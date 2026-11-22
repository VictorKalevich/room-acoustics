import { bandCells, bandEdges, type BandCells, type Weight } from './noiseSpectrum';

/** Ширина столбца истории уровней и полос, столбца грубой спектрограммы, охват точной спектрограммы, предел сеанса. */
export const LEVEL_SECONDS = 1;
export const COARSE_SECONDS = 10;
export const FINE_SECONDS = 600;
export const MAX_SESSION_SECONDS = 12 * 3600;
export const WEIGHTS: readonly Weight[] = ['Z', 'A', 'C'];
export type LevelMetric = 'leq1' | 'leq10' | 'leq60' | 'leqAll' | 'peak';

/** Вариант представления: вес + 3, если с поправкой профиля. Поправка есть только у сеанса с профилем. */
export const variantOf = (weight: Weight, corrected: boolean) => WEIGHTS.indexOf(weight) + (corrected ? 3 : 0);

/** Полосы спектрограммы: 1/12 октавы, центры 1000·2^(n/12) Гц, n = −68…51 (19,6 Гц – 19,6 кГц), не выше Найквиста. */
export function spectrogramEdges(sampleRate: number) {
  const edges: number[] = [];
  for (let n = -68; n <= 51; n++) {
    const hi = 1000 * 2 ** ((2 * n + 1) / 24);
    if (hi > sampleRate / 2) break;
    if (!edges.length) edges.push(1000 * 2 ** ((2 * n - 1) / 24));
    edges.push(hi);
  }
  return edges;
}

interface Flat { offsets: Int32Array; bins: Int32Array; coef: Float64Array }
// Мощность полосы = Σ PSD[k]·Δf·(пересечение/ячейка), та же геометрия, что у bandPowers.
function flatten(cells: BandCells[], step: number): Flat {
  const total = cells.reduce((n, c) => n + c.bins.length, 0);
  const offsets = new Int32Array(cells.length + 1), bins = new Int32Array(total), coef = new Float64Array(total);
  let at = 0;
  cells.forEach((c, b) => {
    offsets[b] = at;
    for (let i = 0; i < c.bins.length; i++, at++) {
      bins[at] = c.bins[i];
      coef[at] = step * c.width[i] / c.span[i];
    }
  });
  offsets[cells.length] = at;
  return { offsets, bins, coef };
}
function integrate(flat: Flat, psd: Float64Array, gain: Float64Array | null, out: Float64Array, at: number) {
  const { offsets, bins, coef } = flat;
  for (let b = 0; b + 1 < offsets.length; b++) {
    let sum = 0;
    for (let i = offsets[b]; i < offsets[b + 1]; i++) {
      const k = bins[i];
      sum += (gain ? psd[k] * gain[k] : psd[k]) * coef[i];
    }
    out[at + b] = sum;
  }
}

function growF64(a: Float64Array<ArrayBuffer>, size: number, limit: number): Float64Array<ArrayBuffer> {
  if (a.length >= size) return a;
  const next = new Float64Array(Math.min(limit, Math.max(size, 2 * a.length, 64)));
  next.set(a);
  return next;
}
function growF32(a: Float32Array<ArrayBuffer>, size: number, limit: number): Float32Array<ArrayBuffer> {
  if (a.length >= size) return a;
  const next = new Float32Array(Math.min(limit, Math.max(size, 2 * a.length, 64)));
  next.set(a);
  return next;
}

export interface TimelineConfig {
  sampleRate: number;
  /** Шаг сетки PSD и число бинов (N/2 + 1), hop спектральных кадров в отсчётах. */
  binHz: number;
  bins: number;
  hop: number;
  /** Множитель мощности бина для каждого варианта по порядку variantOf; null — без изменения. */
  gains: readonly (Float64Array | null)[];
}

/** Достаточные линейные суммы истории (055). Это исходные данные снимка сеанса; dB, доли и окна выводятся из них. */
export interface TimelineData {
  sampleRate: number;
  hop: number;
  variants: number;
  end: number;
  spectrogramEdgesHz: number[];
  energyEdgesHz: number[];
  /** Столбцы 1 с: принятые отсчёты PCM, Σx², max|x|, спектральные отсчёты, Σ мощность A/C × отсчёты, энергия шести полос по вариантам. */
  levels: { pcm: Float64Array; z: Float64Array; peak: Float32Array; spec: Float64Array; a: Float64Array; c: Float64Array; energy: Float32Array };
  /** Столбцы 10 с: спектральные отсчёты и энергия полос спектрограммы по вариантам. */
  coarse: { spec: Float64Array; energy: Float32Array };
  /** Последние кадры по порядку: конец hop и средняя мощность полос спектрограммы по вариантам; dropped — вытесненные из кольца. */
  fine: { ends: Float64Array; power: Float32Array; dropped: number };
}

export interface WindowValue { power: number | null; valid: number; complete: boolean }
export interface SpectrogramImage {
  /** Средняя мощность полосы в пиксельном столбце, FS²; NaN — нет данных. width × bandCount. */
  power: Float32Array;
  /** Доля времени столбца с данными, 0…1. */
  coverage: Float32Array;
  width: number;
  tier: 'fine' | 'coarse';
  columnSeconds: number;
}

/**
 * Ограниченная история сеанса на аудиошкале (отсчёты от начала, пропуски занимают своё время).
 * Уровни и полосы — столбцы 1 с за весь сеанс; спектрограмма — последние 10 мин по кадрам и столбцы 10 с за весь сеанс.
 * Объём ограничен MAX_SESSION_SECONDS. Полноразмерные FFT не хранятся.
 */
export class NoiseTimeline {
  readonly sampleRate: number;
  readonly hop: number;
  readonly variants: number;
  readonly spectrogramEdges: readonly number[];
  readonly energyEdges: readonly number[];
  readonly bandCount: number;
  readonly energyCount: number;
  readonly maxSamples: number;
  readonly fineCapacity: number;
  end = 0;
  levelCount = 0;
  coarseCount = 0;
  fineTotal = 0;
  private pcm = new Float64Array(0);
  private z = new Float64Array(0);
  private peak = new Float32Array(0);
  private spec = new Float64Array(0);
  private a = new Float64Array(0);
  private c = new Float64Array(0);
  private energy = new Float32Array(0);
  private coarseSpec = new Float64Array(0);
  private coarse = new Float32Array(0);
  private fineEnds = new Float64Array(0);
  private fine = new Float32Array(0);
  private readonly flatBands: Flat | null;
  private readonly flatEnergy: Flat | null;
  private readonly gains: readonly (Float64Array | null)[];
  private readonly scratch: Float64Array;
  private readonly scratchEnergy: Float64Array;
  private restoredDropped = 0;

  constructor(config: TimelineConfig | TimelineData) {
    this.sampleRate = config.sampleRate;
    this.hop = config.hop;
    this.maxSamples = MAX_SESSION_SECONDS * this.sampleRate;
    this.fineCapacity = Math.ceil(FINE_SECONDS * this.sampleRate / this.hop);
    if ('gains' in config) {
      this.variants = config.gains.length;
      const spectrogram = bandCells(config.binHz, config.bins, spectrogramEdges(config.sampleRate));
      const energy = bandCells(config.binHz, config.bins, bandEdges);
      this.spectrogramEdges = [spectrogram[0].lo, ...spectrogram.map(b => b.hi)];
      this.energyEdges = [energy[0].lo, ...energy.map(b => b.hi)];
      this.flatBands = flatten(spectrogram, config.binHz);
      this.flatEnergy = flatten(energy, config.binHz);
      this.gains = config.gains;
    } else {
      this.variants = config.variants;
      this.spectrogramEdges = config.spectrogramEdgesHz;
      this.energyEdges = config.energyEdgesHz;
      this.flatBands = this.flatEnergy = null;
      this.gains = [];
    }
    this.bandCount = this.spectrogramEdges.length - 1;
    this.energyCount = this.energyEdges.length - 1;
    this.scratch = new Float64Array(this.bandCount * this.variants);
    this.scratchEnergy = new Float64Array(this.energyCount * this.variants);
    if (!('gains' in config)) this.load(config);
  }

  private get levelLimit() { return Math.ceil(this.maxSamples / this.sampleRate); }
  private ensureLevel(n: number) {
    if (n < this.levelCount) return;
    const limit = this.levelLimit, size = n + 1;
    if (size > limit) throw new RangeError('История шумомера: предел сеанса превышен.');
    this.pcm = growF64(this.pcm, size, limit);
    this.z = growF64(this.z, size, limit);
    this.peak = growF32(this.peak, size, limit);
    this.spec = growF64(this.spec, size, limit);
    this.a = growF64(this.a, size, limit);
    this.c = growF64(this.c, size, limit);
    const width = this.energyCount * this.variants;
    this.energy = growF32(this.energy, size * width, limit * width);
    this.levelCount = size;
  }
  private ensureCoarse(m: number) {
    if (m < this.coarseCount) return;
    const limit = Math.ceil(this.levelLimit / COARSE_SECONDS), width = this.bandCount * this.variants;
    this.coarseSpec = growF64(this.coarseSpec, m + 1, limit);
    this.coarse = growF32(this.coarse, (m + 1) * width, limit * width);
    this.coarseCount = m + 1;
  }

  /** Блок PCM с началом start: энергия и пик делятся точно по границам секунд. */
  addBlock(pcm: Float32Array, start: number) {
    if (!this.flatBands) throw new Error('Сохранённая история только для чтения.');
    const fs = this.sampleRate;
    for (let i = 0; i < pcm.length;) {
      const n = Math.floor((start + i) / fs);
      const stop = Math.min(pcm.length, (n + 1) * fs - start);
      let sum = 0, peak = 0;
      for (let j = i; j < stop; j++) {
        const x = pcm[j];
        sum += x * x;
        const m = x < 0 ? -x : x;
        if (m > peak) peak = m;
      }
      this.ensureLevel(n);
      this.pcm[n] += stop - i;
      this.z[n] += sum;
      if (peak > this.peak[n]) this.peak[n] = peak;
      i = stop;
    }
    this.end = Math.max(this.end, start + pcm.length);
  }

  /** Полный кадр представляет hop перед end (контракт B). Его мощность делится между столбцами пропорционально времени. */
  addFrame(end: number, psd: Float64Array, powerA: number, powerC: number) {
    if (!this.flatBands || !this.flatEnergy) throw new Error('Сохранённая история только для чтения.');
    const B = this.bandCount, E = this.energyCount, V = this.variants;
    for (let v = 0; v < V; v++) {
      integrate(this.flatBands, psd, this.gains[v], this.scratch, v * B);
      integrate(this.flatEnergy, psd, this.gains[v], this.scratchEnergy, v * E);
    }
    const width = B * V;
    const slot = this.fineTotal % this.fineCapacity;
    this.fineEnds = growF64(this.fineEnds, slot + 1, this.fineCapacity);
    this.fine = growF32(this.fine, (slot + 1) * width, this.fineCapacity * width);
    this.fineEnds[slot] = end;
    this.fine.set(this.scratch, slot * width);
    this.fineTotal++;
    const start = end - this.hop, fs = this.sampleRate;
    for (let n = Math.floor(start / fs); n * fs < end; n++) {
      const overlap = Math.min(end, (n + 1) * fs) - Math.max(start, n * fs);
      this.ensureLevel(n);
      this.spec[n] += overlap;
      this.a[n] += powerA * overlap;
      this.c[n] += powerC * overlap;
      const at = n * E * V;
      for (let j = 0; j < E * V; j++) this.energy[at + j] += this.scratchEnergy[j] * overlap;
    }
    const span = COARSE_SECONDS * fs;
    for (let m = Math.floor(start / span); m * span < end; m++) {
      const overlap = Math.min(end, (m + 1) * span) - Math.max(start, m * span);
      this.ensureCoarse(m);
      this.coarseSpec[m] += overlap;
      const at = m * width;
      for (let j = 0; j < width; j++) this.coarse[at + j] += this.scratch[j] * overlap;
    }
  }

  variant(weight: Weight, corrected: boolean) { return variantOf(weight, corrected && this.variants > 3); }

  /** Начало и конец столбца 1 с n в отсчётах; конец открытого столбца — конец данных. */
  columnSpan(n: number): [number, number] {
    return [n * this.sampleRate, Math.min((n + 1) * this.sampleRate, Math.max(this.end, n * this.sampleRate))];
  }

  private valid(n: number, weight: Weight) { return weight === 'Z' ? this.pcm[n] : this.spec[n]; }
  private energyOf(n: number, weight: Weight) { return weight === 'Z' ? this.z[n] : weight === 'A' ? this.a[n] : this.c[n]; }

  /** Энергетическое среднее по столбцам [n − seconds + 1, n]. Полное окно — без пропусков и прогрева. */
  window(n: number, seconds: number, weight: Weight): WindowValue {
    let energy = 0, valid = 0;
    for (let m = Math.max(0, n - seconds + 1); m <= n && m < this.levelCount; m++) {
      energy += this.energyOf(m, weight);
      valid += this.valid(m, weight);
    }
    return { power: valid ? energy / valid : null, valid, complete: n - seconds + 1 >= 0 && valid === seconds * this.sampleRate };
  }

  /** Значения метрики для столбцов [n0, n1). leqAll — с начала сеанса; peak — max|x|² за секунду, только Z. */
  series(metric: LevelMetric, weight: Weight, n0: number, n1: number) {
    n0 = Math.max(0, n0);
    n1 = Math.min(this.levelCount, n1);
    const count = Math.max(0, n1 - n0);
    const power = new Float64Array(count), valid = new Float64Array(count), complete = new Uint8Array(count);
    let energy = 0, total = 0;
    if (metric === 'leqAll') for (let m = 0; m < n0; m++) { energy += this.energyOf(m, weight); total += this.valid(m, weight); }
    for (let i = 0; i < count; i++) {
      const n = n0 + i;
      if (metric === 'leqAll') {
        energy += this.energyOf(n, weight);
        total += this.valid(n, weight);
        power[i] = total ? energy / total : NaN;
        valid[i] = total;
        complete[i] = total ? 1 : 0;
      } else if (metric === 'peak') {
        valid[i] = this.pcm[n];
        power[i] = this.pcm[n] ? this.peak[n] ** 2 : NaN;
        complete[i] = this.pcm[n] === this.sampleRate ? 1 : 0;
      } else {
        const w = this.window(n, metric === 'leq1' ? 1 : metric === 'leq10' ? 10 : 60, weight);
        power[i] = w.power ?? NaN;
        valid[i] = w.valid;
        complete[i] = w.complete ? 1 : 0;
      }
    }
    return { power, valid, complete };
  }

  /** Средняя мощность полосы j по столбцам [n0, n1) для варианта v; NaN — нет спектральных данных, valid — спектральные отсчёты. */
  bandSeries(v: number, j: number, n0: number, n1: number) {
    n0 = Math.max(0, n0);
    n1 = Math.min(this.levelCount, n1);
    const count = Math.max(0, n1 - n0), power = new Float64Array(count), complete = new Uint8Array(count);
    const stride = this.energyCount * this.variants;
    for (let n = n0; n < n1; n++) {
      power[n - n0] = this.spec[n] ? this.energy[n * stride + v * this.energyCount + j] / this.spec[n] : NaN;
      complete[n - n0] = this.spec[n] === this.sampleRate ? 1 : 0;
    }
    return { power, valid: this.spec.slice(n0, n1), complete };
  }

  /** Итог за столбцы [n0, n1): уровень по весу, учтённые отсчёты и шесть полос с долями, как bandPowers. */
  interval(n0: number, n1: number, weight: Weight, v: number) {
    n0 = Math.max(0, n0);
    n1 = Math.min(this.levelCount, n1);
    let energy = 0, valid = 0, spec = 0;
    const bands = new Float64Array(this.energyCount);
    const stride = this.energyCount * this.variants;
    for (let n = n0; n < n1; n++) {
      energy += this.energyOf(n, weight);
      valid += this.valid(n, weight);
      spec += this.spec[n];
      for (let j = 0; j < this.energyCount; j++) bands[j] += this.energy[n * stride + v * this.energyCount + j];
    }
    const list = Array.from(bands, (e, j) => ({ lo: this.energyEdges[j], hi: this.energyEdges[j + 1], power: spec ? e / spec : 0 }));
    const total = list.reduce((sum, b) => sum + b.power, 0);
    return {
      power: valid ? energy / valid : null, valid, spectralSamples: spec,
      bands: list.map(b => ({ ...b, percent: total ? 100 * b.power / total : null })),
    };
  }

  peakAt(n: number) { return n >= 0 && n < this.levelCount && this.pcm[n] ? this.peak[n] : null; }
  pcmSamples(n: number) { return n >= 0 && n < this.levelCount ? this.pcm[n] : 0; }

  private get fineCount() { return Math.min(this.fineTotal, this.fineCapacity); }
  private fineSlot(i: number) { return (this.fineTotal - this.fineCount + i) % this.fineCapacity; }
  /** Кадры, вытесненные из кольца. */
  get fineDropped() { return this.fineTotal - this.fineCount + this.restoredDropped; }
  /** Начало самого раннего сохранённого кадра; пока кадры не вытеснялись — начало сеанса. */
  get fineFrom() { return this.fineDropped ? this.fineEnds[this.fineSlot(0)] - this.hop : 0; }

  /** Точные кадры, если кольцо покрывает начало интервала; иначе столбцы 10 с. */
  tierFor(t0: number): 'fine' | 'coarse' {
    return this.fineTotal && Math.max(0, t0) >= this.fineFrom ? 'fine' : 'coarse';
  }

  /** Спектрограмма [t0, t1) в отсчётах на width столбцов: энергетическое среднее полос варианта v по времени с данными. */
  spectrogramImage(t0: number, t1: number, width: number, v: number): SpectrogramImage {
    const B = this.bandCount, stride = B * this.variants;
    const acc = new Float64Array(width * B), weight = new Float64Array(width);
    const step = (t1 - t0) / width;
    const tier = this.tierFor(t0);
    const add = (s: number, e: number, fraction: number, source: Float32Array, at: number, scale: number) => {
      const from = Math.max(s, t0), to = Math.min(e, t1);
      if (to <= from || fraction <= 0) return;
      for (let x = Math.floor((from - t0) / step); x < width && t0 + x * step < to; x++) {
        const overlap = Math.min(to, t0 + (x + 1) * step) - Math.max(from, t0 + x * step);
        if (overlap <= 0) continue;
        const w = overlap * fraction;
        weight[x] += w;
        for (let b = 0; b < B; b++) acc[x * B + b] += source[at + b] * scale * w;
      }
    };
    if (tier === 'fine') {
      for (let i = 0; i < this.fineCount; i++) {
        const slot = this.fineSlot(i), e = this.fineEnds[slot];
        add(e - this.hop, e, 1, this.fine, slot * stride + v * B, 1);
      }
    } else {
      const span = COARSE_SECONDS * this.sampleRate;
      for (let m = Math.max(0, Math.floor(t0 / span)); m < this.coarseCount && m * span < t1; m++) {
        const s = m * span, e = Math.min((m + 1) * span, Math.max(this.end, s));
        if (!this.coarseSpec[m] || e <= s) continue;
        add(s, e, this.coarseSpec[m] / (e - s), this.coarse, m * stride + v * B, 1 / this.coarseSpec[m]);
      }
    }
    const power = new Float32Array(width * B), coverage = new Float32Array(width);
    for (let x = 0; x < width; x++) {
      coverage[x] = Math.min(1, weight[x] / step);
      for (let b = 0; b < B; b++) power[x * B + b] = weight[x] ? acc[x * B + b] / weight[x] : NaN;
    }
    return { power, coverage, width, tier, columnSeconds: (tier === 'fine' ? this.hop : COARSE_SECONDS * this.sampleRate) / this.sampleRate };
  }

  /** Исходные столбцы яруса, пересекающие [t0, t1) (056, экспорт): границы, доля времени с данными и средняя мощность полос; NaN — нет данных. */
  spectrogramColumns(t0: number, t1: number, v: number, tier = this.tierFor(t0)) {
    const B = this.bandCount, stride = B * this.variants, out: { start: number; end: number; coverage: number; power: Float64Array }[] = [];
    if (tier === 'fine') {
      for (let i = 0; i < this.fineCount; i++) {
        const slot = this.fineSlot(i), e = this.fineEnds[slot], at = slot * stride + v * B;
        if (e > t0 && e - this.hop < t1) out.push({ start: e - this.hop, end: e, coverage: 1, power: Float64Array.from(this.fine.subarray(at, at + B)) });
      }
      return out;
    }
    const span = COARSE_SECONDS * this.sampleRate;
    for (let m = Math.max(0, Math.floor(t0 / span)); m < this.coarseCount && m * span < t1; m++) {
      const s = m * span, e = Math.min((m + 1) * span, Math.max(this.end, s)), spec = this.coarseSpec[m], at = m * stride + v * B;
      if (e <= s) continue;
      out.push({ start: s, end: e, coverage: spec / (e - s), power: Float64Array.from(this.coarse.subarray(at, at + B), x => spec ? x / spec : NaN) });
    }
    return out;
  }

  /** Полосы спектрограммы в момент t из самого точного доступного столбца. */
  spectrumAt(t: number, v: number) {
    const B = this.bandCount, stride = B * this.variants;
    if (this.fineTotal && t >= this.fineFrom) {
      for (let i = this.fineCount - 1; i >= 0; i--) {
        const slot = this.fineSlot(i), e = this.fineEnds[slot];
        if (e - this.hop <= t && t < e) return { start: e - this.hop, end: e, tier: 'fine' as const, power: this.fine.slice(slot * stride + v * B, slot * stride + v * B + B) };
        if (e <= t) break;
      }
    }
    const span = COARSE_SECONDS * this.sampleRate, m = Math.floor(t / span);
    if (m < 0 || m >= this.coarseCount || !this.coarseSpec[m]) return null;
    const power = this.coarse.slice(m * stride + v * B, m * stride + v * B + B).map(e => e / this.coarseSpec[m]);
    return { start: m * span, end: Math.min((m + 1) * span, this.end), tier: 'coarse' as const, power };
  }

  /** Объём выделенных массивов, байты. */
  get bytes() {
    return [this.pcm, this.z, this.peak, this.spec, this.a, this.c, this.energy, this.coarseSpec, this.coarse, this.fineEnds, this.fine]
      .reduce((sum, a) => sum + a.byteLength, 0);
  }

  /** Копия достаточных сумм для снимка сеанса; кадры — в порядке времени. */
  toData(): TimelineData {
    const L = this.levelCount, M = this.coarseCount, F = this.fineCount, width = this.bandCount * this.variants;
    const ends = new Float64Array(F), power = new Float32Array(F * width);
    for (let i = 0; i < F; i++) {
      const slot = this.fineSlot(i);
      ends[i] = this.fineEnds[slot];
      power.set(this.fine.subarray(slot * width, (slot + 1) * width), i * width);
    }
    return {
      sampleRate: this.sampleRate, hop: this.hop, variants: this.variants, end: this.end,
      spectrogramEdgesHz: [...this.spectrogramEdges], energyEdgesHz: [...this.energyEdges],
      levels: {
        pcm: this.pcm.slice(0, L), z: this.z.slice(0, L), peak: this.peak.slice(0, L), spec: this.spec.slice(0, L),
        a: this.a.slice(0, L), c: this.c.slice(0, L), energy: this.energy.slice(0, L * this.energyCount * this.variants),
      },
      coarse: { spec: this.coarseSpec.slice(0, M), energy: this.coarse.slice(0, M * width) },
      fine: { ends, power, dropped: this.fineDropped },
    };
  }

  private load(data: TimelineData) {
    const { levels, coarse, fine } = data;
    this.end = data.end;
    this.levelCount = levels.pcm.length;
    this.pcm = levels.pcm.slice(); this.z = levels.z.slice(); this.peak = levels.peak.slice(); this.spec = levels.spec.slice();
    this.a = levels.a.slice(); this.c = levels.c.slice(); this.energy = levels.energy.slice();
    this.coarseCount = coarse.spec.length;
    this.coarseSpec = coarse.spec.slice(); this.coarse = coarse.energy.slice();
    // Восстановленное кольцо начинается с нулевого слота и не дописывается.
    this.fineTotal = fine.ends.length;
    this.restoredDropped = fine.dropped;
    this.fineEnds = fine.ends.slice(); this.fine = fine.power.slice();
  }
}
