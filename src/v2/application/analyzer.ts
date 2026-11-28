// Анализ сигнала микрофона для инструментов (V2-036, пакет 8б): окна и БПФ-анализатор с перекрытием и
// усреднением, временные характеристики Fast/Slow, искажения синуса, АЧХ свипом в выбранной полосе.
// БПФ, свип, деконволюция, сглаживание и частотные коррекции — функции ядра; формулы ядра не меняются (R39).
import { convolve, fft, inverseSweep, logGrid, nextPow2, smoothOct, spectrumDb, type SweepResult } from '../../core/dsp';
import { weightPower, type Weight } from '../../core/noiseSpectrum';

export type WindowKind = 'hann' | 'hamming' | 'blackman-harris' | 'flat-top' | 'rect';
export const WINDOWS: readonly WindowKind[] = ['hann', 'hamming', 'blackman-harris', 'flat-top', 'rect'];
export const WINDOW_LABEL: Record<WindowKind, string> = {
  hann: 'Ханна', hamming: 'Хэмминга', 'blackman-harris': 'Блэкмана — Харриса', 'flat-top': 'Flat Top', rect: 'Прямоугольное',
};
// Косинусные суммы: w = a0 − a1·cos(2πn/N) + a2·cos(4πn/N) − …
const COSINE: Record<WindowKind, readonly number[]> = {
  hann: [0.5, 0.5],
  hamming: [0.54, 0.46],
  'blackman-harris': [0.35875, 0.48829, 0.14128, 0.01168],
  'flat-top': [0.21557895, 0.41663158, 0.277263158, 0.083578947, 0.006947368],
  rect: [1],
};

/** Периодическое окно длины n (для БПФ). */
export function windowOf(kind: WindowKind, n: number): Float64Array {
  const a = COSINE[kind];
  return Float64Array.from({ length: n }, (_, i) => a.reduce((s, c, k) => s + (k % 2 ? -c : c) * Math.cos((2 * Math.PI * k * i) / n), 0));
}

/** Когерентное усиление (Σw/N) и эквивалентная шумовая полоса в бинах (N·Σw²/(Σw)²). */
export function windowStats(w: ArrayLike<number>) {
  let s = 0, s2 = 0;
  for (let i = 0; i < w.length; i++) { s += w[i]; s2 += w[i] * w[i]; }
  return { coherentGain: s / w.length, enbwBins: (w.length * s2) / (s * s) };
}

export const FFT_SIZES = [1024, 2048, 4096, 8192, 16384, 32768, 65536] as const;
export const OVERLAPS = [0, 0.5, 0.75] as const;
/** Усреднение кадров: нет, экспоненциальное по k кадрам, линейное за весь замер. */
export type Averaging = 'none' | '4' | '16' | 'all';

/**
 * БПФ-анализатор потока: кадры размера size с перекрытием, усреднение мощности по кадрам.
 * Уровень бина — мощность синуса в дБFS (как у шумомера: полная шкала синуса = −3 дБFS): 2·|X|²/(Σw)².
 * Для шума показание зависит от ширины бина и окна.
 */
export class FftAnalyzer {
  readonly window: Float64Array;
  readonly hop: number;
  readonly enbwHz: number;
  frames = 0;
  private readonly buf: Float64Array;
  private fill = 0;
  private readonly power: Float64Array;
  private readonly re: Float64Array;
  private readonly im: Float64Array;
  private readonly scale: number;

  constructor(readonly fs: number, readonly size: number, readonly kind: WindowKind, overlap: number, readonly averaging: Averaging) {
    this.window = windowOf(kind, size);
    this.hop = Math.max(1, Math.round(size * (1 - overlap)));
    const { coherentGain, enbwBins } = windowStats(this.window);
    this.enbwHz = (enbwBins * fs) / size;
    this.scale = 2 / (coherentGain * size) ** 2;
    this.buf = new Float64Array(size);
    this.power = new Float64Array(size / 2 + 1);
    this.re = new Float64Array(size);
    this.im = new Float64Array(size);
  }

  get stepHz() { return this.fs / this.size; }

  push(pcm: ArrayLike<number>) {
    for (let i = 0; i < pcm.length; i++) {
      this.buf[this.fill++] = pcm[i];
      if (this.fill === this.size) {
        this.frame();
        this.buf.copyWithin(0, this.hop);
        this.fill = this.size - this.hop;
      }
    }
  }

  private frame() {
    for (let i = 0; i < this.size; i++) this.re[i] = this.buf[i] * this.window[i];
    this.im.fill(0);
    fft(this.re, this.im);
    this.frames++;
    const a = this.averaging === 'none' || this.frames === 1 ? 1 : this.averaging === 'all' ? 1 / this.frames : 1 / Number(this.averaging);
    for (let k = 0; k < this.power.length; k++) {
      const p = this.scale * (this.re[k] * this.re[k] + this.im[k] * this.im[k]) * (k === 0 || k === this.size / 2 ? 0.5 : 1);
      this.power[k] = a === 1 ? p : this.power[k] + a * (p - this.power[k]);
    }
  }

  /** Спектр в [f0, f1], дБFS; до первого кадра — пусто. */
  spectrum(f0 = 20, f1 = 20000): { f: number[]; db: number[] } {
    if (!this.frames) return { f: [], db: [] };
    const k0 = Math.max(1, Math.ceil(f0 / this.stepHz)), k1 = Math.min(this.size / 2, Math.floor(f1 / this.stepHz));
    const f: number[] = [], db: number[] = [];
    for (let k = k0; k <= k1; k++) { f.push(k * this.stepHz); db.push(10 * Math.log10(Math.max(1e-20, this.power[k]))); }
    return { f, db };
  }
}

/** Прореживание для графика: максимум в каждой полосе 1/ppo октавы, пики сохраняются. */
export function decimateLog(f: readonly number[], db: readonly number[], ppo = 96): { f: number[]; db: number[] } {
  const of: number[] = [], od: number[] = [];
  let cell = NaN, best = -Infinity, at = 0;
  for (let i = 0; i < f.length; i++) {
    const c = Math.floor(Math.log2(f[i]) * ppo);
    if (c !== cell) {
      if (Number.isFinite(best)) { of.push(at); od.push(best); }
      cell = c; best = -Infinity;
    }
    if (db[i] > best) { best = db[i]; at = f[i]; }
  }
  if (Number.isFinite(best)) { of.push(at); od.push(best); }
  return { f: of, db: od };
}

/** Постоянные времени шумомера, с: Fast и Slow. */
export const TAU = { F: 0.125, S: 1 } as const;
export type TimeWeight = keyof typeof TAU;
const BLOCK = 4096;

/**
 * Временные характеристики Fast/Slow по блокам 4096 отсчётов: мощность блока с частотной коррекцией
 * (коррекции A/C ядра по спектру блока) и экспоненциальное усреднение с шагом блока (~85 мс при 48 кГц).
 * Это приближение, а не измеритель класса IEC 61672.
 */
export class TimeWeighted {
  private readonly gains: Record<Weight, Float64Array>;
  private readonly win = windowOf('hann', BLOCK);
  private readonly norm: number;
  private readonly re = new Float64Array(BLOCK);
  private readonly im = new Float64Array(BLOCK);
  private readonly state = new Map<string, { y: number; min: number; max: number }>();
  blocks = 0;

  constructor(readonly fs: number) {
    const bins = BLOCK / 2 + 1;
    const g = (w: Weight) => Float64Array.from({ length: bins }, (_, k) => (k === 0 ? 0 : weightPower((k * fs) / BLOCK, w)) * (k === BLOCK / 2 ? 1 : 2));
    this.gains = { Z: g('Z'), A: g('A'), C: g('C') };
    this.norm = 1 / (BLOCK * windowStats(this.win).enbwBins * windowStats(this.win).coherentGain ** 2 * BLOCK);
  }

  /** Блок ровно 4096 отсчётов; другие длины не принимаются. */
  push(pcm: Float32Array) {
    if (pcm.length !== BLOCK) return;
    for (let i = 0; i < BLOCK; i++) this.re[i] = pcm[i] * this.win[i];
    this.im.fill(0);
    fft(this.re, this.im);
    const dt = BLOCK / this.fs;
    this.blocks++;
    for (const w of ['Z', 'A', 'C'] as const) {
      const g = this.gains[w];
      let p = 0;
      for (let k = 0; k < g.length; k++) p += g[k] * (this.re[k] * this.re[k] + this.im[k] * this.im[k]);
      p *= this.norm;
      for (const t of ['F', 'S'] as const) {
        const key = w + t, s = this.state.get(key);
        // первое значение — сама мощность блока: без нарастания от нуля
        const y = s ? s.y + (1 - Math.exp(-dt / TAU[t])) * (p - s.y) : p;
        this.state.set(key, { y, min: Math.min(s?.min ?? y, y), max: Math.max(s?.max ?? y, y) });
      }
    }
  }

  /** Текущее, минимальное и максимальное значения, дБFS; до первого блока — null. */
  level(w: Weight, t: TimeWeight) {
    const s = this.state.get(w + t);
    const db = (p: number) => (p > 0 ? 10 * Math.log10(p) : null);
    return s ? { now: db(s.y), min: db(s.min), max: db(s.max) } : null;
  }
}

/** Самый длинный участок записи громче четверти максимума (по блокам 50 мс); из его середины — n отсчётов. */
export function steadySegment(x: Float32Array, fs: number, n: number): Float32Array | null {
  const b = Math.max(1, Math.round(0.05 * fs)), count = Math.floor(x.length / b);
  const rms = Array.from({ length: count }, (_, j) => { let s = 0; for (let i = j * b; i < (j + 1) * b; i++) s += x[i] * x[i]; return Math.sqrt(s / b); });
  const top = Math.max(0, ...rms);
  if (!top) return null;
  let best = [0, 0], start = -1;
  for (let j = 0; j <= count; j++) {
    const loud = j < count && rms[j] >= top / 4;
    if (loud && start < 0) start = j;
    if (!loud && start >= 0) { if (j - start > best[1] - best[0]) best = [start, j]; start = -1; }
  }
  // край участка (нарастание и спад) не берём: по блоку с каждой стороны
  const from = (best[0] + 1) * b, to = (best[1] - 1) * b;
  if (to - from < n) return null;
  const at = Math.floor((from + to - n) / 2);
  return x.slice(at, at + n);
}

export interface Harmonic { n: number; f: number; db: number; relDb: number; percent: number }
export interface Distortion {
  f0: number;
  /** Уровень основного тона, дБFS (мощность). */
  fundamentalDb: number;
  harmonics: Harmonic[];
  /** THD — корень из суммы мощностей гармоник к основному тону; THD+N — остаток к полному сигналу в 20 Гц – 20 кГц, %. */
  thd: number;
  thdN: number;
  /** Медианный уровень бина без тона и гармоник, дБFS на бин. */
  noiseDb: number;
  binHz: number;
}

const LOBE = 5;

/**
 * Искажения синуса f по записи: окно Блэкмана — Харриса, мощность тона и гармоник — сумма бинов главного
 * лепестка (±5 бинов). Гармоники — до count-й и не выше 20 кГц и частоты Найквиста.
 */
export function distortion(x: Float32Array, fs: number, f: number, count = 10): Distortion | null {
  const n = Math.min(65536, 2 ** Math.floor(Math.log2(x.length)));
  if (n < 4096) return null;
  const w = windowOf('blackman-harris', n);
  const re = new Float64Array(n), im = new Float64Array(n);
  for (let i = 0; i < n; i++) re[i] = x[i] * w[i];
  fft(re, im);
  const { coherentGain, enbwBins } = windowStats(w);
  // мощность в бинах (для сумм по полосе): 2·|X|²/(N·Σw²)
  const norm = 2 / (n * n * coherentGain * coherentGain * enbwBins);
  const p = Float64Array.from({ length: n / 2 + 1 }, (_, k) => norm * (re[k] * re[k] + im[k] * im[k]));
  const bin = fs / n;
  const around = (k: number) => { let s = 0; for (let j = Math.max(1, k - LOBE); j <= Math.min(n / 2, k + LOBE); j++) s += p[j]; return s; };
  // основной тон — наибольший бин в ±3 % от f
  let k1 = Math.round(f / bin);
  for (let k = Math.max(1, Math.floor((f * 0.97) / bin)); k <= Math.min(n / 2, Math.ceil((f * 1.03) / bin)); k++) if (p[k] > p[k1]) k1 = k;
  const p1 = around(k1);
  if (!(p1 > 0)) return null;
  // частота тона — центр тяжести лепестка: гармоники ищутся точнее, чем по номеру бина
  let ws = 0;
  for (let j = Math.max(1, k1 - LOBE); j <= Math.min(n / 2, k1 + LOBE); j++) ws += j * p[j];
  const kc = ws / p1, f1 = kc * bin, top = Math.min(20000, fs / 2 - LOBE * bin);
  const used = new Set<number>();
  for (let j = k1 - LOBE; j <= k1 + LOBE; j++) used.add(j);
  const harmonics: Harmonic[] = [];
  for (let h = 2; h <= count && h * f1 <= top; h++) {
    const kh = Math.round(h * kc);
    const ph = around(kh);
    for (let j = kh - LOBE; j <= kh + LOBE; j++) used.add(j);
    const rel = 10 * Math.log10(Math.max(1e-30, ph / p1));
    harmonics.push({ n: h, f: kh * bin, db: 10 * Math.log10(Math.max(1e-30, ph)), relDb: rel, percent: 100 * Math.sqrt(ph / p1) });
  }
  const lo = Math.max(1, Math.ceil(20 / bin)), hi = Math.floor(top / bin);
  let total = 0;
  const rest: number[] = [];
  for (let k = lo; k <= hi; k++) { total += p[k]; if (!used.has(k)) rest.push(p[k]); }
  rest.sort((a, b) => a - b);
  const sumH = harmonics.reduce((s, h) => s + 10 ** (h.db / 10), 0);
  return {
    f0: f1, fundamentalDb: 10 * Math.log10(p1), harmonics,
    thd: 100 * Math.sqrt(sumH / p1),
    thdN: 100 * Math.sqrt(Math.max(0, total - p1) / total),
    noiseDb: 10 * Math.log10(Math.max(1e-30, rest[Math.floor(rest.length / 2)] ?? 0)),
    binHz: bin,
  };
}

/**
 * АЧХ свипом в полосе [lo, hi]: тот же порядок, что analyzeSweep ядра (деконволюция, окно 10 мс до пика и 1 с после,
 * нормировка на отклик самого свипа, сглаживание 1/24 октавы), но с выбранной полосой графика. При [15, 500] совпадает
 * с analyzeSweep ядра (проверено тестом); ядро не меняется, чтобы не трогать legacy на физической приёмке (R39).
 */
export function analyzeSweepBand(rec: Float32Array, sweep: Float32Array, f1: number, f2: number, fs: number, lo: number, hi: number): SweepResult {
  const inv = inverseSweep(sweep, f1, f2, fs);
  const ir = convolve(rec, inv);
  const ref = convolve(sweep, inv);
  let pk = 0, pkAt = 0;
  for (let i = 0; i < ir.length; i++) if (Math.abs(ir[i]) > pk) { pk = Math.abs(ir[i]); pkAt = i; }
  let rpk = 0, rAt = 0;
  for (let i = 0; i < ref.length; i++) if (Math.abs(ref[i]) > rpk) { rpk = Math.abs(ref[i]); rAt = i; }
  const pre = Math.round(0.01 * fs), post = Math.round(1.0 * fs);
  const cut = (x: Float64Array, at: number) => {
    const out = new Float64Array(pre + post);
    for (let i = 0; i < out.length; i++) {
      const j = at - pre + i;
      const tail = i > pre + post * 0.7 ? 0.5 * (1 + Math.cos((Math.PI * (i - pre - post * 0.7)) / (post * 0.3))) : 1;
      out[i] = j >= 0 && j < x.length ? x[j] * tail : 0;
    }
    return out;
  };
  const freqs = logGrid(lo, hi, 48);
  const N = nextPow2(pre + post);
  const a = spectrumDb(cut(ir, pkAt), fs, freqs, N);
  const b = spectrumDb(cut(ref, rAt), fs, freqs, N);
  let noise = 0, nc = 0;
  for (let i = Math.max(0, pkAt - Math.round(0.6 * fs)); i < pkAt - Math.round(0.1 * fs); i++) { noise += ir[i] * ir[i]; nc++; }
  const snr = nc ? 10 * Math.log10((pk * pk) / (noise / nc + 1e-30)) : 60;
  let recPeak = 0;
  for (let i = 0; i < rec.length; i++) recPeak = Math.max(recPeak, Math.abs(rec[i]));
  return { f: freqs, db: smoothOct(freqs, a.map((v, i) => v - b[i]), 1 / 24), peak: recPeak, snrDb: snr, irPeakAt: pkAt / fs };
}

export interface Sideband { order: number; f: number; relDb: number }
export interface Intermod { f1: number; f2: number; f2Db: number; sidebands: Sideband[]; imd: number }

/**
 * Интермодуляционные искажения по SMPTE (низкий тон f1, высокий f2, обычно 60 Гц и 7 кГц, 4:1): мощность боковых
 * f2 ± k·f1 (k = 1…4) к мощности f2, окно Блэкмана — Харриса, суммы по главному лепестку.
 */
export function intermod(x: Float32Array, fs: number, f1: number, f2: number): Intermod | null {
  const n = Math.min(65536, 2 ** Math.floor(Math.log2(x.length)));
  if (n < 4096 || f2 + 4 * f1 >= fs / 2) return null;
  const w = windowOf('blackman-harris', n);
  const re = new Float64Array(n), im = new Float64Array(n);
  for (let i = 0; i < n; i++) re[i] = x[i] * w[i];
  fft(re, im);
  const bin = fs / n;
  const p = (f: number) => {
    const k = Math.round(f / bin);
    let s = 0;
    for (let j = Math.max(1, k - LOBE); j <= Math.min(n / 2, k + LOBE); j++) s += re[j] * re[j] + im[j] * im[j];
    return s;
  };
  if (f1 / bin < 2 * LOBE + 1) return null;
  const p2 = p(f2);
  if (!(p2 > 0)) return null;
  const { coherentGain, enbwBins } = windowStats(w);
  const sidebands: Sideband[] = [];
  let sum = 0;
  for (let k = 1; k <= 4; k++) {
    for (const sign of [-1, 1]) {
      const f = f2 + sign * k * f1, ps = p(f);
      sum += ps;
      sidebands.push({ order: sign * k, f, relDb: 10 * Math.log10(Math.max(1e-30, ps / p2)) });
    }
  }
  return { f1, f2, f2Db: 10 * Math.log10((2 * p2) / (n * n * coherentGain * coherentGain * enbwBins)), sidebands, imd: 100 * Math.sqrt(sum / p2) };
}
