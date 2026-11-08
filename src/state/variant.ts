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
  return { ...current, ...placementLayout(p), subSettings: p.subSettings ?? {}, crossoverHz: null };
}

/**
 * После подбора лучший вариант сразу становится текущим, если своей расстановки ещё нет
 * (стоит исходная по умолчанию). Иначе ручную расстановку пользователя не трогаем.
 */
export function shouldAdoptBest(current: Setup, defaults: Setup, best: Placement | undefined): best is Placement {
  return !!best && sameLayout(current, defaults);
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
