import { describe, expect, it } from 'vitest';
import { analyzeSweep, averageRT, calAt, clapRT60, convolve, fft, firLinearPhase, firMinPhase, logSweep, parseCalibration, RT_BANDS, schroederFit, schroederT60, spectrumDb, wav16, wavFloat32 } from '../../src/core/dsp';
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
    const tag = (o: number) => String.fromCharCode(...[0, 1, 2, 3].map((i) => w.getUint8(o + i)));
    expect(w.getUint16(22, true)).toBe(2);
    // float-WAV по спецификации: fmt 18 байт (cbSize = 0) + блок fact с числом отсчётов
    expect(w.getUint32(16, true)).toBe(18);
    expect(w.getUint16(20, true)).toBe(3);
    expect(tag(38)).toBe('fact');
    expect(w.getUint32(46, true)).toBe(10);
    expect(tag(50)).toBe('data');
    expect(w.getUint32(54, true)).toBe(80);
    expect(w.getUint32(4, true)).toBe(w.byteLength - 8);
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

import { firMinPhaseFromCurve, iirDecayLength, octaveBand } from '../../src/core/dsp';
describe('FIR для узких фильтров на низах', () => {
  const filters = [{ f: 30, gainDb: -10, q: 10 }, { f: 45, gainDb: -6, q: 6 }, { f: 90, gainDb: -4, q: 3 }];
  const freqs = [25, 28, 30, 32, 38, 45, 52, 70, 90, 120, 200];
  const want = freqs.map((f) => filters.reduce((s, p) => s + peqGainDb(p, f), 0));
  for (const rate of [48000, 96000]) {
    it(`длина по затуханию фильтров: мин. и лин. фаза повторяют модуль PEQ (±0,3 дБ), ${rate / 1000} кГц`, () => {
      const mp = firMinPhase(filters, rate);
      const lp = firLinearPhase(filters, rate);
      expect(mp.length).toBeGreaterThanOrEqual(iirDecayLength(filters, rate));
      const nfft = 1 << 20;
      const gm = spectrumDb(mp, rate, freqs, nfft), gl = spectrumDb(lp, rate, freqs, nfft);
      freqs.forEach((_, i) => {
        expect(Math.abs(gm[i] - want[i])).toBeLessThan(0.3);
        expect(Math.abs(gl[i] - want[i])).toBeLessThan(0.3);
      });
    });
  }
  it('прежняя фиксированная длина (16384 при 96 кГц) срезала пик на 30 Гц не до конца', () => {
    const short = firMinPhase(filters, 96000, 16384);
    const got = spectrumDb(short, 96000, [30], 1 << 20)[0];
    expect(Math.abs(got - want[2])).toBeGreaterThan(1);
  });
});

describe('минимально-фазовый FIR по кривой (прослушивание комнаты)', () => {
  it('повторяет АЧХ и звенит только после удара — без «предзвона»', () => {
    const f = [20, 30, 40, 43, 46, 60, 80, 120, 200];
    const db = [0, 2, 6, 14, 5, -3, 0, -5, 0];
    const ir = firMinPhaseFromCurve(f, db, fs);
    const got = spectrumDb(ir, fs, [30, 43, 60, 120, 1000], 1 << 18);
    expect(got[0]).toBeCloseTo(2, 0);
    expect(got[1]).toBeCloseTo(14, 0);
    expect(got[2]).toBeCloseTo(-3, 0);
    expect(got[3]).toBeCloseTo(-5, 0);
    expect(got[4]).toBeCloseTo(0, 0);
    // энергия сосредоточена в начале: за первую секунду — почти вся
    let e1 = 0, eAll = 0;
    for (let i = 0; i < ir.length; i++) { eAll += ir[i] ** 2; if (i < fs) e1 += ir[i] ** 2; }
    expect(e1 / eAll).toBeGreaterThan(0.999);
  });
});

describe('RT60 по хлопку при шуме', () => {
  let seed = 11;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
  // одиночное затухание шума в октаве — случайно: по ISO 3382-2 разброс T20 ≈ 0,88·T·√(2,9/(B·T)) — на 125 Гц
  // это ~15 %. Поэтому, как в приложении, усредняются три хлопка
  for (const [band, T, tol] of [[125, 0.9, 0.12], [500, 0.55, 0.08], [2000, 0.4, 0.08]] as const) {
    it(`${band} Гц, T = ${T} с, шум в октаве на −45 дБ от пика, три хлопка: ошибка < ${tol * 100} %`, () => {
      let sum = 0;
      for (let k = 0; k < 3; k++) {
        const n = 3 * fs, pre = Math.round(0.2 * fs);
        const w = new Float32Array(n);
        for (let i = pre; i < n; i++) w[i] = gauss() * Math.exp((-6.91 * (i - pre)) / fs / T);
        const x = octaveBand(w, band, fs);
        let pk = 0;
        for (const v of x) pk = Math.max(pk, Math.abs(v));
        // шум в той же октаве на 45 дБ ниже пикового отсчёта (≈ 35 дБ ниже начального уровня огибающей)
        const nz = octaveBand(Float32Array.from({ length: n }, () => gauss()), band, fs);
        let nr = 0;
        for (const v of nz) nr += v * v;
        const g = (pk * Math.pow(10, -45 / 20)) / Math.sqrt(nr / n);
        for (let i = 0; i < n; i++) x[i] += g * nz[i];
        sum += clapRT60(x, fs).find((b) => b.band === band)!.t60!;
      }
      expect(Math.abs(sum / 3 / T - 1)).toBeLessThan(tol);
    });
  }
});

describe('RT60: малый запас над шумом', () => {
  let seed = 5;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
  const take = (T: number, snr: number) => {
    const n = Math.round(2.5 * fs), nl = Math.pow(10, -snr / 20);
    return octaveBand(Float32Array.from({ length: n }, (_, i) => gauss() * Math.exp((-6.91 * i) / fs / T) + nl * gauss()), 1000, fs);
  };

  it('запас ≥ 35 дБ — T20, 25–35 дБ — T10 (приблизительно)', () => {
    expect(schroederFit(take(0.5, 50), fs)!.method).toBe('T20');
    const low = schroederFit(take(0.5, 30), fs)!;
    expect(low.method).toBe('T10');
    expect(low.rangeDb).toBeLessThan(35);
  });

  it('среднее по хлопкам: оценки T20 вытесняют T10; только T10 — помечено «≈»', () => {
    const t = (v: number | null, approx = false) => RT_BANDS.map((band) => ({ band, t60: v, approx }));
    const avg = averageRT([t(0.5), t(0.9, true), t(0.6)]);
    expect(avg[0].t60).toBeCloseTo(0.55, 9);
    expect(avg[0].approx).toBe(false);
    const rough = averageRT([t(0.9, true), t(0.7, true), t(null)]);
    expect(rough[0].t60).toBeCloseTo(0.8, 9);
    expect(rough[0].approx).toBe(true);
    expect(averageRT([t(null)])[0].t60).toBeNull();
  });
});
