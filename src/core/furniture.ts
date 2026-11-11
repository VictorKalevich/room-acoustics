// Мебель и покрытия (019): каталог типов, вклад в поглощение по октавам и обстановка по списку.
//
// Бас (63–125 Гц) всегда считается по общему уровню обстановки: мебель мало влияет на отклик комнаты
// ниже 100 Гц (Maluski & Gibbs, Applied Acoustics, 2004), а общий уровень подобран по замерам жилых
// комнат и включает потери в конструкции. Список уточняет только средние и высокие частоты.
import type { Covering, FurnitureType, OctaveValues, Room, WallId, Zone } from './types';
import { FURNISHING, LIGHT_CURTAIN_ALPHA, MATERIAL_BY_ID } from './materials';

type Acoustic = 'upholstery' | 'mattress' | 'books';

export interface FurnitureSpec {
  /** Заготовка: вдоль передней стены (ось y), вглубь (ось x) и высота, м. */
  along: number;
  deep: number;
  height: number;
  canSit: boolean;
  /** Чем поглощает; null — в расчёте звука не учитывается (жёсткая мебель: отражает и рассеивает). */
  acoustic: Acoustic | null;
  /** Площадь мягкой поверхности = soft × площадь пятна (для книг — фасад: длина × высота). */
  soft: number;
}

export const FURNITURE: Record<FurnitureType, FurnitureSpec> = {
  sofa: { along: 2.0, deep: 0.9, height: 0.85, canSit: true, acoustic: 'upholstery', soft: 2.2 },
  'sofa-open': { along: 2.0, deep: 1.5, height: 0.5, canSit: true, acoustic: 'upholstery', soft: 1.7 },
  armchair: { along: 0.85, deep: 0.85, height: 0.85, canSit: true, acoustic: 'upholstery', soft: 2.5 },
  bed: { along: 1.6, deep: 2.0, height: 0.5, canSit: true, acoustic: 'mattress', soft: 1.4 },
  bookshelf: { along: 1.0, deep: 0.35, height: 2.0, canSit: false, acoustic: 'books', soft: 1 },
  wardrobe: { along: 1.2, deep: 0.6, height: 2.2, canSit: false, acoustic: null, soft: 0 },
  shelf: { along: 0.8, deep: 0.35, height: 1.8, canSit: false, acoustic: null, soft: 0 },
  table: { along: 1.2, deep: 0.8, height: 0.75, canSit: false, acoustic: null, soft: 0 },
  chair: { along: 0.45, deep: 0.5, height: 0.9, canSit: true, acoustic: null, soft: 0 },
  chest: { along: 0.8, deep: 0.45, height: 0.8, canSit: false, acoustic: null, soft: 0 },
  other: { along: 1, deep: 1, height: 1, canSit: false, acoustic: null, soft: 0 },
};

/** Порядок в меню «Добавить мебель»: сначала то, что учитывается в расчёте. */
export const FURNITURE_ORDER: FurnitureType[] = [
  'sofa', 'sofa-open', 'armchair', 'bed', 'bookshelf', 'wardrobe', 'shelf', 'table', 'chair', 'chest', 'other',
];

/**
 * α по октавам 63…4000 Гц (125–4000 — табличные значения по ISO 354; 63 Гц — оценка, в расчёт не входит:
 * на басу действует общий уровень обстановки).
 */
const ALPHA: Record<Acoustic, OctaveValues> = {
  upholstery: [0.1, 0.19, 0.37, 0.56, 0.67, 0.61, 0.59],
  mattress: [0.11, 0.22, 0.55, 0.7, 0.7, 0.73, 0.75],
  books: [0.15, 0.3, 0.4, 0.4, 0.3, 0.3, 0.3],
};

/** Остаток обстановки при списке: мелкие предметы, одежда, стулья, техника — м² на м² пола. */
export const LIST_RESIDUAL = 0.15;
/** Доля списка по октавам 63…4000 Гц: бас — общий уровень, 250 Гц — переход, выше — список. */
export const LIST_WEIGHT: OctaveValues = [0, 0, 0.5, 1, 1, 1, 1];

const ZERO: OctaveValues = [0, 0, 0, 0, 0, 0, 0];
const wallLen = (room: Room, w: WallId) => (w === 'front' || w === 'back' ? room.width : room.depth);

export function furnitureType(z: Zone): FurnitureType | null {
  if (z.kind !== 'furniture') return null;
  return z.furniture && FURNITURE[z.furniture] ? z.furniture : 'other';
}

/** Учитывается ли предмет в расчёте звука (мягкая мебель, кровать, стеллаж с книгами). */
export function isAcoustic(t: FurnitureType): boolean {
  return FURNITURE[t].acoustic !== null;
}

export function zoneHeight(z: Zone): number {
  const t = furnitureType(z);
  return z.height ?? (t ? FURNITURE[t].height : 1);
}

/** Площадь мягкой поверхности (для стеллажа с книгами — фасад), м². */
export function softArea(z: Zone): number {
  const t = furnitureType(z);
  if (!t) return 0;
  const spec = FURNITURE[t];
  const dx = z.x1 - z.x0, dy = z.y1 - z.y0;
  if (spec.acoustic === 'books') return Math.max(dx, dy) * zoneHeight(z);
  return spec.acoustic ? spec.soft * dx * dy : 0;
}

/** Эквивалентная площадь поглощения предмета по октавам, м². */
export function furnitureAbsorption(z: Zone): OctaveValues {
  const t = furnitureType(z);
  const kind = t ? FURNITURE[t].acoustic : null;
  if (!kind) return ZERO;
  const s = softArea(z);
  return ALPHA[kind].map((a) => a * s) as OctaveValues;
}

export function coveringAlpha(c: Covering): OctaveValues {
  if (c.kind === 'curtain') return c.grade === 'light' ? LIGHT_CURTAIN_ALPHA : MATERIAL_BY_ID.curtains.alpha;
  return MATERIAL_BY_ID[c.grade === 'thick' ? 'carpet-thick' : 'carpet-thin'].alpha;
}

/** Площадь покрытия в пределах его поверхности (после уменьшения комнаты лишнее не считается), м². */
export function coveringArea(room: Room, c: Covering): number {
  const U = c.surface === 'floor' ? room.depth : wallLen(room, c.surface);
  const V = c.surface === 'floor' ? room.width : room.height;
  const du = Math.min(c.u1, U) - Math.max(c.u0, 0), dv = Math.min(c.v1, V) - Math.max(c.v0, 0);
  return Math.max(0, du) * Math.max(0, dv);
}

export function coveringAbsorption(room: Room, c: Covering): OctaveValues {
  const s = coveringArea(room, c);
  return coveringAlpha(c).map((a) => a * s) as OctaveValues;
}

/** Обстановка по списку: остаток + мебель + покрытия, м² на м² пола по октавам. */
export function listOctaves(room: Room): OctaveValues {
  const floor = room.depth * room.width;
  const sum = [...ZERO] as OctaveValues;
  const add = (v: OctaveValues) => v.forEach((x, k) => { sum[k] += x; });
  for (const z of room.zones ?? []) add(furnitureAbsorption(z));
  for (const c of room.coverings ?? []) add(coveringAbsorption(room, c));
  return sum.map((s) => LIST_RESIDUAL + s / floor) as OctaveValues;
}

/**
 * Эквивалентная площадь поглощения обстановки на м² пола по октавам 63…4000 Гц — то, что раньше
 * давал FURNISHING[room.furnishing]. Без списка — общий уровень; со списком — переход 125 → 500 Гц.
 */
export function furnishingOctaves(room: Room): OctaveValues {
  const base = FURNISHING[room.furnishing] ?? FURNISHING.typical;
  if (!room.furnitureList) return base;
  const list = listOctaves(room);
  return base.map((b, k) => b * (1 - LIST_WEIGHT[k]) + list[k] * LIST_WEIGHT[k]) as OctaveValues;
}

export type Contribution = 'strong' | 'noticeable' | 'small' | 'none';

/**
 * Вклад словами: доля поглощения предмета в поглощении комнаты на 500–2000 Гц.
 * total — эквивалентная площадь поглощения комнаты по октавам (computeReverb(room).absorptionArea).
 */
export function contribution(a: OctaveValues, total: readonly number[]): Contribution {
  const mid = [3, 4, 5];
  if (mid.every((k) => a[k] <= 0)) return 'none';
  const share = mid.reduce((s, k) => s + a[k] / Math.max(1e-9, total[k]), 0) / mid.length;
  return share >= 0.2 ? 'strong' : share >= 0.08 ? 'noticeable' : 'small';
}

/** Тип по категории мебели из скана RoomPlan / Polycam. */
export function scanFurnitureType(name: string): FurnitureType {
  const n = name.toLowerCase();
  if (n === 'sofa' || n === 'couch') return 'sofa';
  if (n === 'bed') return 'bed';
  if (n === 'armchair') return 'armchair';
  if (n === 'chair') return 'chair';
  if (n === 'table' || n === 'desk') return 'table';
  if (n === 'storage' || n === 'cabinet' || n === 'wardrobe') return 'wardrobe';
  if (n === 'shelf') return 'shelf';
  return 'other';
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Прямоугольник, вписанный в комнату, с центром как можно ближе к (cx, cy). */
export function fitRect(room: Room, cx: number, cy: number, dx: number, dy: number) {
  const w = Math.min(dx, room.depth), h = Math.min(dy, room.width);
  const x0 = clamp(cx - w / 2, 0, room.depth - w);
  const y0 = clamp(cy - h / 2, 0, room.width - h);
  return { x0, x1: x0 + w, y0, y1: y0 + h };
}

/** Новый предмет по заготовке типа — в центре комнаты, вписанный в неё. */
export function newFurniture(room: Room, type: FurnitureType, id: string, name: string): Zone {
  const s = FURNITURE[type];
  return {
    id, kind: 'furniture', furniture: type, name, canSit: s.canSit,
    height: Math.min(s.height, room.height),
    ...fitRect(room, room.depth / 2, room.width / 2, s.deep, s.along),
  };
}

/** Поворот предмета на 90° вокруг центра (размеры меняются местами, предмет остаётся в комнате). */
export function rotateFurniture(room: Room, z: Zone): Zone {
  const cx = (z.x0 + z.x1) / 2, cy = (z.y0 + z.y1) / 2;
  return { ...z, ...fitRect(room, cx, cy, z.y1 - z.y0, z.x1 - z.x0) };
}

/** Ковёр на полу 2 × 3 м (или меньше) по центру комнаты. */
export function newRug(room: Room, id: string): Covering {
  const r = fitRect(room, room.depth / 2, room.width / 2, 3, 2);
  return { id, kind: 'carpet', grade: 'thick', surface: 'floor', u0: r.x0, u1: r.x1, v0: r.y0, v1: r.y1 };
}

/** Ковёр на стене 2 × 1,5 м по центру стены, низ 0,5 м. */
export function newWallCarpet(room: Room, wall: WallId, id: string): Covering {
  const L = wallLen(room, wall);
  const w = Math.min(2, L), h = Math.min(1.5, room.height);
  const v0 = clamp(0.5, 0, room.height - h);
  return { id, kind: 'carpet', grade: 'thin', surface: wall, u0: (L - w) / 2, u1: (L + w) / 2, v0, v1: v0 + h };
}

/**
 * Шторы: закрывают первое окно стены с запасом 0,15 м по сторонам, от пола до верха окна + 0,15 м;
 * без окна — 2,0 м по центру от пола до потолка. Всё вписано в стену.
 */
export function newCurtain(room: Room, wall: WallId, id: string): Covering {
  const L = wallLen(room, wall);
  const win = (room.features ?? []).find((f) => f.wall === wall && f.kind === 'window');
  const span = win ? [win.a0 - 0.15, win.a1 + 0.15] : [(L - 2) / 2, (L + 2) / 2];
  const u0 = clamp(span[0], 0, L), u1 = clamp(span[1], u0 + 0.1, L);
  const top = win ? Math.min(room.height, win.top + 0.15) : room.height;
  return { id, kind: 'curtain', grade: 'heavy', surface: wall, u0, u1, v0: 0, v1: top };
}

/** Держит покрытие внутри своей поверхности, сохраняя порядок границ (минимум 0,1 м). */
export function fitCovering(room: Room, c: Covering): Covering {
  const U = c.surface === 'floor' ? room.depth : wallLen(room, c.surface);
  const V = c.surface === 'floor' ? room.width : room.height;
  const u0 = clamp(Math.min(c.u0, c.u1), 0, U - 0.1), v0 = clamp(Math.min(c.v0, c.v1), 0, V - 0.1);
  const u1 = clamp(Math.max(c.u1, c.u0), u0 + 0.1, U), v1 = clamp(Math.max(c.v1, c.v0), v0 + 0.1, V);
  return { ...c, u0, u1, v0, v1 };
}

/** Мебель, стоящая у стены (не дальше gap), и её участок вдоль стены — для развёртки. */
export function furnitureAtWall(room: Room, wall: WallId, gap = 0.3): { z: Zone; a0: number; a1: number; height: number }[] {
  const out: { z: Zone; a0: number; a1: number; height: number }[] = [];
  for (const z of room.zones ?? []) {
    if (z.kind !== 'furniture') continue;
    const near =
      wall === 'front' ? z.x0 <= gap : wall === 'back' ? room.depth - z.x1 <= gap :
      wall === 'left' ? z.y0 <= gap : room.width - z.y1 <= gap;
    if (!near) continue;
    const [a0, a1] = wall === 'front' || wall === 'back' ? [z.y0, z.y1] : [z.x0, z.x1];
    out.push({ z, a0, a1, height: Math.min(zoneHeight(z), room.height) });
  }
  return out;
}
