// Полная резервная копия v2 (V2-010): все области, кроме кэша расчётов (он восстанавливается пересчётом). Восстановление —
// одной транзакцией: «добавить» не трогает существующие записи и перечисляет расхождения, «заменить» очищает базу.
import { req, STORE_NAMES, storageError, type StoreName, type V2Db } from './db';
import { roomProblem } from './rooms';

export const BACKUP_FORMAT = 'room-acoustics-v2-backup';
export const BACKUP_VERSION = 1;
export const BACKUP_EXT = '.ra2backup.json';
/** Кэш расчётов не входит в копию: он не исходные данные. */
export const BACKUP_STORES: readonly StoreName[] = STORE_NAMES.filter((s) => s !== 'calculations');

export interface Backup {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  createdAt: string;
  stores: Partial<Record<StoreName, { id: string }[]>>;
}

export async function exportBackup(db: V2Db, now: string): Promise<Backup> {
  const stores = await db.run([...BACKUP_STORES], 'readonly', async (tx) => {
    const out: Backup['stores'] = {};
    for (const s of BACKUP_STORES) out[s] = (await req(tx.objectStore(s).getAll())) as { id: string }[];
    return out;
  });
  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, createdAt: now, stores };
}

export const backupFileName = (now: string) => `room-acoustics-v2-${now.slice(0, 10)}${BACKUP_EXT}`;

export function parseBackup(text: string): Backup {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw storageError('corrupt', undefined, 'Файл резервной копии повреждён: это не JSON.');
  }
  const b = data as Partial<Backup> | null;
  if (!b || b.format !== BACKUP_FORMAT) throw storageError('corrupt', undefined, 'Это не резервная копия Room Acoustics v2.');
  if (typeof b.version !== 'number' || b.version > BACKUP_VERSION) throw storageError('corrupt', undefined, 'Копия создана более новой версией приложения.');
  if (!b.stores || typeof b.stores !== 'object') throw storageError('corrupt', undefined, 'В копии нет данных.');
  for (const [name, list] of Object.entries(b.stores)) {
    if (!BACKUP_STORES.includes(name as StoreName)) throw storageError('corrupt', undefined, `Неизвестная область «${name}» в копии.`);
    if (!Array.isArray(list) || list.some((r) => !r || typeof r !== 'object' || typeof (r as { id?: unknown }).id !== 'string')) {
      throw storageError('corrupt', undefined, `Область «${name}» в копии повреждена.`);
    }
  }
  for (const room of b.stores.rooms ?? []) {
    const problem = roomProblem(room);
    if (problem) throw storageError('corrupt', undefined, `Комната «${room.id}» в копии повреждена (${problem}).`);
  }
  return b as Backup;
}

export interface RestoreResult {
  added: number;
  /** Записи, которые есть и в базе, и в копии, но отличаются: в режиме «добавить» они не перезаписаны. */
  differing: { store: StoreName; id: string }[];
}

export async function restoreBackup(db: V2Db, backup: Backup, mode: 'merge' | 'replace'): Promise<RestoreResult> {
  const result: RestoreResult = { added: 0, differing: [] };
  await db.run([...STORE_NAMES], 'readwrite', async (tx) => {
    if (mode === 'replace') for (const s of STORE_NAMES) tx.objectStore(s).clear();
    for (const s of BACKUP_STORES) {
      const st = tx.objectStore(s);
      for (const rec of backup.stores[s] ?? []) {
        if (mode === 'merge') {
          const cur = await req(st.get(rec.id));
          if (cur !== undefined) {
            if (JSON.stringify(cur) !== JSON.stringify(rec)) result.differing.push({ store: s, id: rec.id });
            continue;
          }
        }
        st.put(rec);
        result.added++;
      }
    }
  });
  return result;
}

export interface Persistence { persisted: boolean | null; usage: number | null; quota: number | null }

/** Попросить браузер не очищать хранилище и узнать занятое место. Где API нет — null, а не выдуманное значение. */
export async function requestPersistence(storage: Pick<StorageManager, 'persist' | 'persisted' | 'estimate'> | undefined = globalThis.navigator?.storage): Promise<Persistence> {
  if (!storage) return { persisted: null, usage: null, quota: null };
  let persisted: boolean | null = null;
  try {
    persisted = (await storage.persisted?.()) || (await storage.persist?.()) || false;
  } catch {
    persisted = null;
  }
  try {
    const e = await storage.estimate();
    return { persisted, usage: e.usage ?? null, quota: e.quota ?? null };
  } catch {
    return { persisted, usage: null, quota: null };
  }
}

/** Только прочитать состояние хранилища, ничего не запрашивая у браузера. */
export async function storageStatus(storage: Pick<StorageManager, 'persisted' | 'estimate'> | undefined = globalThis.navigator?.storage): Promise<Persistence> {
  if (!storage) return { persisted: null, usage: null, quota: null };
  const persisted = (await storage.persisted?.().catch(() => null)) ?? null;
  const e = await storage.estimate?.().catch(() => null);
  return { persisted, usage: e?.usage ?? null, quota: e?.quota ?? null };
}
