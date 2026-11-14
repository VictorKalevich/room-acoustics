// Обработчики задач воркера расчётов (030): по одному на каждый вид из таблицы ComputeJobs. Компилятор проверяет
// полноту: вид задачи без обработчика, лишний обработчик, поле, которого нет во входных данных, или результат
// другого типа не собираются. Модуль не обращается к `self` — его можно импортировать в тестах без воркера.
import { optimizePlacement } from '../core/placement';
import { listenerHeatmap, subHeatmap } from '../core/field';
import { optimizeSubs } from '../core/integration';
import { calibrate, compareMeasurement } from '../core/measure';
import { evaluateSetup } from '../core/system';
import { waveSystemModes } from '../core/acoustics';
import { computeField } from '../core/field3d';
import { optimizeSubFilters } from '../core/subfilters';
import { voiceMap } from '../core/voice';
import type { ComputePayload, ComputeResult, ComputeType } from './computeJobs';

/** Ход расчёта, 0…1. */
export type Progress = (v: number) => void;
export type ComputeHandler<K extends ComputeType> = (p: ComputePayload<K>, progress: Progress) => ComputeResult<K>;
export type ComputeHandlers = { [K in ComputeType]: ComputeHandler<K> };

export const computeHandlers: ComputeHandlers = {
  optimize: (p, progress) => optimizePlacement(p, progress),
  listenerMap: (p, progress) => listenerHeatmap(p.room, p.sources, p.constraints, p.setup, { ppo: p.ppo, onProgress: progress }),
  subMap: (p, progress) => subHeatmap(p.room, p.sources, p.constraints, p.setup, p.subId, { ppo: p.ppo, onProgress: progress }),
  integrate: (p) => optimizeSubs(p.room, p.sources, p.constraints, p.setup, { ppo: p.ppo }),
  calibrate: (p) => calibrate(p.room, p.sources, p.constraints, p.setup, p.measurement),
  compare: (p) => compareMeasurement(p.room, p.sources, p.constraints, p.setup, p.measurement),
  evaluate: (p, progress) => evaluateSetup(p.room, p.sources, p.constraints, p.setup, { ppo: p.ppo, onProgress: progress }),
  modes: (p, progress) => waveSystemModes(p.room, p.fMax, progress),
  field: (p, progress) => computeField(p, progress),
  subFilters: (p) => optimizeSubFilters(p.room, p.sources, p.constraints, p.setup, { ppo: p.ppo }),
  voiceMap: (p, progress) => voiceMap(p.room, p.settings, progress, p.goal, p.precision),
};

/**
 * Выполнить задачу вида K: тип входных данных и результата берётся из таблицы. Вид приходит из сообщения, поэтому
 * неизвестный (страница и воркер разных версий) проверяется и при выполнении — с прежним текстом ошибки.
 */
export function runHandler<K extends ComputeType>(type: K, payload: ComputePayload<K>, progress: Progress): ComputeResult<K> {
  if (!Object.hasOwn(computeHandlers, type)) throw new Error(`Неизвестная задача ${type}`);
  const handler: ComputeHandler<K> = computeHandlers[type];
  return handler(payload, progress);
}
