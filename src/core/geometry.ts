// Геометрия помещения: основная комната, смежные помещения (прямоугольные блоки за стенами), проёмы.
import type { Extension, Room, WallId } from './types';

export interface Box {
  x0: number; x1: number; y0: number; y1: number; z0: number; z1: number;
}

/** Длина стены вдоль её координаты. */
export function wallLength(room: Room, wall: WallId): number {
  return wall === 'front' || wall === 'back' ? room.width : room.depth;
}

export function roomBox(room: Room): Box {
  return { x0: 0, x1: room.depth, y0: 0, y1: room.width, z0: 0, z1: room.height };
}

/** Объём смежного помещения в координатах комнаты. */
export function extensionBox(room: Room, e: Extension): Box {
  const { depth: D, width: W } = room;
  const h = { z0: 0, z1: e.height };
  switch (e.wall) {
    case 'right': return { x0: e.a0, x1: e.a1, y0: W, y1: W + e.depth, ...h };
    case 'left': return { x0: e.a0, x1: e.a1, y0: -e.depth, y1: 0, ...h };
    case 'front': return { x0: -e.depth, x1: 0, y0: e.a0, y1: e.a1, ...h };
    case 'back': return { x0: D, x1: D + e.depth, y0: e.a0, y1: e.a1, ...h };
  }
}

/** Режим расчёта: волновая модель при наличии смежных помещений (в режиме «Авто»). */
export function effectiveModel(room: Room): 'modal' | 'wave' {
  if (room.model === 'modal') return 'modal';
  if (room.model === 'wave') return 'wave';
  return (room.extensions ?? []).length > 0 || !!room.slope ? 'wave' : 'modal';
}

/** Высота потолка основной комнаты в точке плана (учитывает скос). */
export function ceilingAt(room: Room, x: number, y: number): number {
  const s = room.slope;
  if (!s) return room.height;
  const d = s.wall === 'front' ? x : s.wall === 'back' ? room.depth - x : s.wall === 'left' ? y : room.width - y;
  if (d >= s.run) return room.height;
  return s.low + ((room.height - s.low) * Math.max(0, d)) / s.run;
}

/** Объём, срезанный скосом, м³. */
export function slopeCut(room: Room): number {
  const s = room.slope;
  if (!s) return 0;
  const L = s.wall === 'front' || s.wall === 'back' ? room.width : room.depth;
  return (L * s.run * (room.height - s.low)) / 2;
}

/** Объём основной комнаты с учётом скоса. */
export function roomVolume(room: Room): number {
  return room.depth * room.width * room.height - slopeCut(room);
}

export function validateSlope(room: Room): string | null {
  const s = room.slope;
  if (!s) return null;
  const extent = s.wall === 'front' || s.wall === 'back' ? room.depth : room.width;
  if (!(s.low >= 0.5 && s.low < room.height)) return 'Высота у стены со скосом должна быть от 0,5 м и меньше высоты комнаты.';
  if (!(s.run > 0.2 && s.run <= extent)) return 'Ширина скоса должна быть больше 0,2 м и не больше размера комнаты.';
  return null;
}

export const isWave = (room: Room) => effectiveModel(room) === 'wave';

/** Площадь проёма (обрезанного по стене и высоте комнаты), м². */
export function openingArea(room: Room, o: { wall: WallId; a0: number; a1: number; height: number }): number {
  const L = wallLength(room, o.wall);
  const a0 = Math.max(0, Math.min(o.a0, L));
  const a1 = Math.max(0, Math.min(o.a1, L));
  return Math.max(0, a1 - a0) * Math.max(0, Math.min(o.height, room.height));
}

/** Все проёмы, поглощающие звук в прямоугольной модели: проёмы наружу и арки в смежные помещения. */
export function absorbingOpenings(room: Room): { wall: WallId; a0: number; a1: number; height: number }[] {
  return [
    ...(room.openings ?? []),
    ...(room.extensions ?? []).map((e) => ({ wall: e.wall, a0: e.arch.a0, a1: e.arch.a1, height: e.arch.height })),
  ];
}

// ---------- Поворот (новая передняя стена — бывшая левая) ----------

const ROT: Record<WallId, { wall: WallId; reverse: boolean }> = {
  left: { wall: 'front', reverse: true },
  front: { wall: 'right', reverse: false },
  right: { wall: 'back', reverse: true },
  back: { wall: 'left', reverse: false },
};

export function rotateOpening<T extends { wall: WallId; a0: number; a1: number }>(room: Room, o: T): T {
  const r = ROT[o.wall];
  const L = wallLength(room, o.wall);
  return r.reverse ? { ...o, wall: r.wall, a0: L - o.a1, a1: L - o.a0 } : { ...o, wall: r.wall };
}

export function rotateExtension(room: Room, e: Extension): Extension {
  const r = ROT[e.wall];
  const L = wallLength(room, e.wall);
  if (!r.reverse) return { ...e, wall: r.wall };
  return {
    ...e,
    wall: r.wall,
    a0: L - e.a1,
    a1: L - e.a0,
    arch: { ...e.arch, a0: L - e.arch.a1, a1: L - e.arch.a0 },
    openStart: e.openEnd,
    openEnd: e.openStart,
  };
}

/** Проверка смежного помещения; возвращает текст ошибки или null. */
export function validateExtension(room: Room, e: Extension): string | null {
  const L = wallLength(room, e.wall);
  if (!(e.a0 < e.a1)) return 'Участок вдоль стены: начало должно быть меньше конца';
  if (e.a1 - e.a0 > 50 || e.a0 < -20 || e.a1 > L + 20) return 'Участок вдоль стены слишком большой';
  if (!(e.depth >= 0.3 && e.depth <= 20)) return 'Глубина: от 0,3 до 20 м';
  if (!(e.height >= 1 && e.height <= 20)) return 'Высота: от 1 до 20 м';
  const lo = Math.max(e.a0, 0);
  const hi = Math.min(e.a1, L);
  if (!(e.arch.a0 >= lo - 1e-9 && e.arch.a1 <= hi + 1e-9 && e.arch.a0 < e.arch.a1)) {
    return 'Арка должна лежать в пределах общей части стены и коридора';
  }
  if (!(e.arch.height > 0.5 && e.arch.height <= Math.min(e.height, room.height) + 1e-9)) return 'Высота арки: до высоты комнаты и коридора';
  return null;
}
