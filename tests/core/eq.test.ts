import { describe, expect, it } from 'vitest';
import { biquad, designEq, exportEqualizerAPO, exportMiniDSP, exportREW, peqGainDb } from '../../src/core/eq';
import { logFreqs } from '../../src/core/frequency';

const f = logFreqs(20, 200, 48);
const peak = (f0: number, g: number, w: number) => f.map((x) => g * Math.exp(-((Math.log2(x / f0) / w) ** 2)));

describe('designEq', () => {
  const db = peak(45, 8, 0.15).map((v, i) => v + peak(110, 5, 0.1)[i]);
  const target = f.map(() => 0);
  const r = designEq(f, db, target);

  it('первый фильтр около 45 Гц, только срезы', () => {
    expect(Math.abs(r.filters[0].f - 45) / 45).toBeLessThan(0.05);
    expect(r.filters.every((p) => p.gainDb <= 0)).toBe(true);
    expect(r.filters.length).toBeLessThanOrEqual(8);
  });

  it('неровность уменьшается минимум на 30 %', () => {
    expect(r.stdAfter).toBeLessThan(r.stdBefore * 0.7);
  });

  it('провалы отмечаются, а не поднимаются', () => {
    const withDip = peak(70, -12, 0.08);
    const d = designEq(f, withDip, target);
    expect(d.filters.length).toBe(0);
    expect(d.dips.length).toBeGreaterThan(0);
  });
});

describe('биквады и экспорт', () => {
  it('биквад: усиление 1 на 0 Гц и G дБ на центральной частоте', () => {
    const p = { f: 50, gainDb: -6, q: 4 };
    const c = biquad(p, 48000);
    const H = (w: number) => {
      const zr = Math.cos(w), zi = -Math.sin(w), z2r = Math.cos(2 * w), z2i = -Math.sin(2 * w);
      const nr = c.b0 + c.b1 * zr + c.b2 * z2r, ni = c.b1 * zi + c.b2 * z2i;
      const dr = 1 + c.a1 * zr + c.a2 * z2r, di = c.a1 * zi + c.a2 * z2i;
      return 20 * Math.log10(Math.hypot(nr, ni) / Math.hypot(dr, di));
    };
    expect(H(0)).toBeCloseTo(0, 6);
    expect(H((2 * Math.PI * 50) / 48000)).toBeCloseTo(-6, 3);
    expect(peqGainDb(p, 50)).toBeCloseTo(-6, 6);
  });

  it('форматы Equalizer APO, REW, miniDSP', () => {
    const fl = [{ f: 45, gainDb: -6, q: 4 }];
    expect(exportEqualizerAPO(fl)).toContain('Filter 1: ON PK Fc 45.0 Hz Gain -6.0 dB Q 4.00');
    expect(exportREW(fl)).toMatch(/Filter\s+1: ON\s+PK\s+Fc\s+45\.00 Hz\s+Gain\s+-6\.00 dB\s+Q\s+4\.000/);
    const m = exportMiniDSP(fl, 96000);
    expect(m).toMatch(/^biquad1,\nb0=/);
    const a1 = Number(/a1=([-\d.e]+)/.exec(m)![1]);
    expect(a1).toBeCloseTo(-biquad(fl[0], 96000).a1, 12);
  });
});

import { newProject } from '../../src/state/project';
import { evaluateSetup } from '../../src/core/system';
describe('эквалайзер по модели комнаты', () => {
  it('не ставит два фильтра на одну частоту, не режет больше maxCut и не уже maxQ, не ставит фильтр на край полосы', () => {
    const p = newProject();
    const e = evaluateSetup(p.room, p.sources, p.constraints, p.current, { ppo: 48 });
    const eq = designEq(e.response.f, e.response.db, e.response.target, { maxQ: 8 });
    expect(eq.filters.length).toBeGreaterThan(0);
    expect(eq.stdAfter).toBeLessThan(eq.stdBefore);
    for (let i = 0; i < eq.filters.length; i++) {
      const a = eq.filters[i];
      expect(a.q).toBeLessThanOrEqual(8);
      expect(a.gainDb).toBeGreaterThanOrEqual(-12);
      expect(a.f).toBeGreaterThan(e.response.f[0] * 1.01);
      for (let j = i + 1; j < eq.filters.length; j++) expect(Math.abs(Math.log2(a.f / eq.filters[j].f))).toBeGreaterThanOrEqual(1 / 6);
    }
  });
});
