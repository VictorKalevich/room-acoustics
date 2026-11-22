import { builtinProfiles, faberStudy } from '../core/micBuiltins';
import {
  defaultMicSelection, type MicCatalog, type MicConfirmation, type MicInputPreference, type MicProfile, type MicRecordCalibration,
  type MicRoute, type MicScope, type MicSelection,
} from '../core/micCalibration';
import { validateProfile } from '../core/micCurve';

type Entry = { profile: MicProfile; archived: boolean };
type Setting = { scope: MicScope; selection: MicSelection; input: MicInputPreference; confirmation?: MicConfirmation | null };
interface MeasurementRecord { scope: MicScope; session: string; savedAt: string; calibration: MicRecordCalibration }
// 054: confirmation и records необязательны; код C1 читает и переписывает их без изменений.
interface CatalogData { schema: 1; preferredModel?: string | null; entries: Entry[]; settings: Setting[]; records?: MeasurementRecord[] }
export const defaultInput = (): MicInputPreference => ({ confirmedModel: null, source: 'system', absoluteCalibration: null });
/** Один запуск приложения. Подтверждение без проверенной дорожки после перезапуска недействительно. */
const run = globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36) + Math.random().toString(36).slice(2);
const sameScope = (a: MicScope, b: MicScope) => a.tool === b.tool && (a.tool === 'noise' || (b.tool !== 'noise' && a.projectId === b.projectId));
export const sameVersion = (a: Pick<MicProfile, 'id' | 'version'>, b: Pick<MicProfile, 'id' | 'version'>) => a.id === b.id && a.version === b.version;
function matches(selection: MicSelection, p: Pick<MicProfile, 'id' | 'version'>) {
  return selection.mode === 'catalog' && selection.profileId === p.id && selection.version === p.version;
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export const usableRoute = (route: MicRoute | null | undefined): route is MicRoute => !!route && typeof route.deviceId === 'string' && route.deviceId !== '';
function setting(data: CatalogData, scope: MicScope) {
  let row = data.settings.find(s => sameScope(scope, s.scope));
  if (!row) {
    row = { scope, selection: defaultMicSelection(scope), input: { ...defaultInput(), confirmedModel: data.preferredModel ?? null } };
    data.settings.push(row);
  }
  return row;
}
const checkScope = (scope: MicScope) => !!scope && ['noise', 'rta', 'sweep', 'clap'].includes(scope.tool) && (scope.tool === 'noise' || !!scope.projectId);
function checkInput(input: MicInputPreference) {
  if (!input || (input.confirmedModel !== null && typeof input.confirmedModel !== 'string') ||
      (input.source !== 'system' && (typeof input.source?.localDeviceId !== 'string' || !input.source.localDeviceId)))
    throw new Error('Повреждены настройки входа.');
  const absolute = input.absoluteCalibration;
  if (absolute !== null && (!absolute || !Number.isFinite(absolute.offsetDb) || !absolute.physicalInput ||
      !absolute.captureMode || !Number.isFinite(Date.parse(absolute.verifiedAt)) || input.source === 'system' ||
      absolute.physicalInput !== input.source.localDeviceId)) throw new Error('Абсолютная калибровка требует проверенного физического входа и тракта.');
}
function checkConfirmation(c: MicConfirmation | null | undefined) {
  if (c == null) return;
  if (typeof c.profileId !== 'string' || !Number.isSafeInteger(c.version) || (c.model !== null && typeof c.model !== 'string') ||
      (c.source !== 'system' && typeof c.source?.localDeviceId !== 'string') || (c.run !== null && typeof c.run !== 'string') ||
      (c.route !== null && !(usableRoute(c.route) && Number.isFinite(c.route.sampleRate) && typeof c.route.label === 'string')))
    throw new Error('Повреждено подтверждение профиля.');
}
function checkData(data: CatalogData) {
  if ((data.preferredModel != null && typeof data.preferredModel !== 'string') || data.schema !== 1 || !Array.isArray(data.entries) ||
      !Array.isArray(data.settings) || (data.records !== undefined && !Array.isArray(data.records)))
    throw new Error('Неизвестный формат каталога. Данные сохранены.');
  for (const entry of data.entries) {
    validateProfile(entry.profile);
    if (entry.profile.origin !== 'user' || typeof entry.archived !== 'boolean') throw new Error('Повреждена запись каталога.');
  }
  for (const row of data.settings) {
    if (!checkScope(row.scope) || !row.selection || !['legacy','none','catalog'].includes(row.selection.mode) ||
        (row.selection.mode === 'catalog' && (!row.selection.profileId || !Number.isSafeInteger(row.selection.version))))
      throw new Error('Повреждён выбор инструмента.');
    checkInput(row.input);
    checkConfirmation(row.confirmation);
  }
  for (const record of data.records ?? []) {
    if (!checkScope(record?.scope) || typeof record.session !== 'string' || !Number.isFinite(Date.parse(record.savedAt)) ||
        !['none', 'catalog'].includes(record.calibration?.mode)) throw new Error('Повреждён снимок калибровки замера.');
    if (record.calibration.mode === 'catalog') validateProfile(record.calibration.profile);
  }
}

// A single read/modify/write IDB transaction serializes concurrent tabs and commits
// selection checks with profile mutations. The project database is never opened.
async function access<T>(write: boolean, action: (data: CatalogData) => T): Promise<T> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open('ra.micCalibration', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('catalog');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Закройте другие вкладки для обновления каталога.'));
  });
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction('catalog', write ? 'readwrite' : 'readonly');
      const store = tx.objectStore('catalog');
      const req = store.get('v1');
      let result: T;
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(tx.error ?? new Error('Операция каталога отменена.'));
      req.onsuccess = () => {
        try {
          const data: CatalogData = req.result === undefined ? { schema: 1, entries: [], settings: [] } : req.result;
          checkData(data);
          result = action(data);
          if (write) store.put(data, 'v1');
        } catch (error) { tx.abort(); reject(error); }
      };
    });
  } finally { db.close(); }
}

const available = (d: CatalogData) => [...builtinProfiles, ...d.entries.filter(e => !e.archived).map(e => e.profile)];
const archivedOf = (d: CatalogData) => d.entries.filter(e => e.archived).map(e => e.profile);
/** Подтверждение действует для той же версии, того же входа и модели; без дорожки — только в этом запуске. */
function confirmed(data: CatalogData, row: Setting) {
  const c = row.confirmation, s = row.selection;
  return !!c && s.mode === 'catalog' && c.profileId === s.profileId && c.version === s.version &&
    available(data).some(p => matches(s, p)) && same(c.source, row.input.source) && c.model === row.input.confirmedModel &&
    (c.route !== null || c.run === run);
}
function expectRow(row: Setting, expected: { selection: MicSelection; input: MicInputPreference }) {
  if (!same(row.selection, expected.selection) || !same(row.input, expected.input)) throw new Error('Выбор микрофона изменился. Проверьте настройки.');
}
export const micCatalog = {
  studies: [faberStudy] as const,
  list: () => access(false, available),
  read(scope: MicScope) {
    return access(false, data => {
      const row = setting(data, scope);
      return { profiles: available(data), archived: archivedOf(data), selection: row.selection, input: row.input,
        confirmed: confirmed(data, row), persistent: confirmed(data, row) && row.confirmation!.route !== null };
    });
  },
  nextVersion(id: string) {
    return access(false, data => data.entries.reduce((last, e) => e.profile.id === id ? Math.max(last, e.profile.version) : last, 0) + 1);
  },
  saveVersion(profile: MicProfile) {
    return access(true, data => {
      validateProfile(profile);
      if (profile.origin !== 'user' || builtinProfiles.some(p => p.id === profile.id)) throw new Error('Встроенная версия защищена.');
      const latest = data.entries.reduce((v, e) => e.profile.id === profile.id ? Math.max(v, e.profile.version) : v, 0);
      if (profile.version !== latest + 1) throw new Error('Версия изменилась. Откройте актуальный список.');
      data.entries.push({ profile, archived: false });
    });
  },
  readSelection: (scope: MicScope) => access(false, data => setting(data, scope).selection),
  select(scope: MicScope, selection: MicSelection) {
    return access(true, data => {
      if (selection.mode === 'catalog' && !available(data).some(p => matches(selection, p))) throw new Error('Версия профиля недоступна.');
      const row = setting(data, scope);
      row.selection = selection;
      row.confirmation = null;
    });
  },
  readInput: (scope: MicScope) => access(false, data => setting(data, scope).input),
  saveInput(scope: MicScope, preference: MicInputPreference) {
    return access(true, data => {
      checkInput(preference);
      const row = setting(data, scope);
      if (row.input.confirmedModel !== preference.confirmedModel) data.preferredModel = preference.confirmedModel;
      if (!same(row.input.source, preference.source) || row.input.confirmedModel !== preference.confirmedModel) row.confirmation = null;
      row.input = preference;
    });
  },
  saveAbsolute(scope: MicScope, expected: MicInputPreference, absolute: MicInputPreference['absoluteCalibration']) {
    return access(true, data => {
      const row = setting(data, scope);
      if (JSON.stringify(row.input) !== JSON.stringify(expected)) throw new Error('Настройки входа изменились. Повторите проверку.');
      const next = { ...row.input, absoluteCalibration: absolute };
      checkInput(next);
      row.input = next;
    });
  },
  /** Подтвердить или снять подтверждение текущего выбора инструмента. Другие инструменты не меняются. */
  confirm(scope: MicScope, expected: { selection: MicSelection; input: MicInputPreference }, yes: boolean) {
    return access(true, data => {
      const row = setting(data, scope);
      expectRow(row, expected);
      const s = row.selection;
      if (!yes) { row.confirmation = null; return; }
      if (s.mode !== 'catalog' || !available(data).some(p => matches(s, p))) throw new Error('Версия профиля недоступна.');
      row.confirmation = { profileId: s.profileId, version: s.version, source: row.input.source, model: row.input.confirmedModel, run, route: null };
    });
  },
  /**
   * Перед приёмом данных: подтверждение всё ещё действует и открыта та же дорожка. Первое измерение привязывает
   * дорожку, и подтверждение переживает перезапуск; другая дорожка снимает подтверждение.
   * Возвращает true, если подтверждение сохранится между запусками.
   */
  async bindRoute(scope: MicScope, expected: { selection: MicSelection; input: MicInputPreference }, route: MicRoute | null) {
    // Исключение внутри транзакции откатило бы сброс, поэтому о несовпадении сообщаем после записи.
    const result = await access(true, data => {
      const row = setting(data, scope);
      expectRow(row, expected);
      if (!confirmed(data, row)) throw new Error('Подтвердите применимость профиля перед измерением.');
      const c = row.confirmation!;
      if (c.route === null) {
        if (usableRoute(route)) row.confirmation = { ...c, route };
        return usableRoute(route) ? 'kept' : 'run';
      }
      if (same(c.route, route)) return 'kept';
      row.confirmation = null;
      return 'changed';
    });
    if (result === 'changed') throw new Error('Вход изменился после подтверждения профиля. Проверьте вход и подтвердите профиль заново.');
    return result === 'kept';
  },
  references(profile: MicProfile) {
    return access(false, data => data.settings.filter(s => matches(s.selection, profile)).map(s => s.scope));
  },
  archive(profile: MicProfile, confirmedScopes: MicScope[]) {
    return access(true, data => {
      const entry = data.entries.find(e => sameVersion(e.profile, profile));
      if (!entry || entry.archived) throw new Error('Версия недоступна для удаления.');
      const refs = data.settings.filter(s => matches(s.selection, profile));
      if (refs.length !== confirmedScopes.length || refs.some(s => !confirmedScopes.some(scope => sameScope(scope, s.scope))))
        throw new Error('Список использующих инструментов изменился. Повторите подтверждение.');
      // Retain immutable data and dangling selection visibly until explicit replacement.
      entry.archived = true;
      for (const row of refs) row.confirmation = null;
    });
  },
  /** Вернуть архивную версию в выбор с прежними id, версией и данными. Выбор инструментов не меняется. */
  restore(profile: MicProfile) {
    return access(true, data => {
      const entry = data.entries.find(e => sameVersion(e.profile, profile));
      if (!entry || !entry.archived) throw new Error('Версия не найдена в архиве.');
      entry.archived = false;
    });
  },
  /** Снимок поправки сохранённого замера свипа; повторное сохранение того же сеанса заменяет снимок. */
  saveRecord(scope: MicScope, session: string, calibration: MicRecordCalibration) {
    return access(true, data => {
      data.records ??= [];
      const index = data.records.findIndex(r => sameScope(r.scope, scope) && r.session === session);
      const record = { scope, session, savedAt: new Date().toISOString(), calibration };
      if (index < 0) data.records.push(record); else data.records[index] = record;
    });
  },
  readRecord(scope: MicScope, session: string) {
    return access(false, data => data.records?.find(r => sameScope(r.scope, scope) && r.session === session)?.calibration ?? null);
  },
} satisfies MicCatalog & Record<string, unknown>;
