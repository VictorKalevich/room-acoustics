// V2-050: многокритериальный подбор — пространство поиска с закреплениями и ограничениями, покоординатный спуск по
// оценке ядра, фронт Парето «неровность — перестановка», чувствительность, перенос варианта в конфигурацию.
import { describe, expect, it } from 'vitest';
import { evaluateSetup } from '../../src/core/system';
import { evalPpo } from '../../src/core/precision';
import { toCore, type CoreInputs } from '../../src/v2/adapters/core';
import { paretoFront, paretoOp, paretoSearch, searchSpace, sensitivity, thinFront, type Evaluate, type ParetoPoint } from '../../src/v2/application/pareto';
import { buildRoom, DEFAULT_NEW_ROOM } from '../../src/v2/application/rooms';
import type { Room } from '../../src/v2/domain/model';

let n = 0;
const id = () => `id${++n}`;
const room = (layout: '2.1' | '2.2' = '2.2') => buildRoom({ ...DEFAULT_NEW_ROOM, name: 'Тест', depth: 5.2, width: 3.9, height: 2.6, layout }, id, '2026-11-28T10:00:00.000Z');
const inputs = (r: Room): CoreInputs => {
  const c = toCore(r.current);
  if (!c.ok) throw new Error(c.reason);
  return c.inputs;
};
const evaluator = (i: CoreInputs): Evaluate => async (l) => evaluateSetup(i.room, i.sources, i.constraints, { ...i.setup, ...l }, { ppo: evalPpo(i.precision) });
const lock = (r: Room, ids: string[], listener = false): Room => ({
  ...r,
  current: {
    ...r.current,
    audio: { ...r.current.audio, sources: r.current.audio.sources.map((s) => (ids.includes(s.id) ? { ...s, locked: true } : s)) },
    listening: { ...r.current.listening, listeners: r.current.listening.listeners.map((l) => (l.primary ? { ...l, locked: listener } : l)) },
  },
});
const subs = (r: Room) => r.current.audio.sources.filter((s) => s.kind === 'sub').map((s) => s.id);
const spks = (r: Room) => r.current.audio.sources.filter((s) => s.kind === 'speaker').map((s) => s.id);

describe('пространство поиска (V2-050)', () => {
  it('закреплённое и запрещённое целями не двигается; колонки — только вместе', () => {
    const r = room();
    const all = searchSpace(r.current, r.goals, inputs(r));
    expect(all.subs.map((s) => s.id)).toEqual(subs(r));
    expect(all.speakers).toEqual(spks(r));
    expect(all.listener.length).toBeGreaterThan(5);
    expect(all.speakerHalf.length).toBeGreaterThan(0);
    expect(all.fixed).toEqual([]);

    const l = lock(r, [subs(r)[0], spks(r)[0]], true);
    const s = searchSpace(l.current, l.goals, inputs(l));
    expect(s.subs.map((x) => x.id)).toEqual([subs(r)[1]]);
    expect([s.speakers, s.listener]).toEqual([[], []]);
    expect(s.fixed.join(' ')).toMatch(/Место слушателя закреплено.*Колонки двигаются только вместе/);

    const g = { ...r.goals, constraints: { ...r.goals.constraints, canMoveEquipment: false, canMoveFurniture: false } };
    const none = searchSpace(r.current, g, inputs(r));
    expect([none.subs, none.speakers, none.listener]).toEqual([[], [], []]);
    expect(none.fixed).toHaveLength(2);
  });
});

describe('фронт Парето (V2-050)', () => {
  const p = (shift: number, score: number) => ({ key: `${shift}/${score}`, shift, score }) as ParetoPoint;
  it('каждый следующий двигает больше и заметно лучше; прорежение сохраняет края', () => {
    const f = paretoFront([p(0, 10), p(0.5, 9), p(0.5, 8), p(1, 8.5), p(1.2, 7.98), p(2, 6), p(3, 6.2)]);
    expect(f.map((x) => [x.shift, x.score])).toEqual([[0, 10], [0.5, 8], [2, 6]]);
    const long = Array.from({ length: 20 }, (_, k) => p(k, 20 - k));
    const t = thinFront(paretoFront(long), 6);
    expect(t).toHaveLength(6);
    expect([t[0].shift, t[5].shift]).toEqual([0, 19]);
  });
});

describe('поиск по оценке ядра (V2-050)', () => {
  it('спуск не ухудшает; фронт монотонен; закреплённое не сдвинуто ни в одном варианте; бюджет соблюдён', async () => {
    const r = lock(room(), []);
    const lr = lock(r, [subs(r)[0]]);
    const i = inputs(lr);
    const space = searchSpace(lr.current, lr.goals, i);
    const base = { listener: i.setup.listener, positions: i.setup.positions };
    const res = await paretoSearch(space, base, evaluator(i), { budget: 300 });
    expect(res.evaluated).toBeLessThanOrEqual(300);
    expect(res.front[0].shift).toBe(0);
    expect(res.front[0].score).toBeCloseTo(res.baseline.score, 9);
    for (let k = 1; k < res.front.length; k++) {
      expect(res.front[k].shift).toBeGreaterThan(res.front[k - 1].shift);
      expect(res.front[k].score).toBeLessThan(res.front[k - 1].score - 0.05 + 1e-9);
    }
    const best = res.front[res.front.length - 1];
    expect(best.score).toBeLessThan(res.baseline.score);
    for (const f of res.front) expect(f.layout.positions[subs(r)[0]]).toEqual(base.positions[subs(r)[0]]);
    // независимая проверка: оценка варианта — та же, что у ядра для его расстановки
    const direct = evaluateSetup(i.room, i.sources, i.constraints, { ...i.setup, ...best.layout }, { ppo: evalPpo(i.precision) });
    expect(best.score).toBeCloseTo(direct.objScore, 9);
  });

  it('чувствительность: по объекту, неотрицательна, по убыванию; вариант переносится в конфигурацию', async () => {
    const r = room('2.1');
    const i = inputs(r);
    const base = { listener: i.setup.listener, positions: i.setup.positions };
    const b = evaluateSetup(i.room, i.sources, i.constraints, i.setup, { ppo: evalPpo(i.precision) }).objScore;
    const s = await sensitivity(i, base, b, evaluator(i));
    expect(s.map((x) => x.id).sort()).toEqual(['listener', ...Object.keys(base.positions)].sort());
    expect(s.every((x) => x.worse >= 0)).toBe(true);
    expect(s.map((x) => x.worse)).toEqual(s.map((x) => x.worse).sort((x, y) => y - x));
    expect(s.find((x) => x.id === 'listener')?.shift).toBe(0.25);

    const sub = subs(r)[0];
    const moved = { ...base, positions: { ...base.positions, [sub]: { ...base.positions[sub], x: 0.15, y: 0.15 } }, listener: { ...base.listener, x: 3 } };
    const c = paretoOp(moved)(r.current);
    expect(c.audio.sources.find((x) => x.id === sub)?.position).toMatchObject({ x: 0.15, y: 0.15 });
    expect(c.listening.listeners.find((x) => x.primary)?.position.x).toBe(3);
    expect(c.audio.crossoverHz).toBe(r.current.audio.crossoverHz);
    expect(c.audio.sources.map((x) => x.settings)).toEqual(r.current.audio.sources.map((x) => x.settings));
  });
});
