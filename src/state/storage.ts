// Локальное хранение проектов (IndexedDB) и файл проекта (contracts/project-file.md).
import type { Project } from './project';
import { defaultConstraints, defaultRoom, defaultSources, makeId, validateRoom, validateSources } from './project';
import { SURFACES } from '../core/types';
import { MATERIAL_BY_ID } from '../core/materials';

export const FILE_FORMAT = 'room-acoustics-project';
export const FILE_VERSION = 1;
export const FILE_EXT = '.roomacoustics.json';

export function serializeProject(p: Project): string {
  return JSON.stringify({ format: FILE_FORMAT, version: FILE_VERSION, project: p }, null, 2);
}

export function parseProjectFile(text: string): Project {
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Файл повреждён: это не JSON.');
  }
  if (!data || data.format !== FILE_FORMAT) throw new Error('Это не файл проекта «Акустика комнаты».');
  if (typeof data.version !== 'number' || data.version > FILE_VERSION) {
    throw new Error('Файл создан более новой версией приложения. Обновите приложение.');
  }
  return normalizeProject(data.project ?? {});
}

/** Заполняет отсутствующие поля умолчаниями и проверяет диапазоны. */
export function normalizeProject(raw: any): Project {
  const room = { ...defaultRoom(), ...(raw.room ?? {}) };
  room.materials = { ...defaultRoom().materials, ...(raw.room?.materials ?? {}) };
  for (const s of SURFACES) if (!MATERIAL_BY_ID[room.materials[s]]) room.materials[s] = defaultRoom().materials[s];
  const roomErr = validateRoom(room);
  if (roomErr.length) throw new Error(`Неверные данные комнаты: ${roomErr.map((e) => e.message).join('; ')}`);
  const sources = Array.isArray(raw.sources) && raw.sources.length ? raw.sources : defaultSources(2, 1);
  const srcErr = validateSources(sources);
  if (srcErr.length) throw new Error(`Неверные источники: ${srcErr.map((e) => e.message).join('; ')}`);
  return {
    id: typeof raw.id === 'string' ? raw.id : makeId(),
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name : 'Комната',
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString(),
    room,
    sources,
    constraints: { ...defaultConstraints(room), ...(raw.constraints ?? {}) },
    scanInfo: raw.scanInfo ?? null,
    result: raw.result ?? null,
    selectedIndex: typeof raw.selectedIndex === 'number' ? raw.selectedIndex : 0,
  };
}

// ---------- IndexedDB ----------

const DB = 'room-acoustics';
const STORE = 'projects';
const META = 'meta';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB недоступна'));
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export async function storageAvailable(): Promise<boolean> {
  try {
    await tx(META, 'readwrite', (s) => s.put(1, 'probe'));
    return true;
  } catch {
    return false;
  }
}

export const saveProject = (p: Project) =>
  tx(STORE, 'readwrite', (s) => s.put(JSON.parse(JSON.stringify(p))));
export const deleteProject = (id: string) => tx(STORE, 'readwrite', (s) => s.delete(id));
export const listProjects = () =>
  tx<Project[]>(STORE, 'readonly', (s) => s.getAll() as IDBRequest<Project[]>).then((all) =>
    all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
  );

/** Черновик текущего проекта — восстанавливается при следующем запуске. */
export const saveDraft = (p: Project) => tx(META, 'readwrite', (s) => s.put(JSON.parse(JSON.stringify(p)), 'draft'));
export const loadDraft = () =>
  tx<Project | undefined>(META, 'readonly', (s) => s.get('draft') as IDBRequest<Project | undefined>).then((d) =>
    d ? normalizeProject(d) : undefined,
  );

export function downloadProject(p: Project) {
  const blob = new Blob([serializeProject(p)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${p.name.replace(/[\\/:*?"<>|]+/g, '_') || 'room'}${FILE_EXT}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
