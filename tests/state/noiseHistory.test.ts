import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { recordView, NoiseRecordError, type NoiseRecord } from '../../src/core/noiseRecord';
import { parseNoiseFile } from '../../src/core/noiseFile';
import { createNoiseHistory, NOISE_DB, storageError } from '../../src/state/noiseHistory';
import { micCatalog } from '../../src/state/micCatalog';
import { legacyExport, sessionRecord, testProfile, toneMeter } from '../fixtures/noise';
import { expectSameView } from '../fixtures/noiseView';

beforeEach(() => vi.stubGlobal('indexedDB', new IDBFactory()));
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const noEstimate = async () => undefined;
const code = async (p: Promise<unknown>) => p.then(() => 'ok', e => (e as NoiseRecordError).code);

function rawPut(store: 'headers' | 'bodies', value: unknown) {
  return new Promise<void>((resolve, reject) => {
    const req = indexedDB.open(NOISE_DB, 1);
    req.onsuccess = () => {
      const tx = req.result.transaction(store, 'readwrite');
      tx.objectStore(store).put(value);
      tx.oncomplete = () => { req.result.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
  });
}

describe('история шумомера в IndexedDB', () => {
  it('сохранение, чтение после перезапуска модуля, переименование и удаление', async () => {
    const meter = toneMeter({ seconds: 10, profile: testProfile });
    const record = sessionRecord(meter, { id: 'session-0001', name: 'Детская' });
    const history = createNoiseHistory(undefined, noEstimate);
    const header = await history.save(record);
    expect(header.name).toBe('Детская');
    // Новый экземпляр модуля — как после перезапуска приложения или обновления PWA: та же база.
    vi.resetModules();
    const { createNoiseHistory: again } = await import('../../src/state/noiseHistory');
    const restarted = again(undefined, noEstimate);
    const list = await restarted.list();
    expect(list.headers.map(h => h.id)).toEqual(['session-0001']);
    expect(list.bytes).toBe(header.bytes);
    expect(list.problems).toEqual([]);
    const back = await restarted.read('session-0001');
    expect(back.content).toEqual(record.content);
    expectSameView(recordView(back.content, back.context), meter);
    await restarted.rename('session-0001', '  Детская, ночь  ');
    const renamed = await restarted.read('session-0001');
    expect(renamed.name).toBe('Детская, ночь');
    // Снимок сеанса неизменен: переименование меняет только заголовок.
    expect(renamed.content).toEqual(record.content);
    expect(await code(restarted.rename('session-0001', 'x'.repeat(101)))).toBe('invalid');
    expect(await code(restarted.rename('missing-0001', 'x'))).toBe('missing');
    await restarted.remove('session-0001');
    expect((await restarted.list()).headers).toEqual([]);
    expect(await code(restarted.read('session-0001'))).toBe('missing');
  });

  it('повторное сохранение — конфликт без перезаписи; замена — только по явному выбору', async () => {
    const history = createNoiseHistory(undefined, noEstimate);
    const meter = toneMeter({ seconds: 4 });
    const text = JSON.stringify(legacyExport(meter, 'Z', 'session', 'Первый импорт'));
    const first = parseNoiseFile(text, 'a.json').record;
    await history.save(first);
    const again = parseNoiseFile(text.replace('Первый импорт', 'Второй импорт'), 'b.json').record;
    expect(again.id).toBe(first.id);
    expect(await code(history.save(again))).toBe('conflict');
    expect((await history.list()).headers[0].name).toBe('Первый импорт');
    await history.save(again, { replace: true });
    const list = await history.list();
    expect(list.headers.map(h => h.name)).toEqual(['Второй импорт']);
  });

  it('пределы числа записей, объёма записи и всей истории; оценка квоты браузера', async () => {
    const small = sessionRecord(toneMeter({ seconds: 2 }), { id: 'small-0001' });
    const bytes = (await createNoiseHistory(undefined, noEstimate).save(small)).bytes;
    await createNoiseHistory(undefined, noEstimate).remove('small-0001');
    const count = createNoiseHistory({ recordBytes: 1e9, totalBytes: 1e9, records: 1 }, noEstimate);
    await count.save(small);
    expect(await code(count.save({ ...small, id: 'small-0002' }))).toBe('limit');
    // Замена той же записи не упирается в предел числа.
    expect(await code(count.save(small, { replace: true }))).toBe('ok');
    await count.remove('small-0001');
    const total = createNoiseHistory({ recordBytes: 1e9, totalBytes: bytes * 1.5, records: 10 }, noEstimate);
    await total.save(small);
    expect(await code(total.save({ ...small, id: 'small-0002' }))).toBe('limit');
    expect(await code(createNoiseHistory({ recordBytes: bytes - 1, totalBytes: 1e9, records: 10 }, noEstimate).save({ ...small, id: 'small-0003' }))).toBe('size');
    const quota = createNoiseHistory(undefined, async () => ({ quota: 1000, usage: 999 }));
    expect(await code(quota.save({ ...small, id: 'small-0004' }))).toBe('full');
    expect((await total.list()).headers.map(h => h.id)).toEqual(['small-0001']);
  });

  it('переполнение хранилища во время записи: транзакция отменяется целиком', async () => {
    const history = createNoiseHistory(undefined, noEstimate);
    const record = sessionRecord(toneMeter({ seconds: 2 }), { id: 'quota-0001' });
    const put = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
      if (this.name === 'bodies') throw new DOMException('Quota exceeded', 'QuotaExceededError');
      return put.apply(this, args);
    });
    const error = await history.save(record).catch(e => e as NoiseRecordError);
    expect((error as NoiseRecordError).code).toBe('full');
    expect((error as Error).message).toMatch(/Недостаточно места/);
    vi.restoreAllMocks();
    const list = await history.list();
    expect(list.headers).toEqual([]);
    expect(list.problems).toEqual([]);
  });

  it('ошибки браузера переводятся в понятные коды', () => {
    expect(storageError(new DOMException('x', 'QuotaExceededError')).code).toBe('full');
    expect(storageError(new DOMException('x', 'VersionError')).code).toBe('newer');
    expect(storageError(new DOMException('x', 'UnknownError')).code).toBe('unavailable');
  });

  it('недоступный IndexedDB — ошибка, а не пустая история', async () => {
    vi.stubGlobal('indexedDB', undefined);
    expect(await code(createNoiseHistory(undefined, noEstimate).list())).toBe('unavailable');
  });

  it('повреждённые и неполные записи видны в списке отдельно, не читаются и удаляются явно', async () => {
    const history = createNoiseHistory(undefined, noEstimate);
    const good = sessionRecord(toneMeter({ seconds: 2 }), { id: 'good-00001' });
    const header = await history.save(good);
    await history.save({ ...good, id: 'broken-001', name: 'Сломанная' });
    await rawPut('bodies', { id: 'broken-001', format: 1, context: good.context, content: { type: 'session', session: { ...(good.content as any).session, totals: null } } });
    await rawPut('headers', { ...header, id: 'nobody-001', name: 'Без данных' });
    await rawPut('bodies', { id: 'orphan-001', format: 1 });
    await rawPut('headers', { id: 'badhead-01', name: 7 });
    const list = await history.list();
    expect(list.headers.map(h => h.id).sort()).toEqual(['broken-001', 'good-00001']);
    expect(list.problems.map(p => [p.id, p.reason]).sort()).toEqual([['badhead-01', 'header'], ['nobody-001', 'body'], ['orphan-001', 'orphan']]);
    expect(await code(history.read('broken-001'))).toBe('corrupt');
    expect(await code(history.read('nobody-001'))).toBe('corrupt');
    await rawPut('bodies', { id: 'good-00001', format: 2, context: good.context, content: good.content });
    expect(await code(history.read('good-00001'))).toBe('newer');
    for (const id of ['broken-001', 'nobody-001', 'orphan-001', 'badhead-01', 'good-00001']) await history.remove(id);
    const empty = await history.list();
    expect(empty.headers).toEqual([]);
    expect(empty.problems).toEqual([]);
  });

  it('снимок калибровки неизменен при новой версии, архивировании и восстановлении профиля в каталоге', async () => {
    const meter = toneMeter({ seconds: 6, profile: testProfile });
    const history = createNoiseHistory(undefined, noEstimate);
    await history.save(sessionRecord(meter, { id: 'calib-0001' }));
    const before = await history.read('calib-0001');
    const spectrum = recordView(before.content, before.context).spectral.average('session', 'Z', true).density;
    await micCatalog.saveVersion(testProfile);
    await micCatalog.saveVersion({ ...testProfile, version: 2, curve: { kind: 'correction', frequencyHz: [20, 20000], correctionDb: [-10, -10] } });
    await micCatalog.archive(testProfile, []);
    let after: NoiseRecord = await history.read('calib-0001');
    expect(after.content).toEqual(before.content);
    expect(recordView(after.content, after.context).spectral.average('session', 'Z', true).density).toEqual(spectrum);
    await micCatalog.restore(testProfile);
    after = await history.read('calib-0001');
    expect(after.content.type === 'session' && after.content.session.calibration!.profile).toEqual(testProfile);
    // Импорт не добавляет снимок в каталог.
    await history.save(parseNoiseFile(JSON.stringify(legacyExport(meter, 'Z', 'session')), 'a.json').record);
    expect((await micCatalog.read({ tool: 'noise' })).profiles.filter(p => p.id === testProfile.id).map(p => p.version)).toEqual([1, 2]);
  });
});
