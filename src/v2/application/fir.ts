// FIR и комплексная фазовая коррекция (V2-053, экспертный уровень). FIR по комплексной характеристике h(f):
// минимальная фаза (кепстр), линейная (|H| с задержкой n/2) или смешанная (ниже частоты раздела — минимальная, выше —
// линейная, общая задержка τ). Корректор: C = M·e^{−j·w·φ_H}·e^{−jωτ}, w — 1 в полосе коррекции с косинусными
// краями в треть октавы; M — регуляризованное обращение модуля a/(a² + β) с ограничением подъёма. Обрезка
// длиной n и окно Тьюки — реальные ограничения: результат проверяется по характеристике самого FIR, а не цели.
import { fft } from '../../core/dsp';
import type { Complex } from '../../core/types';

const TAU = 2 * Math.PI;
const FLOOR = 1e-6;

export type FirPhase = 'minimum' | 'linear' | 'mixed';
export const FIR_LENGTHS = [1024, 2048, 4096, 8192, 16384, 32768, 65536] as const;

/** Бин k → частота; на нулевом бине — четверть шага (у ФВЧ на 0 Гц деление на ноль). */
const binF = (k: number, n: number, fs: number) => (k === 0 ? fs / n / 4 : (k * fs) / n);

const tukey = (i: number, n: number, taper: number, endOnly: boolean) => {
  const m = Math.max(1, Math.floor(n * taper));
  if (!endOnly && i < m) return 0.5 * (1 - Math.cos((Math.PI * i) / m));
  if (i >= n - m) return 0.5 * (1 + Math.cos((Math.PI * (i - (n - m))) / m));
  return 1;
};

/** Минимально-фазовый логарифм спектра по модулю (кепстр): re — ln|H|, im — непрерывная минимальная фаза, бины 0…n/2. */
function minPhaseLog(mag: Float64Array, n: number): { lnMag: Float64Array; phase: Float64Array } {
  const re = new Float64Array(n), im = new Float64Array(n);
  for (let k = 0; k <= n / 2; k++) {
    const v = Math.log(Math.max(FLOOR, mag[k]));
    re[k] = v;
    if (k > 0 && k < n / 2) re[n - k] = v;
  }
  fft(re, im, true);
  for (let i = 1; i < n / 2; i++) { re[i] *= 2; im[i] *= 2; }
  for (let i = n / 2 + 1; i < n; i++) { re[i] = 0; im[i] = 0; }
  fft(re, im);
  return { lnMag: re.slice(0, n / 2 + 1), phase: im.slice(0, n / 2 + 1) };
}

/** Отсчёты по половине спектра (бины 0…n/2): эрмитово дополнение, обратное БПФ, окно. */
function taps(mag: Float64Array, phase: Float64Array, n: number, endOnly: boolean): Float64Array {
  const re = new Float64Array(n), im = new Float64Array(n);
  for (let k = 0; k <= n / 2; k++) {
    re[k] = mag[k] * Math.cos(phase[k]);
    im[k] = k === 0 || k === n / 2 ? 0 : mag[k] * Math.sin(phase[k]);
    if (k > 0 && k < n / 2) { re[n - k] = re[k]; im[n - k] = -im[k]; }
  }
  fft(re, im, true);
  for (let i = 0; i < n; i++) re[i] *= tukey(i, n, 0.05, endOnly);
  return re;
}

export interface FirDesign {
  taps: Float64Array;
  fs: number;
  /** Задержка, которую вносит фильтр (для минимальной фазы — положение пика), отсчётов и мс. */
  delaySamples: number;
  latencyMs: number;
  /** Энергия раньше пика более чем на 1 мс относительно всей, дБ; null — практически нет. */
  preRingDb: number | null;
}

function preRing(h: Float64Array, fs: number): { peak: number; db: number | null } {
  let peak = 0;
  for (let i = 1; i < h.length; i++) if (Math.abs(h[i]) > Math.abs(h[peak])) peak = i;
  const edge = Math.max(0, peak - Math.round(fs / 1000));
  let pre = 0, all = 0;
  h.forEach((v, i) => { all += v * v; if (i < edge) pre += v * v; });
  const db = all > 0 && pre > 0 ? 10 * Math.log10(pre / all) : -Infinity;
  return { peak, db: db < -80 ? null : db };
}

/** Плавный переход 0 → 1 в логарифме частоты: 0 ниже lo, 1 выше hi. */
const ramp = (f: number, lo: number, hi: number) => (f <= lo ? 0 : f >= hi ? 1 : 0.5 - 0.5 * Math.cos((Math.PI * Math.log(f / lo)) / Math.log(hi / lo)));

export function designFir(h: (f: number) => Complex, o: { n: number; fs: number; phase: FirPhase; splitHz?: number; delaySamples?: number }): FirDesign {
  const { n, fs } = o;
  const mag = new Float64Array(n / 2 + 1);
  for (let k = 0; k <= n / 2; k++) { const v = h(binF(k, n, fs)); mag[k] = Math.hypot(v.re, v.im); }
  let out: Float64Array;
  let delay: number;
  if (o.phase === 'minimum') {
    const m = minPhaseLog(mag, n);
    out = taps(m.lnMag.map(Math.exp), m.phase, n, true);
    delay = preRing(out, fs).peak;
  } else {
    delay = Math.round(Math.min(n / 2, Math.max(0, o.delaySamples ?? n / 2)));
    const lin = (k: number) => (-TAU * k * delay) / n;
    if (o.phase === 'linear') out = taps(mag, Float64Array.from(mag, (_, k) => lin(k)), n, false);
    else {
      const m = minPhaseLog(mag, n);
      const split = o.splitHz ?? 200;
      const ph = Float64Array.from(mag, (_, k) => (1 - ramp(binF(k, n, fs), split / Math.SQRT2, split * Math.SQRT2)) * m.phase[k] + lin(k));
      out = taps(m.lnMag.map(Math.exp), ph, n, false);
    }
  }
  const pr = preRing(out, fs);
  return { taps: out, fs, delaySamples: delay, latencyMs: (delay / fs) * 1000, preRingDb: o.phase === 'minimum' ? null : pr.db };
}

/** Характеристика FIR на частоте f — прямая сумма с вращающимся фазором. */
export function firAt(h: ArrayLike<number>, f: number, fs: number): Complex {
  const w = (TAU * f) / fs, cr = Math.cos(w), ci = -Math.sin(w);
  let pr = 1, pi = 0, re = 0, im = 0;
  for (let i = 0; i < h.length; i++) {
    re += h[i] * pr; im += h[i] * pi;
    const t = pr * cr - pi * ci; pi = pr * ci + pi * cr; pr = t;
  }
  return { re, im };
}

const cmul = (a: Complex, b: Complex): Complex => ({ re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re });
const db = (v: Complex) => 20 * Math.log10(Math.max(1e-12, Math.hypot(v.re, v.im)));
const deg = (v: Complex) => (Math.atan2(v.im, v.re) * 180) / Math.PI;
/** Поворот на +ωτ (убрать чистую задержку τ отсчётов). */
const undelay = (v: Complex, f: number, fs: number, d: number): Complex => { const a = (TAU * f * d) / fs; return cmul(v, { re: Math.cos(a), im: Math.sin(a) }); };

/** Групповая задержка, мс, по значениям на f·(1 ± δ). */
const gdMs = (fn: (f: number) => Complex, f: number) => {
  const d = 1e-5, a = fn(f * (1 - d)), b = fn(f * (1 + d));
  const r = { re: b.re * a.re + b.im * a.im, im: b.im * a.re - b.re * a.im };
  return (-Math.atan2(r.im, r.re) / (TAU * 2 * d * f)) * 1000;
};

/** Сравнение FIR с целью: уровень, фаза без задержки FIR, групповая задержка. */
export function firCheck(target: (f: number) => Complex, d: FirDesign, freqs: readonly number[]) {
  return freqs.map((f) => {
    const t = target(f), v = firAt(d.taps, f, d.fs);
    return { f, targetDb: db(t), firDb: db(v), errDb: db(v) - db(t), firPhaseDeg: deg(undelay(v, f, d.fs, d.delaySamples)), firGdMs: gdMs((x) => firAt(d.taps, x, d.fs), f) - d.latencyMs };
  });
}

// ---------- Комплексная коррекция ----------

export interface CorrectorOptions {
  n: number;
  fs: number;
  /** Полоса коррекции, Гц. */
  f1: number;
  f2: number;
  delaySamples: number;
  /** Исправлять и модуль (регуляризованное обращение), а не только фазу. */
  magnitude: boolean;
  /** Регуляризация β = 10^(−reg/10): наибольший подъём обращения 1/(2√β). */
  regDb: number;
  maxBoostDb: number;
}

/** Непрерывная фаза h на бинах 0…n/2 (разворачивание по соседним бинам). */
function unwrappedPhase(h: (f: number) => Complex, n: number, fs: number) {
  const ph = new Float64Array(n / 2 + 1), mag = new Float64Array(n / 2 + 1);
  let prev = 0;
  for (let k = 0; k <= n / 2; k++) {
    const v = h(binF(k, n, fs));
    mag[k] = Math.hypot(v.re, v.im);
    let p = Math.atan2(v.im, v.re);
    if (k > 0) p += TAU * Math.round((prev - p) / TAU);
    ph[k] = p; prev = p;
  }
  return { ph, mag };
}

/** Опорный уровень в полосе: среднее по логарифму частоты значение |H| в дБ. */
function refLevel(mag: Float64Array, n: number, fs: number, f1: number, f2: number) {
  let s = 0, w = 0;
  for (let k = 1; k <= n / 2; k++) {
    const f = binF(k, n, fs);
    if (f < f1 || f > f2) continue;
    s += (20 * Math.log10(Math.max(FLOOR, mag[k]))) / f; w += 1 / f;
  }
  return w ? 10 ** (s / w / 20) : 1;
}

export function corrector(h: (f: number) => Complex, o: CorrectorOptions): FirDesign & { ref: number } {
  const { n, fs, f1, f2 } = o;
  const { ph, mag } = unwrappedPhase(h, n, fs);
  const ref = refLevel(mag, n, fs, f1, f2);
  const beta = 10 ** (-o.regDb / 10), cap = 10 ** (o.maxBoostDb / 20);
  const third = 2 ** (1 / 3);
  const cm = new Float64Array(n / 2 + 1), cp = new Float64Array(n / 2 + 1);
  for (let k = 0; k <= n / 2; k++) {
    const f = binF(k, n, fs);
    const w = Math.min(ramp(f, f1 / third, f1), 1 - ramp(f, f2, f2 * third));
    let m = 1;
    if (o.magnitude) {
      const a = mag[k] / ref;
      m = Math.min(cap, a / (a * a + beta)) ** w;
    }
    cm[k] = m;
    cp[k] = -w * ph[k] - (TAU * k * o.delaySamples) / n;
  }
  const out = taps(cm, cp, n, false);
  const pr = preRing(out, fs);
  return { taps: out, fs, delaySamples: o.delaySamples, latencyMs: (o.delaySamples / fs) * 1000, preRingDb: pr.db, ref };
}

/** До и после коррекции: уровень (относительно опорного), остаток фазы без задержки, групповая задержка. */
export function correctionCheck(h: (f: number) => Complex, c: FirDesign & { ref: number }, freqs: readonly number[]) {
  const after = (f: number) => cmul(h(f), firAt(c.taps, f, c.fs));
  return freqs.map((f) => {
    const b = h(f), a = after(f);
    return {
      f,
      beforeDb: db(b) - 20 * Math.log10(c.ref), afterDb: db(a) - 20 * Math.log10(c.ref),
      beforePhaseDeg: deg(b), afterPhaseDeg: deg(undelay(a, f, c.fs, c.delaySamples)),
      beforeGdMs: gdMs(h, f), afterGdMs: gdMs(after, f) - c.latencyMs,
    };
  });
}

// ---------- Замер с фазой из файла ----------

export interface PhaseData { f: number[]; db: number[]; phaseRad: number[] }

/**
 * Текст «частота, уровень, фаза в градусах» (экспорт REW «Measurement as text» и похожие): строки с `*`, `#`, `;` —
 * комментарии; разделители — пробелы, табуляция, запятая или точка с запятой; десятичная запятая допустима при
 * разделителе «;» или табуляции. Фаза разворачивается.
 */
export function parsePhaseText(text: string): PhaseData | { error: string } {
  const rows: [number, number, number][] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || /^[*#;]/.test(line)) continue;
    const parts = (/[;\t]/.test(line) ? line.split(/[;\t]+/).map((x) => x.replace(',', '.')) : line.split(/[\s,]+/)).map((x) => Number(x.trim()));
    if (parts.length < 3 || parts.slice(0, 3).some((x) => !Number.isFinite(x))) continue;
    if (parts[0] > 0) rows.push([parts[0], parts[1], parts[2]]);
  }
  if (rows.length < 10) return { error: 'В файле нет трёх столбцов «частота, уровень, фаза» хотя бы в 10 строках. Нужен замер с фазой (например, экспорт REW «Measurement as text»).' };
  rows.sort((a, b) => a[0] - b[0]);
  const f: number[] = [], dbs: number[] = [], ph: number[] = [];
  let prev = 0;
  rows.forEach(([x, y, p], i) => {
    if (i && x === f[f.length - 1]) return;
    let r = (p * Math.PI) / 180;
    if (f.length) r += TAU * Math.round((prev - r) / TAU);
    f.push(x); dbs.push(y); ph.push(r); prev = r;
  });
  return { f, db: dbs, phaseRad: ph };
}

/** Задержка прихода, мс: наклон фазы по ω на верхней октаве данных (наименьшие квадраты). */
export function arrivalDelayMs(d: PhaseData): number {
  const top = d.f[d.f.length - 1];
  let sx = 0, sy = 0, sxx = 0, sxy = 0, m = 0;
  d.f.forEach((f, i) => {
    if (f < top / 2) return;
    const x = TAU * f, y = d.phaseRad[i];
    sx += x; sy += y; sxx += x * x; sxy += x * y; m++;
  });
  if (m < 2) return 0;
  const slope = (m * sxy - sx * sy) / (m * sxx - sx * sx);
  return -slope * 1000;
}

/** Комплексная характеристика по данным: интерполяция уровня и фазы по логарифму частоты, за краями — крайние значения; задержка вычитается. */
export function phaseDataAt(d: PhaseData, removeMs: number): (f: number) => Complex {
  return (f) => {
    let dbv: number, ph: number;
    const n = d.f.length;
    if (f <= d.f[0]) { dbv = d.db[0]; ph = d.phaseRad[0] + TAU * d.f[0] * (removeMs / 1000); }
    else if (f >= d.f[n - 1]) { dbv = d.db[n - 1]; ph = d.phaseRad[n - 1] + TAU * d.f[n - 1] * (removeMs / 1000); }
    else {
      let lo = 0, hi = n - 1;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (d.f[m] <= f) lo = m; else hi = m; }
      const t = Math.log(f / d.f[lo]) / Math.log(d.f[hi] / d.f[lo]);
      dbv = d.db[lo] + t * (d.db[hi] - d.db[lo]);
      ph = d.phaseRad[lo] + t * (d.phaseRad[hi] - d.phaseRad[lo]) + TAU * f * (removeMs / 1000);
    }
    const a = 10 ** (dbv / 20);
    return { re: a * Math.cos(ph), im: a * Math.sin(ph) };
  };
}

/** Коэффициенты FIR текстом: по одному в строке (CamillaDSP, convolver и т. п.). */
export const firText = (h: ArrayLike<number>) => Array.from(h, (v) => v.toPrecision(9)).join('\n') + '\n';
