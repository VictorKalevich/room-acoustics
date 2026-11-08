// Элементы стен: арка (открытый проём, входит в расчёт), закрытая дверь и окно (только ориентир на плане).
import type { Opening, WallFeature, WallId } from './types';

export type WallItemKind = 'arch' | 'door' | 'window';

export interface WallItem {
  wall: WallId;
  a0: number;
  a1: number;
  /** Низ и верх над полом, м. */
  bottom: number;
  top: number;
}

/** Низ окна, если окном назначили то, что было найдено как проём до пола. */
export function windowBottom(top: number): number {
  return Math.max(0, Math.min(0.9, top - 0.5));
}

/** Переводит элемент в нужный вид: арка → проём в расчёте, дверь и окно → ориентиры на плане. */
export function toRoomItem(it: WallItem, kind: WallItemKind, id: string): { opening?: Opening; feature?: WallFeature } {
  const base = { id, wall: it.wall, a0: it.a0, a1: it.a1 };
  if (kind === 'arch') return { opening: { ...base, height: it.top } };
  if (kind === 'door') return { feature: { ...base, kind: 'door', bottom: 0, top: it.top } };
  const bottom = it.bottom > 0.05 ? it.bottom : windowBottom(it.top);
  return { feature: { ...base, kind: 'window', bottom, top: it.top } };
}

export function openingAsItem(o: Opening): WallItem {
  return { wall: o.wall, a0: o.a0, a1: o.a1, bottom: 0, top: o.height };
}
