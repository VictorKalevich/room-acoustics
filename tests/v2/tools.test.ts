// V2-038–V2-040: расчёты инструментов — длина волны, SBIR, геометрия, стереотреугольник, сумма двух источников,
// кроссоверы (сумма LR — всепропускающая), биквады RBJ, экспорт, SPL, направленность, резонаторы, QRD.
import { describe, expect, it } from 'vitest';
import { bw2 } from '../../src/core/filters';
import { peqGainDb } from '../../src/core/eq';
import { speedOfSound } from '../../src/core/physics';
import {
  beamwidth6, besselJ1, combNotches, combResponse, crossoverFilter, crossoverResponse, delayMs, distanceForAngle, distanceOf, eqChain, eqIssues,
  exportApo, helmholtz, logFreqs, membrane, perforated, phaseOfDelay, pistonDb, qrd, rbj, roomGeometry, splBudget, stable, stereoTriangle,
  twoSourceSum, wavelength, type EqFilter,
} from '../../src/v2/application/tools';

const C = speedOfSound(20);
const mag = (c: { re: number; im: number }) => Math.hypot(c.re, c.im);

describe('059 V2-038 · калькуляторы', () => {
  it('длина волны, задержка и фаза', () => {
    const w = wavelength(100);
    expect(w.lambda).toBeCloseTo(C / 100, 9);
    expect(w.quarter).toBeCloseTo(w.lambda / 4, 9);
    expect(w.periodMs).toBeCloseTo(10, 9);
    expect(distanceOf(delayMs(3.43))).toBeCloseTo(3.43, 9);
    expect(phaseOfDelay(1000, 0.25)).toBeCloseTo(90, 9);
  });

  it('SBIR: провалы на нечётных полуволнах разности путей, глубина по коэффициенту отражения', () => {
    const notches = combNotches(1, 1000);
    expect(notches[0]).toBeCloseTo(C / 2, 6);
    expect(notches[1]).toBeCloseTo((3 * C) / 2, 6);
    const [dip] = combResponse([notches[0]], 1, 0.36);
    expect(dip).toBeCloseTo(20 * Math.log10(1 - 0.8), 6);
    const [peak] = combResponse([C], 1, 0);
    expect(peak).toBeCloseTo(20 * Math.log10(2), 6);
  });

  it('геометрия и стереотреугольник', () => {
    const g = roomGeometry(5, 4, 2.5);
    expect(g.volume).toBeCloseTo(50, 9);
    expect(g.surface).toBeCloseTo(85, 9);
    expect(g.ratio).toEqual([1, 1.6, 2]);
    const t = stereoTriangle(2, Math.sqrt(3));
    expect(t.angleDeg).toBeCloseTo(60, 9);
    expect(t.toSpeaker).toBeCloseTo(2, 9);
    expect(distanceForAngle(2, 60)).toBeCloseTo(Math.sqrt(3), 9);
  });
});

describe('059 V2-040 · настройка', () => {
  it('сумма двух источников: синфазно +6 дБ, в противофазе — провал', () => {
    const [same] = twoSourceSum([100], 0, 0, false);
    expect(same.db).toBeCloseTo(20 * Math.log10(2), 9);
    const [opp] = twoSourceSum([100], 0, 0, true);
    expect(opp.db).toBeLessThan(-100);
    const [half] = twoSourceSum([100], 0, 5, false);
    expect(half.db).toBeLessThan(-100);
  });

  it('кроссовер: LP Баттерворта 2-го порядка совпадает с ядром, сумма LR4 ровная, BW2 без инверсии — провал на раздельной', () => {
    for (const f of [30, 80, 200]) {
      const a = crossoverFilter('butterworth', 2, 'lp', 80, f), b = bw2('lp', 80, f);
      expect(a.re).toBeCloseTo(b.re, 9);
      expect(a.im).toBeCloseTo(b.im, 9);
    }
    const lr = crossoverResponse('linkwitz-riley', 4, 100, logFreqs(20, 500, 12), false);
    for (const r of lr) expect(Math.abs(r.sum)).toBeLessThan(1e-6);
    const [bw] = crossoverResponse('butterworth', 2, 100, [100], false);
    expect(bw.sum).toBeLessThan(-100);
    expect(mag(crossoverFilter('linkwitz-riley', 4, 'hp', 100, 100))).toBeCloseTo(0.5, 9);
    expect(() => crossoverFilter('linkwitz-riley', 3, 'lp', 100, 100)).toThrow();
  });

  it('биквады RBJ: пиковый совпадает с аналоговым ядра на низких частотах, полки, полосы, устойчивость', () => {
    const fs = 48000;
    const peak: EqFilter = { id: 'a', type: 'peaking', f: 60, gainDb: -6, q: 4, enabled: true };
    const [r] = eqChain([peak], [60], fs);
    expect(r.db).toBeCloseTo(-6, 6);
    expect(eqChain([peak], [45], fs)[0].db).toBeCloseTo(peqGainDb(peak, 45), 2);
    const ls: EqFilter = { id: 'b', type: 'lowshelf', f: 100, gainDb: 6, q: Math.SQRT1_2, enabled: true };
    expect(eqChain([ls], [10], fs)[0].db).toBeCloseTo(6, 1);
    expect(eqChain([ls], [5000], fs)[0].db).toBeCloseTo(0, 1);
    const hp: EqFilter = { id: 'c', type: 'highpass', f: 100, gainDb: 0, q: Math.SQRT1_2, enabled: true };
    expect(eqChain([hp], [100], fs)[0].db).toBeCloseTo(-3.01, 1);
    const ap: EqFilter = { id: 'd', type: 'allpass', f: 300, gainDb: 0, q: 1, enabled: true };
    for (const f of [50, 300, 3000]) expect(eqChain([ap], [f], fs)[0].db).toBeCloseTo(0, 6);
    const notch: EqFilter = { id: 'e', type: 'notch', f: 1000, gainDb: 0, q: 5, enabled: true };
    expect(eqChain([notch], [1000], fs)[0].db).toBeLessThan(-100);
    expect(eqChain([{ ...peak, enabled: false }], [60], fs)[0].db).toBeCloseTo(0, 9);
    for (const t of ['peaking', 'lowshelf', 'highshelf', 'lowpass', 'highpass', 'bandpass', 'notch', 'allpass'] as const) expect(stable(rbj({ type: t, f: 1000, gainDb: 6, q: 1 }, fs))).toBe(true);
    expect(eqIssues({ ...peak, f: 30000 }, fs)).toHaveLength(1);
    expect(eqIssues({ ...peak, q: 0 }, fs)).toHaveLength(1);
  });

  it('экспорт Equalizer APO: типы, усиление только у типов с усилением, Preamp', () => {
    const text = exportApo([
      { id: 'a', type: 'peaking', f: 63, gainDb: -5, q: 4, enabled: true },
      { id: 'b', type: 'highpass', f: 20, gainDb: 0, q: Math.SQRT1_2, enabled: false },
    ], -1.5);
    expect(text).toBe('Preamp: -1.5 dB\nFilter 1: ON PK Fc 63.0 Hz Gain -5.0 dB Q 4.000\nFilter 2: OFF HPQ Fc 20.0 Hz Q 0.707\n');
  });

  it('SPL: чувствительность + мощность − расстояние; предел активной системы ограничивает; запас', () => {
    const s = splBudget({ sensitivity: 87, powerW: 100, distance: 2, speakers: 2, crestDb: 20, targetDb: 75, limitAt1m: null });
    expect(s.byPower).toBeCloseTo(107, 9);
    expect(s.peak).toBeCloseTo(107 - 20 * Math.log10(2) + 10 * Math.log10(2), 9);
    expect(s.headroom).toBeCloseTo(s.peak - 95, 9);
    expect(splBudget({ sensitivity: 87, powerW: 100, distance: 1, speakers: 1, crestDb: 20, targetDb: 75, limitAt1m: 100 }).at1m).toBe(100);
  });

  it('направленность поршня: на оси 0 дБ, сужение с частотой; J1 по известным значениям', () => {
    expect(besselJ1(1)).toBeCloseTo(0.4400505857, 7);
    expect(besselJ1(10)).toBeCloseTo(0.0434727462, 7);
    expect(pistonDb(1000, 0.1, 0)).toBe(0);
    expect(pistonDb(3000, 0.1, 45)).toBeLessThan(pistonDb(1000, 0.1, 45));
    expect(beamwidth6(100, 0.1)).toBeNull();
    expect(beamwidth6(4000, 0.1)!).toBeLessThan(45);
  });
});

describe('059 V2-039 · конструкции', () => {
  it('резонаторы: Гельмгольц, перфорированная панель, мембрана', () => {
    const f = helmholtz(0.02, 0.05, 0.01);
    expect(f).toBeCloseTo((C / (2 * Math.PI)) * Math.sqrt((Math.PI * 0.0004) / (0.01 * (0.05 + 0.034))), 9);
    const p = perforated(0.005, 0.05, 0.012, 0.1);
    expect(p.porosity).toBeCloseTo((Math.PI * 0.000025) / 0.0025, 9);
    expect(membrane(10, 0.1)).toBeCloseTo(60, 9);
  });

  it('QRD: последовательность квадратичных вычетов, глубины и верхняя граница по ширине ячейки', () => {
    const q = qrd(7, 500, 0.05);
    const step = C / 500 / 14;
    expect(q.depths[0].map((d) => Math.round(d / step))).toEqual([0, 1, 4, 2, 2, 4, 1]);
    expect(q.maxDepth).toBeCloseTo(4 * step, 9);
    expect(q.fMax).toBeCloseTo(C / 0.1, 9);
    expect(qrd(7, 500, 0.05, 20, true).depths).toHaveLength(7);
  });
});
