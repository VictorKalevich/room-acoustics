import type { MicProfile } from './micCalibration';
import { NoiseSpectrum, SPECTRUM_HOP, SPECTRUM_SIZE, emptyPowerRange, recordPower } from './noiseSpectrum';
import { NoiseTimeline } from './noiseTimeline';
import { fft } from './dsp';

export const FFT_SIZE = 4096;
const hann = Float64Array.from({ length: FFT_SIZE }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / FFT_SIZE));
const dbfs = (power: number) => power > 0 ? 10 * Math.log10(power) : null;

export interface NoisePoint {
  endSeconds: number;
  rmsDbfs: number | null;
  rms1sDbfs: number | null;
  windowComplete: boolean;
  peakHz: number | null;
  clipped: boolean;
  missingBefore: number;
}
/** Только чтение по индексу: массив точек или NoiseBlocks. */
export interface NoiseRows {
  readonly length: number;
  at(index: number): NoisePoint | undefined;
}

/** Колонки точек A по блоку (055): тот же NoisePoint при чтении, примерно 27 байт на блок вместо объекта. */
export interface NoiseBlocksData {
  next: Uint32Array;
  rms: Float64Array;
  rms1s: Float64Array;
  peakBin: Uint16Array;
  flags: Uint8Array;
  missingBefore: Uint32Array;
}
const NO_PEAK = 0xffff, COMPLETE = 1, CLIPPED = 2;
export class NoiseBlocks implements NoiseRows {
  length = 0;
  private data: NoiseBlocksData;
  constructor(readonly sampleRate: number, readonly limit: number, data?: NoiseBlocksData) {
    this.data = data ?? { next: new Uint32Array(0), rms: new Float64Array(0), rms1s: new Float64Array(0),
      peakBin: new Uint16Array(0), flags: new Uint8Array(0), missingBefore: new Uint32Array(0) };
    if (data) this.length = data.next.length;
  }
  push(next: number, rms: number | null, rms1s: number | null, windowComplete: boolean, peakBin: number | null, clipped: boolean, missingBefore: number) {
    const i = this.length;
    if (i >= this.data.next.length) {
      const size = Math.min(this.limit, Math.max(1024, 2 * i));
      const d = this.data;
      const grow = <T extends Uint32Array | Float64Array | Uint16Array | Uint8Array>(a: T, make: (n: number) => T) => { const b = make(size); b.set(a); return b; };
      this.data = {
        next: grow(d.next, n => new Uint32Array(n)), rms: grow(d.rms, n => new Float64Array(n)), rms1s: grow(d.rms1s, n => new Float64Array(n)),
        peakBin: grow(d.peakBin, n => new Uint16Array(n)), flags: grow(d.flags, n => new Uint8Array(n)), missingBefore: grow(d.missingBefore, n => new Uint32Array(n)),
      };
    }
    const d = this.data;
    d.next[i] = next;
    d.rms[i] = rms ?? NaN;
    d.rms1s[i] = rms1s ?? NaN;
    d.peakBin[i] = peakBin ?? NO_PEAK;
    d.flags[i] = (windowComplete ? COMPLETE : 0) | (clipped ? CLIPPED : 0);
    d.missingBefore[i] = missingBefore;
    this.length++;
  }
  at(index: number): NoisePoint | undefined {
    const i = index < 0 ? this.length + index : index;
    if (!(i >= 0 && i < this.length)) return undefined;
    const d = this.data, rms = d.rms[i], rms1s = d.rms1s[i];
    return {
      endSeconds: d.next[i] * FFT_SIZE / this.sampleRate, rmsDbfs: Number.isNaN(rms) ? null : rms,
      rms1sDbfs: Number.isNaN(rms1s) ? null : rms1s, windowComplete: !!(d.flags[i] & COMPLETE),
      peakHz: d.peakBin[i] === NO_PEAK ? null : d.peakBin[i] * this.sampleRate / FFT_SIZE,
      clipped: !!(d.flags[i] & CLIPPED), missingBefore: d.missingBefore[i],
    };
  }
  slice(start = 0, end = this.length) {
    const from = start < 0 ? Math.max(0, this.length + start) : Math.min(start, this.length);
    const to = end < 0 ? Math.max(0, this.length + end) : Math.min(end, this.length);
    return Array.from({ length: Math.max(0, to - from) }, (_, i) => this.at(from + i)!);
  }
  map<T>(fn: (point: NoisePoint, index: number) => T) { return Array.from({ length: this.length }, (_, i) => fn(this.at(i)!, i)); }
  *[Symbol.iterator]() { for (let i = 0; i < this.length; i++) yield this.at(i)!; }
  get bytes() { return Object.values(this.data).reduce((sum: number, a: ArrayBufferView) => sum + a.byteLength, 0); }
  toData(): NoiseBlocksData {
    const d = this.data, n = this.length;
    return { next: d.next.slice(0, n), rms: d.rms.slice(0, n), rms1s: d.rms1s.slice(0, n), peakBin: d.peakBin.slice(0, n),
      flags: d.flags.slice(0, n), missingBefore: d.missingBefore.slice(0, n) };
  }
}

/** Все точки сеанса содержат только метрики. БПФ и секундное окно занимают постоянную память.
 * История сеанса (055) ограничена MAX_SESSION_SECONDS: блок за пределом не принимается, limitReached. */
export class NoiseMeter {
  readonly history: NoiseBlocks;
  readonly timeline: NoiseTimeline;
  audioStartMs: number | null = null;
  limitReached = false;
  readonly spectral: NoiseSpectrum;
  readonly blockPower = emptyPowerRange();
  private sumSquares = 0;
  private samplePeak = 0;
  private blocks = 0;
  private missing = 0;
  private clipped = 0;
  private next = 0;
  private readonly energies: { full: number; tail: number }[] = [];
  private readonly f: number[];
  private readonly magnitudes: Float64Array;
  private readonly firstBin: number;
  private readonly re = new Float64Array(FFT_SIZE);
  private readonly im = new Float64Array(FFT_SIZE);

  constructor(readonly sampleRate: number, readonly profile: MicProfile | null = null) {
    this.spectral = new NoiseSpectrum(sampleRate, profile);
    const { gain, calibration: cal } = this.spectral;
    const product = (g: Float64Array) => cal && g.map((v, k) => v * cal[k]);
    this.timeline = new NoiseTimeline({ sampleRate, binHz: this.spectral.binHz, bins: SPECTRUM_SIZE / 2 + 1, hop: SPECTRUM_HOP,
      gains: cal ? [null, gain.A, gain.C, cal, product(gain.A), product(gain.C)] : [null, gain.A, gain.C] });
    this.spectral.sink = (end, psd, a, c) => this.timeline.addFrame(end, psd, a, c);
    this.history = new NoiseBlocks(sampleRate, Math.ceil(this.timeline.maxSamples / FFT_SIZE));
    this.firstBin = Math.ceil(20 * FFT_SIZE / sampleRate);
    const lastBin = Math.floor(Math.min(20000 / sampleRate, 0.5) * FFT_SIZE);
    this.f = Array.from({ length: lastBin - this.firstBin + 1 }, (_, i) => (i + this.firstBin) * sampleRate / FFT_SIZE);
    this.magnitudes = new Float64Array(this.f.length);
  }

  private spectrum(pcm: Float32Array) {
    for (let i = 0; i < FFT_SIZE; i++) this.re[i] = pcm[i] * hann[i];
    this.im.fill(0);
    fft(this.re, this.im);
    let peak = -1, peakBin: number | null = null;
    for (let i = 0; i < this.f.length; i++) {
      const k = this.firstBin + i;
      const scale = (k === FFT_SIZE / 2 ? 2 : 4) / FFT_SIZE;
      const magnitude = scale * Math.hypot(this.re[k], this.im[k]);
      this.magnitudes[i] = magnitude;
      const bounded = Math.max(1e-10, magnitude);
      if (bounded > peak) { peak = bounded; peakBin = k; }
    }
    return peakBin;
  }

  push(pcm: Float32Array, sequence: number, receivedAtMs = Date.now()) {
    if (pcm.length !== FFT_SIZE || sequence < this.next) return;
    if ((sequence + 1) * FFT_SIZE > this.timeline.maxSamples) { this.limitReached = true; return; }
    const missingBefore = sequence - this.next;
    this.missing += missingBefore;
    this.next = sequence + 1;
    this.blocks++;
    const endSeconds = this.next * FFT_SIZE / this.sampleRate;
    this.audioStartMs ??= receivedAtMs - endSeconds * 1000;
    const tailSize = this.sampleRate % FFT_SIZE;
    let full = 0, tail = 0, peak = 0;
    for (let i = 0; i < FFT_SIZE; i++) {
      const square = pcm[i] * pcm[i];
      full += square;
      if (i >= FFT_SIZE - tailSize) tail += square;
      peak = Math.max(peak, Math.abs(pcm[i]));
    }
    const clipped = peak >= 1;
    if (clipped) this.clipped++;
    this.sumSquares += full;
    this.samplePeak = Math.max(this.samplePeak, peak);
    recordPower(this.blockPower, full / FFT_SIZE);
    this.timeline.addBlock(pcm, sequence * FFT_SIZE);
    this.spectral.push(pcm, this.next * FFT_SIZE);
    // Для ровно одной секунды нужны целые последние блоки и хвост самого раннего.
    if (missingBefore) this.energies.length = 0;
    const needed = Math.ceil(this.sampleRate / FFT_SIZE);
    this.energies.push({ full, tail });
    if (this.energies.length > needed) this.energies.shift();
    const windowComplete = this.energies.length === needed;
    const energy1s = windowComplete ? this.energies.reduce((sum, e, i) =>
      sum + (i === 0 && tailSize ? e.tail : e.full), 0) : 0;
    this.history.push(this.next, dbfs(full / FFT_SIZE), dbfs(energy1s / this.sampleRate), windowComplete,
      full ? this.spectrum(pcm) : null, clipped, missingBefore);
  }

  get sessionPower() { return this.blocks ? this.sumSquares / (this.blocks * FFT_SIZE) : null; }
  get peakAmplitude() { return this.blocks ? this.samplePeak : null; }
  /** Исходные счётчики и суммы сеанса для снимка (055). */
  get totals() {
    return { endSamples: this.next * FFT_SIZE, blocks: this.blocks, missingBlocks: this.missing, clippedBlocks: this.clipped,
      sumSquares: this.sumSquares, samplePeak: this.samplePeak };
  }

  snapshot() {
    const last = this.history.at(-1);
    const hasSpectrum = last?.peakHz != null;
    return {
      f: hasSpectrum ? this.f : [], db: hasSpectrum ? Array.from(this.magnitudes, m => 20 * Math.log10(Math.max(1e-10, m))) : [],
      peakHz: last?.peakHz ?? null, rmsDbfs: last?.rmsDbfs ?? null, rms1sDbfs: last?.rms1sDbfs ?? null,
      windowComplete: last?.windowComplete ?? false, activeSeconds: this.blocks * FFT_SIZE / this.sampleRate,
      blocks: this.blocks, missing: this.missing, clipped: this.clipped,
      missingFraction: this.blocks ? this.missing / (this.blocks + this.missing) : null,
      clippedFraction: this.blocks ? this.clipped / this.blocks : null,
    };
  }
}
