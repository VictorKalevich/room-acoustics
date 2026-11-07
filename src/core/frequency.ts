import type { Complex } from './types';

/** Логарифмическая сетка частот от fLo до fHi включительно, pointsPerOctave точек на октаву. */
export function logFreqs(fLo: number, fHi: number, pointsPerOctave = 24): number[] {
  if (!(fLo > 0) || !(fHi > fLo)) throw new Error('logFreqs: нужен 0 < fLo < fHi');
  const octaves = Math.log2(fHi / fLo);
  const n = Math.max(2, Math.round(octaves * pointsPerOctave) + 1);
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(fLo * Math.pow(fHi / fLo, i / (n - 1)));
  return out;
}

export const c = (re: number, im = 0): Complex => ({ re, im });
export const cadd = (a: Complex, b: Complex): Complex => ({ re: a.re + b.re, im: a.im + b.im });
export const cmul = (a: Complex, b: Complex): Complex => ({
  re: a.re * b.re - a.im * b.im,
  im: a.re * b.im + a.im * b.re,
});
export const cdiv = (a: Complex, b: Complex): Complex => {
  const d = b.re * b.re + b.im * b.im;
  return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d };
};
export const cabs = (a: Complex): number => Math.hypot(a.re, a.im);
export const db20 = (mag: number): number => 20 * Math.log10(Math.max(mag, 1e-12));
