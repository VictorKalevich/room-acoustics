import { fft } from './dsp';

export const FFT_SIZE = 4096;

/** Метрики принятого PCM. sequence растёт и для отброшенных пакетов worklet. */
export class NoiseMeter {
  blocks = 0;
  missing = 0;
  clipped = 0;
  samples = 0;
  rmsDbfs: number | null = null;
  private next = 0;
  private pcm = new Float32Array(FFT_SIZE);

  push(pcm: Float32Array, sequence: number) {
    if (pcm.length !== FFT_SIZE || sequence < this.next) return;
    this.missing += sequence - this.next;
    this.next = sequence + 1;
    this.blocks++;
    this.samples += pcm.length;
    let energy = 0, peak = 0;
    for (const value of pcm) {
      energy += value * value;
      peak = Math.max(peak, Math.abs(value));
    }
    if (peak >= 1) this.clipped++;
    this.rmsDbfs = energy ? 10 * Math.log10(energy / pcm.length) : null;
    this.pcm.set(pcm);
  }

  snapshot(fs: number) {
    const f: number[] = [], db: number[] = [];
    let peakHz: number | null = null, peak = -Infinity;
    if (this.rmsDbfs !== null) {
      const re = Float64Array.from(this.pcm, (v, i) => v * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / FFT_SIZE)));
      const im = new Float64Array(FFT_SIZE);
      fft(re, im);
      for (let k = Math.ceil(20 * FFT_SIZE / fs); k <= FFT_SIZE / 2; k++) {
        const hz = k * fs / FFT_SIZE;
        if (hz > 20000) break;
        // Пиковая амплитуда бина с поправкой на усиление периодического окна Ханна.
        const scale = (k === FFT_SIZE / 2 ? 2 : 4) / FFT_SIZE;
        const level = 20 * Math.log10(Math.max(1e-10, scale * Math.hypot(re[k], im[k])));
        f.push(hz);
        db.push(level);
        if (level > peak) { peak = level; peakHz = hz; }
      }
    }
    return {
      f, db, peakHz, rmsDbfs: this.rmsDbfs, activeSeconds: this.samples / fs,
      blocks: this.blocks, missing: this.missing, clipped: this.clipped,
      missingFraction: this.blocks ? this.missing / (this.blocks + this.missing) : null,
      clippedFraction: this.blocks ? this.clipped / this.blocks : null,
    };
  }
}
