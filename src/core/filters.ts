import type { Complex, SourceSpec } from './types';
import { cmul } from './frequency';

/**
 * Фильтр Баттерворта 2-го порядка (Q = 1/√2) на частоте f:
 * ФНЧ ωc²/(s² + √2ωc·s + ωc²), ФВЧ s²/(…), s = jω.
 */
export function bw2(type: 'lp' | 'hp', fc: number, f: number): Complex {
  const w = f / fc; // нормированная частота
  // знаменатель: (1 − w²) + j·√2·w
  const dr = 1 - w * w;
  const di = Math.SQRT2 * w;
  const d = dr * dr + di * di;
  // числитель: ФНЧ — 1, ФВЧ — (jw)² = −w²
  const nr = type === 'lp' ? 1 : -w * w;
  return { re: (nr * dr) / d, im: (-nr * di) / d };
}

/** Linkwitz–Riley 4-го порядка = квадрат Баттерворта 2-го порядка. */
export function lr4(type: 'lp' | 'hp', fc: number, f: number): Complex {
  const h = bw2(type, fc, f);
  return cmul(h, h);
}

/** Есть ли стык «сабвуфер → колонки»: нижняя граница колонок ≈ верхней границе сабвуферов (±15 %). */
export function isCrossover(system: SourceSpec[]): boolean {
  const subs = system.filter((s) => s.kind === 'sub');
  const spk = system.filter((s) => s.kind === 'speaker');
  if (!subs.length || !spk.length) return false;
  const subHigh = Math.max(...subs.map((s) => s.fHigh));
  const spkLow = Math.min(...spk.map((s) => s.fLow));
  return Math.abs(spkLow - subHigh) / subHigh <= 0.15;
}

/**
 * Частотная характеристика источника в свободном поле.
 * Кроссовер сабвуфер/колонки — LR4; естественный спад — Баттерворт 2-го порядка.
 */
export function sourceFilter(spec: SourceSpec, system: SourceSpec[], f: number): Complex {
  const xo = isCrossover(system);
  let hp: Complex;
  let lp: Complex;
  if (spec.kind === 'speaker') {
    hp = xo ? lr4('hp', spec.fLow, f) : bw2('hp', spec.fLow, f);
    lp = bw2('lp', spec.fHigh, f);
  } else {
    hp = bw2('hp', spec.fLow, f);
    lp = xo ? lr4('lp', spec.fHigh, f) : bw2('lp', spec.fHigh, f);
  }
  return cmul(hp, lp);
}
