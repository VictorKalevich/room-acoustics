import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import type { MicProfile, MicRoute, MicScope } from '../../src/core/micCalibration';

type Catalog = typeof import('../../src/state/micCatalog');
/** Новый импорт модуля — как перезапуск приложения: другой идентификатор запуска, то же хранилище. */
async function launch(): Promise<Catalog> {
  vi.resetModules();
  return import('../../src/state/micCatalog');
}
const profile: MicProfile = {
  id: 'c2', version: 1, name: 'C2', deviceModel: 'iPhone 17 Pro', inputKind: 'built-in', captureMode: 'PWA', orientation: null,
  origin: 'user', sourceURL: null, sourceDate: null, method: 'Synthetic', referenceHz: 1000, validRangeHz: [20, 400],
  digitizationUncertaintyDb: null, validationStatus: 'unverified', notes: '', directivitySource: null,
  curve: { kind: 'correction', frequencyHz: [20, 100, 400], correctionDb: [6, 0, -6] },
};
const pick = { mode: 'catalog', profileId: 'c2', version: 1 } as const;
const noise: MicScope = { tool: 'noise' };
const rtaA: MicScope = { tool: 'rta', projectId: 'A' }, rtaB: MicScope = { tool: 'rta', projectId: 'B' };
const sweepA: MicScope = { tool: 'sweep', projectId: 'A' }, clapA: MicScope = { tool: 'clap', projectId: 'A' };
const route: MicRoute = { deviceId: 'dev-1', groupId: 'g', label: 'iPhone Микрофон', sampleRate: 48000 };
let idb: IDBFactory;
beforeEach(() => { idb = new IDBFactory(); vi.stubGlobal('indexedDB', idb); });
afterEach(() => vi.unstubAllGlobals());

async function putRaw(value: unknown) {
  await new Promise<void>((resolve, reject) => {
    const req = idb.open('ra.micCalibration', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('catalog');
    req.onsuccess = () => {
      const tx = req.result.transaction('catalog', 'readwrite');
      tx.objectStore('catalog').put(value, 'v1');
      tx.oncomplete = () => { req.result.close(); resolve(); };
      tx.onabort = () => reject(tx.error);
    };
  });
}

describe('054 · один каталог для всех инструментов', () => {
  it('одна запись доступна во всех инструментах и проектах без автоматического выбора', async () => {
    const { micCatalog } = await launch();
    await micCatalog.saveVersion(profile);
    for (const scope of [noise, rtaA, rtaB, sweepA, clapA]) {
      const row = await micCatalog.read(scope);
      expect(row.profiles.filter(p => p.id === 'c2')).toEqual([profile]);
      expect(row.selection).toEqual(scope.tool === 'noise' ? { mode: 'none' } : { mode: 'legacy' });
      expect(row.confirmed).toBe(false);
    }
  });

  it('выбор независим по инструменту и проекту; legacy возвращается полностью', async () => {
    const { micCatalog } = await launch();
    await micCatalog.saveVersion(profile);
    await micCatalog.select(rtaA, pick);
    await micCatalog.select(clapA, { mode: 'none' });
    expect((await micCatalog.read(rtaA)).selection).toEqual(pick);
    expect((await micCatalog.read(rtaB)).selection).toEqual({ mode: 'legacy' });
    expect((await micCatalog.read(sweepA)).selection).toEqual({ mode: 'legacy' });
    expect((await micCatalog.read(clapA)).selection).toEqual({ mode: 'none' });
    expect((await micCatalog.read(noise)).selection).toEqual({ mode: 'none' });
    await micCatalog.select(rtaA, { mode: 'legacy' });
    expect((await micCatalog.read(rtaA)).selection).toEqual({ mode: 'legacy' });
    expect(await micCatalog.references(profile)).toEqual([]);
  });

  it('UX-003: подтверждение без проверенного входа живёт до перезапуска, с проверенным — переживает его', async () => {
    let { micCatalog } = await launch();
    await micCatalog.saveVersion(profile);
    await micCatalog.select(rtaA, pick);
    await expect(micCatalog.bindRoute(rtaA, await micCatalog.read(rtaA), route)).rejects.toThrow(/Подтвердите/);
    await micCatalog.confirm(rtaA, await micCatalog.read(rtaA), true);
    expect(await micCatalog.read(rtaA)).toMatchObject({ confirmed: true, persistent: false });
    // другие инструменты и проекты подтверждение не получают
    await micCatalog.select(sweepA, pick);
    expect((await micCatalog.read(sweepA)).confirmed).toBe(false);
    ({ micCatalog } = await launch());
    expect((await micCatalog.read(rtaA)).confirmed).toBe(false);
    await micCatalog.confirm(rtaA, await micCatalog.read(rtaA), true);
    // браузер не сообщил идентификатор входа — подтверждение остаётся только на этот запуск
    expect(await micCatalog.bindRoute(rtaA, await micCatalog.read(rtaA), { ...route, deviceId: '' })).toBe(false);
    expect(await micCatalog.bindRoute(rtaA, await micCatalog.read(rtaA), route)).toBe(true);
    expect(await micCatalog.read(rtaA)).toMatchObject({ confirmed: true, persistent: true });
    ({ micCatalog } = await launch());
    expect(await micCatalog.read(rtaA)).toMatchObject({ confirmed: true, persistent: true });
    expect(await micCatalog.bindRoute(rtaA, await micCatalog.read(rtaA), route)).toBe(true);
  });

  it('UX-003: другой вход, модель, источник, профиль или версия требуют нового подтверждения', async () => {
    const { micCatalog } = await launch();
    await micCatalog.saveVersion(profile);
    await micCatalog.saveVersion({ ...profile, version: 2 });
    const confirmBound = async () => {
      await micCatalog.select(rtaA, pick);
      await micCatalog.confirm(rtaA, await micCatalog.read(rtaA), true);
      await micCatalog.bindRoute(rtaA, await micCatalog.read(rtaA), route);
      expect((await micCatalog.read(rtaA)).persistent).toBe(true);
    };
    await confirmBound();
    await expect(micCatalog.bindRoute(rtaA, await micCatalog.read(rtaA), { ...route, label: 'AirPods' })).rejects.toThrow(/Вход изменился/);
    expect((await micCatalog.read(rtaA)).confirmed).toBe(false);
    await confirmBound();
    await expect(micCatalog.bindRoute(rtaA, await micCatalog.read(rtaA), { ...route, sampleRate: 44100 })).rejects.toThrow(/Вход изменился/);
    await confirmBound();
    const input = (await micCatalog.read(rtaA)).input;
    await micCatalog.saveInput(rtaA, { ...input, confirmedModel: 'Android' });
    expect((await micCatalog.read(rtaA)).confirmed).toBe(false);
    await confirmBound();
    await micCatalog.saveInput(rtaA, { ...(await micCatalog.read(rtaA)).input, source: { localDeviceId: 'usb' } });
    expect((await micCatalog.read(rtaA)).confirmed).toBe(false);
    await micCatalog.saveInput(rtaA, { ...(await micCatalog.read(rtaA)).input, source: 'system' });
    await confirmBound();
    await micCatalog.select(rtaA, { mode: 'catalog', profileId: 'c2', version: 2 });
    expect((await micCatalog.read(rtaA)).confirmed).toBe(false);
    await confirmBound();
    await micCatalog.confirm(rtaA, await micCatalog.read(rtaA), false);
    expect((await micCatalog.read(rtaA)).confirmed).toBe(false);
    // устаревшее ожидание (выбор сменили в другой вкладке) не подтверждается
    const stale = await micCatalog.read(rtaA);
    await micCatalog.select(rtaA, { mode: 'none' });
    await expect(micCatalog.confirm(rtaA, stale, true)).rejects.toThrow(/Выбор микрофона изменился/);
  });

  it('архив версии, используемой несколькими инструментами, и восстановление без активации', async () => {
    const { micCatalog } = await launch();
    await micCatalog.saveVersion(profile);
    for (const scope of [noise, rtaA, sweepA]) {
      await micCatalog.select(scope, pick);
      await micCatalog.confirm(scope, await micCatalog.read(scope), true);
    }
    const refs = await micCatalog.references(profile);
    expect(refs).toHaveLength(3);
    await expect(micCatalog.archive(profile, refs.slice(1))).rejects.toThrow(/Список/);
    await micCatalog.archive(profile, refs);
    for (const scope of [noise, rtaA, sweepA]) {
      const row = await micCatalog.read(scope);
      expect(row.selection).toEqual(pick);
      expect(row.profiles.some(p => p.id === 'c2')).toBe(false);
      expect(row.archived).toEqual([profile]);
      expect(row.confirmed).toBe(false);
    }
    await expect(micCatalog.select(rtaB, pick)).rejects.toThrow(/недоступна/);
    await expect(micCatalog.archive(profile, refs)).rejects.toThrow();
    await micCatalog.restore(profile);
    await expect(micCatalog.restore(profile)).rejects.toThrow(/архиве/);
    const row = await micCatalog.read(rtaA);
    expect(row.profiles.filter(p => p.id === 'c2')).toEqual([profile]);
    expect(row.archived).toEqual([]);
    expect(row.selection).toEqual(pick);
    expect(row.confirmed).toBe(false);
    expect((await micCatalog.read(rtaB)).selection).toEqual({ mode: 'legacy' });
    expect(await micCatalog.nextVersion('c2')).toBe(2);
  });

  it('снимок калибровки замера свипа не меняется после новых версий, архива и перезапуска', async () => {
    let { micCatalog } = await launch();
    await micCatalog.saveVersion(profile);
    await micCatalog.saveRecord(sweepA, 's1', { mode: 'catalog', profile });
    await micCatalog.saveRecord(sweepA, 's2', { mode: 'none' });
    await micCatalog.saveVersion({ ...profile, version: 2, curve: { kind: 'correction', frequencyHz: [20, 100, 400], correctionDb: [0, 0, 0] } });
    await micCatalog.archive(profile, []);
    ({ micCatalog } = await launch());
    expect(await micCatalog.readRecord(sweepA, 's1')).toEqual({ mode: 'catalog', profile });
    expect(await micCatalog.readRecord(sweepA, 's2')).toEqual({ mode: 'none' });
    expect(await micCatalog.readRecord({ tool: 'sweep', projectId: 'B' }, 's1')).toBeNull();
    expect(await micCatalog.readRecord(sweepA, 'legacy-session')).toBeNull();
    await micCatalog.saveRecord(sweepA, 's1', { mode: 'none' });
    expect(await micCatalog.readRecord(sweepA, 's1')).toEqual({ mode: 'none' });
  });

  it('данные C1 без подтверждений и снимков читаются; повреждённые — ошибка без перезаписи', async () => {
    const c1 = { schema: 1, preferredModel: null, entries: [{ profile, archived: false }],
      settings: [{ scope: noise, selection: pick, input: { confirmedModel: null, source: 'system', absoluteCalibration: null } }] };
    await putRaw(c1);
    const { micCatalog } = await launch();
    expect(await micCatalog.read(noise)).toMatchObject({ selection: pick, confirmed: false, persistent: false });
    expect((await micCatalog.read(rtaA)).selection).toEqual({ mode: 'legacy' });
    await putRaw({ ...c1, settings: [{ ...c1.settings[0], confirmation: { profileId: 'c2', version: 'x' } }] });
    await expect(micCatalog.read(noise)).rejects.toThrow(/подтверждение/);
    await putRaw({ ...c1, records: [{ scope: sweepA, session: 's', savedAt: 'never', calibration: { mode: 'none' } }] });
    await expect(micCatalog.read(sweepA)).rejects.toThrow(/снимок/);
    await expect(micCatalog.saveRecord(sweepA, 's', { mode: 'none' })).rejects.toThrow();
    await putRaw({ schema: 999 });
    await expect(micCatalog.read(rtaA)).rejects.toThrow(/Неизвестный формат/);
    await expect(micCatalog.select(rtaA, { mode: 'none' })).rejects.toThrow(/Неизвестный формат/);
  });

  it('недоступное хранилище — ошибка чтения, а не тихий выбор', async () => {
    vi.stubGlobal('indexedDB', { open() { const req: Record<string, unknown> = {}; queueMicrotask(() => { req.error = new Error('blocked'); (req.onerror as () => void)(); }); return req; } });
    const { micCatalog } = await launch();
    await expect(micCatalog.read(rtaA)).rejects.toThrow('blocked');
  });
});
