// Применение скана к комнате (020). Одна функция строит комнату из найденного — и при первом применении,
// и при «Поправить границы комнаты». Комната проекта остаётся единственным источником истины: всё, что
// показывают планы, развёртки и 3D-модель, берётся из неё; исходный скан виден только при поправке границ.
import type { Opening, Room, Setup, WallFeature, Zone } from '../core/types';
import { shiftRoom } from '../core/fitRoom';
import { toRoomItem, type WallItem, type WallItemKind } from '../core/wallItems';
import { scanFurnitureType } from '../core/furniture';
import { rotateRoom, rotateSetup } from '../state/project';
import type { LayoutResult } from './layout';

export interface ScanRect { x0: number; x1: number; y0: number; y1: number }

/** Что из найденного и как учитывать: границы комнаты в координатах скана, виды проёмов, мебель, коридор. */
export interface ScanChoice {
  height: number;
  rect: ScanRect;
  /** Разметка в координатах выбранной комнаты (после выбора границ — пересчитанная для них). */
  layout: LayoutResult;
  kinds: WallItemKind[];
  furniture: { on: boolean; sit: boolean }[];
  takeCorridor: boolean;
}

export { shiftRoom };

export interface ScanNames {
  furniture: (name: string) => string;
  corridor: string;
  id: () => string;
}

/** Категории мебели скана, на которых по умолчанию можно сидеть. */
export const SIT_DEFAULT = new Set(['sofa', 'couch', 'chair', 'armchair', 'bed']);

/** Найденные элементы стен: проёмы, двери и окна с предположением, что это. */
export function foundWallItems(layout: LayoutResult): (WallItem & { guess: WallItemKind })[] {
  return [
    ...layout.openings.map((o) => ({ wall: o.wall, a0: o.a0, a1: o.a1, bottom: 0, top: o.height, guess: (o.kind === 'door' ? 'door' : 'arch') as WallItemKind })),
    ...layout.windows.map((w) => ({ ...w, guess: 'window' as WallItemKind })),
  ];
}

/** Выбор по умолчанию — как если бы сразу нажали «Применить размеры». */
export function defaultChoice(layout: LayoutResult, height: number, rect: ScanRect): ScanChoice {
  return {
    height, rect, layout,
    kinds: foundWallItems(layout).map((f) => f.guess),
    furniture: layout.furniture.map((f) => ({ on: true, sit: SIT_DEFAULT.has(f.name) })),
    takeCorridor: true,
  };
}

/**
 * Явно неверное распознавание: размеры, с которыми расчёт невозможен (обычно ошибка в единицах).
 * Тогда комната не меняется, а пользователю сразу открывается поправка границ.
 */
export function scanProblem(d: { depth: number; width: number; height: number }): string | null {
  const ok = (v: number, max: number) => Number.isFinite(v) && v >= 1 && v <= max;
  if (ok(d.depth, 50) && ok(d.width, 50) && ok(d.height, 20)) return null;
  return 'dims';
}

/**
 * Комната из скана в системе координат скана. mode:
 * — 'first': первое применение (комната новая или задана вручную) — как прежняя кнопка «Применить размеры»:
 *   найденные проёмы/окна и коридор заменяют прежние, мебель из скана — прежнюю мебель из скана;
 * — 'fix': поправка границ того же скана — пересоздаётся только найденное в скане, добавленное вручную остаётся.
 */
export function scanRoom(base: Room, c: ScanChoice, mode: 'first' | 'fix', n: ScanNames): Room {
  const depth = Math.round((c.rect.x1 - c.rect.x0) * 1000) / 1000;
  const width = Math.round((c.rect.y1 - c.rect.y0) * 1000) / 1000;
  const found = foundWallItems(c.layout);
  const parts = found.map((f, i) => toRoomItem(f, c.kinds[i] ?? f.guess, n.id()));
  const openings: Opening[] = parts.flatMap((p) => (p.opening ? [{ ...p.opening, fromScan: true }] : []));
  const features: WallFeature[] = parts.flatMap((p) => (p.feature ? [{ ...p.feature, fromScan: true }] : []));
  const ext = c.takeCorridor && c.layout.extension ? [{ ...c.layout.extension, id: n.id(), name: n.corridor, fromScan: true }] : [];
  const furniture: Zone[] = c.layout.furniture.flatMap((f, i) => (c.furniture[i]?.on ?? true)
    ? [{
        id: n.id(), kind: 'furniture' as const, x0: f.x0, x1: f.x1, y0: f.y0, y1: f.y1,
        canSit: c.furniture[i]?.sit ?? SIT_DEFAULT.has(f.name), name: n.furniture(f.name), fromScan: true,
        furniture: scanFurnitureType(f.name), height: f.top > 0 ? f.top : undefined,
      }]
    : []);
  const manual = <T extends { fromScan?: boolean }>(xs: T[] | undefined) => (xs ?? []).filter((x) => !x.fromScan);
  if (mode === 'fix') {
    return {
      ...base, depth, width, height: c.height, source: 'scan',
      openings: [...manual(base.openings), ...openings],
      features: [...manual(base.features), ...features],
      extensions: [...manual(base.extensions), ...ext],
      zones: [...manual(base.zones), ...furniture],
    };
  }
  // прежнее поведение «Применить размеры»: если в скане ничего не нашлось — введённое вручную сохраняется
  return {
    ...base, depth, width, height: c.height, source: 'scan',
    openings: found.length > 0 ? openings : base.openings,
    features: found.length > 0 ? features : base.features ?? [],
    extensions: ext.length ? ext : base.extensions,
    zones: c.layout.furniture.length ? [...manual(base.zones), ...furniture] : base.zones,
  };
}

const mm = (v: number) => Math.round(v * 1000) / 1000;

export function shiftSetup(s: Setup, dx: number, dy: number): Setup {
  const m = (p: { x: number; y: number; z: number }) => ({ ...p, x: mm(p.x - dx), y: mm(p.y - dy) });
  return { ...s, listener: m(s.listener), positions: Object.fromEntries(Object.entries(s.positions).map(([k, v]) => [k, m(v)])) };
}

/**
 * Поправка границ того же скана. Комнату проекта поворачивают обратно в систему координат скана
 * (если после скана нажимали «Колонки у другой стены»), сдвигают ручное на разницу границ,
 * пересоздают найденное и поворачивают обратно.
 */
export function fixScan(
  p: { room: Room; current: Setup; setups: Setup[] },
  c: ScanChoice,
  prev: ScanRect,
  rotation: number,
  n: ScanNames,
): { room: Room; current: Setup; setups: Setup[] } {
  const k = ((rotation % 4) + 4) % 4;
  let { room, current, setups } = p;
  const turn = (times: number) => {
    for (let i = 0; i < times; i++) {
      current = rotateSetup(room, current);
      setups = setups.map((s) => rotateSetup(room, s));
      room = rotateRoom(room);
    }
  };
  turn((4 - k) % 4);
  const dx = c.rect.x0 - prev.x0, dy = c.rect.y0 - prev.y0;
  const depth = Math.round((c.rect.x1 - c.rect.x0) * 1000) / 1000;
  const width = Math.round((c.rect.y1 - c.rect.y0) * 1000) / 1000;
  const manualOnly: Room = {
    ...room,
    zones: (room.zones ?? []).filter((z) => !z.fromScan),
    openings: (room.openings ?? []).filter((o) => !o.fromScan),
    features: (room.features ?? []).filter((f) => !f.fromScan),
    extensions: (room.extensions ?? []).filter((e) => !e.fromScan),
  };
  room = scanRoom(shiftRoom(manualOnly, dx, dy, depth, width), c, 'fix', n);
  current = shiftSetup(current, dx, dy);
  setups = setups.map((s) => shiftSetup(s, dx, dy));
  turn(k);
  return { room, current, setups };
}
