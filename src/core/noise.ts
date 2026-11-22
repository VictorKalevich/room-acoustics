import { NoiseSpectrum, emptyPowerRange, recordPower } from './noiseSpectrum';
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

/** Все точки сеанса содержат только метрики. БПФ и секундное окно занимают постоянную память. */
export class NoiseMeter {
  readonly history: NoisePoint[] = [];
  audioStartMs: number | null = null;
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

  constructor(readonly sampleRate: number) {
    this.spectral = new NoiseSpectrum(sampleRate);
    this.firstBin = Math.ceil(20 * FFT_SIZE / sampleRate);
    const lastBin = Math.floor(Math.min(20000 / sampleRate, 0.5) * FFT_SIZE);
    this.f = Array.from({ length: lastBin - this.firstBin + 1 }, (_, i) => (i + this.firstBin) * sampleRate / FFT_SIZE);
    this.magnitudes = new Float64Array(this.f.length);
  }

  private spectrum(pcm: Float32Array) {
    for (let i = 0; i < FFT_SIZE; i++) this.re[i] = pcm[i] * hann[i];
    this.im.fill(0);
    fft(this.re, this.im);
    let peak = -1, peakHz: number | null = null;
    for (let i = 0; i < this.f.length; i++) {
      const k = this.firstBin + i;
      const scale = (k === FFT_SIZE / 2 ? 2 : 4) / FFT_SIZE;
      const magnitude = scale * Math.hypot(this.re[k], this.im[k]);
      this.magnitudes[i] = magnitude;
      const bounded = Math.max(1e-10, magnitude);
      if (bounded > peak) { peak = bounded; peakHz = this.f[i]; }
    }
    return peakHz;
  }

  push(pcm: Float32Array, sequence: number, receivedAtMs = Date.now()) {
    if (pcm.length !== FFT_SIZE || sequence < this.next) return;
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
    this.spectral.push(pcm, this.next * FFT_SIZE);
    // Для ровно одной секунды нужны целые последние блоки и хвост самого раннего.
    if (missingBefore) this.energies.length = 0;
    const needed = Math.ceil(this.sampleRate / FFT_SIZE);
    this.energies.push({ full, tail });
    if (this.energies.length > needed) this.energies.shift();
    const windowComplete = this.energies.length === needed;
    const energy1s = windowComplete ? this.energies.reduce((sum, e, i) =>
      sum + (i === 0 && tailSize ? e.tail : e.full), 0) : 0;
    this.history.push({
      endSeconds, rmsDbfs: dbfs(full / FFT_SIZE), rms1sDbfs: dbfs(energy1s / this.sampleRate),
      windowComplete, peakHz: full ? this.spectrum(pcm) : null, clipped, missingBefore,
    });
  }

  get sessionPower() { return this.blocks ? this.sumSquares / (this.blocks * FFT_SIZE) : null; }
  get peakAmplitude() { return this.blocks ? this.samplePeak : null; }

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
