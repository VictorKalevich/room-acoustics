import type { Furnishing, Material, OctaveValues } from './types';

export const OCTAVES = [63, 125, 250, 500, 1000, 2000, 4000] as const;

const SRC_EVEREST = 'Everest & Pohlmann, Master Handbook of Acoustics, табл. коэффициентов поглощения';
const SRC_LONG = 'M. Long, Architectural Acoustics, прил. «Absorption coefficients»';

/**
 * Октавные значения 63…4000 Гц. В таблицах значения начинаются со 125 Гц, поэтому 63 Гц — оценка:
 * для жёстких поверхностей и мембран (стекло, гипсокартон, панели на относе) — как на 125 Гц,
 * для пористых материалов (ковры, шторы, панели) — заметно меньше: их поглощение к низам падает.
 */
function m(
  id: string,
  name: string,
  a63: number, a125: number, a250: number, a500: number, a1k: number, a2k: number, a4k: number,
  source = SRC_EVEREST,
): Material {
  return { id, name, alpha: [a63, a125, a250, a500, a1k, a2k, a4k] as OctaveValues, extrapolated63: true, source };
}

/** Справочник материалов. Значения — типичные табличные (случайное падение звука). */
export const MATERIALS: Material[] = [
  m('concrete-painted', 'Бетон окрашенный', 0.01, 0.01, 0.01, 0.015, 0.02, 0.02, 0.02),
  m('plaster', 'Штукатурка по бетону/кирпичу', 0.013, 0.013, 0.015, 0.02, 0.03, 0.04, 0.05),
  m('brick', 'Кирпич без отделки', 0.03, 0.03, 0.03, 0.03, 0.04, 0.05, 0.07),
  m('gypsum', 'Гипсокартон на каркасе', 0.28, 0.29, 0.1, 0.05, 0.04, 0.07, 0.09),
  m('glass', 'Окно (стекло)', 0.35, 0.35, 0.25, 0.18, 0.12, 0.07, 0.04),
  m('wood-panel', 'Деревянные панели на относе', 0.25, 0.28, 0.22, 0.17, 0.09, 0.1, 0.11),
  m('parquet', 'Паркет/ламинат на бетоне', 0.04, 0.04, 0.04, 0.07, 0.06, 0.06, 0.07),
  m('wood-floor', 'Деревянный пол на лагах', 0.15, 0.15, 0.11, 0.1, 0.07, 0.06, 0.07),
  m('linoleum', 'Линолеум на бетоне', 0.02, 0.02, 0.03, 0.03, 0.03, 0.03, 0.02),
  m('tile', 'Керамическая плитка', 0.01, 0.01, 0.01, 0.01, 0.01, 0.02, 0.02),
  m('carpet-thin', 'Ковёр тонкий на бетоне', 0.01, 0.02, 0.06, 0.14, 0.37, 0.6, 0.65),
  m('carpet-thick', 'Ковёр толстый на подложке', 0.03, 0.08, 0.24, 0.57, 0.69, 0.71, 0.73),
  m('curtains', 'Плотные шторы в складку', 0.06, 0.14, 0.35, 0.55, 0.72, 0.7, 0.65),
  m('acoustic-panel', 'Акустические панели 50 мм', 0.08, 0.25, 0.75, 0.97, 0.99, 0.99, 0.95, SRC_LONG),
  m('acoustic-ceiling', 'Подвесной акустический потолок', 0.45, 0.7, 0.66, 0.72, 0.92, 0.88, 0.75, SRC_LONG),
  m('stretch-ceiling', 'Натяжной потолок (ПВХ)', 0.3, 0.3, 0.15, 0.08, 0.05, 0.04, 0.03, SRC_LONG),
];

export const MATERIAL_BY_ID: Record<string, Material> = Object.fromEntries(
  MATERIALS.map((x) => [x.id, x]),
);

/** Окна и двери на стенах (из скана или отмеченные вручную) — поглощают как мембраны. */
export const FEATURE_ALPHA: Record<'window' | 'door', OctaveValues> = {
  window: MATERIAL_BY_ID.glass.alpha,
  // деревянная дверь (полотно): Everest & Pohlmann, «wood door, solid panel»
  door: [0.14, 0.14, 0.1, 0.06, 0.08, 0.1, 0.1],
};

/**
 * Лёгкие шторы (тюль, лёгкая ткань): лёгкий велюр ≈ 0,34 кг/м² без складок вплотную к стене
 * (Everest & Pohlmann). Не входит в список отделки — только покрытие (019).
 */
export const LIGHT_CURTAIN_ALPHA: OctaveValues = [0.02, 0.03, 0.04, 0.11, 0.17, 0.24, 0.35];

export function getMaterial(id: string): Material {
  return MATERIAL_BY_ID[id] ?? MATERIAL_BY_ID['plaster'];
}

/**
 * Обстановка: дополнительная эквивалентная площадь поглощения на 1 м² пола (м²/м²) по октавам —
 * мебель, кровать, шкафы, шторы, ковры и всё, что есть в жилой комнате, кроме отделки стен.
 *
 * Значения подобраны так, чтобы комната 50 м³ с жёсткой отделкой (штукатурка, бетон, паркет), окном 2 м²
 * и дверью давала время реверберации, измеренное в жилых комнатах:
 * — меблированные комнаты до 50 м³: ≈ 0,5 с на средних частотах и рост к низам до ≈ 0,9 с на 50 Гц;
 * — пустые комнаты: ≈ 2,3–2,5 с (D. Mašović, M. Öğüç, Telfor Journal 5(2), 2013 — 242 комнаты);
 * — 0,5 с как типичное значение для меблированного жилья (EN ISO 140 / ISO 16283, J. Díaz, A. Pedrero,
 *   Applied Acoustics 66, 2005 — 11 457 меблированных комнат).
 * «Много мягкой мебели» ≈ в 1,45 раза больше (≈ 0,35 с на средних частотах).
 */
export const FURNISHING: Record<Furnishing, OctaveValues> = {
  empty: [0, 0, 0, 0, 0, 0, 0],
  typical: [0.38, 0.6, 0.68, 0.66, 0.63, 0.6, 0.58],
  heavy: [0.55, 0.87, 0.98, 0.96, 0.92, 0.87, 0.84],
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
