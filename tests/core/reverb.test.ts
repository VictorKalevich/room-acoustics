import { describe, expect, it } from 'vitest';
import { computeReverb, schroederFrequency } from '../../src/core/reverb';
import { defaultRoom } from '../../src/state/project';
import type { Room } from '../../src/core/types';

const allPlaster = (): Room => ({
  ...defaultRoom(),
  depth: 5, width: 4, height: 2.5,
  furnishing: 'empty',
  materials: { floor: 'plaster', ceiling: 'plaster', front: 'plaster', back: 'plaster', left: 'plaster', right: 'plaster' },
});

describe('computeReverb', () => {
  it('Сэбин и Эйринг совпадают с ручным расчётом на 500 Гц (±0,01 с)', () => {
    const r = computeReverb(allPlaster());
    const i = r.bands.indexOf(500);
    const V = 50, S = 85, a = 0.02;
    expect(r.volume).toBeCloseTo(V, 9);
    expect(r.surfaceArea).toBeCloseTo(S, 9);
    expect(Math.abs(r.sabine[i] - (0.161 * V) / (S * a))).toBeLessThan(0.01);
    expect(Math.abs(r.eyring[i] - (0.161 * V) / (-S * Math.log(1 - a)))).toBeLessThan(0.01);
    expect(r.formula[i]).toBe('sabine');
  });

  it('использует Эйринга при среднем поглощении > 0,2', () => {
    const room = allPlaster();
    room.materials = { ...room.materials, front: 'acoustic-panel', back: 'acoustic-panel', left: 'acoustic-panel', right: 'acoustic-panel' };
    const r = computeReverb(room);
    const i = r.bands.indexOf(1000);
    expect(r.meanAlpha[i]).toBeGreaterThan(0.2);
    expect(r.formula[i]).toBe('eyring');
    expect(r.used[i]).toBe(r.eyring[i]);
  });

  it('толстый ковёр уменьшает RT60 на 1–4 кГц', () => {
    const a = computeReverb({ ...defaultRoom(), materials: { ...defaultRoom().materials, floor: 'parquet' } });
    const b = computeReverb({ ...defaultRoom(), materials: { ...defaultRoom().materials, floor: 'carpet-thick' } });
    for (const f of [1000, 2000, 4000]) {
      const i = a.bands.indexOf(f);
      expect(b.used[i]).toBeLessThan(a.used[i]);
    }
    expect(b.schroeder).toBeLessThan(a.schroeder);
  });

  it('частота Шрёдера = 2000·√(T/V)', () => {
    expect(schroederFrequency(0.5, 50)).toBeCloseTo(2000 * Math.sqrt(0.01), 9);
    const r = computeReverb(defaultRoom());
    expect(r.schroeder).toBeCloseTo(schroederFrequency(r.tMid, r.volume), 9);
  });

  it('типичная меблированная комната даёт реалистичное RT60 (0,3–1,0 с на 500 Гц)', () => {
    const r = computeReverb(defaultRoom());
    const t = r.used[r.bands.indexOf(500)];
    expect(t).toBeGreaterThan(0.3);
    expect(t).toBeLessThan(1.0);
  });
});
