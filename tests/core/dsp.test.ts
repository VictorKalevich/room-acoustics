import { describe, expect, it } from 'vitest';
import { analyzeSweep, calAt, clapRT60, convolve, fft, firLinearPhase, firMinPhase, logSweep, parseCalibration, schroederT60, spectrumDb, wav16, wavFloat32 } from '../../src/core/dsp';
import { peqGainDb } from '../../src/core/eq';

const fs = 48000;

describe('ДСП', () => {
  it('БПФ туда-обратно', () => {
    const re = Float64Array.from({ length: 64 }, (_, i) => Math.sin(i)), im = new Float64Array(64);
    const r0 = re.slice();
    fft(re, im); fft(re, im, true);
    for (let i = 0; i < 64; i++) expect(re[i]).toBeCloseTo(r0[i], 9);
  });

  it('свип: АЧХ «комнаты» из двух отражений восстанавливается, задержка и уровень не мешают', () => {
    const sweep = logSweep(10, 1000, 4, fs);
    // «комната»: прямой звук через 0,3 с + отражение −6 дБ через 7,1 мс → гребёнка с провалом на 70 Гц
    const h = new Float32Array(Math.round(0.4 * fs));
    const d0 = Math.round(0.3 * fs), d1 = d0 + Math.round(0.0071428 * fs);
    h[d0] = 0.3; h[d1] = 0.15;
    const rec = Float32Array.from(convolve(sweep, h));
    const r = analyzeSweep(rec, sweep, 10, 1000, fs);
    const at = (f: number) => r.db[r.f.findIndex((x) => x >= f)];
    // ожидаемо: 20lg|0,3 + 0,15·e^{-jωτ}|; на 70 Гц — минимум (0,15), на 140 — максимум (0,45)
    expect(at(140) - at(70)).toBeGreaterThan(7);
    expect(at(140) - at(70)).toBeLessThan(11);
  });

  it('RT60 экспоненциального затухания', () => {
    const T = 0.6;
    const x = new Float32Array(fs * 2);
    let seed = 1;
    for (let i = 0; i < x.length; i++) {
      seed = (seed * 16807) % 2147483647;
      x[i] = ((seed / 2147483647) * 2 - 1) * Math.pow(10, (-60 * (i / fs) / T) / 20);
    }
    expect(schroederT60(x, fs)!).toBeGreaterThan(0.5);
    expect(schroederT60(x, fs)!).toBeLessThan(0.7);
    const bands = clapRT60(x, fs);
    const b1k = bands.find((b) => b.band === 1000)!.t60!;
    expect(b1k).toBeGreaterThan(0.45);
    expect(b1k).toBeLessThan(0.75);
  });

  it('FIR повторяет модуль PEQ (мин. и лин. фаза)', () => {
    const filters = [{ f: 55, gainDb: -8, q: 4 }, { f: 120, gainDb: -5, q: 2 }];
    const mp = firMinPhase(filters, fs, 32768);
    const lp = firLinearPhase(filters, fs, 32768);
    for (const f of [40, 55, 80, 120, 200]) {
      const want = filters.reduce((s, p) => s + peqGainDb(p, f), 0);
      expect(spectrumDb(mp, fs, [f], 65536)[0]).toBeCloseTo(want, 0);
      expect(spectrumDb(lp, fs, [f], 65536)[0]).toBeCloseTo(want, 0);
    }
  });

  it('калибровочный файл UMIK и WAV-заголовки', () => {
    const cal = parseCalibration('"Sens Factor =-1.2dB"\n10 -3.5\n20 -1.0\n1000 0.0\n');
    expect(calAt(cal, 15)).toBeGreaterThan(-3.5);
    expect(calAt(cal, 15)).toBeLessThan(-1);
    const w = new DataView(wavFloat32([new Float32Array(10), new Float32Array(10)], fs));
    expect(w.getUint16(22, true)).toBe(2);
    expect(w.getUint32(40, true)).toBe(80);
    expect(new DataView(wav16(new Float32Array(5), fs)).getUint16(34, true)).toBe(16);
  });
});

import { firFromCurve } from '../../src/core/dsp';
describe('FIR по кривой (наушники)', () => {
  it('повторяет заданную АЧХ и уходит в 0 дБ выше полосы', () => {
    const f = [20, 40, 60, 80, 120, 200];
    const db = [3, -6, 8, 0, -4, 0];
    const ir = firFromCurve(f, db, fs, 65536);
    const got = spectrumDb(ir, fs, [40, 60, 1000], 131072);
    expect(got[0]).toBeCloseTo(-6, 0);
    expect(got[1]).toBeCloseTo(8, 0);
    expect(got[2]).toBeCloseTo(0, 0);
  });
});

import { sweepSegment } from '../../src/core/dsp';
describe('участок свипа в длинной записи', () => {
  it('находит свип посреди записи и отбрасывает оборванный', () => {
    const sw = logSweep(10, 1000, 2, fs);
    const rec = new Float32Array(fs * 8);
    rec.set(sw, fs * 3);
    const seg = sweepSegment(rec, sw.length, fs)!;
    expect(seg).not.toBeNull();
    expect(seg.length).toBeLessThan(fs * 4);
    expect(seg.length).toBeGreaterThan(sw.length);
    const cut = new Float32Array(fs * 4);
    cut.set(sw.subarray(0, fs * 1.5), fs * 2.5);
    expect(sweepSegment(cut, sw.length, fs)).toBeNull();
  });
});
