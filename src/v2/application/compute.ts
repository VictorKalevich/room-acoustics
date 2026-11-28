// Фоновые расчёты v2 (V2-010) через постоянный воркер ядра `src/workers/compute.worker.ts`: тот же договор сообщений
// (computeJobs.ts), что у legacy, но свой клиент — интерфейс legacy (`src/ui/compute.ts`) v2 не подключает.
// Без Worker задача выполняется в основном потоке теми же обработчиками.
import type { ComputeMessage, ComputePayload, ComputeReply, ComputeResult, ComputeType } from '../../workers/computeJobs';

export interface WorkerLike {
  postMessage(m: ComputeMessage): void;
  onmessage: ((e: { data: ComputeReply }) => void) | null;
  onerror: ((e: { message?: string }) => void) | null;
  terminate(): void;
}

export interface RunOptions {
  onProgress?: (v: number) => void;
  signal?: AbortSignal;
  /** Задача скрытого раздела ждёт задачи видимых. */
  hidden?: boolean;
}

export class ComputeAborted extends Error {
  constructor() {
    super('Расчёт отменён.');
    this.name = 'AbortError';
  }
}

export interface ComputeClient {
  run<K extends ComputeType>(type: K, payload: ComputePayload<K>, opts?: RunOptions): Promise<ComputeResult<K>>;
  setHidden(id: number, hidden: boolean): void;
  /** Сколько задач ждёт ответа. */
  pending(): number;
  dispose(): void;
}

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
  onProgress?: (v: number) => void;
}

export function createComputeWorker(): WorkerLike {
  return new Worker(new URL('../../workers/compute.worker.ts', import.meta.url), { type: 'module', name: 'v2-compute' }) as unknown as WorkerLike;
}

/** Выполнить задачу в основном потоке (нет Worker): те же обработчики, что в воркере. */
async function runLocal<K extends ComputeType>(type: K, payload: ComputePayload<K>, onProgress?: (v: number) => void): Promise<ComputeResult<K>> {
  const { runHandler } = await import('../../workers/computeHandlers');
  return runHandler(type, payload, onProgress ?? (() => undefined));
}

export function computeClient(makeWorker: (() => WorkerLike) | null = typeof Worker === 'undefined' ? null : createComputeWorker): ComputeClient {
  let worker: WorkerLike | null = null;
  let nextId = 1;
  const pending = new Map<number, Pending>();

  const fail = (message: string) => {
    for (const p of pending.values()) p.reject(new Error(message));
    pending.clear();
    worker?.terminate();
    worker = null;
  };

  const ensure = (): WorkerLike => {
    if (worker) return worker;
    const w = makeWorker!();
    w.onmessage = ({ data }) => {
      const p = pending.get(data.id);
      if (!p) return;
      if (data.kind === 'progress') p.onProgress?.(data.value);
      else {
        pending.delete(data.id);
        if (data.kind === 'done') p.resolve(data.result);
        else p.reject(new Error(data.error));
      }
    };
    // сбой воркера (например, нехватка памяти): все ожидающие задачи получают ошибку, следующая создаст новый воркер
    w.onerror = (e) => fail(`Фоновый расчёт прервался: ${e.message ?? 'ошибка воркера'}.`);
    worker = w;
    return w;
  };

  return {
    run(type, payload, opts = {}) {
      if (opts.signal?.aborted) return Promise.reject(new ComputeAborted());
      if (!makeWorker) return runLocal(type, payload, opts.onProgress);
      const id = nextId++;
      const w = ensure();
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve: resolve as (v: unknown) => void, reject, onProgress: opts.onProgress });
        opts.signal?.addEventListener('abort', () => {
          if (!pending.has(id)) return;
          pending.delete(id);
          w.postMessage({ cancel: id });
          reject(new ComputeAborted());
        }, { once: true });
        // JSON-копия, как у legacy: договор проверяет, что входные данные её переживают
        w.postMessage({ id, type, payload: JSON.parse(JSON.stringify(payload)), ...(opts.hidden ? { hidden: true } : {}) });
      });
    },
    setHidden(id, hidden) {
      worker?.postMessage({ priority: id, hidden });
    },
    pending: () => pending.size,
    dispose() {
      fail('Расчёты остановлены.');
    },
  };
}
