// V2-008: IndexedDB v2 и сценарии комнат — отдельная база, конфликт вкладок, удаление со связанными записями.
import { afterEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { openV2Db, req, ROOM_OWNED, StorageError, STORE_NAMES, V2_DB_NAME, type V2Db } from '../../src/v2/storage/db';
import { getMeta, listRooms, saveRoom } from '../../src/v2/storage/rooms';
import { buildRoom, DEFAULT_NEW_ROOM, newRoomIssues, roomsService, type Clock } from '../../src/v2/application/rooms';
import { coreInputs } from '../../src/v2/adapters/core';
import { newProject } from '../../src/state/project';

let dbs: V2Db[] = [];
afterEach(() => { dbs.forEach((d) => d.close()); dbs = []; });

function setup(factory = new IDBFactory()) {
  const db = openV2Db(factory);
  dbs.push(db);
  let t = Date.parse('2026-11-27T10:00:00.000Z');
  let n = 0;
  const clock: Clock = { now: () => new Date((t += 1000)).toISOString(), newId: () => `id-${++n}` };
  return { factory, db, clock, svc: roomsService(db, clock) };
}

describe('059 V2-008 · база v2', () => {
  it('отдельное имя и все области хранения', async () => {
    const { factory, db } = setup();
    expect(V2_DB_NAME).not.toMatch(/^(room-acoustics|ra\.noiseHistory|ra\.micCalibration)$/);
    await db.run('meta', 'readonly', () => undefined);
    const names = (await factory.databases()).map((d) => d.name);
    expect(names).toEqual([V2_DB_NAME]);
    const stores = await db.run('rooms', 'readonly', (tx) => Array.from(tx.db.objectStoreNames));
    expect([...stores].sort()).toEqual([...STORE_NAMES].sort());
    expect(ROOM_OWNED).toEqual(['measurements', 'snapshots', 'calculations', 'optimizationRuns', 'actionPlans', 'reports']);
  });

  it('ошибка внутри транзакции откатывает все её записи', async () => {
    const { db } = setup();
    await expect(db.run(['meta'], 'readwrite', async (tx) => {
      await req(tx.objectStore('meta').put({ id: 'a', value: 1 }));
      throw new Error('сбой');
    })).rejects.toBeInstanceOf(StorageError);
    expect(await db.run('meta', 'readonly', (tx) => req(tx.objectStore('meta').get('a')))).toBeUndefined();
  });

  it('без IndexedDB — понятная ошибка «недоступно»', async () => {
    const db = openV2Db(undefined);
    await expect(db.run('rooms', 'readonly', () => 1)).rejects.toMatchObject({ kind: 'unavailable' });
  });
});

describe('059 V2-008 · сценарии комнат', () => {
  it('новая комната — значения по умолчанию legacy, активная', async () => {
    const { svc } = setup();
    const room = await svc.create({ ...DEFAULT_NEW_ROOM, name: '  Гостиная ' });
    expect(room.name).toBe('Гостиная');
    const legacy = newProject();
    const mine = coreInputs(room.current);
    expect(mine.room).toEqual(legacy.room);
    expect(mine.sources).toEqual(legacy.sources);
    expect(mine.constraints).toEqual(legacy.constraints);
    expect({ ...mine.setup, id: '', name: '' }).toEqual({ ...legacy.current, id: '', name: '' });
    expect((await svc.active())?.id).toBe(room.id);
    expect((await svc.list()).rooms.map((r) => r.id)).toEqual([room.id]);
  });

  it('состав системы и проверка ввода', () => {
    let n = 0;
    const id = () => `x${++n}`;
    expect(buildRoom({ ...DEFAULT_NEW_ROOM, layout: 'mono' }, id, 'now').current.audio.sources.map((s) => s.id)).toEqual(['spkC']);
    expect(buildRoom({ ...DEFAULT_NEW_ROOM, layout: '2.2' }, id, 'now').current.audio.sources.map((s) => s.id)).toEqual(['spkL', 'spkR', 'sub1', 'sub2']);
    expect(newRoomIssues({ ...DEFAULT_NEW_ROOM, name: ' ', depth: 0.2 }).map((i) => i.path)).toEqual(['geometry.depth', 'name']);
    expect(() => buildRoom({ ...DEFAULT_NEW_ROOM, height: 40 }, id, 'now')).toThrow(/Высота/);
  });

  it('сохранение от устаревшей версии — конфликт, чужое изменение не перезаписано', async () => {
    const { svc } = setup();
    const base = await svc.create(DEFAULT_NEW_ROOM);
    const tabA = await svc.save({ ...base, name: 'Вкладка A' }, base);
    await expect(svc.save({ ...base, name: 'Вкладка B' }, base)).rejects.toMatchObject({ kind: 'conflict' });
    expect((await svc.open(base.id))?.name).toBe('Вкладка A');
    const again = await svc.save({ ...tabA, name: 'A2' }, tabA);
    expect(again.updatedAt > tabA.updatedAt).toBe(true);
  });

  it('создание поверх существующей записи — конфликт', async () => {
    const { db, svc } = setup();
    const room = await svc.create(DEFAULT_NEW_ROOM);
    await expect(saveRoom(db, room, null)).rejects.toMatchObject({ kind: 'conflict' });
  });

  it('удаление убирает связанные записи только этой комнаты и активную ссылку', async () => {
    const { db, svc } = setup();
    const a = await svc.create(DEFAULT_NEW_ROOM);
    const b = await svc.create({ ...DEFAULT_NEW_ROOM, name: 'Вторая' });
    await svc.setActive(a.id);
    await db.run(['measurements', 'measurementData', 'snapshots'], 'readwrite', (tx) => {
      tx.objectStore('measurements').put({ id: 'm1', roomId: a.id });
      tx.objectStore('measurementData').put({ id: 'm1', samples: [1, 2] });
      tx.objectStore('measurements').put({ id: 'm2', roomId: b.id });
      tx.objectStore('measurementData').put({ id: 'm2', samples: [3] });
      tx.objectStore('snapshots').put({ id: 's1', roomId: a.id });
    });
    await svc.remove(a.id);
    const left = await db.run(['measurements', 'measurementData', 'snapshots'], 'readonly', async (tx) => ({
      m: await req(tx.objectStore('measurements').getAllKeys()),
      d: await req(tx.objectStore('measurementData').getAllKeys()),
      s: await req(tx.objectStore('snapshots').getAllKeys()),
    }));
    expect(left).toEqual({ m: ['m2'], d: ['m2'], s: [] });
    expect(await getMeta(db, 'activeRoomId')).toBeUndefined();
    expect((await svc.list()).rooms.map((r) => r.id)).toEqual([b.id]);
  });

  it('копия — новые идентификаторы комнаты и конфигураций', async () => {
    const { svc } = setup();
    const a = await svc.create(DEFAULT_NEW_ROOM);
    const c = await svc.duplicate(a.id);
    expect(c.name).toBe('Моя комната (копия)');
    expect(c.id).not.toBe(a.id);
    expect(c.current.id).not.toBe(a.current.id);
    expect(c.current.geometry).toEqual(a.current.geometry);
  });

  it('повреждённая запись показывается отдельно, остальные комнаты открываются', async () => {
    const { db, svc } = setup();
    const a = await svc.create(DEFAULT_NEW_ROOM);
    await db.run('rooms', 'readwrite', (tx) => req(tx.objectStore('rooms').put({ id: 'bad', schema: 1, name: 'x' })));
    const { rooms, damaged } = await listRooms(db);
    expect(rooms.map((r) => r.id)).toEqual([a.id]);
    expect(damaged).toEqual([{ id: 'bad', reason: 'нет текущей конфигурации' }]);
    await expect(svc.open('bad')).rejects.toMatchObject({ kind: 'corrupt' });
  });

  it('данные переживают переоткрытие базы', async () => {
    const { factory, svc } = setup();
    const a = await svc.create(DEFAULT_NEW_ROOM);
    const other = setup(factory);
    expect((await other.svc.open(a.id))?.current).toEqual(a.current);
  });
});
