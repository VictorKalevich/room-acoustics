// Расчёты в постоянном воркере (очередь, отмена ещё не начатых задач, кэш волновой модели).
import { logError } from '../state/errlog';

export type ComputeType = 'optimize' | 'listenerMap' | 'subMap' | 'integrate' | 'calibrate' | 'compare' | 'evaluate' | 'modes' | 'field' | 'subFilters' | 'voiceMap';

export interface ComputeJob<T> {
  promise: Promise<T>;
  cancel: () => void;
}

interface Pending {
  type: ComputeType;
  resolve: (v: any) => void;
  reject: (e: Error) => void;
  progress?: (v: number) => void;
}

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, Pending>();

function getWorker(): Worker {
  if (worker) return worker;
  const w = new Worker(new URL('../workers/compute.worker.ts', import.meta.url), { type: 'module' });
  w.onmessage = (e) => {
    const m = e.data;
    const p = pending.get(m.id);
    if (!p) return;
    if (m.kind === 'progress') { p.progress?.(m.value); return; }
    pending.delete(m.id);
    if (m.kind === 'done') { p.resolve(m.result); return; }
    const err = new Error(m.error);
    if (m.stack) err.stack = m.stack;
    logError('worker', err, p.type);
    p.reject(err);
  };
  w.onerror = (e) => {
    // воркер упал: отклоняем все задачи и создаём новый при следующем вызове
    const types = [...new Set([...pending.values()].map((p) => p.type))].join(', ');
    logError('worker', `${e.message || 'Воркер расчётов упал'}${e.filename ? ` (${e.filename.split('/').pop()}:${e.lineno})` : ''}`, types || undefined);
    for (const p of pending.values()) p.reject(new Error(e.message || 'Ошибка расчёта'));
    pending.clear();
    worker = null;
  };
  worker = w;
  return w;
}

export function compute<T>(type: ComputeType, payload: unknown, onProgress?: (v: number) => void): ComputeJob<T> {
  const w = getWorker();
  const id = ++seq;
  let settled = false;
  const promise = new Promise<T>((resolve, reject) => {
    pending.set(id, {
      type,
      resolve: (v) => { settled = true; resolve(v); },
      reject: (e) => { settled = true; reject(e); },
      progress: onProgress,
    });
  });
  // данные проекта — обычные объекты; JSON-копия отбрасывает всё лишнее
  w.postMessage({ id, type, payload: JSON.parse(JSON.stringify(payload)) });
  return {
    promise,
    cancel: () => {
      if (settled) return;
      settled = true;
      pending.delete(id);
      w.postMessage({ cancel: id });
    },
  };
}
