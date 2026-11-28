// Кэш результатов расчёта (V2-010): ключ — метод и хеш значимых входов, поэтому смена ревизии без изменения входов
// (например, переименование) не пересчитывает, а изменение входа — пересчитывает. Память ограничена числом записей.

export interface Lru<V> {
  get(key: string): V | undefined;
  set(key: string, value: V): void;
  has(key: string): boolean;
  delete(key: string): void;
  clear(): void;
  readonly size: number;
}

export function lru<V>(max = 32): Lru<V> {
  const map = new Map<string, V>();
  return {
    get(key) {
      if (!map.has(key)) return undefined;
      const v = map.get(key)!;
      map.delete(key);
      map.set(key, v);
      return v;
    },
    set(key, value) {
      map.delete(key);
      map.set(key, value);
      while (map.size > max) map.delete(map.keys().next().value!);
    },
    has: (key) => map.has(key),
    delete: (key) => { map.delete(key); },
    clear: () => map.clear(),
    get size() { return map.size; },
  };
}

/** Один расчёт на ключ: параллельные запросы того же ключа ждут одно обещание; ошибка не кэшируется. */
export function memoAsync<V>(cache: Lru<Promise<V>>, key: string, compute: () => Promise<V>): Promise<V> {
  const hit = cache.get(key);
  if (hit) return hit;
  const p = compute();
  cache.set(key, p);
  p.catch(() => { if (cache.get(key) === p) cache.delete(key); });
  return p;
}
