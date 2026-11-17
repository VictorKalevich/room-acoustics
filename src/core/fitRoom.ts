// Объекты комнаты внутри её стен (020/021). Сдвиг начала координат при поправке границ скана и проверка
// после уменьшения комнаты: мебель, зоны, окна, двери, проёмы, ковры и шторы обрезаются по стенам,
// а оказавшиеся целиком снаружи удаляются; скос и коридоры приводятся к размерам комнаты.
// Список изменений показывается пользователю до сохранения.
import type { Covering, Extension, Opening, Room, Treatment, WallFeature, WallId, Zone } from './types';

/** Миллиметры: без хвостов округления после сдвига. */
const mm = (v: number) => Math.round(v * 1000) / 1000;
/** Участок [a, b] в пределах [lo, hi]; округляется только то, что сдвинуто или обрезано. Короче 0,1 м — нет. */
const clip = (a: number, b: number, lo: number, hi: number, shifted: boolean): [number, number] | null => {
  const s = Math.min(a, b), e = Math.max(a, b);
  const a0 = Math.max(lo, s), a1 = Math.min(hi, e);
  const r0 = shifted || a0 !== s ? mm(a0) : a0, r1 = shifted || a1 !== e ? mm(a1) : a1;
  return r1 - r0 >= 0.1 ? [r0, r1] : null;
};
const len = (room: { depth: number; width: number }, w: WallId) => (w === 'front' || w === 'back' ? room.width : room.depth);

/**
 * Сдвиг начала координат на (dx, dy) при новых размерах: элементы остаются на тех же местах настоящей
 * комнаты. То, что оказалось за новыми стенами, обрезается; совсем снаружи — удаляется.
 * С dx = dy = 0 — просто вписывание объектов в комнату её текущих размеров.
 */
export function shiftRoom(room: Room, dx: number, dy: number, depth: number, width: number): Room {
  const along = (w: WallId) => (w === 'front' || w === 'back' ? dy : dx);
  const sized = { ...room, depth, width };
  const H = room.height;
  const sx = dx !== 0, sy = dy !== 0;
  const sa = (w: WallId) => along(w) !== 0;
  const zones = (room.zones ?? []).flatMap((z): Zone[] => {
    const x = clip(z.x0 - dx, z.x1 - dx, 0, depth, sx), y = clip(z.y0 - dy, z.y1 - dy, 0, width, sy);
    if (!x || !y) return [];
    const n: Zone = { ...z, x0: x[0], x1: x[1], y0: y[0], y1: y[1] };
    if (n.height !== undefined && n.height > H) n.height = H;
    return [n];
  });
  const openings = (room.openings ?? []).flatMap((o): Opening[] => {
    const r = clip(o.a0 - along(o.wall), o.a1 - along(o.wall), 0, len(sized, o.wall), sa(o.wall));
    return r ? [{ ...o, a0: r[0], a1: r[1], height: Math.min(o.height, H) }] : [];
  });
  const features = (room.features ?? []).flatMap((f): WallFeature[] => {
    const r = clip(f.a0 - along(f.wall), f.a1 - along(f.wall), 0, len(sized, f.wall), sa(f.wall));
    const v = clip(f.bottom, f.top, 0, H, false);
    return r && v ? [{ ...f, a0: r[0], a1: r[1], bottom: v[0], top: v[1] }] : [];
  });
  const coverings = (room.coverings ?? []).flatMap((c): Covering[] => {
    const floor = c.surface === 'floor';
    const du = floor ? dx : along(c.surface as WallId), dv = floor ? dy : 0;
    const u = clip(c.u0 - du, c.u1 - du, 0, floor ? depth : len(sized, c.surface as WallId), du !== 0);
    const v = clip(c.v0 - dv, c.v1 - dv, 0, floor ? width : H, dv !== 0);
    return u && v ? [{ ...c, u0: u[0], u1: u[1], v0: v[0], v1: v[1] }] : [];
  });
  const extensions = (room.extensions ?? []).map((e): Extension => {
    const d = along(e.wall);
    if (!d) return e;
    return { ...e, a0: mm(e.a0 - d), a1: mm(e.a1 - d), arch: { ...e.arch, a0: mm(e.arch.a0 - d), a1: mm(e.arch.a1 - d) } };
  });
  const treatments = (room.treatments ?? []).map((t): Treatment => {
    if (t.kind === 'cloud' && (dx || dy)) return { ...t, x: mm((t.x ?? 0) - dx), y: mm((t.y ?? 0) - dy) };
    if (t.kind === 'panel' && t.wall && along(t.wall)) return { ...t, at: mm((t.at ?? len(room, t.wall) / 2) - along(t.wall)) };
    return t;
  });
  return fitShape({ ...sized, zones, openings, features, coverings, extensions, treatments });
}

type Slope = NonNullable<Room['slope']>;

/**
 * Скос и коридоры в пределах комнаты (021): ширина скоса — не больше стены, высота у стены — ниже потолка;
 * коридор — у своей стены, арка — в общей части стены и коридора и не выше комнаты. То, что после этого
 * теряет смысл (скос уже 0,2 м или ниже 0,5 м, арка короче 0,1 м или ниже 0,5 м), удаляется — иначе
 * проверка комнаты не проходит и проект не открывается.
 */
function fitShape(room: Room): Room {
  const H = room.height;
  let slope: Slope | null = room.slope ?? null;
  if (slope) {
    const extent = slope.wall === 'front' || slope.wall === 'back' ? room.depth : room.width;
    const run = Math.min(slope.run, extent);
    const low = slope.low < H ? slope.low : mm(H - 0.1);
    slope = run > 0.2 && low >= 0.5 ? (run === slope.run && low === slope.low ? slope : { ...slope, run, low }) : null;
  }
  const extensions = (room.extensions ?? []).flatMap((e): Extension[] => {
    const L = len(room, e.wall);
    const a0 = Math.max(e.a0, -20), a1 = Math.min(e.a1, mm(L + 20));
    if (!(a1 - a0 >= 0.1)) return [];
    const arch = clip(e.arch.a0, e.arch.a1, Math.max(a0, 0), Math.min(a1, L), false);
    const height = Math.min(e.arch.height, e.height, H);
    if (!arch || !(height > 0.5)) return [];
    const same = a0 === e.a0 && a1 === e.a1 && arch[0] === e.arch.a0 && arch[1] === e.arch.a1 && height === e.arch.height;
    return [same ? e : { ...e, a0, a1, arch: { ...e.arch, a0: arch[0], a1: arch[1], height } }];
  });
  return room.slope ? { ...room, slope, extensions } : { ...room, extensions };
}

/** 048: выход за стены меньше сантиметра — неточность округления (скан, размеры в миллиметрах), подравнивается молча. */
export const FIT_TOLERANCE = 0.01;
/** Не меньше допуска: 5,01 − 5 в двоичной записи чуть меньше 0,01. */
const notSmall = (v: number) => v > FIT_TOLERANCE - 1e-9;

/** Куда объект выходит за комнату. */
export type FitSide = WallId | 'ceiling' | 'floor';
/** На сколько метров объект заходит за стену, потолок или пол. */
export interface FitOver { side: FitSide; by: number }

type FitTarget =
  | { kind: 'zone'; item: Zone }
  | { kind: 'opening'; item: Opening }
  | { kind: 'feature'; item: WallFeature }
  | { kind: 'covering'; item: Covering }
  | { kind: 'extension'; item: Extension }
  | { kind: 'slope'; item: Slope };
/** Объект, который при сохранении обрежется или удалится; over пуст, если дело не в стенах (скос уже 0,2 м и т. п.). */
export type FitItem = FitTarget & { over: FitOver[] };
export type FitKind = FitItem['kind'];

/** Стены у начала и конца участка вдоль стены: у передней и задней отступ — от левой, у боковых — от передней. */
const ENDS: Record<WallId, [WallId, WallId]> = { front: ['left', 'right'], back: ['left', 'right'], left: ['front', 'back'], right: ['front', 'back'] };
const OPPOSITE: Record<WallId, WallId> = { front: 'back', back: 'front', left: 'right', right: 'left' };

/** За какими стенами, потолком или полом объект и на сколько (только то, что не меньше допуска). */
function overOf(room: Room, t: FitTarget): FitOver[] {
  const out: FitOver[] = [];
  const H = room.height;
  const past = (side: FitSide, by: number) => { if (notSmall(by)) out.push({ side, by: mm(by) }); };
  const span = (a: number, b: number, L: number, [s, e]: [FitSide, FitSide]) => {
    past(s, -Math.min(a, b));
    past(e, Math.max(a, b) - L);
  };
  switch (t.kind) {
    case 'zone':
      span(t.item.x0, t.item.x1, room.depth, ['front', 'back']);
      span(t.item.y0, t.item.y1, room.width, ['left', 'right']);
      if (t.item.height !== undefined) past('ceiling', t.item.height - H);
      break;
    case 'opening':
      span(t.item.a0, t.item.a1, len(room, t.item.wall), ENDS[t.item.wall]);
      past('ceiling', t.item.height - H);
      break;
    case 'feature':
      span(t.item.a0, t.item.a1, len(room, t.item.wall), ENDS[t.item.wall]);
      past('floor', -Math.min(t.item.bottom, t.item.top));
      past('ceiling', Math.max(t.item.bottom, t.item.top) - H);
      break;
    case 'covering': {
      const c = t.item;
      if (c.surface === 'floor') {
        span(c.u0, c.u1, room.depth, ['front', 'back']);
        span(c.v0, c.v1, room.width, ['left', 'right']);
      } else {
        span(c.u0, c.u1, len(room, c.surface), ENDS[c.surface]);
        span(c.v0, c.v1, H, ['floor', 'ceiling']);
      }
      break;
    }
    case 'extension':
      span(t.item.arch.a0, t.item.arch.a1, len(room, t.item.wall), ENDS[t.item.wall]);
      past('ceiling', t.item.arch.height - H);
      break;
    case 'slope': {
      const s = t.item;
      past(OPPOSITE[s.wall], s.run - (s.wall === 'front' || s.wall === 'back' ? room.depth : room.width));
      // низ скоса должен быть ниже потолка: и «вровень» — тоже не помещается
      if (s.low >= H) out.push({ side: 'ceiling', by: mm(s.low - H) });
      break;
    }
  }
  return out;
}

/** Наибольшее расхождение чисел двух объектов, включая вложенные (арка коридора); другое нечисловое — бесконечность. */
function maxShift(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b);
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const x = a as Record<string, unknown>, y = b as Record<string, unknown>;
    let m = 0;
    for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) m = Math.max(m, maxShift(x[k], y[k]));
    return m;
  }
  return a === b ? 0 : Infinity;
}

/**
 * Вписать объекты в стены комнаты: итог и что удалено или обрезано (по сравнению с исходными объектами).
 * 048: обрезанное меньше чем на FIT_TOLERANCE в итог входит, но в списки не попадает.
 */
export function fitRoomObjects(room: Room): { room: Room; removed: FitItem[]; trimmed: FitItem[] } {
  const fitted = shiftRoom(room, 0, 0, room.depth, room.width);
  const removed: FitItem[] = [], trimmed: FitItem[] = [];
  let changed = false;
  const check = (t: FitTarget, after: unknown) => {
    const shift = after === undefined ? Infinity : maxShift(t.item, after);
    if (shift === 0) return;
    changed = true;
    if (notSmall(shift)) (after === undefined ? removed : trimmed).push({ ...t, over: overOf(room, t) });
  };
  const diff = <T extends { id: string }>(kind: FitKind, before: T[] | undefined, after: T[] | undefined) => {
    const next = new Map((after ?? []).map((x) => [x.id, x]));
    for (const b of before ?? []) check({ kind, item: b } as unknown as FitTarget, next.get(b.id));
  };
  diff('zone', room.zones, fitted.zones);
  diff('opening', room.openings, fitted.openings);
  diff('feature', room.features, fitted.features);
  diff('covering', room.coverings, fitted.coverings);
  diff('extension', room.extensions, fitted.extensions);
  if (room.slope) check({ kind: 'slope', item: room.slope }, fitted.slope ?? undefined);
  // без изменений — исходный объект, чтобы не плодить лишних обновлений
  return { room: changed ? fitted : room, removed, trimmed };
}
