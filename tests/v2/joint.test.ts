// V2-054: неопределённость (Монте-Карло) и совместный подбор. Проверки: повторяемость и границы выборки, нулевые
// допуски дают ровно оценку ядра, сравнение варианта с самим собой — нулевая разница, возмущение не выводит объекты из
// комнаты; совместный подбор: сабвуферы и эквалайзер не ухудшают неровность, без плана обработки — один вариант на точку.
import { describe, expect, it } from 'vitest';
import { evaluateSetup } from '../../src/core/system';
import { optimizeSubs } from '../../src/core/integration';
import { evalPpo } from '../../src/core/precision';
import { toCore, type CoreInputs } from '../../src/v2/adapters/core';
import { paretoSearch, searchSpace, thinFront } from '../../src/v2/application/pareto';
import { DEFAULT_TOL, draws, jointSearch, monteCarlo, perturb, rng, stats, type EvaluateAt } from '../../src/v2/application/joint';
import { buildRoom, DEFAULT_NEW_ROOM } from '../../src/v2/application/rooms';

let n = 0;
const id = () => `id${++n}`;
const room = () => buildRoom({ ...DEFAULT_NEW_ROOM, name: 'Тест', depth: 5.2, width: 3.9, height: 2.6, layout: '2.2' }, id, '2026-11-28T10:00:00.000Z');
const inputs = (): CoreInputs => {
  const c = toCore(room().current);
  if (!c.ok) throw new Error(c.reason);
  return c.inputs;
};

describe('выборка возмущений (V2-054)', () => {
  it('повторяемая по зерну, в пределах допусков; в волновой модели размеры не меняются', () => {
    const a = draws(200, DEFAULT_TOL, ['s1'], 7), b = draws(200, DEFAULT_TOL, ['s1'], 7);
    expect(a).toEqual(b);
    expect(draws(5, DEFAULT_TOL, ['s1'], 8)).not.toEqual(a.slice(0, 5));
    for (const d of a) {
      expect(Math.abs(d.depth)).toBeLessThanOrEqual(0.02);
      expect(Math.abs(d.damping - 1)).toBeLessThanOrEqual(0.2);
      expect(Math.abs(d.sources.s1[0])).toBeLessThanOrEqual(0.05);
    }
    const mean = a.reduce((s, d) => s + d.damping, 0) / a.length;
    expect(mean).toBeCloseTo(1, 1);
    expect(draws(3, DEFAULT_TOL, [], 1, false).every((d) => d.depth === 0 && d.width === 0 && d.height === 0)).toBe(true);
    const r = rng(1);
    expect(Array.from({ length: 1000 }, r).every((x) => x >= 0 && x < 1)).toBe(true);
    expect(stats([5, 1, 3, 2, 4])).toEqual({ p10: 1.4, median: 3, p90: 4.6 });
  });

  it('возмущение: множитель затухания, размеры, объекты остаются в комнате', () => {
    const i = inputs();
    const l = { listener: i.setup.listener, positions: i.setup.positions };
    const d = { depth: -0.5, width: 0.01, height: 0, damping: 1.2, listener: [10, 0] as [number, number], sources: Object.fromEntries(Object.keys(l.positions).map((k) => [k, [-10, 0] as [number, number]])) };
    const p = perturb(i.room, i.setup, l, d);
    expect(p.room.depth).toBeCloseTo(i.room.depth - 0.5, 12);
    expect(p.room.calibration?.dampingScale).toBeCloseTo((i.room.calibration?.dampingScale ?? 1) * 1.2, 12);
    expect(p.setup.listener.x).toBeLessThanOrEqual(p.room.depth - 0.1);
    for (const q of Object.values(p.setup.positions)) expect(q.x).toBeGreaterThanOrEqual(0.05);
  });
});

describe('Монте-Карло и совместный подбор (V2-054)', () => {
  const i = inputs();
  const ppo = evalPpo(i.precision);
  const evaluate: EvaluateAt = async (r, s) => evaluateSetup(r, i.sources, i.constraints, s, { ppo });
  const base = { listener: i.setup.listener, positions: i.setup.positions };

  it('нулевые допуски — оценка ядра; вариант против себя — разница 0; разброс растёт с допусками', async () => {
    const zero = await monteCarlo(i, base, base, { dims: 0, absorption: 0, listener: 0, sources: 0 }, 4, 1, evaluate);
    const direct = evaluateSetup(i.room, i.sources, i.constraints, i.setup, { ppo }).objScore;
    expect(zero.a.median).toBeCloseTo(direct, 9);
    expect([zero.a.p10, zero.a.p90]).toEqual([zero.a.median, zero.a.median]);
    const self = await monteCarlo(i, base, base, DEFAULT_TOL, 12, 3, evaluate);
    expect([self.diff.p10, self.diff.p90, self.better, self.worse]).toEqual([0, 0, 0, 0]);
    expect(self.a.p90 - self.a.p10).toBeGreaterThan(0);
    expect(self.bandA.f).toEqual(self.bandA.f.slice().sort((x, y) => x - y));
    expect(self.bandA.p10.every((v, k) => v <= self.bandA.p50[k] + 1e-9 && self.bandA.p50[k] <= self.bandA.p90[k] + 1e-9)).toBe(true);
  });

  it('совместный подбор: сабвуферы и эквалайзер не ухудшают неровность; план обработки удваивает варианты', async () => {
    const r = await paretoSearch(searchSpace(room().current, room().goals, i), base, async (l) => evaluate(i.room, { ...i.setup, ...l }), { budget: 60 });
    const pts = thinFront(r.front, 3);
    const integrate = async (rm: typeof i.room, s: typeof i.setup) => optimizeSubs(rm, i.sources, i.constraints, s, { ppo });
    const rows = await jointSearch(i, pts, false, { evaluate, integrate }, id);
    expect(rows).toHaveLength(pts.length);
    for (const x of rows) {
      expect(x.subs).not.toBeNull();
      expect(x.subs!).toBeLessThanOrEqual(x.raw + 0.05);
      expect(x.eq).toBeLessThanOrEqual(x.subs! + 1e-9);
      expect(x.preamp).toBeLessThanOrEqual(0);
    }
    expect(rows.map((x) => x.eq)).toEqual(rows.map((x) => x.eq).sort((a, b) => a - b));
    const both = await jointSearch(i, pts.slice(0, 1), true, { evaluate, integrate: null }, id);
    expect(both.map((x) => x.treatments).sort()).toEqual([false, true]);
    expect(both.every((x) => x.subs === null)).toBe(true);
  });
});
