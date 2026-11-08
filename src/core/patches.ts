// Участки поверхностей с другим поглощением: окна, двери, проёмы и элементы обработки.
// Для каждой моды вклад участка в затухание зависит от того, где он стоит: в пучности моды
// (у стены, где давление максимально) он гасит её сильно, в узле — почти не действует.
import type { OctaveValues, Room, SurfaceId, WallId } from './types';
import { FEATURE_ALPHA, alphaAt, getMaterial } from './materials';
import { activeTreatments, porousAlpha } from './treatments';

export type PatchKind = 'window' | 'door' | 'opening' | 'treatment';

/**
 * Прямоугольник на поверхности в её координатах: для стен u — вдоль стены (для передней/задней —
 * от левой стены, для левой/правой — от передней), v — высота над полом; для потолка и пола u = x, v = y.
 */
export interface Patch {
  kind: PatchKind;
  surface: SurfaceId;
  u0: number;
  u1: number;
  v0: number;
  v1: number;
  /** α участка по октавам; null — проём (звук уходит из комнаты, α = 1). */
  alpha: OctaveValues | null;
  /** Элемент обработки лежит поверх стены (её поглощение не пропадает), окно и дверь — вместо стены. */
  overlay: boolean;
  /** Площадь поглощающей поверхности, м². */
  area: number;
  /** Угловая ловушка: грань по диагонали угла в плане от (ax, ay) до (bx, by), высота v0…v1. */
  diag?: { ax: number; ay: number; bx: number; by: number; walls: [WallId, WallId] };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Длина стены вдоль её координаты u. */
const wallLen = (room: Room, w: WallId) => (w === 'front' || w === 'back' ? room.width : room.depth);

function wallRect(room: Room, wall: WallId, a0: number, a1: number, v0: number, v1: number) {
  const L = wallLen(room, wall);
  const u0 = clamp(Math.min(a0, a1), 0, L), u1 = clamp(Math.max(a0, a1), 0, L);
  const w0 = clamp(Math.min(v0, v1), 0, room.height), w1 = clamp(Math.max(v0, v1), 0, room.height);
  return { u0, u1, v0: w0, v1: w1, area: Math.max(0, u1 - u0) * Math.max(0, w1 - w0) };
}

/**
 * Все участки комнаты. withArches — добавлять ли арки в смежные помещения как проёмы
 * (в прямоугольной модели; волновая модель считает коридор целиком).
 */
export function roomPatches(room: Room, opts: { withArches?: boolean } = {}): Patch[] {
  const out: Patch[] = [];
  for (const f of room.features ?? []) {
    const r = wallRect(room, f.wall, f.a0, f.a1, f.bottom, f.top);
    if (r.area > 0) out.push({ kind: f.kind, surface: f.wall, ...r, alpha: FEATURE_ALPHA[f.kind], overlay: false });
  }
  const openings = [
    ...(room.openings ?? []),
    ...(opts.withArches === false ? [] : (room.extensions ?? []).map((e) => ({ wall: e.wall, a0: e.arch.a0, a1: e.arch.a1, height: e.arch.height }))),
  ];
  for (const o of openings) {
    const r = wallRect(room, o.wall, o.a0, o.a1, 0, o.height);
    if (r.area > 0) out.push({ kind: 'opening', surface: o.wall, ...r, alpha: null, overlay: false });
  }
  for (const t of activeTreatments(room)) {
    const alpha = porousAlpha(t.thickness, t.gap ?? 0);
    if (t.kind === 'panel' && t.wall) {
      const at = t.at ?? wallLen(room, t.wall) / 2, z = t.z ?? room.height / 2;
      const r = wallRect(room, t.wall, at - t.width / 2, at + t.width / 2, z - t.height / 2, z + t.height / 2);
      if (r.area > 0) out.push({ kind: 'treatment', surface: t.wall, ...r, alpha, overlay: true });
    } else if (t.kind === 'cloud') {
      const x = t.x ?? room.depth / 2, y = t.y ?? room.width / 2;
      // ширина облака — поперёк комнаты (по y), «высота» — вдоль (по x), как на плане
      const u0 = clamp(x - t.height / 2, 0, room.depth), u1 = clamp(x + t.height / 2, 0, room.depth);
      const v0 = clamp(y - t.width / 2, 0, room.width), v1 = clamp(y + t.width / 2, 0, room.width);
      const area = Math.max(0, u1 - u0) * Math.max(0, v1 - v0);
      if (area > 0) out.push({ kind: 'treatment', surface: 'ceiling', u0, u1, v0, v1, alpha, overlay: true, area });
    } else if (t.kind === 'corner') {
      const [fb, lr] = (t.corner ?? 'front-left').split('-') as [WallId, WallId];
      const leg = Math.min(t.width / Math.SQRT2, room.depth / 2, room.width / 2);
      const cx = fb === 'front' ? 0 : room.depth, cy = lr === 'left' ? 0 : room.width;
      const sx = fb === 'front' ? 1 : -1, sy = lr === 'left' ? 1 : -1;
      const h = clamp(t.height, 0, room.height);
      // A — на боковой стене (lr) на расстоянии leg от угла, B — на передней/задней (fb)
      const diag = { ax: cx + sx * leg, ay: cy, bx: cx, by: cy + sy * leg, walls: [fb, lr] as [WallId, WallId] };
      out.push({ kind: 'treatment', surface: fb, u0: 0, u1: 0, v0: 0, v1: h, alpha, overlay: true, area: leg * Math.SQRT2 * h, diag });
    }
  }
  return out;
}

/** α стены (материала поверхности) на частоте f. */
const wallAlpha = (room: Room, s: SurfaceId, f: number) => alphaAt(getMaterial(room.materials[s]).alpha, f);

/** α поверхности под участком на частоте f; для угловой ловушки — среднее двух стен. */
export function patchWallAlpha(room: Room, p: Patch, f: number): number {
  return p.diag ? (wallAlpha(room, p.diag.walls[0], f) + wallAlpha(room, p.diag.walls[1], f)) / 2 : wallAlpha(room, p.surface, f);
}

/** Прибавка к α на участке относительно поверхности под ним. Для угловой ловушки — среднее двух стен. */
export function patchDeltaAlpha(room: Room, p: Patch, f: number): number {
  const aw = patchWallAlpha(room, p, f);
  const ap = p.alpha ? alphaAt(p.alpha, f) : 1;
  return p.overlay ? Math.max(0, ap - aw) : ap - aw;
}

/** Доли площади участка по поверхностям (для расчёта реверберации). */
export function patchShares(p: Patch): { s: SurfaceId; share: number }[] {
  return p.diag ? [{ s: p.diag.walls[0], share: 0.5 }, { s: p.diag.walls[1], share: 0.5 }] : [{ s: p.surface, share: 1 }];
}

/** ∫ cos²(k·u) du на [a, b]. */
export function cos2Int(k: number, a: number, b: number): number {
  if (Math.abs(k) < 1e-12) return b - a;
  return (b - a) / 2 + (Math.sin(2 * k * b) - Math.sin(2 * k * a)) / (4 * k);
}

// узлы и веса Гаусса–Лежандра на [0, 1] (6 точек)
const GL_X = [0.033765242898424, 0.169395306766868, 0.380690406958402, 0.619309593041598, 0.830604693233132, 0.966234757101576];
const GL_W = [0.085662246189585, 0.180380786524069, 0.233956967286346, 0.233956967286346, 0.180380786524069, 0.085662246189585];

/**
 * ∫ ψ² dS по участку для моды с волновыми числами (kx, ky, kz), ψ = cos(kx·x)·cos(ky·y)·cos(kz·z).
 * На стене x = 0 или x = L множитель cos²(kx·x) = 1 (то же для остальных пар стен).
 */
export function patchModeIntegral(p: Patch, kx: number, ky: number, kz: number): number {
  if (p.diag) {
    const { ax, ay, bx, by } = p.diag;
    let s = 0;
    for (let i = 0; i < GL_X.length; i++) {
      const t = GL_X[i];
      const x = ax + (bx - ax) * t, y = ay + (by - ay) * t;
      s += GL_W[i] * Math.cos(kx * x) ** 2 * Math.cos(ky * y) ** 2;
    }
    const len = Math.hypot(bx - ax, by - ay);
    return len * s * cos2Int(kz, p.v0, p.v1);
  }
  switch (p.surface) {
    case 'front':
    case 'back':
      return cos2Int(ky, p.u0, p.u1) * cos2Int(kz, p.v0, p.v1);
    case 'left':
    case 'right':
      return cos2Int(kx, p.u0, p.u1) * cos2Int(kz, p.v0, p.v1);
    default:
      return cos2Int(kx, p.u0, p.u1) * cos2Int(ky, p.v0, p.v1);
  }
}

/** Содержит ли участок точку (u, v) поверхности surface (для волновой модели). */
export function patchContains(p: Patch, surface: SurfaceId, u: number, v: number): boolean {
  if (p.diag) return false;
  return p.surface === surface && u >= p.u0 && u <= p.u1 && v >= p.v0 && v <= p.v1;
}

/**
 * Угловая ловушка для волновой модели: два прямоугольника на стенах угла (катеты), с α, уменьшенным в √2 раз,
 * чтобы площадь поглощения совпала с площадью диагональной грани.
 */
export function cornerLegs(room: Room, p: Patch): Patch[] {
  if (!p.diag) return [];
  const { ax, ay, bx, by, walls } = p.diag;
  const [fb, lr] = walls;
  const legX = Math.abs(ax - bx), legY = Math.abs(by - ay);
  const ux = fb === 'front' ? [0, legX] : [room.depth - legX, room.depth]; // вдоль боковой стены — по x
  const uy = lr === 'left' ? [0, legY] : [room.width - legY, room.width]; // вдоль передней/задней — по y
  const scale = (a: OctaveValues | null) => (a ? (a.map((v) => v / Math.SQRT2) as OctaveValues) : null);
  return [
    { ...p, diag: undefined, surface: lr, u0: ux[0], u1: ux[1], alpha: scale(p.alpha), area: legX * (p.v1 - p.v0) },
    { ...p, diag: undefined, surface: fb, u0: uy[0], u1: uy[1], alpha: scale(p.alpha), area: legY * (p.v1 - p.v0) },
  ];
}
