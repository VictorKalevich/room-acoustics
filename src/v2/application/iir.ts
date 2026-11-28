// Пользовательские IIR (V2-053, экспертный уровень): аналоговые прототипы фильтров кроссовера — Баттерворт, Бессель,
// Чебышёв I и II, эллиптический (Кауэр) — нулями и полюсами; звенья цепочки сверх RBJ — усиление, задержка, полярность,
// свой биквад; групповая задержка и экспорт цепочки. Эллиптический — по алгоритму Orfanidis («Lecture Notes on
// Elliptic Filter Design», 2006): эллиптические функции Якоби через спуск Ландена. Все семейства, кроме
// Linkwitz–Riley, нормированы на −3 дБ на частоте раздела; LR — квадрат Баттерворта (−6 дБ), как в V2-040.
import type { Complex } from '../../core/types';
import { CROSSOVER_ORDERS, EQ_TYPES, biquadAt, crossoverFilter, eqIssues, rbj, stable, type Biquad, type CrossoverFamily, type EqFilter } from './tools';

const TAU = 2 * Math.PI;
type C = Complex;
const cx = (re: number, im = 0): C => ({ re, im });
const add = (a: C, b: C): C => ({ re: a.re + b.re, im: a.im + b.im });
const sub = (a: C, b: C): C => ({ re: a.re - b.re, im: a.im - b.im });
const mul = (a: C, b: C): C => ({ re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re });
const div = (a: C, b: C): C => { const d = b.re * b.re + b.im * b.im; return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d }; };
const scale = (a: C, k: number): C => ({ re: a.re * k, im: a.im * k });
const abs = (a: C) => Math.hypot(a.re, a.im);
const sqrt = (a: C): C => { const r = abs(a); const re = Math.sqrt((r + a.re) / 2); const im = Math.sqrt(Math.max(0, (r - a.re) / 2)); return { re, im: a.im < 0 ? -im : im }; };
const ccos = (a: C): C => ({ re: Math.cos(a.re) * Math.cosh(a.im), im: -Math.sin(a.re) * Math.sinh(a.im) });
const csin = (a: C): C => ({ re: Math.sin(a.re) * Math.cosh(a.im), im: Math.cos(a.re) * Math.sinh(a.im) });
const clog = (a: C): C => ({ re: Math.log(abs(a)), im: Math.atan2(a.im, a.re) });
/** acos(w) = −j·ln(w + j·√(1 − w²)). */
const cacos = (w: C): C => { const l = clog(add(w, mul(cx(0, 1), sqrt(sub(cx(1), mul(w, w)))))); return { re: l.im, im: -l.re }; };

// ---------- Эллиптические функции Якоби (спуск Ландена, Orfanidis) ----------

function landen(k: number, M = 7): number[] {
  const v: number[] = [];
  for (let i = 0; i < M; i++) { k = (k / (1 + Math.sqrt(1 - k * k))) ** 2; v.push(k); }
  return v;
}
/** cd(uK, k) и sn(uK, k) для комплексного u (K — полный эллиптический интеграл). */
function ascend(w: C, k: number): C {
  const v = landen(k);
  for (let i = v.length - 1; i >= 0; i--) w = div(scale(w, 1 + v[i]), add(cx(1), scale(mul(w, w), v[i])));
  return w;
}
const cde = (u: C, k: number): C => ascend(ccos(scale(u, Math.PI / 2)), k);
const sne = (u: C, k: number): C => ascend(csin(scale(u, Math.PI / 2)), k);
function acde(w: C, k: number): C {
  const v = landen(k);
  let prev = k;
  for (const vn of v) {
    w = scale(div(w, add(cx(1), sqrt(sub(cx(1), scale(mul(w, w), prev * prev))))), 2 / (1 + vn));
    prev = vn;
  }
  return scale(cacos(w), 2 / Math.PI);
}
const asne = (w: C, k: number): C => sub(cx(1), acde(w, k));

// ---------- Аналоговые прототипы ФНЧ (ωc = 1) ----------

export interface Prototype { zeros: C[]; poles: C[]; gain: number }

export const protoAt = (p: Prototype, s: C): C => {
  let h = cx(p.gain);
  for (const z of p.zeros) h = mul(h, sub(s, z));
  for (const q of p.poles) h = div(h, sub(s, q));
  return h;
};
/** Коэффициент усиления, при котором H(0) = h0. */
const dcGain = (zeros: C[], poles: C[], h0: number) => {
  let g = cx(h0);
  for (const q of poles) g = mul(g, scale(q, -1));
  for (const z of zeros) g = div(g, scale(z, -1));
  return g.re;
};

/** Корни многочлена (коэффициенты от старшей степени) методом Дюрана–Кернера. */
function roots(coef: number[]): C[] {
  const n = coef.length - 1;
  const a = coef.map((x) => x / coef[0]);
  const seed = cx(0.4, 0.9);
  let z = Array.from({ length: n }, (_, i) => { let v = cx(1); for (let j = 0; j <= i; j++) v = mul(v, seed); return v; });
  for (let it = 0; it < 500; it++) {
    let moved = 0;
    z = z.map((zi, i) => {
      let p = cx(1);
      for (let j = 1; j <= n; j++) p = add(mul(p, zi), cx(a[j]));
      let d = cx(1);
      z.forEach((zj, j) => { if (j !== i) d = mul(d, sub(zi, zj)); });
      const step = div(p, d);
      moved = Math.max(moved, abs(step));
      return sub(zi, step);
    });
    if (moved < 1e-14) break;
  }
  return z;
}

const fact = (n: number): number => (n <= 1 ? 1 : n * fact(n - 1));

export function butterworthProto(N: number): Prototype {
  const poles = Array.from({ length: N }, (_, k) => { const t = (Math.PI * (2 * k + 1 + N)) / (2 * N); return cx(Math.cos(t), Math.sin(t)); });
  return { zeros: [], poles, gain: dcGain([], poles, 1) };
}

/** Бессель: корни обратного многочлена Бесселя (нормировка по задержке: τ(0) = 1 с). */
export function besselProto(N: number): Prototype {
  const coef = Array.from({ length: N + 1 }, (_, i) => { const k = N - i; return fact(2 * N - k) / (2 ** (N - k) * fact(k) * fact(N - k)); });
  const poles = roots(coef);
  return { zeros: [], poles, gain: dcGain([], poles, 1) };
}

/** Чебышёв I: пульсации rp дБ в полосе пропускания, на ω = 1 уровень −rp. */
export function chebyshev1Proto(N: number, rp: number): Prototype {
  const eps = Math.sqrt(10 ** (rp / 10) - 1), mu = Math.asinh(1 / eps) / N;
  const poles = Array.from({ length: N }, (_, k) => { const t = (Math.PI * (2 * k + 1)) / (2 * N); return cx(-Math.sinh(mu) * Math.sin(t), Math.cosh(mu) * Math.cos(t)); });
  return { zeros: [], poles, gain: dcGain([], poles, N % 2 ? 1 : 1 / Math.sqrt(1 + eps * eps)) };
}

/** Чебышёв II: подавление as дБ в полосе задерживания, начиная с ω = 1. */
export function chebyshev2Proto(N: number, as: number): Prototype {
  const eps = 1 / Math.sqrt(10 ** (as / 10) - 1), mu = Math.asinh(1 / eps) / N;
  const poles: C[] = [], zeros: C[] = [];
  for (let k = 0; k < N; k++) {
    const t = (Math.PI * (2 * k + 1)) / (2 * N);
    poles.push(div(cx(1), cx(-Math.sinh(mu) * Math.sin(t), Math.cosh(mu) * Math.cos(t))));
    if (Math.abs(Math.cos(t)) > 1e-12) zeros.push(cx(0, 1 / Math.cos(t)));
  }
  return { zeros, poles, gain: dcGain(zeros, poles, 1) };
}

/** Эллиптический: пульсации rp дБ до ω = 1, подавление не менее as дБ выше ω = 1/k (k — из уравнения степени). */
export function ellipticProto(N: number, rp: number, as: number): Prototype & { k: number } {
  const ep = Math.sqrt(10 ** (rp / 10) - 1), es = Math.sqrt(10 ** (as / 10) - 1);
  const k1 = ep / es, k1p = Math.sqrt(1 - k1 * k1);
  const L = Math.floor(N / 2);
  const ui = Array.from({ length: L }, (_, i) => (2 * i + 1) / N);
  const kp = k1p ** N * ui.reduce((p, u) => p * sne(cx(u), k1p).re ** 4, 1);
  const k = Math.sqrt(1 - kp * kp);
  const zeros: C[] = [], poles: C[] = [];
  const v0 = scale(mul(cx(0, -1), asne(cx(0, 1 / ep), k1)), 1 / N);
  for (const u of ui) {
    const zeta = cde(cx(u), k).re;
    zeros.push(cx(0, 1 / (k * zeta)), cx(0, -1 / (k * zeta)));
    const p = mul(cx(0, 1), cde(sub(cx(u), mul(cx(0, 1), v0)), k));
    poles.push(p, { re: p.re, im: -p.im });
  }
  if (N % 2) poles.push(mul(cx(0, 1), sne(mul(cx(0, 1), v0), k)));
  return { zeros, poles, gain: dcGain(zeros, poles, N % 2 ? 1 : 1 / Math.sqrt(1 + ep * ep)), k };
}

/** Частота, где |H(jω)| = −3 дБ (ниже первой полосы задерживания), — для нормировки. */
function minus3(p: Prototype): number {
  const target = 1 / Math.SQRT2;
  let lo = 1e-3, hi = 1e-3;
  while (abs(protoAt(p, cx(0, hi))) > target && hi < 1e3) { lo = hi; hi *= 1.05; }
  for (let i = 0; i < 80; i++) { const m = Math.sqrt(lo * hi); if (abs(protoAt(p, cx(0, m))) > target) lo = m; else hi = m; }
  return Math.sqrt(lo * hi);
}

// ---------- Кроссовер всех семейств ----------

export type XoverFamily = CrossoverFamily | 'bessel' | 'chebyshev1' | 'chebyshev2' | 'elliptic';
export const XOVER_ORDERS: Record<XoverFamily, readonly number[]> = {
  ...CROSSOVER_ORDERS, bessel: [2, 3, 4], chebyshev1: [2, 3, 4, 5, 6], chebyshev2: [2, 3, 4, 5, 6], elliptic: [2, 3, 4, 5, 6],
};
export const XOVER_LABEL: Record<XoverFamily, string> = {
  'linkwitz-riley': 'Linkwitz–Riley', butterworth: 'Butterworth', bessel: 'Bessel', chebyshev1: 'Чебышёв I', chebyshev2: 'Чебышёв II', elliptic: 'Эллиптический',
};
export interface XoverParams { ripple: number; attenuation: number }
export const XOVER_DEFAULTS: XoverParams = { ripple: 0.5, attenuation: 40 };
/** Пульсации — Чебышёв I и эллиптический; подавление — Чебышёв II и эллиптический. */
export const usesRipple = (f: XoverFamily) => f === 'chebyshev1' || f === 'elliptic';
export const usesAttenuation = (f: XoverFamily) => f === 'chebyshev2' || f === 'elliptic';

export function xoverIssues(family: XoverFamily, order: number, p: XoverParams): string[] {
  const out: string[] = [];
  if (!XOVER_ORDERS[family].includes(order)) out.push(`Порядок ${order} недопустим для семейства ${XOVER_LABEL[family]}.`);
  if (usesRipple(family) && !(p.ripple >= 0.01 && p.ripple <= 2)) out.push('Пульсации — от 0,01 до 2 дБ.');
  if (usesAttenuation(family) && !(p.attenuation >= 20 && p.attenuation <= 100)) out.push('Подавление — от 20 до 100 дБ.');
  if (family === 'elliptic' && p.attenuation <= p.ripple + 10) out.push('Подавление должно быть больше пульсаций хотя бы на 10 дБ.');
  return out;
}

const protoCache = new Map<string, { p: Prototype; w3: number }>();
/** Нормированный прототип семейства (−3 дБ на ω = 1). */
export function xoverPrototype(family: Exclude<XoverFamily, CrossoverFamily>, order: number, p: XoverParams): Prototype {
  const key = `${family}|${order}|${p.ripple}|${p.attenuation}`;
  let hit = protoCache.get(key);
  if (!hit) {
    const raw = family === 'bessel' ? besselProto(order) : family === 'chebyshev1' ? chebyshev1Proto(order, p.ripple) : family === 'chebyshev2' ? chebyshev2Proto(order, p.attenuation) : ellipticProto(order, p.ripple, p.attenuation);
    const w3 = minus3(raw);
    const zeros = raw.zeros.map((z) => scale(z, 1 / w3)), poles = raw.poles.map((q) => scale(q, 1 / w3));
    hit = { p: { zeros, poles, gain: raw.gain * w3 ** (raw.zeros.length - raw.poles.length) }, w3 };
    if (protoCache.size > 64) protoCache.clear();
    protoCache.set(key, hit);
  }
  return hit.p;
}

/** Электрический фильтр полосы: ФНЧ — s = jf/fc, ФВЧ — s = fc/(jf) (замена s → 1/s). */
export function xoverFilter(family: XoverFamily, order: number, p: XoverParams, type: 'lp' | 'hp', fc: number, f: number): C {
  if (family === 'butterworth' || family === 'linkwitz-riley') return crossoverFilter(family, order, type, fc, f);
  const s = type === 'lp' ? cx(0, f / fc) : cx(0, -fc / f);
  return protoAt(xoverPrototype(family, order, p), s);
}

export function xoverSum(family: XoverFamily, order: number, p: XoverParams, fc: number, f: number, invertHigh: boolean): C {
  const lp = xoverFilter(family, order, p, 'lp', fc, f), hp = xoverFilter(family, order, p, 'hp', fc, f);
  return invertHigh ? sub(lp, hp) : add(lp, hp);
}

// ---------- Групповая задержка ----------

/** Групповая задержка −dφ/dω, мс, — по отношению значений на f·(1 ± δ) (без разворачивания фазы). */
export function groupDelayMs(h: (f: number) => C, f: number): number {
  const d = 1e-6;
  const a = h(f * (1 - d)), b = h(f * (1 + d));
  const r = div(b, a);
  return (-Math.atan2(r.im, r.re) / (TAU * 2 * d * f)) * 1000;
}

// ---------- Звенья цепочки сверх RBJ ----------

export type ExtraType = 'gain' | 'delay' | 'polarity' | 'biquad';
export const EXTRA_TYPES: readonly ExtraType[] = ['gain', 'delay', 'polarity', 'biquad'];
export interface ChainExtra { id: string; type: ExtraType; enabled: boolean; gainDb: number; ms: number; coeffs: Biquad }
export type ChainItem = EqFilter | ChainExtra;

export const isEq = (x: ChainItem): x is EqFilter => (EQ_TYPES as readonly string[]).includes(x.type);
export const newExtra = (id: string, type: ExtraType): ChainExtra => ({ id, type, enabled: true, gainDb: 0, ms: 1, coeffs: { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 } });

export function itemIssues(x: ChainItem, fs: number): string[] {
  if (isEq(x)) return eqIssues(x, fs);
  const c = x.coeffs;
  if (x.type === 'biquad' && ![c.b0, c.b1, c.b2, c.a1, c.a2].every(Number.isFinite)) return ['Коэффициенты должны быть числами.'];
  if (x.type === 'biquad' && !stable(c)) return ['Фильтр неустойчив: полюсы вне единичного круга (нужно |a2| < 1 и |a1| < 1 + a2).'];
  if (x.type === 'delay' && !(x.ms >= 0 && x.ms <= 1000)) return ['Задержка — от 0 до 1000 мс.'];
  return [];
}

/** Комплексная характеристика одного звена; неверное звено не учитывается (единица). */
export function itemAt(x: ChainItem, f: number, fs: number): C {
  if (!x.enabled || itemIssues(x, fs).length) return cx(1);
  if (isEq(x)) return biquadAt(rbj(x, fs), f, fs);
  if (x.type === 'gain') return cx(10 ** (x.gainDb / 20));
  if (x.type === 'polarity') return cx(-1);
  if (x.type === 'delay') { const ph = -TAU * f * (x.ms / 1000); return cx(Math.cos(ph), Math.sin(ph)); }
  return biquadAt(x.coeffs, f, fs);
}

export const chainAt = (items: readonly ChainItem[], f: number, fs: number): C => items.reduce<C>((h, x) => mul(h, itemAt(x, f, fs)), cx(1));

export function chainResponse(items: readonly ChainItem[], freqs: readonly number[], fs: number) {
  const h = (f: number) => chainAt(items, f, fs);
  return freqs.map((f) => {
    const v = h(f);
    return { db: 20 * Math.log10(Math.max(1e-12, abs(v))), phaseDeg: (Math.atan2(v.im, v.re) * 180) / Math.PI, gdMs: groupDelayMs(h, f) };
  });
}

const APO_TYPE: Record<EqFilter['type'], string> = { peaking: 'PK', lowshelf: 'LSC', highshelf: 'HSC', lowpass: 'LPQ', highpass: 'HPQ', bandpass: 'BP', notch: 'NO', allpass: 'AP' };
const g15 = (v: number) => v.toPrecision(15);

/**
 * Equalizer APO в порядке цепочки: RBJ — как в V2-040; усиление — `Preamp`, задержка — `Delay`, полярность и свой биквад —
 * `IIR Order … Coefficients b… a…` (a0 = 1). Отключённые звенья — OFF или комментарий.
 */
export function exportApoChain(items: readonly ChainItem[], preampDb: number): string {
  const lines = [`Preamp: ${preampDb.toFixed(1)} dB`];
  items.forEach((x, i) => {
    const on = x.enabled ? 'ON' : 'OFF';
    if (isEq(x)) lines.push(`Filter ${i + 1}: ${on} ${APO_TYPE[x.type]} Fc ${x.f.toFixed(1)} Hz${x.type === 'peaking' || x.type === 'lowshelf' || x.type === 'highshelf' ? ` Gain ${x.gainDb.toFixed(1)} dB` : ''} Q ${x.q.toFixed(3)}`);
    else if (x.type === 'gain') lines.push(`${x.enabled ? '' : '# '}Preamp: ${x.gainDb.toFixed(2)} dB`);
    else if (x.type === 'delay') lines.push(`${x.enabled ? '' : '# '}Delay: ${x.ms.toFixed(3)} ms`);
    else if (x.type === 'polarity') lines.push(`Filter ${i + 1}: ${on} IIR Order 1 Coefficients -1 0 1 0`);
    else lines.push(`Filter ${i + 1}: ${on} IIR Order 2 Coefficients ${[x.coeffs.b0, x.coeffs.b1, x.coeffs.b2, 1, x.coeffs.a1, x.coeffs.a2].map(g15).join(' ')}`);
  });
  return lines.join('\n') + '\n';
}

/** Коэффициенты биквадов (miniDSP и др.: a1, a2 со сменой знака) для всего, что сводится к биквадам; задержки — отдельно. */
export function exportChainBiquads(items: readonly ChainItem[], fs: number): { text: string; delays: number[] } {
  const delays: number[] = [];
  const blocks: string[] = [];
  for (const x of items) {
    if (!x.enabled || itemIssues(x, fs).length) continue;
    if (!isEq(x) && x.type === 'delay') { delays.push(x.ms); continue; }
    const c: Biquad = isEq(x) ? rbj(x, fs) : x.type === 'gain' ? { b0: 10 ** (x.gainDb / 20), b1: 0, b2: 0, a1: 0, a2: 0 } : x.type === 'polarity' ? { b0: -1, b1: 0, b2: 0, a1: 0, a2: 0 } : x.coeffs;
    const n = blocks.length + 1;
    blocks.push([`biquad${n},`, `b0=${g15(c.b0)},`, `b1=${g15(c.b1)},`, `b2=${g15(c.b2)},`, `a1=${g15(-c.a1)},`, `a2=${g15(-c.a2)}`].join('\n'));
  }
  return { text: blocks.join(',\n') + '\n', delays };
}
