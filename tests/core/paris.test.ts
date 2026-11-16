import { describe, expect, it } from 'vitest';
import { alphaStat, apertureBeta, betaFromAlpha, openEndAdmittance } from '../../src/core/paris';

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
    for (const f of [30, 40, 50, 63]) {
      expect(apertureBeta(1.8, f), `${f} Гц`).toBeGreaterThan(1 / 7);
      expect(apertureBeta(1.8, f), `${f} Гц`).toBeLessThan(1 / 5);
    }
    expect(apertureBeta(6, 60)).toBeGreaterThan(apertureBeta(1.8, 60));
  });
});

describe('041: открытая сторона смежного помещения', () => {
  const r = ([re, im]: [number, number]) => Math.hypot(1 - re * re - im * im, 2 * im) / ((1 + re) ** 2 + im * im);
  it('на басу — масса воздуха: Im β ≈ −1/(k·0,85a), Re β ≈ 0,69; на высоких β → 1 (ρc)', () => {
    const area = 1.2 * 2.4, a = Math.sqrt(area / Math.PI);
    for (const f of [15, 20, 25]) {
      const [re, im] = openEndAdmittance(area, f);
      const k = (2 * Math.PI * f) / 343;
      expect(-1 / im / (k * a), `${f} Гц`).toBeCloseTo(8 / (3 * Math.PI), 1);
      expect(re, `${f} Гц`).toBeCloseTo((9 * Math.PI * Math.PI) / 128, 1);
    }
    const [re, im] = openEndAdmittance(area, 2000);
    expect(re).toBeCloseTo(1, 1);
    expect(Math.abs(im)).toBeLessThan(0.05);
  });

  it('сечение коридора 1,2 × 2,4 м отражает на басу почти весь звук, на высоких почти ничего; граница ρc не отражает', () => {
    const area = 1.2 * 2.4;
    expect(r(openEndAdmittance(area, 20))).toBeGreaterThan(0.85);
    expect(r(openEndAdmittance(area, 80))).toBeGreaterThan(0.3);
    expect(r(openEndAdmittance(area, 80))).toBeLessThan(0.5);
    expect(r(openEndAdmittance(area, 1000))).toBeLessThan(0.1);
    expect(r([1, 0])).toBe(0);
    // узкий проём отражает сильнее широкого
    expect(r(openEndAdmittance(0.5, 60))).toBeGreaterThan(r(openEndAdmittance(6, 60)));
  });
});
