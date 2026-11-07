import { describe, expect, it } from 'vitest';
import { evaluateSetup, receiverSet, seatPositions, sourceAllowed, seatAllowed, subAdjust, filterSet } from '../../src/core/system';
import { defaultConstraints, defaultRoom, defaultSetup, defaultSources } from '../../src/state/project';
import { cabs } from '../../src/core/frequency';

const room = defaultRoom();
const sources = defaultSources(2, 1);
const c = defaultConstraints(room);

describe('места прослушивания', () => {
  it('одно место: центр и сдвиги головы ±0,3 м с весами 0,6/0,2/0,2', () => {
    const r = receiverSet(room, c, { x: 2, y: 2, z: 1.1 });
    expect(r.pts.map((p) => p.y)).toEqual([2, 1.7, 2.3]);
    expect(r.weights).toEqual([0.6, 0.2, 0.2]);
  });

  it('три места с шагом 0,6 м центрированы на основном месте', () => {
    const cc = { ...c, seats: { count: 3, spacing: 0.6 } };
    const s = seatPositions(room, { x: 2, y: 2, z: 1.1 }, cc);
    expect(s.map((p) => +p.y.toFixed(3))).toEqual([1.4, 2, 2.6]);
    expect(receiverSet(room, cc, { x: 2, y: 2, z: 1.1 }).weights).toEqual([1 / 3, 1 / 3, 1 / 3]);
  });

  it('если места не помещаются по ширине, шаг уменьшается', () => {
    const cc = { ...c, seats: { count: 5, spacing: 1.2 } };
    const s = seatPositions(room, { x: 2, y: 2, z: 1.1 }, cc);
    expect(s[0].y).toBeGreaterThanOrEqual(0.2 - 1e-9);
    expect(s[4].y).toBeLessThanOrEqual(room.width - 0.2 + 1e-9);
  });
});

describe('зоны', () => {
  it('источник нельзя ставить в зоне, сидеть можно только где canSit', () => {
    const r = { ...room, zones: [
      { id: 'a', kind: 'door' as const, x0: 0, x1: 1, y0: 0, y1: 1, canSit: false },
      { id: 'b', kind: 'furniture' as const, x0: 3, x1: 4, y0: 1, y1: 3, canSit: true },
    ] };
    expect(sourceAllowed(r, { x: 0.5, y: 0.5 })).toBe(false);
    expect(sourceAllowed(r, { x: 2, y: 2 })).toBe(true);
    expect(seatAllowed(r, { x: 0.5, y: 0.5 })).toBe(false);
    expect(seatAllowed(r, { x: 3.5, y: 2 })).toBe(true);
    expect(sourceAllowed(r, { x: 3.5, y: 2 })).toBe(false);
  });
});

describe('регулировки сабвуфера', () => {
  it('задержка 1 мс на 250 Гц = поворот фазы на 90°, уровень +6 дБ ≈ ×2', () => {
    const a = subAdjust({ delayMs: 1, phaseDeg: 0, gainDb: 6 }, 250);
    expect(cabs(a)).toBeCloseTo(Math.pow(10, 6 / 20), 9);
    expect(Math.atan2(a.im, a.re)).toBeCloseTo(-Math.PI / 2, 9);
    const p = subAdjust({ delayMs: 0, phaseDeg: 180, gainDb: 0 }, 50);
    expect(p.re).toBeCloseTo(-1, 9);
  });

  it('регулировки не меняют целевую кривую', () => {
    const f = [40, 80, 120];
    const a = filterSet(sources, f);
    const b = filterSet(sources, f, null, { sub1: { delayMs: 5, phaseDeg: 90, gainDb: 3 } });
    expect(b.target).toEqual(a.target);
    expect(b.filt.sub1.re[0]).not.toBeCloseTo(a.filt.sub1.re[0], 6);
  });
});

describe('evaluateSetup', () => {
  it('оценивает расстановку по умолчанию и учитывает полярность', () => {
    const s = defaultSetup(room, sources, c);
    const e0 = evaluateSetup(room, sources, c, s);
    const e1 = evaluateSetup(room, sources, c, { ...s, subSettings: { sub1: { delayMs: 0, phaseDeg: 180, gainDb: 0 } } });
    expect(e0.score).toBeGreaterThan(0);
    expect(e1.score).not.toBeCloseTo(e0.score, 3);
    expect(e0.response.f.length).toBe(e0.response.db.length);
  });
});
