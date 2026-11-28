// V2-010: фоновые расчёты через договор воркера ядра, кэш, сохранённые расчёты, резервная копия.
import { afterEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { runHandler } from '../../src/workers/computeHandlers';
import type { ComputeMessage, ComputeReply } from '../../src/workers/computeJobs';
import { evaluateSetup } from '../../src/core/system';
import { computeClient, ComputeAborted, type WorkerLike } from '../../src/v2/application/compute';
import { lru, memoAsync } from '../../src/v2/application/cache';
import { coreInputs } from '../../src/v2/adapters/core';
import { calcModes } from '../../src/v2/adapters/calculations';
import { DEFAULT_NEW_ROOM, roomsService, type Clock } from '../../src/v2/application/rooms';
import { openV2Db, req, type V2Db } from '../../src/v2/storage/db';
import { loadCalculation, PER_ROOM, saveCalculation } from '../../src/v2/storage/calculations';
import { BACKUP_STORES, exportBackup, parseBackup, requestPersistence, restoreBackup } from '../../src/v2/storage/backup';

/** Воркер в том же процессе: та же очередь сообщений и те же обработчики, ответы — асинхронно. */
function fakeWorker(opts: { crash?: boolean; delay?: number } = {}): WorkerLike & { sent: ComputeMessage[] } {
  const cancelled = new Set<number>();
  const w: WorkerLike & { sent: ComputeMessage[] } = {
    sent: [], onmessage: null, onerror: null, terminate: () => undefined,
    postMessage(m) {
      w.sent.push(m);
      if ('cancel' in m) { cancelled.add(m.cancel); return; }
      if ('priority' in m) return;
      setTimeout(() => {
        if (cancelled.has(m.id)) return;
        if (opts.crash) { w.onerror?.({ message: 'out of memory' }); return; }
        const reply = (r: ComputeReply) => w.onmessage?.({ data: r });
        try {
          const result = runHandler(m.type, m.payload, (v) => reply({ id: m.id, kind: 'progress', value: v }));
          reply({ id: m.id, kind: 'done', result });
        } catch (e) {
          reply({ id: m.id, kind: 'error', error: (e as Error).message });
        }
      }, opts.delay ?? 0);
    },
  };
  return w;
}

let seq = 0;
const clock: Clock = { now: () => new Date(Date.parse('2026-11-27T10:00:00Z') + 1000 * ++seq).toISOString(), newId: () => `id-${++seq}` };
let dbs: V2Db[] = [];
afterEach(() => { dbs.forEach((d) => d.close()); dbs = []; });
const v2db = (f = new IDBFactory()) => { const d = openV2Db(f); dbs.push(d); return d; };

describe('059 V2-010 · фоновые расчёты', () => {
  it('результат через воркер совпадает с прямым вызовом ядра, прогресс приходит', async () => {
    const room = await roomsService(v2db(), clock).create(DEFAULT_NEW_ROOM);
    const i = coreInputs(room.current);
    const progress: number[] = [];
    const client = computeClient(() => fakeWorker());
    const ev = await client.run('evaluate', { room: i.room, sources: i.sources, constraints: i.constraints, setup: i.setup, ppo: 24 }, { onProgress: (v) => progress.push(v) });
    expect(ev).toEqual(JSON.parse(JSON.stringify(evaluateSetup(i.room, i.sources, i.constraints, i.setup, { ppo: 24 }))));
    expect(client.pending()).toBe(0);
  });

  it('отмена: ошибка AbortError, воркер получает отмену', async () => {
    const w = fakeWorker({ delay: 20 });
    const client = computeClient(() => w);
    const ac = new AbortController();
    const room = await roomsService(v2db(), clock).create(DEFAULT_NEW_ROOM);
    const i = coreInputs(room.current);
    const p = client.run('evaluate', { room: i.room, sources: i.sources, constraints: i.constraints, setup: i.setup }, { signal: ac.signal });
    ac.abort();
    await expect(p).rejects.toBeInstanceOf(ComputeAborted);
    expect(w.sent.some((m) => 'cancel' in m)).toBe(true);
    await expect(client.run('modes', { room: i.room }, { signal: ac.signal })).rejects.toBeInstanceOf(ComputeAborted);
  });

  it('ошибка задачи и сбой воркера доходят до вызывающего; после сбоя создаётся новый воркер', async () => {
    let made = 0;
    const client = computeClient(() => (made++ === 0 ? fakeWorker({ crash: true }) : fakeWorker()));
    const room = await roomsService(v2db(), clock).create(DEFAULT_NEW_ROOM);
    const i = coreInputs(room.current);
    await expect(client.run('modes', { room: i.room })).rejects.toThrow(/прервался/);
    await expect(client.run('nope' as 'modes', { room: i.room })).rejects.toThrow(/Неизвестная задача/);
    expect(made).toBe(2);
  });

  it('без Worker — расчёт в основном потоке теми же обработчиками', async () => {
    const room = await roomsService(v2db(), clock).create(DEFAULT_NEW_ROOM);
    const i = coreInputs(room.current);
    const r = await computeClient(null).run('modes', { room: i.room, fMax: 120 });
    expect(r.length).toBeGreaterThan(0);
  });
});

describe('059 V2-010 · кэш', () => {
  it('LRU вытесняет давно не использованное', () => {
    const c = lru<number>(2);
    c.set('a', 1); c.set('b', 2); c.get('a'); c.set('c', 3);
    expect([c.has('a'), c.has('b'), c.has('c'), c.size]).toEqual([true, false, true, 2]);
  });

  it('один расчёт на ключ, ошибка не кэшируется', async () => {
    const c = lru<Promise<number>>(4);
    let calls = 0;
    const a = memoAsync(c, 'k', async () => ++calls);
    const b = memoAsync(c, 'k', async () => ++calls);
    expect(await a).toBe(1);
    expect(await b).toBe(1);
    await expect(memoAsync(c, 'bad', () => Promise.reject(new Error('x')))).rejects.toThrow();
    await Promise.resolve();
    expect(c.has('bad')).toBe(false);
  });

  it('сохранённый расчёт: ключ по входу, не больше PER_ROOM на комнату, удаляется с комнатой', async () => {
    const db = v2db();
    const svc = roomsService(db, clock);
    const room = await svc.create(DEFAULT_NEW_ROOM);
    const m = calcModes(room.current, clock.now());
    if (!m.ok) throw new Error('нет расчёта');
    const key = await saveCalculation(db, room.id, m.result.provenance, m.result.value);
    expect((await loadCalculation(db, key))?.value).toEqual(JSON.parse(JSON.stringify(m.result.value)));
    for (let k = 0; k < PER_ROOM + 3; k++) await saveCalculation(db, room.id, { ...m.result.provenance, inputHash: `h${k}`, createdAt: clock.now() }, k);
    const count = () => db.run('calculations', 'readonly', (tx) => req(tx.objectStore('calculations').count()));
    expect(await count()).toBe(PER_ROOM);
    await svc.remove(room.id);
    expect(await count()).toBe(0);
  });
});

describe('059 V2-010 · резервная копия', () => {
  it('копия → восстановление в пустую базу даёт те же данные; кэш расчётов не входит', async () => {
    const a = v2db();
    const svc = roomsService(a, clock);
    const r1 = await svc.create(DEFAULT_NEW_ROOM);
    await svc.create({ ...DEFAULT_NEW_ROOM, name: 'Вторая' });
    await a.run(['measurements', 'measurementData', 'calculations'], 'readwrite', (tx) => {
      tx.objectStore('measurements').put({ id: 'm1', roomId: r1.id, budget: { missing: 'unknown' } });
      tx.objectStore('measurementData').put({ id: 'm1', f: [20], db: [70] });
      tx.objectStore('calculations').put({ id: 'c1', roomId: r1.id });
    });
    const backup = parseBackup(JSON.stringify(await exportBackup(a, clock.now())));
    expect(Object.keys(backup.stores).sort()).toEqual([...BACKUP_STORES].sort());
    expect(backup.stores.calculations).toBeUndefined();
    const b = v2db();
    expect(await restoreBackup(b, backup, 'merge')).toMatchObject({ differing: [] });
    expect(await exportBackup(b, backup.createdAt)).toEqual(backup);
  });

  it('«добавить» не перезаписывает отличающиеся записи и перечисляет их; «заменить» очищает базу', async () => {
    const db = v2db();
    const svc = roomsService(db, clock);
    const r = await svc.create(DEFAULT_NEW_ROOM);
    const backup = await exportBackup(db, clock.now());
    const renamed = await svc.save({ ...r, name: 'Изменена после копии' }, r);
    await svc.create({ ...DEFAULT_NEW_ROOM, name: 'Новая' });
    const merged = await restoreBackup(db, backup, 'merge');
    expect(merged.differing).toEqual(expect.arrayContaining([{ store: 'rooms', id: r.id }]));
    expect((await svc.open(r.id))?.name).toBe(renamed.name);
    await restoreBackup(db, backup, 'replace');
    expect((await svc.list()).rooms.map((x) => x.name)).toEqual([r.name]);
  });

  it('чужой и повреждённый файл отклоняются с причиной', () => {
    expect(() => parseBackup('{')).toThrow(/не JSON/);
    expect(() => parseBackup('{"format":"x"}')).toThrow(/не резервная копия/);
    expect(() => parseBackup(JSON.stringify({ format: 'room-acoustics-v2-backup', version: 9, stores: {} }))).toThrow(/новой версией/);
    expect(() => parseBackup(JSON.stringify({ format: 'room-acoustics-v2-backup', version: 1, stores: { rooms: [{ id: 'r', schema: 1 }] } }))).toThrow(/повреждена/);
    expect(() => parseBackup(JSON.stringify({ format: 'room-acoustics-v2-backup', version: 1, stores: { secrets: [] } }))).toThrow(/Неизвестная область/);
  });

  it('постоянное хранилище: без API — null, а не выдуманные значения', async () => {
    expect(await requestPersistence(undefined)).toEqual({ persisted: null, usage: null, quota: null });
    expect(await requestPersistence({ persisted: async () => false, persist: async () => true, estimate: async () => ({ usage: 10, quota: 100 }) })).toEqual({ persisted: true, usage: 10, quota: 100 });
  });
});
