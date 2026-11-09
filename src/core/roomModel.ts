// Геометрия 3D-модели комнаты по введённым данным (когда скана нет): пол, стены с вырезами под проёмы и арки,
// окна и двери, коридоры и ниши за стенами, скос потолка. Потолка нет — чтобы было видно комнату изнутри.
// Координаты комнаты: x — глубина (от стены с колонками), y — ширина (от левой стены), z — вверх.
import type { Room, WallId } from './types';
import { ceilingAt, wallLength } from './geometry';

export type V3 = [number, number, number];
export type QuadKind = 'floor' | 'wall' | 'front' | 'window' | 'door' | 'slope';
/** Четырёхугольник; обход такой, что нормаль ((p1 − p0) × (p3 − p0)) смотрит в сторону, откуда грань видна. */
export interface Quad { kind: QuadKind; pts: [V3, V3, V3, V3] }

const WALLS: WallId[] = ['front', 'back', 'left', 'right'];
/** Окна и двери чуть отступают от стены внутрь, чтобы не мерцать с ней. */
const INSET = 0.008;
const EPS = 1e-3;

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const neg = (a: V3): V3 => [-a[0], -a[1], -a[2]];
const add = (a: V3, b: V3, k = 1): V3 => [a[0] + k * b[0], a[1] + k * b[1], a[2] + k * b[2]];

/** Нормаль четырёхугольника (не единичная). */
export function quadNormal(q: Quad): V3 {
  return cross(sub(q.pts[1], q.pts[0]), sub(q.pts[3], q.pts[0]));
}

/** Четырёхугольник, повёрнутый лицом в сторону `face`. */
function quad(kind: QuadKind, p: [V3, V3, V3, V3], face: V3): Quad {
  const q: Quad = { kind, pts: p };
  return dot(quadNormal(q), face) >= 0 ? q : { kind, pts: [p[0], p[3], p[2], p[1]] };
}

/** Точка на плоскости стены: u — вдоль стены (как у проёмов: для передней/задней от левой, для левой/правой от передней). */
function wallPoint(room: Room, w: WallId, u: number, z: number): V3 {
  switch (w) {
    case 'front': return [0, u, z];
    case 'back': return [room.depth, u, z];
    case 'left': return [u, 0, z];
    case 'right': return [u, room.width, z];
  }
}

/** Направление внутрь комнаты от стены. */
function inward(w: WallId): V3 {
  return w === 'front' ? [1, 0, 0] : w === 'back' ? [-1, 0, 0] : w === 'left' ? [0, 1, 0] : [0, -1, 0];
}

/** Направление вдоль стены (рост u). */
function alongDir(w: WallId): V3 {
  return w === 'front' || w === 'back' ? [0, 1, 0] : [1, 0, 0];
}

interface Hole { a0: number; a1: number; h: number }

/**
 * Полоса стены от u = lo до u = hi с верхом top(u) и вырезами от пола (проёмы, арки): разбивается на куски
 * между краями вырезов и изломами верха; над вырезом остаётся перемычка.
 */
function strip(
  kind: QuadKind, at: (u: number, z: number) => V3, face: V3,
  lo: number, hi: number, top: (u: number) => number, holes: Hole[], breaks: number[] = [],
): Quad[] {
  if (hi - lo < EPS) return [];
  const us = [lo, hi, ...breaks, ...holes.flatMap((h) => [h.a0, h.a1])]
    .filter((u) => u >= lo - EPS && u <= hi + EPS)
    .map((u) => Math.min(hi, Math.max(lo, u)))
    .sort((a, b) => a - b)
    .filter((u, i, a) => i === 0 || u - a[i - 1] > EPS);
  const out: Quad[] = [];
  for (let i = 0; i + 1 < us.length; i++) {
    const u0 = us[i], u1 = us[i + 1], mid = (u0 + u1) / 2;
    const bottom = Math.max(0, ...holes.filter((h) => h.a0 <= mid && h.a1 >= mid).map((h) => h.h));
    const t0 = top(u0), t1 = top(u1);
    if (bottom >= Math.max(t0, t1) - EPS) continue;
    out.push(quad(kind, [at(u0, bottom), at(u1, bottom), at(u1, Math.max(t1, bottom)), at(u0, Math.max(t0, bottom))], face));
  }
  return out;
}

/** Точка смежного помещения: u — вдоль стены комнаты, s — от стены наружу. */
function extPoint(room: Room, w: WallId, u: number, s: number, z: number): V3 {
  switch (w) {
    case 'right': return [u, room.width + s, z];
    case 'left': return [u, -s, z];
    case 'front': return [-s, u, z];
    case 'back': return [room.depth + s, u, z];
  }
}

/** Модель комнаты: набор четырёхугольников (пол, стены, окна, двери, скос). */
export function roomModel(room: Room): Quad[] {
  const { depth: D, width: W, height: H } = room;
  const out: Quad[] = [];
  out.push(quad('floor', [[0, 0, 0], [D, 0, 0], [D, W, 0], [0, W, 0]], [0, 0, 1]));
  const openings = room.openings ?? [];
  const exts = room.extensions ?? [];
  const s = room.slope;

  for (const w of WALLS) {
    const L = wallLength(room, w);
    const at = (u: number, z: number) => wallPoint(room, w, u, z);
    const top = (u: number) => { const p = at(u, 0); return ceilingAt(room, p[0], p[1]); };
    const breaks = s ? [s.run, L - s.run] : [];
    const myExts = exts.filter((e) => e.wall === w);
    const holes: Hole[] = [
      ...openings.filter((o) => o.wall === w).map((o) => ({ a0: o.a0, a1: o.a1, h: o.height })),
      // арка — только в пределах коридора
      ...myExts.map((e) => ({ a0: Math.max(e.a0, e.arch.a0), a1: Math.min(e.a1, e.arch.a1), h: e.arch.height })).filter((h) => h.a1 > h.a0),
    ];
    out.push(...strip(w === 'front' ? 'front' : 'wall', at, inward(w), 0, L, top, holes, breaks));

    // окна и двери — на стене, чуть внутри
    for (const f of (room.features ?? []).filter((x) => x.wall === w)) {
      const a0 = Math.max(0, f.a0), a1 = Math.min(L, f.a1);
      const t = Math.min(top(a0), top(a1));
      const b = f.kind === 'door' ? 0 : Math.max(0, f.bottom);
      const tt = Math.min(f.top, t);
      if (a1 - a0 < EPS || tt - b < EPS) continue;
      const pin = (u: number, z: number) => add(at(u, z), inward(w), INSET);
      out.push(quad(f.kind, [pin(a0, b), pin(a1, b), pin(a1, tt), pin(a0, tt)], inward(w)));
    }

    // коридоры и ниши за этой стеной
    for (const e of myExts) {
      const ex = (u: number, s2: number, z: number) => extPoint(room, w, u, s2, z);
      const out3 = neg(inward(w));
      const along = alongDir(w);
      const flat = () => e.height;
      out.push(quad('floor', [ex(e.a0, 0, 0), ex(e.a1, 0, 0), ex(e.a1, e.depth, 0), ex(e.a0, e.depth, 0)], [0, 0, 1]));
      // общая стена со стороны коридора: с той же аркой и проёмами
      out.push(...strip('wall', at, out3, Math.max(0, e.a0), Math.min(L, e.a1), flat, holes));
      // стена коридора за пределами комнаты (коридор заходит за угол)
      if (e.a0 < 0) out.push(...strip('wall', at, out3, e.a0, Math.min(0, e.a1), flat, []));
      if (e.a1 > L) out.push(...strip('wall', at, out3, Math.max(L, e.a0), e.a1, flat, []));
      if (!e.openStart) out.push(...strip('wall', (s2, z) => ex(e.a0, s2, z), along, 0, e.depth, flat, []));
      if (!e.openEnd) out.push(...strip('wall', (s2, z) => ex(e.a1, s2, z), neg(along), 0, e.depth, flat, []));
      if (!e.openFar) out.push(...strip('wall', (u, z) => ex(u, e.depth, z), inward(w), e.a0, e.a1, flat, []));
    }
  }

  // скос потолка — наклонная плоскость от стены до полной высоты
  if (s) {
    const L = wallLength(room, s.wall);
    const at = (u: number, z: number) => wallPoint(room, s.wall, u, z);
    const p0 = at(0, s.low), p1 = at(L, s.low);
    const p2 = add(at(L, H), inward(s.wall), s.run), p3 = add(at(0, H), inward(s.wall), s.run);
    out.push(quad('slope', [p0, p1, p2, p3], [0, 0, -1]));
  }
  return out;
}
