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
    expect(proportionsNotes(room(4, 4, 2)).length).toBeGreaterThan(0);
    expect(proportionsNotes(room(5.2, 4.1, 2.7)).length).toBe(0);
  });

  it('критерий Бонелло: число мод по третьоктавам', () => {
    const res = bonelloCheck(computeModes(room(5, 4, 2.5), 300));
    expect(res.bands.length).toBeGreaterThan(5);
    expect(typeof res.ok).toBe('boolean');
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
