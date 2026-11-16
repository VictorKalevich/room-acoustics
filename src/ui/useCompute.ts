// 034: один способ запускать расчёт из интерфейса. `useComputed` — по изменению входных данных, `useComputeAction` —
// по кнопке; логика — в computeTask.ts, отправка задач воркеру — compute.ts, выбор потока — inMainThread.
// Договор о поведении каждого места (задержки, манера показа, кэши) — specs/034-compute-hook/spec.md.
// 035: задача несёт признак видимости раздела (SectionVisibility); его смена доходит до задачи в той же отрисовке
// (useLayoutEffect), до следующего действия пользователя.
import { useEffect, useLayoutEffect, useMemo, useState } from 'preact/hooks';
import type { Room } from '../core/types';
import { compute, inMainThread, type ComputePayload, type ComputeResult, type ComputeType } from './compute';
import { ComputeAction, ComputeTask, idleState, type ActionState, type ResultCache, type TaskState } from './computeTask';
import { useSectionVisible } from './components/SectionVisibility';

/** Тот же расчёт в основном потоке; где считать, решает inMainThread(room). */
export interface LocalCompute<V> {
  room: Room;
  compute: () => V;
}

export interface ComputedOptions<V> {
  /**
   * Входы: при изменении любого (по ссылке) расчёт запускается заново. Список каждого места переносится как есть;
   * объект входных данных берётся из той отрисовки, в которой изменились входы.
   */
  deps: readonly unknown[];
  /** Задержка запуска, мс; без неё задача уходит сразу из эффекта. */
  delay?: number;
  /** Когда снимается прежняя задача: `change` (по умолчанию) — сразу при изменении входов, `start` — при запуске новой. */
  restart?: 'change' | 'start';
  /** Прежний результат, пока считается новый: остаётся или скрывается. */
  previous: 'keep' | 'clear';
  /** Когда считать нечего (`payload` null): результат сбрасывается или остаётся, скрытый условием экрана. */
  idle?: 'clear' | 'keep';
  progress?: 'reset' | 'carry';
  fallback?: (e: Error) => V;
  cache?: () => ResultCache<V> | undefined;
  /** Расчёт без воркера для прямоугольной модели (inMainThread). */
  local?: LocalCompute<V>;
}

export type Computed<V, I> = TaskState<V, I>;

/**
 * Результат расчёта по входным данным. `payload` null — считать нечего. `input` в ответе — входные данные, по которым
 * посчитан `value` (экран может показывать результат только для своих входов).
 */
export function useComputed<K extends ComputeType, F = never>(
  type: K,
  payload: ComputePayload<K> | null,
  options: ComputedOptions<ComputeResult<K> | F>,
): Computed<ComputeResult<K> | F, ComputePayload<K>> {
  type V = ComputeResult<K> | F;
  const main = !!options.local && inMainThread(options.local.room);
  const [state, setState] = useState<TaskState<V, ComputePayload<K>>>(idleState);
  // задача живёт, пока смонтирован экран; вид задачи может меняться (карта слушателя ↔ сабвуфера)
  const [task] = useState(() => new ComputeTask<{ type: K; payload: ComputePayload<K> }, V>(
    (r, onProgress, hidden) => compute(r.type, r.payload, onProgress, hidden),
    (s) => setState({ ...s, input: s.input?.payload ?? null }),
  ));
  const hidden = !useSectionVisible();
  useLayoutEffect(() => task.setHidden(hidden), [hidden]); // eslint-disable-line react-hooks/exhaustive-deps
  const sync = useMemo(
    () => (main && payload ? options.local!.compute() : null),
    [main, ...options.deps], // eslint-disable-line react-hooks/exhaustive-deps
  );
  useEffect(() => {
    task.change(main || !payload ? null : { type, payload }, options);
    return () => task.leave();
  }, [main, ...options.deps]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => task.dispose(), []); // eslint-disable-line react-hooks/exhaustive-deps
  if (main) return { value: sync, input: payload, busy: false, error: null, progress: 0 };
  return state;
}

export interface ComputeRun {
  busy: boolean;
  progress: number;
  /** Запустить задачу; `local` — тот же расчёт в основном потоке для прямоугольной модели (inMainThread). */
  run: <K extends ComputeType>(type: K, payload: ComputePayload<K>, h: {
    done: (r: ComputeResult<K>) => void;
    failed: (e: Error) => void;
    local?: LocalCompute<ComputeResult<K>>;
  }) => void;
}

/** Расчёт по кнопке: «считаем», ход и отмена — здесь, результат и ошибку обрабатывает экран. */
export function useComputeAction(opts: { progress?: boolean; cancelOnUnmount?: boolean } = {}): ComputeRun {
  const [state, setState] = useState<ActionState>({ busy: false, progress: 0 });
  const [action] = useState(() => new ComputeAction(setState, { progress: opts.progress, cancelOnDispose: opts.cancelOnUnmount }));
  const hidden = !useSectionVisible();
  useLayoutEffect(() => action.setHidden(hidden), [hidden]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => action.dispose(), []); // eslint-disable-line react-hooks/exhaustive-deps
  return {
    busy: state.busy,
    progress: state.progress,
    run: (type, payload, h) => action.run((p: typeof payload, onProgress?: (v: number) => void, hidden?: boolean) => compute(type, p, onProgress, hidden), payload, {
      done: h.done,
      failed: h.failed,
      local: h.local && inMainThread(h.local.room) ? h.local.compute : undefined,
    }),
  };
}
