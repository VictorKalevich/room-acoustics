// Чтение проектов legacy для переноса (V2-009) — только чтение. База legacy `room-acoustics` открывается без версии;
// если её нет, создание отменяется в onupgradeneeded, чтобы перенос не оставил на устройстве пустую базу legacy.
// IndexedDB и localStorage видны только на том же origin, что и legacy; на другом origin перенос — из файла проекта.
import { normalizeProject, parseProjectFile } from '../../state/storage';
import type { Project } from '../../state/project';

export const LEGACY_DB = 'room-acoustics';
export const LEGACY_PENDING_KEY = 'ra-draft-pending';

export type LegacyOrigin = 'draft' | 'pending' | 'saved' | 'file';

export interface LegacyCandidate { project: Project; from: LegacyOrigin }
export interface LegacyProblem { from: LegacyOrigin; id?: string; reason: string }
export interface LegacyRead { candidates: LegacyCandidate[]; problems: LegacyProblem[]; dbFound: boolean }

const reason = (e: unknown) => (e instanceof Error ? e.message : String(e));

function openExisting(factory: IDBFactory): Promise<IDBDatabase | null> {
  return new Promise((resolve, reject) => {
    let created = false;
    let r: IDBOpenDBRequest;
    try {
      r = factory.open(LEGACY_DB);
    } catch (e) {
      reject(e);
      return;
    }
    r.onupgradeneeded = () => {
      created = true;
      r.transaction?.abort();
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = (ev) => {
      if (created) {
        ev.preventDefault();
        resolve(null);
      } else reject(r.error);
    };
    r.onblocked = () => reject(new Error('Хранилище legacy занято другой вкладкой.'));
  });
}

function readAll(db: IDBDatabase): Promise<{ saved: unknown[]; draft: unknown }> {
  const stores = ['projects', 'meta'].filter((s) => db.objectStoreNames.contains(s));
  if (!stores.length) return Promise.resolve({ saved: [], draft: undefined });
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, 'readonly');
    let saved: unknown[] = [];
    let draft: unknown;
    if (stores.includes('projects')) {
      const q = tx.objectStore('projects').getAll();
      q.onsuccess = () => { saved = q.result; };
    }
    if (stores.includes('meta')) {
      const q = tx.objectStore('meta').get('draft');
      q.onsuccess = () => { draft = q.result; };
    }
    tx.oncomplete = () => resolve({ saved, draft });
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function normalized(raw: unknown, from: LegacyOrigin, out: LegacyRead): void {
  try {
    out.candidates.push({ project: normalizeProject(raw), from });
  } catch (e) {
    const id = raw && typeof raw === 'object' && typeof (raw as { id?: unknown }).id === 'string' ? (raw as { id: string }).id : undefined;
    out.problems.push({ from, ...(id ? { id } : {}), reason: reason(e) });
  }
}

/** Рабочий проект, запись при уходе со страницы и сохранённые проекты legacy этого origin. */
export async function readLegacyStore(factory: IDBFactory | undefined = globalThis.indexedDB, storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): Promise<LegacyRead> {
  const out: LegacyRead = { candidates: [], problems: [], dbFound: false };
  try {
    const pending = storage?.getItem(LEGACY_PENDING_KEY);
    if (pending) normalized(JSON.parse(pending), 'pending', out);
  } catch (e) {
    out.problems.push({ from: 'pending', reason: reason(e) });
  }
  if (!factory) return out;
  let db: IDBDatabase | null = null;
  try {
    db = await openExisting(factory);
    if (db) {
      out.dbFound = true;
      const { saved, draft } = await readAll(db);
      if (draft) normalized(draft, 'draft', out);
      for (const raw of saved) normalized(raw, 'saved', out);
    }
  } catch (e) {
    out.problems.push({ from: 'saved', reason: `Хранилище legacy не прочитано: ${reason(e)}` });
  } finally {
    db?.close();
  }
  return out;
}

export function readLegacyFile(text: string): LegacyRead {
  try {
    return { candidates: [{ project: parseProjectFile(text), from: 'file' }], problems: [], dbFound: false };
  } catch (e) {
    return { candidates: [], problems: [{ from: 'file', reason: reason(e) }], dbFound: false };
  }
}

const RANK: Record<LegacyOrigin, number> = { pending: 0, draft: 1, file: 2, saved: 3 };

/**
 * Один кандидат на проект: самый свежий по времени изменения, при равенстве — рабочий проект раньше сохранённой копии.
 * Более старые копии не переносятся и остаются в legacy; о них сообщается.
 */
export function pickCandidates(cands: LegacyCandidate[]): { chosen: LegacyCandidate[]; older: LegacyCandidate[] } {
  const byId = new Map<string, LegacyCandidate[]>();
  for (const c of cands) byId.set(c.project.id, [...(byId.get(c.project.id) ?? []), c]);
  const chosen: LegacyCandidate[] = [];
  const older: LegacyCandidate[] = [];
  for (const list of byId.values()) {
    list.sort((a, b) => String(b.project.updatedAt).localeCompare(String(a.project.updatedAt)) || RANK[a.from] - RANK[b.from]);
    chosen.push(list[0]);
    older.push(...list.slice(1).filter((c) => c.project.updatedAt !== list[0].project.updatedAt || c.from !== list[0].from));
  }
  return { chosen, older };
}
