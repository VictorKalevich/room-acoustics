import { describe, expect, it } from 'vitest';
import { computeModes, bonelloCheck, proportionsNotes } from '../../src/core/modes';
import { speedOfSound } from '../../src/core/physics';
import { defaultRoom } from '../../src/state/project';

const room = (depth: number, width: number, height: number) => ({ ...defaultRoom(), depth, width, height });

describe('speedOfSound', () => {
  it('≈343,2 м/с при 20 °C и 331,3 при 0 °C', () => {
    expect(speedOfSound(20)).toBeCloseTo(343.2, 1);
    expect(speedOfSound(0)).toBeCloseTo(331.3, 5);
  });
});

describe('computeModes', () => {
  const modes = computeModes(room(5, 4, 2.5), 300);

  it('первые моды 5 × 4 × 2,5 м совпадают с аналитическими (±0,1 Гц)', () => {
    expect(modes[0].n).toEqual([1, 0, 0]);
    expect(modes[0].f).toBeCloseTo(34.3, 1);
    expect(modes[1].n).toEqual([0, 1, 0]);
    expect(modes[1].f).toBeCloseTo(42.9, 1);
    expect(modes[2].n).toEqual([1, 1, 0]);
    expect(Math.abs(modes[2].f - 54.9)).toBeLessThan(0.1);
    const z = modes.find((m) => m.n.join() === '0,0,1')!;
    expect(z.f).toBeCloseTo(68.6, 1);
  });

  it('формула f = c/2·√Σ(n/L)² для каждой моды', () => {
    const c = speedOfSound(20);
    for (const m of modes) {
      const [a, b, d] = m.n;
      const f = (c / 2) * Math.hypot(a / 5, b / 4, d / 2.5);
      expect(m.f).toBeCloseTo(f, 9);
    }
  });

  it('классифицирует типы мод', () => {
    const kind = (n: string) => modes.find((m) => m.n.join() === n)!.kind;
    expect(kind('2,0,0')).toBe('axial');
    expect(kind('1,1,0')).toBe('tangential');
    expect(kind('1,1,1')).toBe('oblique');
  });

  it('отсортированы по частоте, без нулевой моды, в пределах fMax', () => {
    for (let i = 1; i < modes.length; i++) expect(modes[i].f).toBeGreaterThanOrEqual(modes[i - 1].f);
    expect(modes.every((m) => m.f > 0 && m.f <= 300)).toBe(true);
  });

  it('находит вырожденные моды в комнате 4 × 4 × 2', () => {
    const cube = computeModes(room(4, 4, 2), 200);
    const m100 = cube.find((m) => m.n.join() === '1,0,0')!;
    expect(m100.degenerate).toBe(true);
    // 5 × 4 × 2,5 м: 34,3 Гц ни с чем не совпадает, а (2,0,0) и (0,0,1) — обе 68,6 Гц
    const box = computeModes(room(5, 4, 2.5), 200);
    const deg = (n: string) => box.find((m) => m.n.join() === n)!.degenerate;
    expect([deg('1,0,0'), deg('0,1,0'), deg('2,0,0'), deg('0,0,1')]).toEqual([false, false, true, true]);
    expect(proportionsNotes(room(4, 4, 2)).length).toBeGreaterThan(0);
    expect(proportionsNotes(room(5.2, 4.1, 2.7)).length).toBe(0);
  });

  it('критерий Бонелло: число мод по третьоктавам', () => {
    const m = (f: number, degenerate = false) => ({ n: [1, 0, 0] as [number, number, number], f, kind: 'axial' as const, degenerate, clustered: false });
    // по одной моде в 25 и 31,5 Гц, три в 40, ни одной в 50: число мод убывает на 50 Гц
    const drop = bonelloCheck([m(25), m(31), m(39), m(40), m(41)], 100);
    expect(drop.bands.map((b) => [b.center, b.count])).toEqual([[20, 0], [25, 1], [31.5, 1], [40, 3], [50, 0], [63, 0], [80, 0], [100, 0]]);
    expect(drop).toMatchObject({ ok: false, violations: [50] });
    // число мод не убывает — критерий выполнен
    expect(bonelloCheck([m(31), m(39), m(41), m(50), m(51)], 50)).toMatchObject({ ok: true, violations: [] });
    // совпадающие моды допустимы лишь в полосе, где мод пять и больше
    expect(bonelloCheck([m(39, true), m(40, true), m(50), m(50), m(51)], 50).violations).toEqual([40]);
    expect(bonelloCheck([...[38, 39, 40, 41, 42].map((f) => m(f, true)), ...[47, 48, 49, 50, 51].map((f) => m(f))], 50).ok).toBe(true);
    // 5 × 4 × 2,5 м: 34,3, 42,9 и 54,9 Гц — по одной; на 68,6 Гц совпадают (2,0,0) и (0,0,1)
    const real = bonelloCheck(computeModes(room(5, 4, 2.5), 300));
    expect(real.bands.slice(2, 6).map((b) => [b.center, b.count, b.coincident])).toEqual([[31.5, 1, false], [40, 1, false], [50, 1, false], [63, 2, true]]);
    expect(real.violations).toContain(63);
    expect(real.ok).toBe(false);
  });
});

import { modeWhere } from '../../src/core/modes';
describe('подпись моды словами', () => {
  it('осевые, тангенциальные, косые', () => {
    expect(modeWhere([1, 0, 0])).toBe('по глубине');
    expect(modeWhere([0, 2, 0])).toBe('2-я по ширине');
    expect(modeWhere([0, 0, 1])).toBe('по высоте');
    expect(modeWhere([1, 0, 2])).toBe('глубина + высота');
    expect(modeWhere([1, 1, 1])).toBe('по всем трём размерам');
    expect(modeWhere([2, 1, 1], true)).toBe('косая');
  });
});
