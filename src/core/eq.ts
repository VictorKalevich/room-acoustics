// Подсказки параметрического эквалайзера (research R13): только срезы пиков.
// Фильтры — peakingEQ из Audio EQ Cookbook (R. Bristow-Johnson).

export interface PeqFilter {
  f: number;
  gainDb: number;
  q: number;
}

export interface EqResult {
  filters: PeqFilter[];
  after: number[];
  stdBefore: number;
  stdAfter: number;
  dips: { f: number; depth: number }[];
}

/** Модуль аналогового прототипа пикового фильтра на частоте f, дБ. */
export function peqGainDb(p: PeqFilter, f: number): number {
  const A = Math.pow(10, p.gainDb / 40);
  const w = f / p.f;
  const r = 1 - w * w;
  const num = Math.hypot(r, (w * A) / p.q);
  const den = Math.hypot(r, w / (A * p.q));
  return 20 * Math.log10(num / den);
}

export function peqResponse(filters: PeqFilter[], freqs: number[]): number[] {
  return freqs.map((f) => filters.reduce((s, p) => s + peqGainDb(p, f), 0));
}

function median(a: number[]): number {
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function std(a: number[]): number {
  const m = a.reduce((x, y) => x + y, 0) / a.length;
  return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length);
}

/**
 * Жадный подбор фильтров: наибольшее превышение над целью (относительно медианы) → срез с усилением
 * −0,9·превышение и добротностью по ширине пика на уровне половины превышения.
 */
export function designEq(
  freqs: number[],
  db: number[],
  target: number[],
  opts: { maxFilters?: number; threshold?: number; maxCut?: number; smoothOct?: number } = {},
): EqResult {
  const maxFilters = opts.maxFilters ?? 8;
  const threshold = opts.threshold ?? 2;
  const maxCut = opts.maxCut ?? 12;
  const smoothOct = opts.smoothOct ?? 1 / 12;
  const n = freqs.length;
  const base = db.map((v, i) => v - target[i]);
  const stdBefore = std(base);
  const filters: PeqFilter[] = [];
  // Подбор ведётся по сглаженной кривой (как в REW): узкие пики одной точки не «вырезаются» до дна
  const raw = base.slice();
  let cur = smoothLog(freqs, raw, smoothOct);
  let actual = raw.slice();
  for (let k = 0; k < maxFilters; k++) {
    const ref = median(cur);
    let im = 0;
    for (let i = 1; i < n; i++) if (cur[i] - ref > cur[im] - ref) im = i;
    const peak = cur[im] - ref;
    if (peak < threshold) break;
    const half = ref + peak / 2;
    let lo = im, hi = im;
    while (lo > 0 && cur[lo] > half) lo--;
    while (hi < n - 1 && cur[hi] > half) hi++;
    const bw = Math.max(Math.log2(freqs[hi] / freqs[lo]), 1 / 24);
    const p = Math.pow(2, bw);
    const q = Math.min(12, Math.max(0.7, Math.sqrt(p) / (p - 1)));
    const filter = { f: round(freqs[im], 1), gainDb: round(-Math.min(maxCut, 0.9 * peak), 1), q: round(q, 2) };
    // фильтр, не дающий улучшения, не добавляем
    const trial = cur.map((v, i) => v + peqGainDb(filter, freqs[i]));
    if (std(trial) >= std(cur) - 1e-6) break;
    filters.push(filter);
    cur = trial;
    actual = actual.map((v, i) => v + peqGainDb(filter, freqs[i]));
  }
  const dips: EqResult['dips'] = [];
  const refEnd = median(cur);
  for (let i = 1; i < n - 1; i++) {
    const d = cur[i] - refEnd;
    if (d < -6 && cur[i] <= cur[i - 1] && cur[i] <= cur[i + 1]) dips.push({ f: round(freqs[i], 1), depth: round(d, 1) });
  }
  return {
    filters,
    after: actual.map((v, i) => v + target[i]),
    stdBefore,
    stdAfter: std(actual),
    dips,
  };
}

/** Сглаживание в окне ±oct/2 по логарифму частоты (среднее в дБ). */
export function smoothLog(freqs: number[], v: number[], oct: number): number[] {
  if (!(oct > 0)) return v.slice();
  const k = Math.pow(2, oct / 2);
  return freqs.map((f) => {
    let s = 0, n = 0;
    for (let j = 0; j < freqs.length; j++) if (freqs[j] >= f / k && freqs[j] <= f * k) { s += v[j]; n++; }
    return n ? s / n : 0;
  });
}

const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;

/** Коэффициенты биквада (нормированы по a0) для частоты дискретизации fs. */
export function biquad(p: PeqFilter, fs: number) {
  const A = Math.pow(10, p.gainDb / 40);
  const w0 = (2 * Math.PI * p.f) / fs;
  const alpha = Math.sin(w0) / (2 * p.q);
  const cosw = Math.cos(w0);
  const a0 = 1 + alpha / A;
  return {
    b0: (1 + alpha * A) / a0,
    b1: (-2 * cosw) / a0,
    b2: (1 - alpha * A) / a0,
    a1: (-2 * cosw) / a0,
    a2: (1 - alpha / A) / a0,
  };
}

const fx = (v: number, d: number) => v.toFixed(d);

export function exportEqualizerAPO(filters: PeqFilter[]): string {
  const lines = ['Preamp: 0 dB'];
  filters.forEach((p, i) => lines.push(`Filter ${i + 1}: ON PK Fc ${fx(p.f, 1)} Hz Gain ${fx(p.gainDb, 1)} dB Q ${fx(p.q, 2)}`));
  return lines.join('\n') + '\n';
}

export function exportREW(filters: PeqFilter[]): string {
  const lines = ['Filter Settings file', '', 'Room EQ V5', 'Equaliser: Generic', ''];
  filters.forEach((p, i) =>
    lines.push(`Filter ${String(i + 1).padStart(2)}: ON  PK       Fc ${fx(p.f, 2).padStart(8)} Hz  Gain ${fx(p.gainDb, 2).padStart(6)} dB  Q ${fx(p.q, 3).padStart(6)}`),
  );
  return lines.join('\n') + '\n';
}

/** Формат miniDSP (Advanced biquad programming): a1 и a2 со сменой знака. */
export function exportMiniDSP(filters: PeqFilter[], fs: number): string {
  return filters
    .map((p, i) => {
      const c = biquad(p, fs);
      return [`biquad${i + 1},`, `b0=${c.b0.toPrecision(15)},`, `b1=${c.b1.toPrecision(15)},`, `b2=${c.b2.toPrecision(15)},`, `a1=${(-c.a1).toPrecision(15)},`, `a2=${(-c.a2).toPrecision(15)}`].join('\n');
    })
    .join(',\n') + '\n';
}
