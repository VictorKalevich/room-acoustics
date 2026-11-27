// IndexedDB v2 (059, V2-008): отдельная база, не совпадающая с базами legacy (`room-acoustics`, `ra.noiseHistory`,
// `ra.micCalibration`). Запись подтверждается по завершении транзакции, а не по успеху запроса.

export const V2_DB_NAME = 'room-acoustics-v2';
export const V2_DB_VERSION = 1;

/** Области хранения (data-model): у каждой ключ `id`; у зависимых от комнаты — индекс `roomId`. */
export const STORES = {
  rooms: [],
  measurements: ['roomId'],
  measurementData: [],
  snapshots: ['roomId'],
  materials: [],
  equipment: [],
  measurementDevices: [],
  constructions: [],
  presets: [],
  calculations: ['roomId'],
  optimizationRuns: ['roomId'],
  actionPlans: ['roomId'],
  reports: ['roomId'],
  meta: [],
} as const satisfies Record<string, readonly string[]>;

export type StoreName = keyof typeof STORES;
export const STORE_NAMES = Object.keys(STORES) as StoreName[];
/** Записи, удаляемые вместе с комнатой. Данные измерений (`measurementData`) удаляются по своим измерениям. */
export const ROOM_OWNED: readonly StoreName[] = STORE_NAMES.filter((s) => (STORES[s] as readonly string[]).includes('roomId'));

export type StorageErrorKind = 'unavailable' | 'blocked' | 'quota' | 'conflict' | 'corrupt' | 'failed';

export class StorageError extends Error {
  constructor(readonly kind: StorageErrorKind, message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'StorageError';
  }
}

const MESSAGES: Record<StorageErrorKind, string> = {
  unavailable: 'Хранилище браузера недоступно: данные не сохраняются. Возможно, включён приватный режим.',
  blocked: 'Хранилище занято другой вкладкой Room Acoustics v2 — закройте её и повторите.',
  quota: 'На устройстве не хватает места для сохранения. Освободите место или сделайте резервную копию и удалите старые измерения.',
  conflict: 'Комнату изменили в другой вкладке. Обновите страницу, чтобы не потерять изменения.',
  corrupt: 'Запись в хранилище повреждена и не прочитана.',
  failed: 'Не удалось сохранить данные.',
};

export function storageError(kind: StorageErrorKind, cause?: unknown, message = MESSAGES[kind]): StorageError {
  return new StorageError(kind, message, cause);
}

function classify(e: unknown): StorageError {
  if (e instanceof StorageError) return e;
  const name = (e as { name?: string } | null)?.name;
  if (name === 'QuotaExceededError') return storageError('quota', e);
  if (name === 'InvalidStateError' || name === 'UnknownError') return storageError('unavailable', e);
  return storageError('failed', e);
}

export interface V2Db {
  readonly name: string;
  /** Чтение и запись в одной транзакции: `fn` ставит запросы, результат — после завершения транзакции. */
  run<T>(stores: StoreName | StoreName[], mode: IDBTransactionMode, fn: (tx: IDBTransaction) => T | Promise<T>): Promise<T>;
  close(): void;
}

/** Результат запроса внутри транзакции. */
export function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function upgrade(db: IDBDatabase, tx: IDBTransaction): void {
  for (const name of STORE_NAMES) {
    const st = db.objectStoreNames.contains(name) ? tx.objectStore(name) : db.createObjectStore(name, { keyPath: 'id' });
    for (const index of STORES[name]) if (!st.indexNames.contains(index)) st.createIndex(index, index);
  }
}

export function openV2Db(factory: IDBFactory | undefined = globalThis.indexedDB, name = V2_DB_NAME): V2Db {
  let conn: Promise<IDBDatabase> | null = null;
  const open = (): Promise<IDBDatabase> => {
    if (conn) return conn;
    if (!factory) return Promise.reject(storageError('unavailable'));
    const p = new Promise<IDBDatabase>((resolve, reject) => {
      let r: IDBOpenDBRequest;
      try {
        r = factory.open(name, V2_DB_VERSION);
      } catch (e) {
        reject(storageError('unavailable', e));
        return;
      }
      r.onupgradeneeded = () => upgrade(r.result, r.transaction!);
      r.onsuccess = () => {
        const db = r.result;
        // другая вкладка открыла новую версию схемы: соединение закрывается, следующее действие откроет заново
        db.onversionchange = () => { db.close(); if (conn === p) conn = null; };
        db.onclose = () => { if (conn === p) conn = null; };
        resolve(db);
      };
      r.onerror = () => reject(storageError('unavailable', r.error));
      r.onblocked = () => reject(storageError('blocked'));
    });
    conn = p;
    p.catch(() => { if (conn === p) conn = null; });
    return p;
  };

  const run = async <T>(stores: StoreName | StoreName[], mode: IDBTransactionMode, fn: (tx: IDBTransaction) => T | Promise<T>, again = true): Promise<T> => {
    const db = await open();
    let tx: IDBTransaction;
    try {
      tx = db.transaction(stores, mode);
    } catch (e) {
      // соединение закрыто без уведомления: один повтор с новым
      conn = null;
      if (!again) throw classify(e);
      return run(stores, mode, fn, false);
    }
    const done = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(classify(tx.error ?? new Error('aborted')));
      tx.onerror = () => undefined;
    });
    let value: T;
    try {
      value = await fn(tx);
    } catch (e) {
      try { tx.abort(); } catch { /* уже завершена */ }
      await done.catch(() => undefined);
      throw classify(e);
    }
    await done;
    return value;
  };

  return {
    name,
    run: (stores, mode, fn) => run(stores, mode, fn),
    close: () => { void conn?.then((db) => db.close()).catch(() => undefined); conn = null; },
  };
}

/** Удалить базу v2 целиком (только по явному действию пользователя и в тестах). */
export function deleteV2Db(factory: IDBFactory | undefined = globalThis.indexedDB, name = V2_DB_NAME): Promise<void> {
  if (!factory) return Promise.reject(storageError('unavailable'));
  return new Promise((resolve, reject) => {
    const r = factory.deleteDatabase(name);
    r.onsuccess = () => resolve();
    r.onerror = () => reject(storageError('failed', r.error));
    r.onblocked = () => reject(storageError('blocked'));
  });
}
