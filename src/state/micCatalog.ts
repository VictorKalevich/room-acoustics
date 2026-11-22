import { builtinProfiles, faberStudy } from '../core/micBuiltins';
import { defaultMicSelection, type MicCatalog, type MicInputPreference, type MicProfile, type MicScope, type MicSelection } from '../core/micCalibration';
import { validateProfile } from '../core/micCurve';

type Entry = { profile: MicProfile; archived: boolean };
type Setting = { scope: MicScope; selection: MicSelection; input: MicInputPreference };
interface CatalogData { schema: 1; preferredModel?: string | null; entries: Entry[]; settings: Setting[] }
export const defaultInput = (): MicInputPreference => ({ confirmedModel: null, source: 'system', absoluteCalibration: null });
const sameScope = (a: MicScope, b: MicScope) => a.tool === b.tool && (a.tool === 'noise' || (b.tool !== 'noise' && a.projectId === b.projectId));
export const sameVersion = (a: Pick<MicProfile, 'id' | 'version'>, b: Pick<MicProfile, 'id' | 'version'>) => a.id === b.id && a.version === b.version;
function matches(selection: MicSelection, p: MicProfile) {
  return selection.mode === 'catalog' && selection.profileId === p.id && selection.version === p.version;
}
function setting(data: CatalogData, scope: MicScope) {
  let row = data.settings.find(s => sameScope(scope, s.scope));
  if (!row) {
    row = { scope, selection: defaultMicSelection(scope), input: { ...defaultInput(), confirmedModel: data.preferredModel ?? null } };
    data.settings.push(row);
  }
  return row;
}
function checkInput(input: MicInputPreference) {
  if (!input || (input.confirmedModel !== null && typeof input.confirmedModel !== 'string') ||
      (input.source !== 'system' && (typeof input.source?.localDeviceId !== 'string' || !input.source.localDeviceId)))
    throw new Error('Повреждены настройки входа.');
  const absolute = input.absoluteCalibration;
  if (absolute !== null && (!absolute || !Number.isFinite(absolute.offsetDb) || !absolute.physicalInput ||
      !absolute.captureMode || !Number.isFinite(Date.parse(absolute.verifiedAt)) || input.source === 'system' ||
      absolute.physicalInput !== input.source.localDeviceId)) throw new Error('Абсолютная калибровка требует проверенного физического входа и тракта.');
}
function checkData(data: CatalogData) {
  if ((data.preferredModel != null && typeof data.preferredModel !== 'string') || data.schema !== 1 || !Array.isArray(data.entries) || !Array.isArray(data.settings))
    throw new Error('Неизвестный формат каталога. Данные сохранены.');
  for (const entry of data.entries) {
    validateProfile(entry.profile);
    if (entry.profile.origin !== 'user' || typeof entry.archived !== 'boolean') throw new Error('Повреждена запись каталога.');
  }
  for (const row of data.settings) {
    if (!row.scope || !['noise','rta','sweep','clap'].includes(row.scope.tool) ||
        (row.scope.tool !== 'noise' && !row.scope.projectId) ||
        !row.selection || !['legacy','none','catalog'].includes(row.selection.mode) ||
        (row.selection.mode === 'catalog' && (!row.selection.profileId || !Number.isSafeInteger(row.selection.version))))
      throw new Error('Повреждён выбор инструмента.');
    checkInput(row.input);
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
export const micCatalog = {
  studies: [faberStudy] as const,
  list: () => access(false, available),
  read(scope: MicScope) {
    return access(false, data => ({ profiles: available(data), ...setting(data, scope) }));
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
      setting(data, scope).selection = selection;
    });
  },
  readInput: (scope: MicScope) => access(false, data => setting(data, scope).input),
  saveInput(scope: MicScope, preference: MicInputPreference) {
    return access(true, data => {
      checkInput(preference);
      const row = setting(data, scope);
      if (row.input.confirmedModel !== preference.confirmedModel) data.preferredModel = preference.confirmedModel;
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
    });
  },
} satisfies MicCatalog & Record<string, unknown>;
