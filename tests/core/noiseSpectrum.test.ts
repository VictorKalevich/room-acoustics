import { describe, expect, it } from 'vitest';
import { NoiseMeter, FFT_SIZE as BLOCK } from '../../src/core/noise';
import { bandPowers, NoiseSpectrum, SPECTRUM_SIZE as N, SPECTRUM_HOP as HOP, weightPower } from '../../src/core/noiseSpectrum';
import { noisePlot } from '../../src/ui/noisePlot';

const db = (power: number) => 10 * Math.log10(power);
const integral = (psd: Float64Array, step: number) => psd.reduce((s, v) => s + v, 0) * step;
const signal = (hz: number, fs: number, amp = 1) =>
  Float32Array.from({ length: N }, (_, i) => amp * Math.cos(2 * Math.PI * hz * i / fs));
function feed(analyzer: NoiseSpectrum, data: Float32Array, start = 0) {
  for (let i = 0; i < data.length; i += BLOCK) analyzer.push(data.subarray(i, i + BLOCK), start + i + BLOCK);
}
// Независимая правая часть равенства Парсеваля, только во временной области.
function hannPower(pcm: Float32Array) {
  const mean = pcm.reduce((s, x) => s + x, 0) / pcm.length;
  let sum = 0, norm = 0;
  for (let i = 0; i < pcm.length; i++) {
    const w = Math.sin(Math.PI * i / pcm.length) ** 2;
    sum += ((pcm[i] - mean) * w) ** 2;
    norm += w * w;
  }
  return sum / norm;
}

describe('PSD и временные окна шумомера', () => {
  for (const fs of [44100, 48000]) {
    it('Parseval для шума со смещением, Nyquist, первого бина и постоянного входа при ' + fs, () => {
      let seed = 178;
      const noise = Float32Array.from({ length: N }, () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return 0.21 + seed / 2 ** 32;
      });
      for (const pcm of [noise, signal(fs / 2, fs), signal(fs / N, fs), new Float32Array(N).fill(0.73)]) {
        const s = new NoiseSpectrum(fs);
        feed(s, pcm);
        const { density } = s.average('now', 'Z');
        expect(integral(density, s.binHz)).toBeCloseTo(hannPower(pcm), 10);
        expect(density.length).toBe(N / 2 + 1);
      }
    });
    it('разрешает два басовых тона и правильно находит 40/63 Гц при ' + fs, () => {
      const s = new NoiseSpectrum(fs);
      for (const hz of [40, 63]) {
        feed(s, signal(hz, fs));
        const psd = s.average('now', 'Z').density;
        expect(Math.abs(noisePlot(psd, s.binHz, 250, 0).peakHz! - hz)).toBeLessThan(s.binHz);
        expect(bandPowers(psd, s.binHz)[hz === 40 ? 0 : 1].percent!).toBeGreaterThan(99);
      }
      const pcm = signal(40, fs), other = signal(46, fs);
      feed(s, pcm.map((x, i) => x + other[i]));
      const { density } = s.average('now', 'Z');
      for (const hz of [40, 46]) {
        const k = Math.round(hz / s.binHz);
        expect(density[k]).toBeGreaterThan(Math.max(density[k - 1], density[k + 1]));
      }
    });
  }
  it('10/60 с и сеанс взвешивают только пересечение hop с окном, включая его дробный край', () => {
    const fs = 8192, s = new NoiseSpectrum(fs);
    const pcm = Float32Array.from({ length: 140 * BLOCK }, (_, i) => (i / fs / 100) * Math.cos(i * Math.PI / 8));
    const frames: { end: number; power: number }[] = [];
    for (const [start, end] of [[0, 47 * BLOCK], [50 * BLOCK, pcm.length]]) {
      feed(s, pcm.subarray(start, end), start);
      for (let t = start + N; t <= end; t += HOP) frames.push({ end: t, power: hannPower(pcm.subarray(t - N, t)) });
    }
    for (const period of ['10', '60', 'session'] as const) {
      const cutoff = period === 'session' ? 0 : pcm.length - Number(period) * fs;
      let duration = 0, energy = 0;
      for (const frame of frames) {
        const dt = Math.max(0, Math.min(HOP, frame.end - cutoff)) / fs;
        duration += dt; energy += frame.power * dt;
      }
      const avg = s.average(period, 'Z');
      expect(avg.seconds).toBe(duration);
      expect(integral(avg.density, s.binHz)).toBeCloseTo(energy / duration, 9);
    }
  });
  it('прогрев и большой пропуск исключают старый мгновенный спектр и истёкшие окна, сохраняют сеанс и всю историю A', () => {
    const fs = 48000, meter = new NoiseMeter(fs);
    const tone = signal(1000, fs);
    for (let seq = 0; seq < 12; seq++) {
      const offset = seq % 8 * BLOCK;
      meter.push(tone.subarray(offset, offset + BLOCK), seq);
      expect(meter.history).toHaveLength(seq + 1);
      expect(meter.history.at(seq)!.endSeconds).toBe((seq + 1) * BLOCK / fs);
      expect(meter.spectral.weightedSeconds).toBe((seq < 7 ? 0 : seq < 11 ? 1 : 2) * HOP / fs);
    }
    meter.push(tone.subarray(0, BLOCK), 1000);
    expect(meter.history.at(-1)).toMatchObject({ missingBefore: 988, windowComplete: false });
    expect(meter.snapshot().activeSeconds).toBe(13 * BLOCK / fs);
    for (const w of ['now', '10', '60'] as const) expect(meter.spectral.average(w, 'Z').seconds).toBe(0);
    expect(meter.spectral.range.A.current).toBeNull();
    expect(meter.spectral.average('session', 'A').seconds).toBe(2 * HOP / fs);
    for (let seq = 1001; seq <= 1007; seq++) meter.push(tone.subarray(0, BLOCK), seq);
    expect(meter.spectral.average('now', 'Z').seconds).toBe(HOP / fs);
    expect(meter.history).toHaveLength(20);
  });
  it('Leq, LTAS, экстремумы и sample peak для равных интервалов с разницей 20 дБ и паузой', () => {
    const fs = N, m = new NoiseMeter(fs);
    for (const [index, amplitude] of [0.01, 0.1].entries()) {
      const pcm = signal(1000, fs, amplitude);
      for (let i = 0; i < N / BLOCK; i++) m.push(pcm.subarray(i * BLOCK, (i + 1) * BLOCK), index * 100 + i);
    }
    const expected = db((0.01 ** 2 + 0.1 ** 2) / 4);
    expect(db(m.sessionPower!)).toBeCloseTo(expected, 6);
    // Относительный сдвиг шкалы: эквивалент равных интервалов 40 и 60 дБ.
    expect(db(m.sessionPower! / m.blockPower.min!) + 40).toBeCloseTo(57.0329, 4);
    expect(db(m.blockPower.max! / m.blockPower.min!)).toBeCloseTo(20, 5);
    expect(20 * Math.log10(m.peakAmplitude!)).toBeCloseTo(-20, 6);
    for (const weight of ['Z', 'A', 'C'] as const) {
      const avg = m.spectral.average('session', weight);
      expect(db(integral(avg.density, m.spectral.binHz))).toBeCloseTo(expected, 4);
      if (weight !== 'Z') expect(db(m.spectral.leqPower(weight)!)).toBeCloseTo(expected, 4);
    }
  });
  it('десятикратная мощность даёт +10 дБ, сумма двух ортогональных тонов даёт +3,01 дБ', () => {
    const s = new NoiseSpectrum(N), pcm = signal(500, N, 0.1), other = signal(1000, N, 0.1);
    const power = (v: Float32Array) => { feed(s, v); return integral(s.average('now', 'Z').density, s.binHz); };
    const base = power(pcm);
    expect(db(power(pcm.map(x => x * Math.sqrt(10))) / base)).toBeCloseTo(10, 5);
    expect(db(power(pcm.map((x, i) => x + other[i])) / base)).toBeCloseTo(3.0103, 4);
  });
});

describe('взвешивание и полосы', () => {
  // Номинальные табличные значения NTi Audio, Frequency Weightings for Sound Level Measurements.
  for (const [hz, a, c] of [[31.5,-39.4,-3], [63,-26.2,-0.8], [125,-16.1,-0.2], [1000,0,0], [4000,1,-0.8], [8000,-1.1,-3]]) {
    it('коэффициенты и интегральный уровень тона ' + hz + ' Гц', () => {
      const s = new NoiseSpectrum(48000);
      feed(s, signal(hz, 48000));
      for (const [w, ref] of [['A', a], ['C', c], ['Z', 0]] as const) {
        // Таблица округлена до 0,1 дБ и именует полосы номинальной частотой:
        // например 31,5 Гц соответствует точному центру 31,6228 Гц.
        const center = 1000 * 10 ** (Math.round(10 * Math.log10(hz / 1000)) / 10);
        expect(Math.abs(db(weightPower(center, w)) - ref)).toBeLessThan(0.07);
        expect(Math.abs(db(weightPower(hz, w)) - ref)).toBeLessThan(0.15);
        const avg = s.average('session', w);
        expect(Math.abs(db(2 * integral(avg.density, s.binHz)) - ref)).toBeLessThan(0.15);
        expect(weightPower(24000, w)).toBeGreaterThan(0);
      }
    });
  }
  it('делит пограничный бин, учитывает половинные ячейки DC/Nyquist и обрезанный диапазон', () => {
    const psd = Float64Array.of(2, 0, 4, 0, 6);
    const bands = bandPowers(psd, 10, [0, 2.5, 20, 36, 100, 110]);
    expect(bands.map(b => b.power)).toEqual([10, 30, 32, 48]);
    expect(bands.at(-1)?.hi).toBe(40);
    expect(bands.reduce((s, b) => s + b.percent!, 0)).toBeCloseTo(100, 10);
    expect(bandPowers(new Float64Array(20), 10).every(b => b.percent === null && b.power === 0)).toBe(true);
  });
  it('распределяет изолированные тоны по всем шести полосам', () => {
    const s = new NoiseSpectrum(48000);
    for (const [band, hz] of [40, 100, 320, 1000, 3200, 10000].entries()) {
      feed(s, signal(hz, 48000));
      const shares = bandPowers(s.average('now', 'Z').density, s.binHz);
      expect(shares[band].percent!).toBeGreaterThan(99.99);
      expect(shares.reduce((sum, b) => sum + b.percent!, 0)).toBeCloseTo(100, 9);
    }
  });
  it('фокус и сглаживание изменяют только график, узкая линия сохраняется', () => {
    const psd = new Float64Array(N / 2 + 1);
    psd[9000] = 1; psd[40] = 0.1;
    const before = psd.slice();
    const bands = bandPowers(psd, 1);
    const raw = noisePlot(psd, 1, 16000, 0);
    expect(raw.peakHz).toBe(9000);
    expect(noisePlot(psd, 1, 250, 24).peakHz).toBe(40);
    for (const divisor of [3, 6, 12, 24]) {
      expect(Math.max(...noisePlot(psd, 1, 16000, divisor).db)).toBeLessThan(Math.max(...raw.db));
    }
    expect(psd).toEqual(before);
    expect(bandPowers(psd, 1)).toEqual(bands);
  });
});
