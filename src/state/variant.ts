// Варианты расстановки и текущая расстановка проекта: сравнение и применение.
import type { Measurement, Placement, Setup, Vec3 } from '../core/types';

export type Layout = Pick<Setup, 'listener' | 'positions'>;

/** Расстановка варианта в виде, сравнимом с Setup. */
export function placementLayout(p: Placement): Layout {
  return { listener: p.listener, positions: Object.fromEntries(p.sources.filter((s) => s.pos).map((s) => [s.id, s.pos])) as Record<string, Vec3> };
}

/** Совпадают ли места слушателя и всех источников (по плану, с точностью до миллиметра). */
export function sameLayout(a: Layout, b: Layout, tol = 1e-3): boolean {
  const near = (p: { x: number; y: number }, q: { x: number; y: number }) => Math.abs(p.x - q.x) < tol && Math.abs(p.y - q.y) < tol;
  if (!near(a.listener, b.listener)) return false;
  const ids = new Set([...Object.keys(a.positions), ...Object.keys(b.positions)]);
  for (const id of ids) {
    const p = a.positions[id], q = b.positions[id];
    if (!p || !q || !near(p, q)) return false;
  }
  return true;
}

/**
 * Текущая расстановка по варианту: места, настройки сабвуферов варианта; частота раздела сбрасывается
 * (подобрана для прежних мест). Имя, id и замер остаются.
 */
export function setupFromPlacement(current: Setup, p: Placement): Setup {
  return { ...current, ...placementLayout(p), subSettings: p.subSettings ?? {}, crossoverHz: null, placed: true };
}

/**
 * После подбора лучший вариант сразу становится текущим, если места ещё не выбраны (стоят исходные по умолчанию).
 * Иначе расстановку пользователя не трогаем. 022: признак хранится у расстановки — прежнее сравнение с местами
 * по умолчанию не работало, когда размеры комнаты отличались от комнаты нового проекта.
 */
export function shouldAdoptBest(current: Setup, best: Placement | undefined): best is Placement {
  return !!best && !current.placed;
}

/**
 * Изменение мест пользователем (перетаскивание, координаты, вариант, «Колонки стоят так») — места выбраны.
 * Настройки сабвуфера, кроссовер и замер места не меняют.
 */
export function markPlaced(prev: Setup, next: Setup): Setup {
  // выбранные места остаются выбранными и тогда, когда новая расстановка с ними совпадает, но признака не несёт
  // (вариант, сохранённый до 022): иначе места сбрасывались к исходным
  return next.placed ? next : prev.placed || !sameLayout(prev, next) ? { ...next, placed: true } : next;
}

/** Сколько прошлых замеров хранится у расстановки для сравнения «до и после». */
export const HISTORY_MAX = 5;

/**
 * Новый замер становится текущим, прежний уходит в историю (свежие — первыми).
 * Повторное сохранение того же сеанса (добавили точек и сохранили снова) прежний не сохраняет —
 * это уточнение, а не новый замер.
 */
export function withMeasurement(s: Setup, m: Measurement): Setup {
  const prev = s.measurement;
  const sameSession = !!prev && !!m.session && prev.session === m.session;
  const history = prev && !sameSession ? [prev, ...(s.history ?? [])].slice(0, HISTORY_MAX) : (s.history ?? []);
  return { ...s, measurement: m, history };
}
