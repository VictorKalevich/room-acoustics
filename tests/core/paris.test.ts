import { describe, expect, it } from 'vitest';
import { alphaStat, apertureBeta, betaFromAlpha } from '../../src/core/paris';

describe('α ↔ β (формула Пари)', () => {
  it('обращение точное во всём диапазоне и при малых α даёт α/8', () => {
    for (let a = 1e-4; a < 0.95; a *= 1.05) expect(Math.abs(alphaStat(betaFromAlpha(a)) - a) / a).toBeLessThan(1e-9);
    expect(betaFromAlpha(0.001) / (0.001 / 8)).toBeCloseTo(1, 2);
    // при α = 0,2 β больше α/8 на ~23 %, при 0,3 — на ~35 %
    expect(betaFromAlpha(0.2) / 0.025).toBeCloseTo(1.229, 2);
    expect(betaFromAlpha(0.3) / 0.0375).toBeCloseTo(1.349, 2);
  });
});

describe('проводимость проёма в стене', () => {
  it('дверной проём 0,9 × 2 м: ≈ 0,15 на 30–40 Гц, растёт с частотой, на высоких — около 1', () => {
    const b = (f: number) => apertureBeta(1.8, f);
    expect(b(30)).toBeGreaterThan(0.13);
    expect(b(40)).toBeLessThan(0.18);
    for (const [f1, f2] of [[30, 60], [60, 100], [100, 160]]) expect(b(f2)).toBeGreaterThan(b(f1));
    expect(b(1000)).toBeGreaterThan(0.85);
    expect(b(1000)).toBeLessThan(1.15);
  });

  it('на басу в 5–7 раз меньше согласованной границы ρc (β = 1); проём больше — проводимость выше', () => {
    expect(8 * apertureBeta(1.8, 50)).toBeLessThan(1.6);
    expect(apertureBeta(6, 60)).toBeGreaterThan(apertureBeta(1.8, 60));
  });
});
