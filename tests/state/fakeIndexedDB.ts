// Небольшая заглушка IndexedDB для unit-тестов хранилища (029): тесты идут в среде node, где IndexedDB нет.
// Повторяет только то, чем пользуется src/state/storage.ts: open с версией и onupgradeneeded, хранилища с keyPath и без,
// get / put / getAll / delete, события success / error / blocked, versionchange и close у соединения.
// События приходят асинхронно, как в браузере. Значения копируются (structuredClone), как при записи в базу.

type Handler = ((ev: unknown) => void) | null;
const later = (fn: () => void) => setTimeout(fn, 0);

export class FakeRequest<T = unknown> {
  result = undefined as T;
  error: unknown = null;
  onsuccess: Handler = null;
  onerror: Handler = null;
  succeed(v: T) { this.result = v; later(() => this.onsuccess?.({ target: this })); }
  fail(e: unknown) { this.error = e; later(() => this.onerror?.({ target: this })); }
}

export class FakeOpenRequest extends FakeRequest<FakeDB> {
  onupgradeneeded: Handler = null;
  onblocked: Handler = null;
}

interface Store { keyPath?: string; data: Map<unknown, unknown> }

class FakeStore {
  constructor(private server: FakeIndexedDB, private store: Store) {}
  private run<T>(fn: () => T): FakeRequest<T> {
    const req = new FakeRequest<T>();
    if (this.server.failRequests > 0) { this.server.failRequests--; req.fail(new DOMException('проверка: запрос не выполнен', 'UnknownError')); }
    else req.succeed(fn());
    return req;
  }
  get(key: unknown) { return this.run(() => structuredClone(this.store.data.get(key))); }
  getAll() { return this.run(() => [...this.store.data.values()].map((v) => structuredClone(v))); }
  put(value: unknown, key?: unknown) {
    return this.run(() => {
      const k = this.store.keyPath ? (value as Record<string, unknown>)[this.store.keyPath] : key;
      this.store.data.set(k, structuredClone(value));
      return k;
    });
  }
  delete(key: unknown) { return this.run(() => { this.store.data.delete(key); return undefined; }); }
}

export class FakeDB {
  closed = false;
  onversionchange: Handler = null;
  onclose: Handler = null;
  constructor(private server: FakeIndexedDB) {}
  get objectStoreNames() { return { contains: (n: string) => this.server.stores.has(n) }; }
  createObjectStore(name: string, opts?: { keyPath?: string }) { this.server.stores.set(name, { keyPath: opts?.keyPath, data: new Map() }); }
  transaction(name: string) {
    if (this.closed) throw new DOMException('соединение закрыто', 'InvalidStateError');
    const store = this.server.stores.get(name);
    if (!store) throw new DOMException(`нет хранилища ${name}`, 'NotFoundError');
    this.server.transactions++;
    return { objectStore: () => new FakeStore(this.server, store) };
  }
  close() { this.closed = true; this.server.connections.delete(this); }
}

export class FakeIndexedDB {
  stores = new Map<string, Store>();
  version = 0;
  /** Открытые соединения (не закрытые ни приложением, ни «браузером»). */
  connections = new Set<FakeDB>();
  /** Сколько раз вызывали open и сколько транзакций начали. */
  opens = 0;
  transactions = 0;
  /** Столько следующих открытий завершится ошибкой. */
  failOpens = 0;
  /** Столько следующих открытий сначала получат blocked, а успех придёт позже. */
  blockOpens = 0;
  /** Столько следующих запросов (get, put…) завершится ошибкой. */
  failRequests = 0;

  open(_name: string, version = 1) {
    this.opens++;
    const req = new FakeOpenRequest();
    if (this.failOpens > 0) {
      this.failOpens--;
      req.fail(new DOMException('проверка: хранилище не открылось', 'UnknownError'));
      return req;
    }
    const blocked = this.blockOpens > 0;
    if (blocked) this.blockOpens--;
    later(() => {
      if (blocked) req.onblocked?.({ target: req });
      later(() => {
        const db = new FakeDB(this);
        req.result = db;
        if (version > this.version) {
          this.version = version;
          req.onupgradeneeded?.({ target: req });
        }
        this.connections.add(db);
        req.onsuccess?.({ target: req });
      });
    });
    return req;
  }

  /** Удаление базы или смена её версии из другой вкладки: versionchange открытым соединениям; blocked, если кто-то не закрылся. */
  versionChange(): 'done' | 'blocked' {
    for (const db of this.connections) db.onversionchange?.({ target: db });
    return this.connections.size ? 'blocked' : 'done';
  }

  /** Браузер закрыл соединения сам (как Safari после возврата из фона): с событием close или молча. */
  dropConnections(notify: boolean) {
    for (const db of this.connections) {
      db.closed = true;
      this.connections.delete(db);
      if (notify) db.onclose?.({ target: db });
    }
  }

  /** Значение из хранилища напрямую, минуя приложение. */
  peek(store: string, key: unknown) { return structuredClone(this.stores.get(store)?.data.get(key)); }
  /** Записать значение напрямую, минуя приложение (до запуска). */
  seed(store: string, key: unknown, value: unknown) {
    if (!this.stores.has(store)) this.stores.set(store, { data: new Map() });
    this.stores.get(store)!.data.set(key, structuredClone(value));
  }
}

/** localStorage в памяти. */
export class MemStorage {
  m = new Map<string, string>();
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
}
