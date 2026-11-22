import {
  checkRecord, MAX_HISTORY_BYTES, MAX_HISTORY_RECORDS, MAX_NAME_LENGTH, MAX_RECORD_BYTES, NOISE_RECORD_FORMAT, NoiseRecordError, recordHeader,
  type NoiseRecord, type NoiseRecordContent, type NoiseRecordContext, type NoiseRecordHeader,
} from '../core/noiseRecord';

/**
 * Постоянная история шумомера (056): отдельная база IndexedDB, не связанная с проектом комнаты и каталогом калибровок.
 * headers — сводки для списка, bodies — неизменяемое содержимое и контекст. Запись и удаление меняют обе части в одной
 * транзакции; переименование меняет только заголовок. Автоматического удаления нет.
 */
export const NOISE_DB = 'ra.noiseHistory';
export const NOISE_DB_VERSION = 1;
const HEADERS = 'headers', BODIES = 'bodies';

interface Body { id: string; format: typeof NOISE_RECORD_FORMAT; context: NoiseRecordContext; content: NoiseRecordContent }
export interface HistoryProblem { id: string; name: string; reason: string }
export interface HistoryList { headers: NoiseRecordHeader[]; problems: HistoryProblem[]; bytes: number }
export interface HistoryLimits { recordBytes: number; totalBytes: number; records: number }
export const defaultLimits: HistoryLimits = { recordBytes: MAX_RECORD_BYTES, totalBytes: MAX_HISTORY_BYTES, records: MAX_HISTORY_RECORDS };

const mib = (b: number) => (b / 2 ** 20).toFixed(0);
/** Сообщение для пользователя; исходная ошибка браузера остаётся в cause. */
export function storageError(e: unknown): NoiseRecordError {
  if (e instanceof NoiseRecordError) return e;
  const name = (e as { name?: string } | null)?.name;
  const error = name === 'QuotaExceededError'
    ? new NoiseRecordError('full', 'Недостаточно места в хранилище браузера. Измерение не сохранено. Удалите ненужные измерения или экспортируйте их в файлы.')
    : name === 'VersionError'
      ? new NoiseRecordError('newer', 'История измерений создана более новой версией приложения. Обновите приложение: данные не изменены.')
      : new NoiseRecordError('unavailable', 'Хранилище истории недоступно: ' + ((e as Error)?.message || 'ошибка браузера') + '.');
  (error as Error & { cause?: unknown }).cause = e;
  return error;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new NoiseRecordError('unavailable', 'Хранилище истории недоступно в этом браузере.')); return; }
    const req = indexedDB.open(NOISE_DB, NOISE_DB_VERSION);
    // Новые версии добавляют хранилища по oldVersion; существующие записи не переписываются.
    req.onupgradeneeded = event => {
      const db = req.result;
      if ((event as IDBVersionChangeEvent).oldVersion < 1) {
        db.createObjectStore(HEADERS, { keyPath: 'id' });
        db.createObjectStore(BODIES, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(storageError(req.error));
    req.onblocked = () => reject(new NoiseRecordError('unavailable', 'Закройте другие вкладки приложения, чтобы обновить хранилище истории.'));
  });
}

/** Одна транзакция на операцию: результат — после complete; исключение в обработчике отменяет всю транзакцию. */
async function run<T>(mode: IDBTransactionMode, action: (headers: IDBObjectStore, bodies: IDBObjectStore, done: (value: T) => void, fail: (e: unknown) => void) => void) {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      let result: T, failure: unknown = null;
      let tx: IDBTransaction;
      try { tx = db.transaction([HEADERS, BODIES], mode); } catch (e) { reject(storageError(e)); return; }
      const fail = (e: unknown) => {
        failure ??= e;
        try { tx.abort(); } catch { /* уже завершена */ }
      };
      tx.oncomplete = () => failure ? reject(storageError(failure)) : resolve(result);
      tx.onabort = () => reject(storageError(failure ?? tx.error ?? new Error('операция отменена')));
      tx.onerror = event => { failure ??= tx.error ?? (event.target as IDBRequest | null)?.error; };
      try { action(tx.objectStore(HEADERS), tx.objectStore(BODIES), v => { result = v; }, fail); } catch (e) { fail(e); }
    });
  } finally { db.close(); }
}
const guard = <T>(fail: (e: unknown) => void, fn: (v: T) => void) => (event: Event) => {
  try { fn((event.target as IDBRequest<T>).result); } catch (e) { fail(e); }
};

function checkHeader(h: NoiseRecordHeader) {
  return !!h && typeof h.id === 'string' && h.format === NOISE_RECORD_FORMAT && typeof h.name === 'string' && typeof h.savedAt === 'string' &&
    Number.isFinite(h.bytes) && h.bytes >= 0 && Number.isFinite(h.activeSeconds) && Number.isFinite(h.sampleRate) && !!h.leq;
}

export function createNoiseHistory(limits: HistoryLimits = defaultLimits,
  estimate: () => Promise<StorageEstimate | undefined> | undefined = () => globalThis.navigator?.storage?.estimate?.()) {
  async function enoughSpace(bytes: number) {
    let e: StorageEstimate | undefined;
    try { e = await estimate(); } catch { return; }
    if (e?.quota != null && e.usage != null && e.quota - e.usage < bytes)
      throw new NoiseRecordError('full', `Браузер сообщает, что свободно около ${mib(e.quota - e.usage)} МиБ, а измерению нужно ${mib(bytes)} МиБ. Измерение не сохранено.`);
  }
  return {
    limits,
    /** Заголовки по дате сохранения, новые первыми; повреждённые и неполные записи — отдельно, для явного удаления. */
    list(): Promise<HistoryList> {
      return run<HistoryList>('readonly', (headers, bodies, done, fail) => {
        headers.getAll().onsuccess = guard<NoiseRecordHeader[]>(fail, all => {
          bodies.getAllKeys().onsuccess = guard<IDBValidKey[]>(fail, keys => {
            const present = new Set(keys.map(String)), good: NoiseRecordHeader[] = [], problems: HistoryProblem[] = [];
            for (const h of all) {
              const id = String((h as { id?: unknown })?.id ?? '');
              if (!checkHeader(h)) problems.push({ id, name: typeof h?.name === 'string' ? h.name : '', reason: 'header' });
              else if (!present.has(h.id)) problems.push({ id, name: h.name, reason: 'body' });
              else good.push(h);
              present.delete(id);
            }
            for (const id of present) problems.push({ id, name: '', reason: 'orphan' });
            good.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
            done({ headers: good, problems, bytes: good.reduce((n, h) => n + h.bytes, 0) });
          });
        });
      });
    },
    has(id: string) {
      return run<boolean>('readonly', (headers, _bodies, done, fail) => {
        headers.getKey(id).onsuccess = guard<IDBValidKey | undefined>(fail, key => done(key !== undefined));
      });
    },
    /** Полная проверка при чтении: формат, массивы, итоги и объём совпадают с заголовком. */
    read(id: string) {
      return run<NoiseRecord>('readonly', (headers, bodies, done, fail) => {
        headers.get(id).onsuccess = guard<NoiseRecordHeader | undefined>(fail, h => {
          if (!h) throw new NoiseRecordError('missing', 'Измерение не найдено: возможно, оно удалено в другой вкладке.');
          bodies.get(id).onsuccess = guard<Body | undefined>(fail, body => {
            if (!body) throw new NoiseRecordError('corrupt', 'Запись повреждена: нет данных измерения.');
            if (body.format !== NOISE_RECORD_FORMAT) throw new NoiseRecordError('newer', 'Запись создана другой версией формата истории.');
            const record: NoiseRecord = { id: h.id, name: h.name, savedAt: h.savedAt, project: h.project, imported: h.imported, context: body.context, content: body.content };
            try { checkRecord(record); } catch (e) { throw new NoiseRecordError('corrupt', 'Запись повреждена: ' + (e as Error).message + '.'); }
            if (recordHeader(record).bytes !== h.bytes) throw new NoiseRecordError('corrupt', 'Запись повреждена: объём данных не совпадает со сводкой.');
            done(record);
          });
        });
      });
    },
    /**
     * Сохранить запись. Существующий идентификатор — конфликт, пока не передано replace. Пределы проверяются в той же
     * транзакции, что и запись, чтобы параллельные вкладки не превысили их вместе.
     */
    async save(record: NoiseRecord, options: { replace?: boolean } = {}) {
      checkRecord(record);
      const header = recordHeader(record);
      if (header.bytes > limits.recordBytes) throw new NoiseRecordError('size', `Измерение больше предела одной записи ${mib(limits.recordBytes)} МиБ.`);
      await enoughSpace(header.bytes);
      const body: Body = { id: record.id, format: NOISE_RECORD_FORMAT, context: record.context, content: record.content };
      return run<NoiseRecordHeader>('readwrite', (headers, bodies, done, fail) => {
        headers.getAll().onsuccess = guard<NoiseRecordHeader[]>(fail, all => {
          const existing = all.find(h => h?.id === record.id);
          if (existing && !options.replace) throw new NoiseRecordError('conflict', `Измерение «${existing.name || 'без названия'}» уже есть в истории.`);
          const others = all.filter(h => h?.id !== record.id);
          if (others.length + 1 > limits.records)
            throw new NoiseRecordError('limit', `В истории уже ${others.length} измерений — это предел. Удалите ненужные, чтобы сохранить новое.`);
          const used = others.reduce((n, h) => n + (Number.isFinite(h?.bytes) ? h.bytes : 0), 0);
          if (used + header.bytes > limits.totalBytes)
            throw new NoiseRecordError('limit', `История заполнена: занято около ${mib(used)} из ${mib(limits.totalBytes)} МиБ. Удалите ненужные измерения, чтобы сохранить новое.`);
          headers.put(header);
          bodies.put(body);
          done(header);
        });
      });
    },
    rename(id: string, name: string) {
      const next = name.trim();
      if (next.length > MAX_NAME_LENGTH) return Promise.reject(new NoiseRecordError('invalid', `Название длиннее ${MAX_NAME_LENGTH} символов.`));
      return run<NoiseRecordHeader>('readwrite', (headers, _bodies, done, fail) => {
        headers.get(id).onsuccess = guard<NoiseRecordHeader | undefined>(fail, h => {
          if (!h) throw new NoiseRecordError('missing', 'Измерение не найдено: возможно, оно удалено в другой вкладке.');
          const changed = { ...h, name: next };
          headers.put(changed);
          done(changed);
        });
      });
    },
    /** Удаление по явному действию: заголовок и данные вместе, в том числе у повреждённой записи. */
    remove(id: string) {
      return run<void>('readwrite', (headers, bodies, done) => {
        headers.delete(id);
        bodies.delete(id);
        done(undefined);
      });
    },
    /** Просьба к браузеру не очищать данные сайта при нехватке места. Не гарантирует сохранность. */
    async persist() {
      try { return await globalThis.navigator?.storage?.persist?.() ?? null; } catch { return null; }
    },
    async persisted() {
      try { return await globalThis.navigator?.storage?.persisted?.() ?? null; } catch { return null; }
    },
    async estimate() {
      try { return (await estimate()) ?? null; } catch { return null; }
    },
  };
}

export const noiseHistory = createNoiseHistory();
export type NoiseHistory = ReturnType<typeof createNoiseHistory>;
