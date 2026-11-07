// Запуск расчёта в воркере с возможностью отмены.
export type ComputeType = 'optimize' | 'listenerMap' | 'subMap' | 'integrate' | 'calibrate';

export interface ComputeJob<T> {
  promise: Promise<T>;
  cancel: () => void;
}

export function compute<T>(type: ComputeType, payload: unknown, onProgress?: (v: number) => void): ComputeJob<T> {
  const w = new Worker(new URL('../workers/compute.worker.ts', import.meta.url), { type: 'module' });
  let done = false;
  const promise = new Promise<T>((resolve, reject) => {
    w.onmessage = (e) => {
      const m = e.data;
      if (m.kind === 'progress') { onProgress?.(m.value); return; }
      done = true;
      w.terminate();
      if (m.kind === 'done') resolve(m.result as T);
      else reject(new Error(m.error));
    };
    w.onerror = (e) => { done = true; w.terminate(); reject(new Error(e.message || 'Ошибка расчёта')); };
  });
  // данные проекта — обычные объекты; JSON-копия отбрасывает всё лишнее
  w.postMessage({ type, payload: JSON.parse(JSON.stringify(payload)) });
  return {
    promise,
    cancel: () => { if (!done) { done = true; w.terminate(); } },
  };
}
