// 048: объекты за стенами комнаты в конструкторе — подпись как у карточки, где и на сколько объект не помещается,
// подсказки полей с допустимыми значениями и куда перейти, чтобы поправить.
import { createContext } from 'preact';
import { useContext } from 'preact/hooks';
import type { Room, WallId } from '../../../core/types';
import type { FitItem, FitOver } from '../../../core/fitRoom';
import type { RoomStep } from '../../navigation';
import { S } from '../../strings';

export interface FitIssue { f: FitItem; removed: boolean }
/** Подсказки полей карточки по суффиксу id поля (x0, dx, a0, v1, …). */
export type FitHints = Partial<Record<string, string>>;

const Issues = createContext<{ room: Room; issues: Map<string, FitIssue> } | null>(null);
export const FitIssuesProvider = Issues.Provider;

/** Ключ объекта: id, у скоса — 'slope'. */
export const fitKey = (f: FitItem) => (f.kind === 'slope' ? 'slope' : f.item.id);
/** id карточки объекта: у мебели — прежний furn-…, по нему выбирают предмет на плане. */
export const fitCardId = (f: FitItem) => (f.kind === 'zone' && f.item.kind === 'furniture' ? `furn-${f.item.id}` : `fit-${fitKey(f)}`);

/** Что не так с объектом по ключу: текст для карточки и подсказки её полей; null — объект в комнате. */
export function useFitIssues(): (key: string) => { text: string; hints: FitHints } | null {
  const c = useContext(Issues);
  return (key) => {
    const issue = c?.issues.get(key);
    return c && issue ? { text: fitText(issue), hints: fitHints(c.room, issue.f) } : null;
  };
}

const plain = (v: number) => String(Number(v.toFixed(2))).replace('.', ',');
/** Наибольшее допустимое — вниз до сантиметра: введённое как показано помещается. */
const upTo = (v: number) => plain(Math.floor(v * 100 + 1e-6) / 100);
const amount = (by: number) => (by < 1 ? S.fit.cm(String(Math.max(1, Math.round(by * 100)))) : S.fit.m(plain(by)));

/** «за задней стеной на 12 см, выше потолка на 3 см». */
export function fitDetails(over: FitOver[]): string {
  return over.map((o) => (o.side === 'ceiling' && o.by < 0.005 ? S.fit.atCeiling : S.fit.by(S.fit.past[o.side], amount(o.by)))).join(', ');
}

/** Текст для карточки и списка: где не помещается и что будет при сохранении. */
export function fitText({ f, removed }: FitIssue): string {
  const d = fitDetails(f.over);
  return `${d ? d[0].toUpperCase() + d.slice(1) : S.fit.outside}. ${removed ? S.fit.willRemove : S.fit.willTrim}`;
}

/** Подпись объекта — с тем же номером, что у его карточки. */
export function fitName(room: Room, f: FitItem): string {
  const wall = (w: WallId) => S.editor.neighbour[w];
  const nth = <T extends { id: string }>(xs: T[] | undefined, keep: (x: T) => boolean, id: string) => (xs ?? []).filter(keep).findIndex((x) => x.id === id) + 1;
  switch (f.kind) {
    case 'zone': {
      const z = f.item;
      if (z.kind === 'furniture') {
        const name = z.name || (z.furniture ? S.furniture.types[z.furniture] : S.zones.kinds.furniture);
        return `${name} (${S.furniture.type} ${nth(room.zones, (x) => x.kind === 'furniture', z.id)})`;
      }
      return `${S.zones.kinds[z.kind]} (${S.zones.kind} ${nth(room.zones, (x) => x.kind !== 'furniture', z.id)})`;
    }
    case 'opening': return `${S.openings.opening} ${nth(room.openings, (x) => x.wall === f.item.wall, f.item.id)}, ${wall(f.item.wall)}`;
    case 'feature': {
      const n = nth(room.features, (x) => x.wall === f.item.wall, f.item.id);
      return `${f.item.kind === 'window' ? S.openings.window : S.openings.door} ${n}, ${wall(f.item.wall)}`;
    }
    case 'covering': {
      const c = f.item;
      const n = nth(room.coverings, (x) => x.surface === c.surface, c.id);
      if (c.surface === 'floor') return `${S.coverings.carpet} ${n} ${S.editor.fitFloor}`;
      return `${c.kind === 'curtain' ? S.coverings.curtain : S.coverings.wallCarpet} ${n}, ${wall(c.surface)}`;
    }
    case 'extension': {
      const e = f.item;
      const n = nth(room.extensions, () => true, e.id);
      const name = e.name && e.name !== S.openings.corridor ? ` (${e.name})` : '';
      return `${S.openings.corridor} ${n}${name}, ${wall(e.wall)}`;
    }
    case 'slope': return S.shape.slopeTitle;
  }
}

/** Где объект правится: шаг конструктора, стена на шаге «Стены», предмет мебели. */
export function fitPlace(f: FitItem): { step: RoomStep; wall?: WallId; furniture?: string } {
  switch (f.kind) {
    case 'zone': return { step: 'furniture', furniture: f.item.kind === 'furniture' ? f.item.id : undefined };
    case 'opening': case 'feature': return { step: 'walls', wall: f.item.wall };
    case 'covering': return f.item.surface === 'floor' ? { step: 'floor' } : { step: 'walls', wall: f.item.surface };
    case 'extension': return { step: 'size' };
    case 'slope': return { step: 'floor' };
  }
}

/**
 * Подсказки полей: какое значение поля подходит, если остальные не менять. Пара «отступ + размер» вдоль одной
 * оси (s, d в пределах L) — у отступа предел при этом размере, у размера — при этом отступе.
 */
export function fitHints(room: Room, f: FitItem): FitHints {
  const h: FitHints = {};
  const H = room.height;
  const at = (side: FitOver['side']) => f.over.some((o) => o.side === side);
  const pair = (off: string, size: string, s: number, d: number, L: number, words: [string, string], of: string) => {
    if (d > L) { h[size] = S.fit.maxOf(upTo(L), of); return; }
    h[off] = S.fit.maxWith(upTo(L - d), words[0], plain(d));
    if (L - s >= 0.1) h[size] = S.fit.maxWith(upTo(L - s), words[1], plain(s));
    else h[size] = S.fit.maxOf(upTo(L), of);
  };
  const ends = (w: WallId): [WallId, WallId] => (w === 'front' || w === 'back' ? ['left', 'right'] : ['front', 'back']);
  const wallLen = (w: WallId) => (w === 'front' || w === 'back' ? room.width : room.depth);
  const { at: a, of } = S.fit;
  switch (f.kind) {
    case 'zone': {
      const z = f.item;
      if (z.kind === 'furniture') {
        if (at('front')) h.x0 = S.fit.min0;
        if (at('back')) pair('x0', 'dx', z.x0, z.x1 - z.x0, room.depth, [a.deep, a.offset], of.depth);
        if (at('left')) h.y0 = S.fit.min0;
        if (at('right')) pair('y0', 'dy', z.y0, z.y1 - z.y0, room.width, [a.length, a.offset], of.width);
      } else {
        if (at('front')) h.x0 = S.fit.min0;
        if (at('back')) h.x1 = S.fit.maxOf(upTo(room.depth), of.depth);
        if (at('left')) h.y0 = S.fit.min0;
        if (at('right')) h.y1 = S.fit.maxOf(upTo(room.width), of.width);
      }
      if (at('ceiling')) h.h = S.fit.maxOf(upTo(H), of.height);
      break;
    }
    case 'opening': case 'feature': {
      const o = f.item;
      const [s, e] = ends(o.wall);
      if (at(s)) h.a0 = S.fit.min0;
      if (at(e)) pair('a0', 'a1', o.a0, o.a1 - o.a0, wallLen(o.wall), [a.width, a.offset], of.wall);
      if (f.kind === 'opening' && at('ceiling')) h.h = S.fit.maxOf(upTo(H), of.height);
      if (f.kind === 'feature' && at('ceiling')) h.t = S.fit.maxOf(upTo(H), of.height);
      if (f.kind === 'feature' && at('floor')) h.b = S.fit.min0;
      break;
    }
    case 'covering': {
      const c = f.item;
      if (c.surface === 'floor') {
        if (at('front')) h.u0 = S.fit.min0;
        if (at('back')) pair('u0', 'du', c.u0, c.u1 - c.u0, room.depth, [a.length, a.offset], of.depth);
        if (at('left')) h.v0 = S.fit.min0;
        if (at('right')) pair('v0', 'dv', c.v0, c.v1 - c.v0, room.width, [a.width, a.offset], of.width);
      } else {
        const [s, e] = ends(c.surface);
        if (at(s)) h.u0 = S.fit.min0;
        if (at(e)) pair('u0', 'du', c.u0, c.u1 - c.u0, wallLen(c.surface), [a.width, a.offset], of.wall);
        if (at('floor')) h.v0 = S.fit.min0;
        if (at('ceiling')) h.v1 = S.fit.maxOf(upTo(H), of.height);
      }
      break;
    }
    case 'extension': {
      const e = f.item;
      const [s, end] = ends(e.wall);
      if (at(s)) h.aa0 = S.fit.min0;
      if (at(end)) pair('aa0', 'aa1', e.arch.a0, e.arch.a1 - e.arch.a0, wallLen(e.wall), [a.archWidth, a.archOffset], of.wall);
      if (at('ceiling')) h.ah = S.fit.maxOf(upTo(H), of.height);
      break;
    }
    case 'slope': {
      const across = f.item.wall === 'front' || f.item.wall === 'back';
      if (f.over.some((o) => o.side !== 'ceiling')) h.run = S.fit.maxOf(upTo(across ? room.depth : room.width), across ? of.depth : of.width);
      if (at('ceiling')) h.low = S.fit.maxOf(upTo(H - 0.1), of.belowCeiling);
      break;
    }
  }
  return h;
}
