// 030: таблица обработчиков воркера расчётов без воркера — каждый вид задачи на небольшой комнате даёт то же,
// что прямой вызов функции ядра; входные данные проходят ту же JSON-копию, что в ui/compute.ts.
import { describe, expect, it } from 'vitest';
import { computeHandlers, runHandler } from '../../src/workers/computeHandlers';
import type { ComputeType } from '../../src/workers/computeJobs';
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

  it('ход расчёта передаётся в ядро', () => {
    const seen: number[] = [];
    runHandler('voiceMap', wire(jobCases.voiceMap.payload), (v) => seen.push(v));
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((v) => v >= 0 && v <= 1)).toBe(true);
  });
});
