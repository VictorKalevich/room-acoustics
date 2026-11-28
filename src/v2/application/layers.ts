// Многослойные конструкции (V2-052): поверхностный импеданс и поглощение методом матриц переноса (TMM) для слоёв,
// уложенных от комнаты к жёсткой стене. TMM — способ объединить слои, а не модель материала: пористый слой — модель
// эквивалентной жидкости (Delany–Bazley, Miki или Johnson–Champoux–Allard), перфорированный лист — Маа, ткань —
// сопротивление продуванию, мембрана — масса без изгибной жёсткости. Временная зависимость e^{jωt}.
// Бесконечная плоская конструкция: краевой эффект конечной панели и её изгибные моды не учитываются.
import { airDensity, speedOfSound } from '../../core/physics';
import { c as cx, cabs, cadd, cdiv, cmul } from '../../core/frequency';
import type { Complex } from '../../core/types';

export type PorousModel = 'delany-bazley' | 'miki' | 'jca';

export type Layer =
  | { kind: 'porous'; thickness: number; sigma: number; model: PorousModel; density?: number | null; jca?: { porosity: number; tortuosity: number; viscousUm: number; thermalUm: number } }
  | { kind: 'air'; thickness: number }
  | { kind: 'perforated'; thickness: number; holeDiameter: number; pitch: number; surfaceMass?: number | null }
  | { kind: 'fabric'; resistance: number; surfaceMass?: number | null }
  | { kind: 'membrane'; surfaceMass: number };

export interface Air { rho: number; c: number; z0: number; eta: number; gamma: number; p0: number; pr: number }

/** Воздух при температуре t: плотность, скорость звука, вязкость (Сазерленд), γ, давление, число Прандтля. */
export function air(tempC = 20): Air {
  const T = tempC + 273.15;
  const rho = airDensity(tempC), c = speedOfSound(tempC);
  const eta = 1.458e-6 * T ** 1.5 / (T + 110.4);
  return { rho, c, z0: rho * c, eta, gamma: 1.4, p0: 101325, pr: 0.71 };
}

const J = cx(0, 1);
const sub = (a: Complex, b: Complex) => cx(a.re - b.re, a.im - b.im);
const scale = (a: Complex, k: number) => cx(a.re * k, a.im * k);
export function csqrt(z: Complex): Complex {
  const r = cabs(z);
  const re = Math.sqrt(Math.max(0, (r + z.re) / 2)), im = Math.sqrt(Math.max(0, (r - z.re) / 2));
  return cx(re, z.im < 0 ? -im : im);
}
const ccos = (z: Complex) => cx(Math.cos(z.re) * Math.cosh(z.im), -Math.sin(z.re) * Math.sinh(z.im));
const csin = (z: Complex) => cx(Math.sin(z.re) * Math.cosh(z.im), Math.cos(z.re) * Math.sinh(z.im));

/** Характеристический импеданс Zc и волновое число k пористого слоя. */
export function porous(l: Extract<Layer, { kind: 'porous' }>, f: number, a: Air): { zc: Complex; k: Complex } {
  const w = 2 * Math.PI * f, k0 = w / a.c;
  if (l.model === 'jca' && l.jca) {
    const { porosity: phi, tortuosity: ainf } = l.jca;
    const L = l.jca.viscousUm * 1e-6, Lp = l.jca.thermalUm * 1e-6, s = l.sigma;
    const g = csqrt(cx(1, (4 * ainf ** 2 * a.eta * a.rho * w) / (s ** 2 * L ** 2 * phi ** 2)));
    const rho = scale(cadd(cx(1), cmul(cdiv(cx(s * phi), cx(0, w * a.rho * ainf)), g)), (ainf * a.rho) / phi);
    const inner = cadd(cx(1), cmul(cdiv(cx(8 * a.eta), cx(0, Lp ** 2 * a.pr * w * a.rho)), csqrt(cx(1, (a.rho * w * a.pr * Lp ** 2) / (16 * a.eta)))));
    const K = cdiv(cx((a.gamma * a.p0) / phi), sub(cx(a.gamma), cdiv(cx(a.gamma - 1), inner)));
    return { zc: csqrt(cmul(rho, K)), k: scale(csqrt(cdiv(rho, K)), w) };
  }
  const X = (a.rho * f) / l.sigma;
  const [zr, zi, kr, ki] = l.model === 'miki'
    ? [0.07 * X ** -0.632, 0.107 * X ** -0.632, 0.109 * X ** -0.618, 0.16 * X ** -0.618]
    : [0.0571 * X ** -0.754, 0.087 * X ** -0.732, 0.0978 * X ** -0.7, 0.189 * X ** -0.595];
  return { zc: cx(a.z0 * (1 + zr), -a.z0 * zi), k: cx(k0 * (1 + kr), -k0 * ki) };
}

/** Последовательный импеданс тонкого слоя (лист, ткань, мембрана), Па·с/м. */
export function seriesImpedance(l: Exclude<Layer, { kind: 'porous' | 'air' }>, f: number, a: Air): Complex {
  const w = 2 * Math.PI * f;
  if (l.kind === 'fabric') return cx(l.resistance, w * (l.surfaceMass ?? 0));
  if (l.kind === 'membrane') return cx(0, w * l.surfaceMass);
  // Маа (1998): отверстия любого размера, вязкость в отверстии и концевая поправка 0,85·d
  const { thickness: t, holeDiameter: d } = l;
  const phi = perforation(l);
  const x = d * Math.sqrt((w * a.rho) / (4 * a.eta));
  const r = ((32 * a.eta * t) / (phi * a.rho * a.c * d * d)) * (Math.sqrt(1 + (x * x) / 32) + (Math.SQRT2 / 32) * x * (d / t));
  const m = ((w * t) / (phi * a.c)) * (1 + 1 / Math.sqrt(1 + (x * x) / 2) + 0.85 * (d / t));
  return cx(a.z0 * r, a.z0 * m);
}

/** Перфорация листа с отверстиями по квадратной сетке. */
export const perforation = (l: { holeDiameter: number; pitch: number }) => Math.min(1, (Math.PI * (l.holeDiameter / 2) ** 2) / l.pitch ** 2);

type M2 = [Complex, Complex, Complex, Complex];
const mmul = (A: M2, B: M2): M2 => [cadd(cmul(A[0], B[0]), cmul(A[1], B[2])), cadd(cmul(A[0], B[1]), cmul(A[1], B[3])), cadd(cmul(A[2], B[0]), cmul(A[3], B[2])), cadd(cmul(A[2], B[1]), cmul(A[3], B[3]))];

/**
 * Поверхностный импеданс конструкции на жёсткой стене при угле падения θ (рад): произведение матриц переноса слоёв
 * от комнаты к стене; у стены нормальная скорость равна нулю, Zs = T11/T21. Слои жидкости — с преломлением
 * (kx = √(k² − k0²·sin²θ)), тонкие слои — последовательный импеданс.
 */
export function surfaceImpedance(layers: readonly Layer[], f: number, theta = 0, a = air()): Complex {
  const k0 = (2 * Math.PI * f) / a.c, kt = k0 * Math.sin(theta);
  let T: M2 = [cx(1), cx(0), cx(0), cx(1)];
  for (const l of layers) {
    let M: M2;
    if (l.kind === 'porous' || l.kind === 'air') {
      const { zc, k } = l.kind === 'air' ? { zc: cx(a.z0), k: cx(k0) } : porous(l, f, a);
      const kx = csqrt(sub(cmul(k, k), cx(kt * kt)));
      const kd = scale(kx, l.thickness);
      const zr = cdiv(cmul(zc, k), kx);
      M = [ccos(kd), cmul(J, cmul(zr, csin(kd))), cmul(J, cdiv(csin(kd), zr)), ccos(kd)];
    } else M = [cx(1), seriesImpedance(l, f, a), cx(0), cx(1)];
    T = mmul(T, M);
  }
  return cdiv(T[0], T[2]);
}

/** Поглощение при угле θ по поверхностному импедансу: α = 1 − |(Zs·cosθ − Z0)/(Zs·cosθ + Z0)|². */
export function alphaAt(zs: Complex, theta: number, z0: number): number {
  const zc = scale(zs, Math.cos(theta));
  const r = cdiv(sub(zc, cx(z0)), cadd(zc, cx(z0)));
  return Math.max(0, Math.min(1, 1 - (r.re ** 2 + r.im ** 2)));
}

/** Поле падения: 0–78° — принятое приближение реверберационной камеры; 0–90° — идеально диффузное поле. */
export const FIELD_MAX = (78 * Math.PI) / 180;

/** Диффузное поглощение по Пари: ∫α(θ)·sin2θ dθ / sin²θmax, правило Симпсона. */
export function diffuseAlpha(alphaOf: (theta: number) => number, thetaMax = FIELD_MAX, n = 48): number {
  const h = thetaMax / n;
  let s = 0;
  for (let i = 0; i <= n; i++) {
    const t = i * h;
    s += (i === 0 || i === n ? 1 : i % 2 ? 4 : 2) * alphaOf(t) * Math.sin(2 * t);
  }
  return (s * h) / 3 / Math.sin(thetaMax) ** 2;
}

export interface Absorption { f: number[]; normal: number[]; diffuse: number[]; zs: Complex[] }

/** Поглощение конструкции на сетке частот: нормальное падение и диффузное поле. */
export function absorption(layers: readonly Layer[], freqs: readonly number[], tempC = 20): Absorption {
  const a = air(tempC);
  const zs = freqs.map((f) => surfaceImpedance(layers, f, 0, a));
  return {
    f: [...freqs], zs,
    normal: zs.map((z) => alphaAt(z, 0, a.z0)),
    diffuse: freqs.map((f) => diffuseAlpha((t) => alphaAt(surfaceImpedance(layers, f, t, a), t, a.z0))),
  };
}

export const OCTAVES = [63, 125, 250, 500, 1000, 2000, 4000] as const;

/** Среднее по октавной полосе (границы f/√2…f·√2) значений на логарифмической сетке. */
export function octaveMean(f: readonly number[], v: readonly number[], centre: number): number | null {
  const lo = centre / Math.SQRT2, hi = centre * Math.SQRT2;
  const xs = v.filter((_, k) => f[k] >= lo && f[k] < hi);
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null;
}

/** Частоты, где модель пористого слоя выходит за пределы применимости (Delany–Bazley: 0,01 ≤ ρ0·f/σ ≤ 1). */
export function outOfRange(l: Layer, freqs: readonly number[], tempC = 20): { lo: number; hi: number } | null {
  if (l.kind !== 'porous' || l.model === 'jca') return null;
  const rho = airDensity(tempC);
  const bad = freqs.filter((f) => {
    const X = (rho * f) / l.sigma;
    return l.model === 'delany-bazley' ? X < 0.01 || X > 1 : X > 1;
  });
  return bad.length ? { lo: Math.min(...bad), hi: Math.max(...bad) } : null;
}

/** Глубина конструкции, м, и поверхностная масса, кг/м² (null — у какого-то слоя масса не указана). */
export function construction(layers: readonly Layer[]): { depth: number; mass: number | null } {
  let depth = 0, mass: number | null = 0;
  for (const l of layers) {
    if (l.kind === 'porous' || l.kind === 'air' || l.kind === 'perforated') depth += l.thickness;
    const m = l.kind === 'air' ? 0 : l.kind === 'porous' ? (l.density === null || l.density === undefined ? null : l.density * l.thickness)
      : l.kind === 'membrane' ? l.surfaceMass : l.surfaceMass ?? null;
    mass = mass === null || m === null ? null : mass + m;
  }
  return { depth, mass };
}

/** Частота максимума и полоса, где поглощение не ниже половины максимума (рабочая полоса резонатора). */
export function peak(f: readonly number[], v: readonly number[]): { f: number; value: number; lo: number; hi: number } | null {
  if (!v.length) return null;
  let k = 0;
  for (let i = 1; i < v.length; i++) if (v[i] > v[k]) k = i;
  let lo = k, hi = k;
  while (lo > 0 && v[lo - 1] >= v[k] / 2) lo--;
  while (hi < v.length - 1 && v[hi + 1] >= v[k] / 2) hi++;
  return { f: f[k], value: v[k], lo: f[lo], hi: f[hi] };
}
