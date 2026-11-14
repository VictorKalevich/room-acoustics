// Постоянный воркер тяжёлых расчётов с очередью: кэш волновой модели живёт между задачами.
// 030: здесь только обвязка — очередь, прогресс, передача буферов, ошибки; задачи выполняет таблица computeHandlers,
// сообщения описаны в computeJobs.ts.
import { runHandler } from './computeHandlers';
import type { ComputeMessage, ComputeReply, ComputeRequest, ComputeResult, ComputeType } from './computeJobs';

/** `self` воркера с типами договора: что он принимает и что отправляет. */
interface ComputeScope {
  onmessage: ((e: MessageEvent<ComputeMessage>) => void) | null;
  postMessage(reply: ComputeReply, transfer?: Transferable[]): void;
}
const scope = self as unknown as ComputeScope;

/**
 * Буферы результата, которые передаются, а не копируются. Они созданы как ArrayBuffer, а типы ядра объявляют
 * ArrayBufferLike (в том числе SharedArrayBuffer, который передать нельзя), — отсюда приведение.
 */
const transfers: { [K in ComputeType]?: (r: ComputeResult<K>) => Transferable[] } = {
  field: (r) => (r.energy && r.mask ? [r.energy.buffer as ArrayBuffer, r.mask.buffer as ArrayBuffer] : []),
  voiceMap: (r) => (r.scores && r.facing && r.allowed ? [r.scores.buffer as ArrayBuffer, r.facing.buffer as ArrayBuffer, r.allowed.buffer as ArrayBuffer] : []),
};

const queue: ComputeRequest[] = [];
let running = false;

function run<K extends ComputeType>(job: ComputeRequest<K>) {
  const { id, type, payload } = job;
  let last = 0;
  const progress = (v: number) => {
    const now = Date.now();
    if (now - last > 100 || v >= 1) { last = now; scope.postMessage({ id, kind: 'progress', value: Math.min(1, v) }); }
  };
  try {
    const result = runHandler(type, payload, progress);
    scope.postMessage({ id, kind: 'done', result }, transfers[type]?.(result) ?? []);
  } catch (err) {
    scope.postMessage({ id, kind: 'error', error: (err as Error).message ?? String(err), stack: (err as Error).stack });
  }
}

function pump() {
  if (running) return;
  const job = queue.shift();
  if (!job) return;
  running = true;
  run(job);
  running = false;
  // отдаём управление, чтобы успели прийти отмены
  setTimeout(pump, 0);
}

scope.onmessage = (e) => {
  const m = e.data;
  if ('cancel' in m) {
    const i = queue.findIndex((j) => j.id === m.cancel);
    if (i >= 0) queue.splice(i, 1);
    return;
  }
  queue.push(m);
  setTimeout(pump, 0);
};
