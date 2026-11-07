import type { Furnishing, Material, OctaveValues } from './types';

export const OCTAVES = [63, 125, 250, 500, 1000, 2000, 4000] as const;

const SRC_EVEREST = 'Everest & Pohlmann, Master Handbook of Acoustics, табл. коэффициентов поглощения';
const SRC_LONG = 'M. Long, Architectural Acoustics, прил. «Absorption coefficients»';

/** Строит октавные значения: 63 Гц экстраполируется значением 125 Гц. */
function m(
  id: string,
  name: string,
  a125: number, a250: number, a500: number, a1k: number, a2k: number, a4k: number,
  source = SRC_EVEREST,
): Material {
  return {
    id,
    name,
    alpha: [a125, a125, a250, a500, a1k, a2k, a4k] as OctaveValues,
    extrapolated63: true,
    source,
  };
}

/** Справочник материалов. Значения — типичные табличные (случайное падение звука). */
export const MATERIALS: Material[] = [
  m('concrete-painted', 'Бетон окрашенный', 0.01, 0.01, 0.015, 0.02, 0.02, 0.02),
  m('plaster', 'Штукатурка по бетону/кирпичу', 0.013, 0.015, 0.02, 0.03, 0.04, 0.05),
  m('brick', 'Кирпич без отделки', 0.03, 0.03, 0.03, 0.04, 0.05, 0.07),
  m('gypsum', 'Гипсокартон на каркасе', 0.29, 0.1, 0.05, 0.04, 0.07, 0.09),
  m('glass', 'Окно (стекло)', 0.35, 0.25, 0.18, 0.12, 0.07, 0.04),
  m('wood-panel', 'Деревянные панели на относе', 0.28, 0.22, 0.17, 0.09, 0.1, 0.11),
  m('parquet', 'Паркет/ламинат на бетоне', 0.04, 0.04, 0.07, 0.06, 0.06, 0.07),
  m('wood-floor', 'Деревянный пол на лагах', 0.15, 0.11, 0.1, 0.07, 0.06, 0.07),
  m('linoleum', 'Линолеум на бетоне', 0.02, 0.03, 0.03, 0.03, 0.03, 0.02),
  m('tile', 'Керамическая плитка', 0.01, 0.01, 0.01, 0.01, 0.02, 0.02),
  m('carpet-thin', 'Ковёр тонкий на бетоне', 0.02, 0.06, 0.14, 0.37, 0.6, 0.65),
  m('carpet-thick', 'Ковёр толстый на подложке', 0.08, 0.24, 0.57, 0.69, 0.71, 0.73),
  m('curtains', 'Плотные шторы в складку', 0.14, 0.35, 0.55, 0.72, 0.7, 0.65),
  m('acoustic-panel', 'Акустические панели 50 мм', 0.25, 0.75, 0.97, 0.99, 0.99, 0.95, SRC_LONG),
  m('acoustic-ceiling', 'Подвесной акустический потолок', 0.7, 0.66, 0.72, 0.92, 0.88, 0.75, SRC_LONG),
  m('stretch-ceiling', 'Натяжной потолок (ПВХ)', 0.3, 0.15, 0.08, 0.05, 0.04, 0.03, SRC_LONG),
];

export const MATERIAL_BY_ID: Record<string, Material> = Object.fromEntries(
  MATERIALS.map((x) => [x.id, x]),
);

export function getMaterial(id: string): Material {
  return MATERIAL_BY_ID[id] ?? MATERIAL_BY_ID['plaster'];
}

/**
 * Меблировка: дополнительная эквивалентная площадь поглощения на 1 м² пола (м²/м²)
 * по октавам. Оценка для мягкой мебели, полок, людей; не табличные данные.
 */
export const FURNISHING: Record<Furnishing, OctaveValues> = {
  empty: [0, 0, 0, 0, 0, 0, 0],
  typical: [0.12, 0.18, 0.3, 0.4, 0.45, 0.45, 0.45],
  heavy: [0.2, 0.3, 0.45, 0.6, 0.65, 0.65, 0.65],
};

export const FURNISHING_LABEL: Record<Furnishing, string> = {
  empty: 'Пустая комната',
  typical: 'Обычная меблировка',
  heavy: 'Много мягкой мебели',
};

/** Значение октавной характеристики на частоте f (интерполяция по log f, края — константа). */
export function alphaAt(values: readonly number[], f: number): number {
  if (f <= OCTAVES[0]) return values[0];
  const last = OCTAVES.length - 1;
  if (f >= OCTAVES[last]) return values[last];
  let i = 0;
  while (f >= OCTAVES[i + 1]) i++;
  const t = Math.log(f / OCTAVES[i]) / Math.log(OCTAVES[i + 1] / OCTAVES[i]);
  return values[i] * (1 - t) + values[i + 1] * t;
}
