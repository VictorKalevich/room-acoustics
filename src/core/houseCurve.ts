// Подъём низа целевой кривой («домашняя кривая», 043): в комнате большинству слушателей нравится бас громче ровного.
// Olive, Welti, McMullin (AES 135, 2013, доклад 8994): предпочтение — полка с серединой перехода около 105 Гц,
// подъём на 30–50 Гц в среднем 6,6 дБ (обученные слушатели — 4,9, остальные — 11,2) при большом разбросе вкусов.
import type { HouseRise } from './types';

export const HOUSE_RISES: readonly HouseRise[] = [3, 6, 9];
/** Середина перехода полки (половина подъёма), Гц. */
export const HOUSE_F0 = 105;
/** Добротность полки: самый крутой переход без выброса (S = 1 у RBJ) — полная величина ниже 40 Гц, почти 0 выше 200 Гц. */
const HOUSE_Q = Math.SQRT1_2;

/** Подъём низа на частоте f, дБ: модуль аналоговой полки второго порядка A·(s² + √A/Q·s + A)/(A·s² + √A/Q·s + 1). */
export function houseDb(rise: number | undefined, f: number): number {
  if (!rise) return 0;
  const A = Math.pow(10, rise / 40);
  const w = f / HOUSE_F0;
  const k = (Math.sqrt(A) / HOUSE_Q) * w;
  return 20 * Math.log10((A * Math.hypot(A - w * w, k)) / Math.hypot(1 - A * w * w, k));
}

/** Подъём из файла проекта: только 3, 6 или 9 дБ, иначе ровная цель. */
export function normalizeHouseRise(raw: unknown): HouseRise | undefined {
  return HOUSE_RISES.includes(raw as HouseRise) ? (raw as HouseRise) : undefined;
}
