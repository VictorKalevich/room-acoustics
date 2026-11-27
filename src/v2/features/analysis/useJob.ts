// Тяжёлый расчёт по запросу (карты мест, место для записи, сравнение с замером) в фоновом воркере ядра.
// Готовый результат того же набора входов берётся из кэша в памяти без повторного запуска; после изменения входов
// расчёт не запускается сам — его запрашивают заново.
import { useEffect, useState } from 'preact/hooks';
import { lru, memoAsync } from '../../application/cache';

export type JobState<T> =
  | { status: 'idle' }
  | { status: 'running'; progress?: number }
  | { status: 'ready'; value: T }
  | { status: 'error'; message: string };

const cache = lru<Promise<unknown>>(12);

/** `key` — метод и хеш значимых входов; null — расчёт сейчас невозможен. `auto` — запускать сразу. */
export function useJob<T>(key: string | null, run: (onProgress: (v: number) => void) => Promise<T>, auto = false): [JobState<T>, () => void] {
  const [state, setState] = useState<JobState<T>>({ status: 'idle' });
  const [requested, setRequested] = useState<{ key: string | null; n: number }>({ key: null, n: 0 });
  const go = !!key && (auto || requested.key === key || cache.has(key));
  useEffect(() => {
    if (!key || !go) { setState({ status: 'idle' }); return; }
    let alive = true;
    setState({ status: 'running' });
    (memoAsync(cache, key, () => run((p) => alive && setState({ status: 'running', progress: p }))) as Promise<T>).then(
      (value) => alive && setState({ status: 'ready', value }),
      (e: unknown) => alive && setState({ status: 'error', message: e instanceof Error ? e.message : String(e) }),
    );
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, go, requested.n]);
  return [state, () => setRequested((r) => ({ key, n: r.n + 1 }))];
}
