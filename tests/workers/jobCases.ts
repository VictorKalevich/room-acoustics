// Задачи воркера расчётов на небольшой комнате (030): входные данные в том виде, в каком их отправляет интерфейс,
// и прямой вызов функции ядра с теми аргументами, которые раскладывал прежний switch воркера (коммит 6f3327e).
import { optimizePlacement } from '../../src/core/placement';
import { listenerHeatmap, subHeatmap } from '../../src/core/field';
import { optimizeSubs } from '../../src/core/integration';
import { calibrate, compareMeasurement } from '../../src/core/measure';
import { evaluateSetup } from '../../src/core/system';
import { waveSystemModes } from '../../src/core/acoustics';
import { computeField } from '../../src/core/field3d';
import { optimizeSubFilters } from '../../src/core/subfilters';
import { VOICE_DEFAULTS, voiceMap } from '../../src/core/voice';
import type { Measurement } from '../../src/core/types';
import { defaultConstraints, defaultSetup, defaultSources, emptyRoom } from '../../src/state/project';
import type { ComputePayload, ComputeType } from '../../src/workers/computeJobs';

const room = emptyRoom(); // 4 × 3 × 2,7 м, прямоугольная модель
const sources = defaultSources(2, 1);
const constraints = defaultConstraints(room);
const setup = defaultSetup(room, sources, constraints);
// подбор фильтров сабвуфера работает, только если у него есть полосы PEQ или all-pass
const filterSources = sources.map((s) => (s.kind === 'sub' ? { ...s, peqBands: 1, allpass: true } : s));

/** Синтетический замер: расчётный отклик со сдвигом уровня, как в tests/core/measure.test.ts. */
const response = evaluateSetup(room, sources, constraints, setup, { ppo: 48 }).response;
const measurement: Measurement = { name: 'Синтетический', importedAt: '2026-11-14T00:00:00.000Z', f: response.f, db: response.db.map((v) => v + 75) };

export interface JobCase<K extends ComputeType> {
  type: K;
  payload: ComputePayload<K>;
  /** Прямой вызов ядра без прогресса. */
  direct: () => unknown;
}

export const jobCases: { [K in ComputeType]: JobCase<K> } = {
  optimize: { type: 'optimize', payload: { room, sources, constraints, precision: 'high' }, direct: () => optimizePlacement({ room, sources, constraints, precision: 'high' }) },
  listenerMap: { type: 'listenerMap', payload: { room, sources, constraints, setup, ppo: 24 }, direct: () => listenerHeatmap(room, sources, constraints, setup, { ppo: 24 }) },
  subMap: { type: 'subMap', payload: { room, sources, constraints, setup, subId: 'sub1', ppo: 24 }, direct: () => subHeatmap(room, sources, constraints, setup, 'sub1', { ppo: 24 }) },
  integrate: { type: 'integrate', payload: { room, sources, constraints, setup, ppo: 48 }, direct: () => optimizeSubs(room, sources, constraints, setup, { ppo: 48 }) },
  calibrate: { type: 'calibrate', payload: { room, sources, constraints, setup, measurement }, direct: () => calibrate(room, sources, constraints, setup, measurement) },
  compare: { type: 'compare', payload: { room, sources, constraints, setup, measurement }, direct: () => compareMeasurement(room, sources, constraints, setup, measurement) },
  evaluate: { type: 'evaluate', payload: { room, sources, constraints, setup, ppo: 48 }, direct: () => evaluateSetup(room, sources, constraints, setup, { ppo: 48 }) },
  modes: { type: 'modes', payload: { room, fMax: 80 }, direct: () => waveSystemModes(room, 80) },
  field: { type: 'field', payload: { room, sources, setup, kind: 'excited', freqs: [40, 63] }, direct: () => computeField({ room, sources, setup, kind: 'excited', freqs: [40, 63] }) },
  subFilters: { type: 'subFilters', payload: { room, sources: filterSources, constraints, setup, ppo: 48 }, direct: () => optimizeSubFilters(room, filterSources, constraints, setup, { ppo: 48 }) },
  voiceMap: { type: 'voiceMap', payload: { room, settings: VOICE_DEFAULTS, goal: 'room', precision: 'high' }, direct: () => voiceMap(room, VOICE_DEFAULTS, undefined, 'room', 'high') },
};

/** Все виды задач — тот же список, что был в объединении ComputeType до 030. */
export const JOB_TYPES: ComputeType[] = ['optimize', 'listenerMap', 'subMap', 'integrate', 'calibrate', 'compare', 'evaluate', 'modes', 'field', 'subFilters', 'voiceMap'];

/** Как в ui/compute.ts: в воркер уходит JSON-копия входных данных. */
export const wire = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Время расчёта (elapsedMs) у каждого вызова своё — при сравнении результатов не учитывается. */
export function timeless(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(timeless);
  if (v && typeof v === 'object' && !ArrayBuffer.isView(v)) {
    return Object.fromEntries(Object.entries(v).filter(([k]) => k !== 'elapsedMs').map(([k, x]) => [k, timeless(x)]));
  }
  return v;
}
