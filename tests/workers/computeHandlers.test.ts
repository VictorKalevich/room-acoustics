// 030: таблица обработчиков воркера расчётов без воркера — каждый вид задачи на небольшой комнате даёт то же,
// что прямой вызов функции ядра; входные данные проходят ту же JSON-копию, что в ui/compute.ts.
import { describe, expect, it } from 'vitest';
import { computeHandlers, runHandler } from '../../src/workers/computeHandlers';
import type { ComputePayload, ComputeType } from '../../src/workers/computeJobs';
import { clearWaveCache } from '../../src/core/acoustics';
import type { Room } from '../../src/core/types';
import { defaultConstraints, defaultSetup, defaultSources, emptyRoom } from '../../src/state/project';
import { JOB_TYPES, jobCases, timeless, wire } from './jobCases';

const noop = () => {};

describe('таблица обработчиков воркера расчётов', () => {
  it('обработчик есть у каждого из 11 видов задач, лишних нет', () => {
    expect(Object.keys(computeHandlers).sort()).toEqual([...JOB_TYPES].sort());
    expect(Object.keys(jobCases).sort()).toEqual([...JOB_TYPES].sort());
  });

  for (const type of JOB_TYPES) {
    it(`${type}: результат совпадает с прямым вызовом ядра`, () => {
      const c = jobCases[type];
      const viaTable = runHandler(type, wire(c.payload), noop);
      expect(timeless(viaTable)).toEqual(timeless(c.direct()));
    });
  }

  it('неизвестный вид задачи — прежняя ошибка «Неизвестная задача …», в том числе для имён свойств объекта', () => {
    expect(() => runHandler('nope' as ComputeType, jobCases.modes.payload, noop)).toThrow('Неизвестная задача nope');
    expect(() => runHandler('toString' as ComputeType, jobCases.modes.payload, noop)).toThrow('Неизвестная задача toString');
  });

  it('ход расчёта передаётся в ядро у каждого вида задачи с ходом', () => {
    // в прямоугольной модели карты, оценка и поле 3D считаются сразу и хода не сообщают — для них волновая комната
    const corridor: Room = {
      ...emptyRoom(), depth: 6.5, width: 5, height: 3,
      extensions: [{ id: 'e', name: 'к', wall: 'right', a0: 0.5, a1: 5.5, depth: 1.2, height: 2.6, arch: { a0: 1, a1: 2.4, height: 2.2 }, openStart: false, openEnd: true, openFar: false }],
    };
    const sources = defaultSources(2, 1);
    const wave = { room: corridor, sources, constraints: defaultConstraints(corridor), setup: defaultSetup(corridor, sources, defaultConstraints(corridor)), ppo: 12 };
    const runs: { [K in ComputeType]?: ComputePayload<K> } = {
      optimize: jobCases.optimize.payload,
      modes: jobCases.modes.payload,
      voiceMap: jobCases.voiceMap.payload,
      listenerMap: wave,
      subMap: { ...wave, subId: 'sub1' },
      evaluate: wave,
      field: { room: corridor, sources, setup: wave.setup, kind: 'excited', freqs: [40, 63] },
    };
    for (const [type, payload] of Object.entries(runs) as [ComputeType, ComputePayload<ComputeType>][]) {
      clearWaveCache();
      const seen: number[] = [];
      runHandler(type, wire(payload), (v) => seen.push(v));
      expect(seen.length, type).toBeGreaterThan(0);
      expect(seen.every((v, i) => v >= 0 && v <= 1 && (i === 0 || v >= seen[i - 1])), `${type}: ${seen}`).toBe(true);
    }
  });
});
