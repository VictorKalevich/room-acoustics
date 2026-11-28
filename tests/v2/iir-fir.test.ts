// V2-053: свои IIR и FIR, фазовая коррекция. Независимые проверки: определяющие свойства прототипов (пульсации и
// подавление равноволновые, известные полюсы Бесселя, Баттерворт 1/√(1+ω^2N)); минимально-фазовый FIR совпадает
// с самим IIR (биквад RBJ минимально-фазовый); линеаризация суммы LR4 даёт чистую задержку.
import { describe, expect, it } from 'vitest';
import {
  besselProto, butterworthProto, chainAt, chainResponse, chebyshev1Proto, chebyshev2Proto, ellipticProto, exportApoChain, exportChainBiquads, groupDelayMs,
  itemIssues, newExtra, protoAt, xoverFilter, xoverIssues, xoverSum, type ChainItem,
} from '../../src/v2/application/iir';
import { arrivalDelayMs, corrector, correctionCheck, designFir, firAt, parsePhaseText, phaseDataAt } from '../../src/v2/application/fir';
import { biquadAt, logFreqs, rbj, type EqFilter } from '../../src/v2/application/tools';

const dB = (v: { re: number; im: number }) => 20 * Math.log10(Math.hypot(v.re, v.im));
const at = (p: Parameters<typeof protoAt>[0], w: number) => dB(protoAt(p, { re: 0, im: w }));
const grid = (lo: number, hi: number, n = 400) => Array.from({ length: n }, (_, i) => lo * (hi / lo) ** (i / (n - 1)));

describe('аналоговые прототипы (V2-053)', () => {
  it('Баттерворт: |H|² = 1/(1 + ω^2N); Бессель 2-го порядка: полюсы −1,5 ± j0,866, задержка τ(0) = 1 с', () => {
    for (const w of [0.3, 1, 2.5]) expect(at(butterworthProto(4), w)).toBeCloseTo(-10 * Math.log10(1 + w ** 8), 9);
    const p = besselProto(2).poles.sort((a, b) => a.im - b.im);
    expect(p[0].re).toBeCloseTo(-1.5, 9); expect(p[0].im).toBeCloseTo(-Math.sqrt(3) / 2, 9);
    const b4 = besselProto(4);
    expect(groupDelayMs((f) => protoAt(b4, { re: 0, im: 2 * Math.PI * f }), 0.001 / (2 * Math.PI)) / 1000).toBeCloseTo(1, 4);
  });

  it('Чебышёв I: пульсации rp в полосе, −rp на ω = 1; Чебышёв II: −as на ω = 1 и не выше −as дальше', () => {
    const c1 = chebyshev1Proto(5, 0.5);
    const pass = grid(0.01, 1).map((w) => at(c1, w));
    expect(Math.min(...pass)).toBeCloseTo(-0.5, 3);
    expect(Math.max(...pass)).toBeCloseTo(0, 3);
    expect(at(c1, 1)).toBeCloseTo(-0.5, 9);
    const c2 = chebyshev2Proto(4, 40);
    expect(at(c2, 1)).toBeCloseTo(-40, 6);
    expect(Math.max(...grid(1, 50).map((w) => at(c2, w)))).toBeCloseTo(-40, 2);
    expect(at(c2, 1e-4)).toBeCloseTo(0, 6);
  });

  it('эллиптический: равноволновые пульсации до ω = 1 и подавление as выше 1/k (Orfanidis)', () => {
    for (const [N, rp, as] of [[4, 1, 40], [5, 0.5, 60], [3, 0.1, 30]] as const) {
      const e = ellipticProto(N, rp, as);
      expect(at(e, 1)).toBeCloseTo(-rp, 6);
      const pass = grid(0.01, 1).map((w) => at(e, w));
      expect(Math.min(...pass)).toBeGreaterThan(-rp - 1e-6);
      expect(Math.max(...pass)).toBeLessThan(1e-6);
      const stop = grid(1 / e.k, 100, 2000).map((w) => at(e, w));
      expect(Math.max(...stop)).toBeCloseTo(-as, 1);
      expect(e.k).toBeGreaterThan(0); expect(e.k).toBeLessThan(1);
    }
  });

  it('кроссовер: все семейства −3 дБ на частоте раздела, ФВЧ — зеркало ФНЧ; ограничения параметров', () => {
    const p = { ripple: 0.5, attenuation: 40 };
    for (const fam of ['bessel', 'chebyshev1', 'chebyshev2', 'elliptic'] as const) {
      expect(dB(xoverFilter(fam, 4, p, 'lp', 1000, 1000))).toBeCloseTo(-3.0103, 3);
      expect(dB(xoverFilter(fam, 4, p, 'hp', 1000, 1000))).toBeCloseTo(-3.0103, 3);
      expect(dB(xoverFilter(fam, 4, p, 'hp', 1000, 4000))).toBeCloseTo(dB(xoverFilter(fam, 4, p, 'lp', 1000, 250)), 9);
    }
    expect(dB(xoverSum('linkwitz-riley', 4, p, 500, 123, false))).toBeCloseTo(0, 9);
    expect(xoverIssues('bessel', 8, p)).toHaveLength(1);
    expect(xoverIssues('elliptic', 4, { ripple: 1, attenuation: 5 })).toHaveLength(2);
    expect(xoverIssues('chebyshev1', 4, { ripple: 3, attenuation: 40 })).toHaveLength(1);
  });
});

describe('цепочка звеньев (V2-053)', () => {
  const pk: EqFilter = { id: 'a', type: 'peaking', f: 100, gainDb: -6, q: 4, enabled: true };
  it('задержка, полярность, усиление и свой биквад; неустойчивый биквад не учитывается', () => {
    const fs = 48000;
    const d = { ...newExtra('d', 'delay'), ms: 2.5 };
    expect(groupDelayMs((f) => chainAt([d], f, fs), 1000)).toBeCloseTo(2.5, 6);
    expect(chainAt([newExtra('p', 'polarity')], 300, fs).re).toBeCloseTo(-1, 12);
    expect(dB(chainAt([{ ...newExtra('g', 'gain'), gainDb: -4 }], 300, fs))).toBeCloseTo(-4, 9);
    const own = { ...newExtra('b', 'biquad'), coeffs: rbj(pk, fs) };
    const a = chainAt([own], 97, fs), b = chainAt([pk], 97, fs);
    expect(a.re).toBeCloseTo(b.re, 12); expect(a.im).toBeCloseTo(b.im, 12);
    const bad = { ...newExtra('x', 'biquad'), coeffs: { b0: 1, b1: 0, b2: 0, a1: -2.1, a2: 1.2 } };
    expect(itemIssues(bad, fs)[0]).toMatch(/неустойчив/);
    expect(chainAt([bad], 100, fs)).toEqual({ re: 1, im: 0 });
    expect(chainResponse([pk, d], [100], fs)[0].db).toBeCloseTo(-6, 6);
  });

  it('экспорт: Equalizer APO в порядке цепочки, биквады — без задержек', () => {
    const items: ChainItem[] = [pk, { ...newExtra('d', 'delay'), ms: 1.5 }, newExtra('p', 'polarity'), { ...newExtra('g', 'gain'), gainDb: -2, enabled: false }];
    expect(exportApoChain(items, -1)).toBe('Preamp: -1.0 dB\nFilter 1: ON PK Fc 100.0 Hz Gain -6.0 dB Q 4.000\nDelay: 1.500 ms\nFilter 3: ON IIR Order 1 Coefficients -1 0 1 0\n# Preamp: -2.00 dB\n');
    const b = exportChainBiquads(items, 48000);
    expect(b.delays).toEqual([1.5]);
    expect(b.text.match(/biquad\d/g)).toEqual(['biquad1', 'biquad2']);
    expect(b.text).toContain('b0=-1.00000000000000');
  });
});

describe('FIR и фазовая коррекция (V2-053)', () => {
  const fs = 48000;
  const pk: EqFilter = { id: 'a', type: 'peaking', f: 200, gainDb: -8, q: 3, enabled: true };
  const iir = (f: number) => biquadAt(rbj(pk, fs), f, fs);

  it('минимальная фаза: FIR совпадает с самим IIR (модуль и фаза); линейная — тот же модуль, задержка n/2, предзвон', () => {
    const min = designFir(iir, { n: 16384, fs, phase: 'minimum' });
    for (const f of [50, 150, 200, 260, 1000, 8000]) {
      const v = firAt(min.taps, f, fs), t = iir(f);
      expect(Math.hypot(v.re - t.re, v.im - t.im)).toBeLessThan(0.01);
    }
    const lin = designFir(iir, { n: 16384, fs, phase: 'linear' });
    expect(lin.delaySamples).toBe(8192);
    for (const f of [50, 200, 1000]) {
      expect(dB(firAt(lin.taps, f, fs))).toBeCloseTo(dB(iir(f)), 1);
      expect(groupDelayMs((x) => firAt(lin.taps, x, fs), f)).toBeCloseTo((8192 / fs) * 1000, 2);
    }
    expect(lin.preRingDb).not.toBeNull();
    expect(min.preRingDb).toBeNull();
  });

  it('смешанная фаза: ниже раздела — минимальная (с общей задержкой), выше — линейная', () => {
    const hs = (f: number) => biquadAt(rbj({ type: 'highshelf', f: 3000, gainDb: 6, q: 0.7 }, fs), f, fs);
    const both = (f: number) => { const a = iir(f), b = hs(f); return { re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re }; };
    const d = designFir(both, { n: 16384, fs, phase: 'mixed', splitHz: 800, delaySamples: 2048 });
    const tau = (2048 / fs) * 1000;
    expect(groupDelayMs((x) => firAt(d.taps, x, fs), 200)).toBeCloseTo(tau + groupDelayMs(both, 200), 1);
    expect(groupDelayMs((x) => firAt(d.taps, x, fs), 3000)).toBeCloseTo(tau, 1);
    expect(dB(firAt(d.taps, 3000, fs))).toBeCloseTo(dB(both(3000)), 1);
  });

  it('коррекция суммы LR4 (фазовый фильтр): после FIR — чистая задержка в полосе', () => {
    const p = { ripple: 0.5, attenuation: 40 };
    const sum = (f: number) => xoverSum('linkwitz-riley', 4, p, 1000, f, false);
    const c = corrector(sum, { n: 8192, fs, f1: 100, f2: 15000, delaySamples: 4096, magnitude: false, regDb: 20, maxBoostDb: 6 });
    const r = correctionCheck(sum, c, logFreqs(200, 10000, 6));
    for (const x of r) {
      expect(Math.abs(x.afterPhaseDeg)).toBeLessThan(3);
      expect(Math.abs(x.afterGdMs)).toBeLessThan(0.05);
      expect(Math.abs(x.afterDb)).toBeLessThan(0.1);
    }
    expect(Math.max(...r.map((x) => Math.abs(x.beforeGdMs)))).toBeGreaterThan(0.2);
  });

  it('регуляризация: глубокий провал не вытягивается выше предела подъёма', () => {
    const notch = (f: number) => biquadAt(rbj({ type: 'peaking', f: 300, gainDb: -20, q: 2 }, fs), f, fs);
    const c = corrector(notch, { n: 8192, fs, f1: 50, f2: 2000, delaySamples: 4096, magnitude: true, regDb: 20, maxBoostDb: 6 });
    expect(dB(firAt(c.taps, 300, fs))).toBeLessThan(6.2);
    expect(dB(firAt(c.taps, 300, fs))).toBeGreaterThan(5);
    const r = correctionCheck(notch, c, [300, 1000]);
    expect(r[0].afterDb - r[0].beforeDb).toBeCloseTo(dB(firAt(c.taps, 300, fs)), 6);
  });

  it('замер с фазой из текста: комментарии, развёртка фазы, задержка прихода по наклону', () => {
    const tau = 0.005;
    const lines = ['* Measurement data measured by REW', '* Freq(Hz) SPL(dB) Phase(degrees)'];
    // экспорт БПФ-замера — линейная сетка: при шаге 5 Гц фаза с задержкой 5 мс меняется между точками на 0,16 рад
    for (let f = 5; f <= 20000; f += 5) {
      const v = xoverSum('linkwitz-riley', 4, { ripple: 0.5, attenuation: 40 }, 1000, f, false);
      const ph = Math.atan2(v.im, v.re) - 2 * Math.PI * f * tau;
      lines.push(`${f.toFixed(3)} ${(80 + dB(v)).toFixed(3)} ${(((ph * 180) / Math.PI + 540) % 360 - 180).toFixed(4)}`);
    }
    const d = parsePhaseText(lines.join('\n'));
    if ('error' in d) throw new Error(d.error);
    expect(arrivalDelayMs(d)).toBeCloseTo(5, 1);
    const h = phaseDataAt(d, arrivalDelayMs(d));
    expect(dB(h(1000))).toBeCloseTo(80, 2);
    expect(parsePhaseText('1 2\n3 4')).toHaveProperty('error');
    const comma = parsePhaseText(Array.from({ length: 12 }, (_, i) => `${100 + i};80,5;-10,25`).join('\n'));
    expect('error' in comma ? null : comma.db[0]).toBeCloseTo(80.5, 9);
  });
});
