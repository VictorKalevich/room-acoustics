// Точность расчёта (026): насколько подробно считаются АЧХ, карты и поиск. Модель звука, формулы и критерии
// оценки одни и те же на всех уровнях — меняются только шаг сетки частот, полосы голоса и шаг карты голоса.
// «Стандартная» — прежние значения приложения.
//
// Откуда числа (проверка на трёх комнатах, 1–2 сабвуфера, цели «ровный бас» и «меньше провалов»; опорная
// оценка — на сетке 192–384 точки на октаву):
//  • оценка расстановки на 24 точках на октаву отличается от опорной на ≤ 0,15 дБ при цели «ровный бас» и до
//    0,3–0,7 дБ при целях по провалам (провал уже полутона попадает между точками); на 48 — ≤ 0,1–0,2 дБ,
//    на 96 — ≤ 0,05–0,1 дБ;
//  • поиск на сетке вдвое гуще в отдельных комнатах находит вариант на 0,5 дБ лучше, а порядок вариантов
//    короткого списка на 24 точках бывает неверным — поэтому итоговые варианты упорядочиваются на сетке графика;
//  • число мод в сумме (усечение по частоте) на оценку почти не влияет: ×4 по частоте меняет её на ≤ 0,05 дБ
//    (изредка до 0,2 дБ) при росте времени расчёта в десятки раз — на уровнях точности оно не меняется;
//  • карта нужна для сравнения мест, а не для точного числа: она считается на сетке поиска, точное значение
//    и график — для выбранной точки.
import type { BassObjective } from './types';
import { isFlat } from './objective';

export type Precision = 'standard' | 'high' | 'max';
export const PRECISIONS: readonly Precision[] = ['standard', 'high', 'max'];

interface PrecisionSpec {
  /** Оценка выбранной расстановки и её график: точек на октаву. */
  evalPpo: number;
  /** Поиск мест и карты при цели «ровный бас»: точек на октаву. */
  gridPpo: number;
  /** Поиск и карты при целях по провалам (не реже 24: окно усреднения — полутон). */
  dipPpo: number;
  /** Голос: полос на октаву у выбранного места (оценка неровности всегда приводится к 1/6 октавы). */
  voiceBands: number;
  /** Голос: примерное число узлов карты и наименьший шаг, м. */
  voiceNodes: number;
  voiceMinStep: number;
}

export const PRECISION: Record<Precision, PrecisionSpec> = {
  standard: { evalPpo: 24, gridPpo: 12, dipPpo: 24, voiceBands: 6, voiceNodes: 320, voiceMinStep: 0.15 },
  high: { evalPpo: 48, gridPpo: 24, dipPpo: 48, voiceBands: 24, voiceNodes: 640, voiceMinStep: 0.1 },
  max: { evalPpo: 96, gridPpo: 48, dipPpo: 48, voiceBands: 48, voiceNodes: 1280, voiceMinStep: 0.1 },
};

export function normalizePrecision(raw: unknown): Precision {
  return PRECISIONS.includes(raw as Precision) ? (raw as Precision) : 'standard';
}

/** Сетка частот оценки выбранной расстановки и графика, точек на октаву; не реже min (экраны, где и раньше было 48). */
export function evalPpo(p: Precision | undefined, min = 24): number {
  return Math.max(min, PRECISION[normalizePrecision(p)].evalPpo);
}

/** Сетка частот поиска мест и карт для цели подбора, точек на октаву. */
export function gridPpo(p: Precision | undefined, o: BassObjective | undefined): number {
  const s = PRECISION[normalizePrecision(p)];
  return isFlat(o) ? s.gridPpo : s.dipPpo;
}

/** Точек на октаву в данных графика (по сетке частот кривой). */
export function pointsPerOctave(f: ArrayLike<number>): number {
  const n = f.length;
  if (n < 2 || !(f[0] > 0) || !(f[n - 1] > f[0])) return 0;
  return (n - 1) / Math.log2(f[n - 1] / f[0]);
}
