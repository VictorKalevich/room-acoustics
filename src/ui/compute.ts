// Расчёты в постоянном воркере (очередь, отмена ещё не начатых задач, кэш волновой модели).
// 030: вид задачи определяет тип входных данных и результата (таблица ComputeJobs, общая с воркером).
import { logError } from '../state/errlog';
import type { ComputeMessage, ComputePayload, ComputeReply, ComputeResult, ComputeType } from '../workers/computeJobs';

export type { ComputePayload, ComputeResult, ComputeType } from '../workers/computeJobs';

export interface ComputeJob<T> {
  promise: Promise<T>;
  cancel: () => void;
}

interface Pending {
  type: ComputeType;
  resolve: (v: ComputeResult<ComputeType>) => void;
  reject: (e: Error) => void;
  progress?: (v: number) => void;
}

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, Pending>();

/** Сообщение воркеру: состав проверяет компилятор. */
const send = (w: Worker, m: ComputeMessage) => w.postMessage(m);

function getWorker(): Worker {
  if (worker) return worker;
  const w = new Worker(new URL('../workers/compute.worker.ts', import.meta.url), { type: 'module' });
  w.onmessage = (e: MessageEvent<ComputeReply>) => {
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
    w.terminate();
    worker = null;
  };
  worker = w;
  return w;
}

/** Данные проекта — обычные объекты; JSON-копия отбрасывает всё лишнее (что до воркера доходит — см. JsonSafe). */
function jsonCopy<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

export function compute<K extends ComputeType>(type: K, payload: ComputePayload<K>, onProgress?: (v: number) => void): ComputeJob<ComputeResult<K>> {
  const w = getWorker();
  const id = ++seq;
  let settled = false;
  const promise = new Promise<ComputeResult<K>>((resolve, reject) => {
    pending.set(id, {
      type,
      // ответ с этим id — результат этой задачи, то есть вида K
      resolve: (v) => { settled = true; resolve(v as ComputeResult<K>); },
      reject: (e) => { settled = true; reject(e); },
      progress: onProgress,
    });
  });
  send(w, { id, type, payload: jsonCopy(payload) });
  return {
    promise,
    cancel: () => {
      if (settled) return;
      settled = true;
      pending.delete(id);
      send(w, { cancel: id });
    },
  };
}
