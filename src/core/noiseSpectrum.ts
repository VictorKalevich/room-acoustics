import type { MicProfile } from './micCalibration';
import { powerGains } from './micCurve';
import { fft } from './dsp';

export const SPECTRUM_SIZE = 32768;
export const SPECTRUM_HOP = SPECTRUM_SIZE / 2;
export type Weight = 'A' | 'C' | 'Z';
export type SpectrumPeriod = 'now' | '10' | '60' | 'session';
export const bandEdges = [20, 60, 250, 500, 2000, 5000, 20000] as const;

// Аналоговые частотные характеристики. Коэффициенты применяются к мощности бина.
function response(f: number, weight: 'A' | 'C') {
  const s = f * f;
  const c = (12194 ** 2 / (s + 12194 ** 2)) * (s / (s + 20.6 ** 2));
  return weight === 'C' ? c : c * s / Math.sqrt((s + 107.7 ** 2) * (s + 737.9 ** 2));
}
export function weightPower(hz: number, weight: Weight) {
  return weight === 'Z' ? 1 : (response(hz, weight) / response(1000, weight)) ** 2;
}

const window = Float64Array.from({ length: SPECTRUM_SIZE }, (_, i) =>
  0.5 - 0.5 * Math.cos(2 * Math.PI * i / SPECTRUM_SIZE));
const windowEnergy = window.reduce((sum, w) => sum + w * w, 0);
const bins = SPECTRUM_SIZE / 2 + 1;

export interface PowerRange {
  current: number | null;
  min: number | null;
  max: number | null;
}
export const emptyPowerRange = (): PowerRange => ({ current: null, min: null, max: null });
export function recordPower(range: PowerRange, power: number) {
  range.current = power;
  range.min = Math.min(range.min ?? power, power);
  range.max = Math.max(range.max ?? power, power);
}

interface Frame { end: number; psd: Float64Array }
interface SecondBucket {
  second: number;
  count: number;
  frames: Frame[];
  sum: Float64Array;
}

/** Шкала времени в отсчётах. Каждый валидный кадр представляет последний hop.
 * В начале каждого непрерывного отрезка ждём полное окно. */
export class NoiseSpectrum {
  readonly binHz: number;
  readonly range = { A: emptyPowerRange(), C: emptyPowerRange() };
  private readonly weightedSums = { A: 0, C: 0 };
  private readonly gain: Record<'A' | 'C', Float64Array>;
  private readonly pcm = new Float32Array(SPECTRUM_SIZE);
  private readonly re = new Float64Array(SPECTRUM_SIZE);
  private readonly im = new Float64Array(SPECTRUM_SIZE);
  private readonly sum = new Float64Array(bins);
  private readonly recent: (SecondBucket | undefined)[] = Array.from({ length: 61 });
  private latest: Frame | null = null;
  private filled = 0;
  private end = 0;
  private frames = 0;

  private readonly calibration: Float64Array | null;

  constructor(readonly sampleRate: number, profile: MicProfile | null = null) {
    this.binHz = sampleRate / SPECTRUM_SIZE;
    this.calibration = profile ? powerGains(profile, this.binHz, bins) : null;
    const gains = (w: Weight) => Float64Array.from({ length: bins }, (_, k) => weightPower(k * this.binHz, w));
    this.gain = { A: gains('A'), C: gains('C') };
  }

  // Вызывается для каждого принятого блока A (4096 делит окно и hop).
  push(block: Float32Array, end: number) {
    if (end - block.length !== this.end) {
      this.filled = 0;
      this.latest = null;
      this.range.A.current = this.range.C.current = null;
    }
    this.end = end;
    this.pcm.set(block, this.filled);
    this.filled += block.length;
    if (this.filled < SPECTRUM_SIZE) return;
    const mean = this.pcm.reduce((sum, v) => sum + v, 0) / SPECTRUM_SIZE;
    for (let i = 0; i < SPECTRUM_SIZE; i++) this.re[i] = (this.pcm[i] - mean) * window[i];
    this.im.fill(0);
    fft(this.re, this.im);
    this.pcm.copyWithin(0, SPECTRUM_HOP);
    this.filled = SPECTRUM_SIZE - SPECTRUM_HOP;

    // Кольцо секундных сумм. Исходные кадры нужны только при пересечении
    // левой границы окна. Перезаполнение ячейки переиспользует её массивы.
    const second = Math.floor((end - 1) / this.sampleRate);
    const slot = second % this.recent.length;
    const bucket = this.recent[slot] ??= { second, count: 0, sum: new Float64Array(bins), frames: [] };
    if (bucket.second !== second) {
      bucket.second = second;
      bucket.count = 0;
      bucket.sum.fill(0);
    }
    const frame = bucket.frames[bucket.count] ??= { end, psd: new Float64Array(bins) };
    frame.end = end;
    bucket.count++;
    const psd = frame.psd;
    const norm = 1 / (this.sampleRate * windowEnergy);
    let a = 0, c = 0;
    for (let k = 0; k < bins; k++) {
      const sided = k === 0 || k === bins - 1 ? 1 : 2;
      const density = (this.re[k] ** 2 + this.im[k] ** 2) * norm * sided;
      psd[k] = density;
      this.sum[k] += density;
      bucket.sum[k] += density;
      a += density * this.gain.A[k];
      c += density * this.gain.C[k];
    }
    recordPower(this.range.A, a * this.binHz);
    recordPower(this.range.C, c * this.binHz);
    this.weightedSums.A += a * this.binHz;
    this.weightedSums.C += c * this.binHz;
    this.latest = frame;
    this.frames++;
  }

  releasePcm() {
    this.pcm.fill(0);
    this.re.fill(0);
    this.im.fill(0);
  }

  get weightedSeconds() { return this.frames * SPECTRUM_HOP / this.sampleRate; }

  leqPower(weight: 'A' | 'C') {
    return this.frames ? this.weightedSums[weight] / this.frames : null;
  }

  average(period: SpectrumPeriod, weight: Weight, corrected = false) {
    const density = new Float64Array(bins);
    let samples = 0;
    if (period === 'now') {
      if (this.latest) { density.set(this.latest.psd); samples = SPECTRUM_HOP; }
    } else if (period === 'session') {
      samples = this.frames * SPECTRUM_HOP;
      if (this.frames) for (let k = 0; k < bins; k++) density[k] = this.sum[k] / this.frames;
    } else {
      const cutoff = this.end - Number(period) * this.sampleRate;
      for (const bucket of this.recent) {
        if (!bucket || bucket.frames[bucket.count - 1].end <= cutoff) continue;
        if (bucket.frames[0].end - SPECTRUM_HOP >= cutoff) {
          samples += bucket.count * SPECTRUM_HOP;
          for (let k = 0; k < bins; k++) density[k] += bucket.sum[k] * SPECTRUM_HOP;
        } else {
          for (let i = 0; i < bucket.count; i++) {
            const frame = bucket.frames[i];
            const count = Math.min(SPECTRUM_HOP, frame.end - cutoff);
            if (count <= 0) continue;
            samples += count;
            for (let k = 0; k < bins; k++) density[k] += frame.psd[k] * count;
          }
        }
      }
      if (samples) for (let k = 0; k < bins; k++) density[k] /= samples;
    }
    if (weight !== 'Z') for (let k = 0; k < bins; k++) density[k] *= this.gain[weight][k];
    if (corrected && this.calibration) for (let k = 0; k < bins; k++) density[k] *= this.calibration[k];
    return { density, seconds: samples / this.sampleRate };
  }
}

/** Делим всю мощность бина между частями его физической ячейки, включая
 * половинные ячейки DC и Nyquist. Знаменатель долей ограничен выбранной полосой. */
export function bandPowers(psd: Float64Array, step: number, edges: readonly number[] = bandEdges) {
  const nyquist = (psd.length - 1) * step;
  const bands = edges.slice(1).map((upper, i) => {
    const lo = edges[i], hi = Math.min(upper, nyquist);
    let power = 0;
    for (let k = Math.max(0, Math.ceil(lo / step - 0.5)); k <= Math.min(psd.length - 1, Math.floor(hi / step + 0.5)); k++) {
      const left = Math.max(0, (k - 0.5) * step), right = Math.min(nyquist, (k + 0.5) * step);
      const width = Math.max(0, Math.min(hi, right) - Math.max(lo, left));
      power += psd[k] * step * width / (right - left);
    }
    return { lo, hi, power };
  }).filter(b => b.hi > b.lo);
  const total = bands.reduce((sum, b) => sum + b.power, 0);
  return bands.map(b => ({ ...b, percent: total ? 100 * b.power / total : null }));
}
