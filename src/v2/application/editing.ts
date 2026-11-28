// Операции редактора комнаты (V2-021–V2-025): каждая принимает конфигурацию и возвращает новую, не меняя исходную.
// Значения по умолчанию и подбор исходных мест — из ядра и legacy (baselinePositions, newFurniture, ковры и шторы),
// чтобы новая модель вела себя как прежняя. Физические формулы здесь не меняются.
import { baselinePositions } from '../../core/placement';
import { fitCovering, newCurtain, newFurniture, newRug, newWallCarpet, rotateFurniture } from '../../core/furniture';
import { validateExtension, validateSlope } from '../../core/geometry';
import { MATERIAL_BY_ID } from '../../core/materials';
import type { Extension, FurnitureType, SurfaceId, Treatment, WallId, Zone } from '../../core/types';
import { defaultConstraints, defaultSub } from '../../state/project';
import { coreInputs } from '../adapters/core';
import type {
  DiffuserItem, Listener, Opening, OpeningKind, ResonatorItem, RoomConfiguration, Source, SystemLayout, TreatmentItem,
} from '../domain/model';
import { UNKNOWN } from '../domain/units';
import { validateDimensions, type Issue } from '../domain/validation';
import type { IdFactory, ObjectRef } from '../domain/operations';

export type EditRef = ObjectRef | { type: 'covering'; id: string };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const r2 = (v: number) => Math.round(v * 100) / 100;

export function rect(c: RoomConfiguration) {
  if (c.geometry.kind !== 'rect') throw new Error('Редактор плана пока работает с прямоугольной комнатой.');
  return c.geometry;
}

export const wallLen = (c: RoomConfiguration, wall: WallId) => (wall === 'front' || wall === 'back' ? rect(c).width : rect(c).depth);

const coreRoom = (c: RoomConfiguration) => coreInputs(c).room;

/** Привязка к сетке; шаг 0 — без привязки. */
export const snap = (v: number, step: number) => (step > 0 ? Math.round(v / step) * step : v);

// ---------- Геометрия ----------

export interface DimsResult { config: RoomConfiguration; notes: string[] }

/**
 * Новые размеры. Пока места не выбраны (`placed = false`), источники и слушатель встают на исходные места ядра для
 * новой комнаты; после выбора — сдвигаются внутрь, если оказались снаружи. Проёмы, мебель, покрытия и обработка
 * вписываются в новые стены; что не помещается — удаляется с пояснением.
 */
export function setDimensions(c: RoomConfiguration, d: { depth: number; width: number; height: number }): DimsResult {
  const g = rect(c);
  const issues = validateDimensions(d);
  if (issues.length) throw new Error(issues.map((i) => i.message).join(' '));
  const notes: string[] = [];
  const { depth: D, width: W, height: H } = d;
  const len = (w: WallId) => (w === 'front' || w === 'back' ? W : D);

  let slope = g.slope;
  if (slope) {
    const across = slope.wall === 'front' || slope.wall === 'back' ? D : W;
    const fixed = { wall: slope.wall, low: Math.min(slope.low, r2(H - 0.1)), run: Math.min(slope.run, across) };
    if (fixed.low !== slope.low || fixed.run !== slope.run) notes.push('Скос потолка уменьшен под новые размеры.');
    slope = fixed;
  }

  const openings: Opening[] = [];
  for (const o of c.openings) {
    const L = len(o.wall);
    if (o.a0 >= L - 0.1) { notes.push(`Проём на стене (${WALL_LABEL[o.wall]}) не помещается и удалён.`); continue; }
    openings.push({ ...o, a1: Math.min(o.a1, L), top: Math.min(o.top, H), bottom: Math.min(o.bottom, Math.max(0, Math.min(o.top, H) - 0.1)) });
  }
  const zones = c.zones.flatMap((z) => {
    const L = len(z.wall);
    if (z.a0 >= L - 0.1) { notes.push(`Смежная зона «${z.name}» не помещается у стены и удалена.`); return []; }
    const a1 = Math.min(z.a1, L);
    return [{ ...z, a1, arch: { ...z.arch, a0: clamp(z.arch.a0, z.a0, a1 - 0.1), a1: clamp(z.arch.a1, z.a0 + 0.1, a1), height: Math.min(z.arch.height, H) } }];
  });

  const fitZone = (z: Zone): Zone => {
    const w = Math.min(z.x1 - z.x0, D), h = Math.min(z.y1 - z.y0, W);
    const x0 = clamp(z.x0, 0, D - w), y0 = clamp(z.y0, 0, W - h);
    return { ...z, x0, x1: x0 + w, y0, y1: y0 + h, height: z.height === undefined ? undefined : Math.min(z.height, H) };
  };
  const coreRoomLike = { depth: D, width: W, height: H } as Parameters<typeof fitCovering>[0];
  const treatment = c.treatment.items.map((t): TreatmentItem => {
    if (t.kind === 'cloud') {
      const w = Math.min(t.width, D), h = Math.min(t.height, W);
      return { ...t, width: w, height: h, x: clamp(t.x ?? D / 2, w / 2, D - w / 2), y: clamp(t.y ?? W / 2, h / 2, W - h / 2) };
    }
    if (t.kind === 'corner') return { ...t, height: Math.min(t.height, H) };
    const L = len(t.wall!);
    const width = Math.min(t.width, L), height = Math.min(t.height, H);
    return { ...t, width, height, at: clamp(t.at ?? L / 2, width / 2, L - width / 2), z: clamp(t.z ?? H / 2, height / 2, H - height / 2) } as TreatmentItem;
  });

  let next: RoomConfiguration = {
    ...c,
    geometry: { ...g, depth: D, width: W, height: H, slope },
    openings, zones, treatment: { ...c.treatment, items: treatment },
    interior: {
      ...c.interior,
      obstacles: c.interior.obstacles.map(fitZone),
      coverings: c.interior.coverings.map((cv) => fitCovering(coreRoomLike, cv)),
    },
  };

  const pl = c.simulation.placement;
  const oldDef = defaultConstraints({ depth: g.depth, width: g.width, height: g.height } as never);
  const newDef = defaultConstraints({ depth: D, width: W, height: H } as never);
  const zoneDefault = pl.listenerMinX === oldDef.listenerMinX && pl.listenerMaxX === oldDef.listenerMaxX;
  next = {
    ...next,
    simulation: {
      ...next.simulation,
      placement: zoneDefault ? { ...pl, listenerMinX: newDef.listenerMinX, listenerMaxX: newDef.listenerMaxX }
        : { ...pl, listenerMinX: clamp(pl.listenerMinX, 0, D), listenerMaxX: clamp(pl.listenerMaxX, 0, D) },
    },
  };

  if (!c.placed) next = rebaseline(next);
  else {
    const inside = (p: { x: number; y: number; z: number }) => ({ x: clamp(p.x, 0.05, D - 0.05), y: clamp(p.y, 0.05, W - 0.05), z: clamp(p.z, 0.05, H - 0.05) });
    const moved = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => a.x !== b.x || a.y !== b.y || a.z !== b.z;
    let shifted = 0;
    const sources = next.audio.sources.map((s) => { const p = inside(s.position); if (moved(p, s.position)) shifted++; return { ...s, position: p }; });
    const listeners = next.listening.listeners.map((l) => { const p = inside(l.position); if (moved(p, l.position)) shifted++; return { ...l, position: p }; });
    if (shifted) notes.push(`Объекты за новыми стенами сдвинуты внутрь: ${shifted}.`);
    next = { ...next, audio: { ...next.audio, sources }, listening: { ...next.listening, listeners } };
  }
  return { config: next, notes };
}

/**
 * Исходные места: L, R, C и сабвуферы — как в ядре (`baselinePositions`). Ядро не знает тыловых и дополнительных
 * колонок и ставит их в углы, поэтому тыловые встают у боковых стен чуть позади слушателя, дополнительные — по центру
 * у передней стены на линии фронта (R18).
 */
function initialPlaces(c: RoomConfiguration): { listener: { x: number; y: number }; positions: Record<string, { x: number; y: number }> } {
  const i = coreInputs(c);
  const own = (s: Source) => s.kind === 'speaker' && !['spkL', 'spkR', 'spkC'].includes(s.id);
  const b = baselinePositions(i.room, i.sources.filter((s) => !own(c.audio.sources.find((x) => x.id === s.id)!)), i.constraints);
  const g = rect(c), side = c.simulation.placement.speakerMinSide;
  const frontX = (b.positions.spkL ?? b.positions.spkC)?.x ?? Math.max(c.simulation.placement.speakerMinFront, 0.5);
  const positions: Record<string, { x: number; y: number }> = { ...b.positions };
  for (const s of c.audio.sources.filter(own)) {
    positions[s.id] = s.channel === 'SL' || s.channel === 'SR'
      ? { x: r2(Math.min(g.depth - 0.3, b.listener.x + 0.6)), y: s.channel === 'SL' ? side : r2(g.width - side) }
      : { x: frontX, y: r2(g.width / 2) };
  }
  return { listener: b.listener, positions };
}

/** Исходные места для текущей комнаты и системы (пока пользователь их не выбрал). */
export function rebaseline(c: RoomConfiguration): RoomConfiguration {
  const b = initialPlaces(c);
  const primary = c.listening.listeners.find((l) => l.primary);
  return {
    ...c,
    audio: { ...c.audio, sources: c.audio.sources.map((s) => ({ ...s, position: { ...(b.positions[s.id] ?? s.position), z: s.position.z } })) },
    listening: {
      ...c.listening,
      listeners: c.listening.listeners.map((l) => (l === primary ? { ...l, position: { x: b.listener.x, y: b.listener.y, z: l.position.z } } : l)),
    },
  };
}

export const SURFACE_LABEL: Record<SurfaceId, string> = { floor: 'Пол', ceiling: 'Потолок', front: 'Передняя стена', back: 'Задняя стена', left: 'Левая стена', right: 'Правая стена' };
export const WALL_LABEL: Record<WallId, string> = { front: 'передняя', back: 'задняя', left: 'левая', right: 'правая' };

export function setSurface(c: RoomConfiguration, surface: SurfaceId, material: string): RoomConfiguration {
  if (!MATERIAL_BY_ID[material]) throw new Error(`Неизвестный материал «${material}».`);
  return { ...c, surfaces: { ...c.surfaces, [surface]: { material } } };
}

/** Скос потолка у одной стены; `null` — потолок ровный. */
export function setSlope(c: RoomConfiguration, slope: { wall: WallId; low: number; run: number } | null): RoomConfiguration {
  const g = rect(c);
  const next = { ...c, geometry: { ...g, slope } };
  const err = validateSlope(coreRoom(next));
  if (err) throw new Error(err);
  return next;
}

/** Смежная зона (коридор, ниша) у стены — в форме ядра; проверка — правилами ядра. */
export function newZone(c: RoomConfiguration, wall: WallId, id: string, name: string): Extension {
  const L = wallLen(c, wall), H = rect(c).height;
  const a1 = r2(Math.min(L, 1.5));
  return { id, name, wall, a0: 0, a1, depth: 1.5, height: H, arch: { a0: 0, a1, height: Math.min(2.1, H) }, openStart: false, openEnd: false, openFar: false };
}

export function upsertZone(c: RoomConfiguration, z: Extension): RoomConfiguration {
  const err = validateExtension(coreRoom(c), z);
  if (err) throw new Error(`${err}.`);
  const has = c.zones.some((x) => x.id === z.id);
  return { ...c, zones: has ? c.zones.map((x) => (x.id === z.id ? z : x)) : [...c.zones, z] };
}

export const removeZone = (c: RoomConfiguration, id: string): RoomConfiguration => ({ ...c, zones: c.zones.filter((z) => z.id !== id) });

// ---------- Проёмы ----------

export function openingIssues(c: RoomConfiguration, o: Opening): string[] {
  const L = wallLen(c, o.wall), H = rect(c).height;
  const out: string[] = [];
  if (!(o.a1 - o.a0 >= 0.1)) out.push('Ширина проёма — не меньше 10 см.');
  if (o.a0 < 0 || o.a1 > L + 1e-9) out.push(`Проём должен быть на стене: от 0 до ${r2(L)} м.`);
  if (!(o.top - o.bottom >= 0.1)) out.push('Высота проёма — не меньше 10 см.');
  if (o.bottom < 0 || o.top > H + 1e-9) out.push(`Проём должен быть по высоте от 0 до ${r2(H)} м.`);
  return out;
}

export function newOpening(c: RoomConfiguration, kind: OpeningKind, wall: WallId, id: string): Opening {
  const L = wallLen(c, wall), H = rect(c).height;
  const w = Math.min(kind === 'window' ? 1.2 : kind === 'door' ? 0.8 : 1.0, L - 0.1);
  const a0 = r2((L - w) / 2);
  const [bottom, top] = kind === 'window' ? [Math.min(0.9, H - 0.3), Math.min(2.1, H - 0.1)] : [0, Math.min(2.05, H)];
  return { id, kind, wall, a0, a1: r2(a0 + w), bottom, top, state: kind === 'passage' ? 'permanent' : 'closed' };
}

export function upsertOpening(c: RoomConfiguration, o: Opening): RoomConfiguration {
  const errs = openingIssues(c, o);
  if (errs.length) throw new Error(errs.join(' '));
  const has = c.openings.some((x) => x.id === o.id);
  return { ...c, openings: has ? c.openings.map((x) => (x.id === o.id ? o : x)) : [...c.openings, o] };
}

export const removeOpening = (c: RoomConfiguration, id: string): RoomConfiguration => ({ ...c, openings: c.openings.filter((o) => o.id !== id) });

// ---------- Аудиосистема ----------

const SPEAKER_SLOTS: Record<string, { name: string; channel: string }> = {
  spkL: { name: 'Левая колонка', channel: 'L' },
  spkR: { name: 'Правая колонка', channel: 'R' },
  spkC: { name: 'Центральная колонка', channel: 'C' },
  spkSL: { name: 'Левая тыловая', channel: 'SL' },
  spkSR: { name: 'Правая тыловая', channel: 'SR' },
};

export const LAYOUT_SLOTS: Record<Exclude<SystemLayout, 'custom'>, { speakers: string[]; subs: number }> = {
  mono: { speakers: ['spkC'], subs: 0 },
  '2.0': { speakers: ['spkL', 'spkR'], subs: 0 },
  '2.1': { speakers: ['spkL', 'spkR'], subs: 1 },
  '2.2': { speakers: ['spkL', 'spkR'], subs: 2 },
  '5.1': { speakers: ['spkL', 'spkR', 'spkC', 'spkSL', 'spkSR'], subs: 1 },
};

function speakerSource(id: string, name: string, channel: string | undefined, withSubs: boolean): Source {
  return { id, kind: 'speaker', name, channel, position: { x: 0.5, y: 0.5, z: 1.0 }, rotationDeg: 0, fLow: withSubs ? 80 : 50, fHigh: 20000, capabilities: {} };
}

function subSource(i: number): Source {
  const d = defaultSub(i);
  const { id, fLow, fHigh, height, kind: _k, ...caps } = d;
  void _k;
  return { id, kind: 'sub', name: `Сабвуфер ${i}`, channel: 'LFE', position: { x: 0.3, y: 0.3, z: height }, rotationDeg: 0, fLow, fHigh, capabilities: caps };
}

/** Новые источники — на исходных местах ядра; уже стоящие не двигаются. */
function placeNew(c: RoomConfiguration, fresh: ReadonlySet<string>): RoomConfiguration {
  if (!fresh.size) return c;
  const b = initialPlaces(c);
  return { ...c, audio: { ...c.audio, sources: c.audio.sources.map((s) => (fresh.has(s.id) && b.positions[s.id] ? { ...s, position: { ...b.positions[s.id], z: s.position.z } } : s)) } };
}

/** Стандартная схема системы: совпадающие источники сохраняются с местами и настройками, недостающие добавляются. */
export function setLayout(c: RoomConfiguration, layout: Exclude<SystemLayout, 'custom'>): RoomConfiguration {
  const slots = LAYOUT_SLOTS[layout];
  const keep = new Map(c.audio.sources.map((s) => [s.id, s]));
  const fresh = new Set<string>();
  const sources: Source[] = [];
  for (const id of slots.speakers) {
    const old = keep.get(id);
    if (old) sources.push(old);
    else { fresh.add(id); sources.push(speakerSource(id, SPEAKER_SLOTS[id].name, SPEAKER_SLOTS[id].channel, slots.subs > 0)); }
  }
  for (let n = 1; n <= slots.subs; n++) {
    const old = keep.get(`sub${n}`);
    if (old) sources.push(old);
    else { fresh.add(`sub${n}`); sources.push(subSource(n)); }
  }
  return placeNew({ ...c, audio: { ...c.audio, layout, sources } }, fresh);
}

export function addSource(c: RoomConfiguration, kind: 'speaker' | 'sub'): RoomConfiguration {
  const ids = new Set(c.audio.sources.map((s) => s.id));
  let n = 1;
  if (kind === 'sub') {
    while (ids.has(`sub${n}`)) n++;
    return placeNew({ ...c, audio: { ...c.audio, layout: 'custom', sources: [...c.audio.sources, subSource(n)] } }, new Set([`sub${n}`]));
  }
  while (ids.has(`spk${n}`)) n++;
  const s = speakerSource(`spk${n}`, `Колонка ${n}`, undefined, c.audio.sources.some((x) => x.kind === 'sub'));
  return placeNew({ ...c, audio: { ...c.audio, layout: 'custom', sources: [...c.audio.sources, s] } }, new Set([s.id]));
}

export function sourceIssues(s: Source): string[] {
  const out: string[] = [];
  if (!(s.fLow > 0 && s.fHigh > s.fLow)) out.push('Нижняя граница диапазона должна быть больше нуля и меньше верхней.');
  if (s.kind === 'sub' && s.fHigh > 250) out.push('Верхняя граница сабвуфера — не выше 250 Гц.');
  return out;
}

export function patchSource(c: RoomConfiguration, id: string, patch: Partial<Source>): RoomConfiguration {
  const s = c.audio.sources.find((x) => x.id === id);
  if (!s) throw new Error('Источник не найден.');
  const next = { ...s, ...patch, id };
  const errs = sourceIssues(next);
  if (errs.length) throw new Error(errs.join(' '));
  const g = rect(c);
  next.position = { x: clamp(next.position.x, 0, g.depth), y: clamp(next.position.y, 0, g.width), z: clamp(next.position.z, 0, g.height) };
  const moved = next.position.x !== s.position.x || next.position.y !== s.position.y;
  return { ...c, placed: c.placed || moved, audio: { ...c.audio, sources: c.audio.sources.map((x) => (x.id === id ? next : x)) } };
}

/** Пара стереоколонок для симметричного редактирования. */
export function mirrorOf(c: RoomConfiguration, id: string): Source | undefined {
  const s = c.audio.sources.find((x) => x.id === id);
  if (!s) return undefined;
  const pair: Record<string, string> = { L: 'R', R: 'L', SL: 'SR', SR: 'SL' };
  const ch = s.channel && pair[s.channel];
  return ch ? c.audio.sources.find((x) => x.channel === ch) : undefined;
}

/** Зеркально повторить положение и поворот источника для его пары относительно середины ширины. */
export function mirrorSource(c: RoomConfiguration, id: string): RoomConfiguration {
  const s = c.audio.sources.find((x) => x.id === id);
  const m = mirrorOf(c, id);
  if (!s || !m || m.locked) return c;
  const W = rect(c).width;
  return { ...c, audio: { ...c.audio, sources: c.audio.sources.map((x) => (x.id === m.id ? { ...x, position: { x: s.position.x, y: r2(W - s.position.y), z: s.position.z }, rotationDeg: -s.rotationDeg } : x)) } };
}

// ---------- Слушатели ----------

export function addListener(c: RoomConfiguration, newId: IdFactory): RoomConfiguration {
  const p = c.listening.listeners.find((l) => l.primary) ?? c.listening.listeners[0];
  const g = rect(c);
  const base = p?.position ?? { x: g.depth * 0.6, y: g.width / 2, z: 1.1 };
  const n = c.listening.listeners.length + 1;
  const l: Listener = { id: newId(), name: `Место ${n}`, position: { x: base.x, y: clamp(base.y + 0.6 * (n - 1) * (n % 2 ? -1 : 1), 0.1, g.width - 0.1), z: base.z }, weight: 1, primary: !p };
  return { ...c, listening: { ...c.listening, listeners: [...c.listening.listeners, l] } };
}

export function patchListener(c: RoomConfiguration, id: string, patch: Partial<Listener>): RoomConfiguration {
  const g = rect(c);
  const listeners = c.listening.listeners.map((l) => {
    if (l.id !== id) return patch.primary ? { ...l, primary: false } : l;
    const next = { ...l, ...patch, id };
    next.position = { x: clamp(next.position.x, 0, g.depth), y: clamp(next.position.y, 0, g.width), z: clamp(next.position.z, 0.3, g.height) };
    next.weight = clamp(next.weight, 0, 10);
    return next;
  });
  if (!listeners.some((l) => l.primary)) throw new Error('Одно место должно быть основным.');
  const cur = c.listening.listeners.find((l) => l.id === id);
  const moved = !!cur && !!patch.position && (patch.position.x !== cur.position.x || patch.position.y !== cur.position.y);
  return { ...c, placed: c.placed || moved, listening: { ...c.listening, listeners } };
}

export function removeListener(c: RoomConfiguration, id: string): RoomConfiguration {
  const rest = c.listening.listeners.filter((l) => l.id !== id);
  if (!rest.length) throw new Error('Нужно хотя бы одно место прослушивания.');
  if (!rest.some((l) => l.primary)) rest[0] = { ...rest[0], primary: true };
  return { ...c, listening: { ...c.listening, listeners: rest } };
}

// ---------- Интерьер ----------

export const FURNITURE_LABEL: Record<FurnitureType, string> = {
  sofa: 'Диван', 'sofa-open': 'Диван раскладной', armchair: 'Кресло', bed: 'Кровать', bookshelf: 'Стеллаж с книгами', wardrobe: 'Шкаф',
  shelf: 'Полка', table: 'Стол', chair: 'Стул', chest: 'Комод', other: 'Другое',
};

export function addFurniture(c: RoomConfiguration, type: FurnitureType, id: string): RoomConfiguration {
  const z = newFurniture(coreRoom(c), type, id, FURNITURE_LABEL[type]);
  return { ...c, interior: { ...c.interior, obstacles: [...c.interior.obstacles, z] } };
}

export function patchObstacle(c: RoomConfiguration, id: string, patch: Partial<Zone>): RoomConfiguration {
  const g = rect(c);
  return {
    ...c,
    interior: {
      ...c.interior,
      obstacles: c.interior.obstacles.map((z) => {
        if (z.id !== id) return z;
        const n = { ...z, ...patch, id };
        const w = clamp(n.x1 - n.x0, 0.1, g.depth), h = clamp(n.y1 - n.y0, 0.1, g.width);
        const x0 = clamp(n.x0, 0, g.depth - w), y0 = clamp(n.y0, 0, g.width - h);
        return { ...n, x0, x1: x0 + w, y0, y1: y0 + h, height: n.height === undefined ? undefined : clamp(n.height, 0.05, g.height) };
      }),
    },
  };
}

export const rotateObstacle = (c: RoomConfiguration, id: string): RoomConfiguration =>
  ({ ...c, interior: { ...c.interior, obstacles: c.interior.obstacles.map((z) => (z.id === id ? rotateFurniture(coreRoom(c), z) : z)) } });

export const removeObstacle = (c: RoomConfiguration, id: string): RoomConfiguration =>
  ({ ...c, interior: { ...c.interior, obstacles: c.interior.obstacles.filter((z) => z.id !== id) } });

export type CoveringKind = 'rug' | 'wall-carpet' | 'curtain';

export function addCovering(c: RoomConfiguration, kind: CoveringKind, id: string, wall: WallId = 'back'): RoomConfiguration {
  const room = coreRoom(c);
  const cv = kind === 'rug' ? newRug(room, id) : kind === 'wall-carpet' ? newWallCarpet(room, wall, id) : newCurtain(room, wall, id);
  return { ...c, interior: { ...c.interior, coverings: [...c.interior.coverings, cv] } };
}

export function patchCovering(c: RoomConfiguration, id: string, patch: Partial<RoomConfiguration['interior']['coverings'][number]>): RoomConfiguration {
  const room = coreRoom(c);
  return { ...c, interior: { ...c.interior, coverings: c.interior.coverings.map((cv) => (cv.id === id ? fitCovering(room, { ...cv, ...patch, id }) : cv)) } };
}

export const removeCovering = (c: RoomConfiguration, id: string): RoomConfiguration =>
  ({ ...c, interior: { ...c.interior, coverings: c.interior.coverings.filter((cv) => cv.id !== id) } });

// ---------- Обработка ----------

export type TreatmentKind = 'panel' | 'corner' | 'cloud' | 'diffuser' | 'resonator';
export const TREATMENT_LABEL: Record<TreatmentKind, string> = { panel: 'Панель на стене', corner: 'Угловая ловушка', cloud: 'Потолочное облако', diffuser: 'Диффузор', resonator: 'Резонатор' };

export function newTreatment(c: RoomConfiguration, kind: TreatmentKind, id: string): TreatmentItem {
  const g = rect(c);
  switch (kind) {
    case 'panel': return { id, kind: 'panel', wall: 'left', at: r2(g.depth / 3), z: 1.2, width: 0.6, height: 1.2, thickness: 0.1, gap: 0, enabled: true };
    case 'corner': return { id, kind: 'corner', corner: 'front-left', width: 0.6, height: g.height, thickness: 0.3, enabled: true };
    case 'cloud': return { id, kind: 'cloud', x: r2(g.depth / 2), y: r2(g.width / 2), width: 1.2, height: 1.2, thickness: 0.1, gap: 0.2, enabled: true };
    case 'diffuser': return { id, kind: 'diffuser', design: 'qrd-1d', wall: 'back', at: r2(g.width / 2), z: 1.3, width: 0.6, height: 0.6, depth: 0.2, enabled: true } satisfies DiffuserItem;
    case 'resonator': return { id, kind: 'resonator', design: 'helmholtz', wall: 'front', at: r2(g.width / 2), z: 0.6, width: 0.6, height: 0.6, depth: 0.2, tuningHz: UNKNOWN, enabled: true } satisfies ResonatorItem;
  }
}

export const addTreatment = (c: RoomConfiguration, item: TreatmentItem): RoomConfiguration =>
  ({ ...c, treatment: { ...c.treatment, items: [...c.treatment.items, item] } });

export function patchTreatment(c: RoomConfiguration, id: string, patch: Partial<TreatmentItem>): RoomConfiguration {
  const g = rect(c);
  return {
    ...c,
    treatment: {
      ...c.treatment,
      items: c.treatment.items.map((t) => {
        if (t.id !== id) return t;
        const n = { ...t, ...patch, id } as TreatmentItem;
        if (n.kind === 'cloud') {
          const w = clamp(n.width, 0.1, g.depth), h = clamp(n.height, 0.1, g.width);
          return { ...n, width: w, height: h, x: clamp(n.x ?? g.depth / 2, w / 2, g.depth - w / 2), y: clamp(n.y ?? g.width / 2, h / 2, g.width - h / 2) };
        }
        if (n.kind === 'corner') return { ...n, width: clamp(n.width, 0.1, 2), height: clamp(n.height, 0.1, g.height) };
        const L = wallLen(c, n.wall!);
        const width = clamp(n.width, 0.1, L), height = clamp(n.height, 0.1, g.height);
        return { ...n, width, height, at: clamp(n.at ?? L / 2, width / 2, L - width / 2), z: clamp(n.z ?? g.height / 2, height / 2, g.height - height / 2) } as TreatmentItem;
      }),
    },
  };
}

export const removeTreatment = (c: RoomConfiguration, id: string): RoomConfiguration =>
  ({ ...c, treatment: { ...c.treatment, items: c.treatment.items.filter((t) => t.id !== id) } });

// ---------- Перемещение на плане, блокировка, удаление ----------

/** Переместить объект: точка — центр; у элемента на стене меняется место вдоль стены и высота. */
export function moveRef(c: RoomConfiguration, ref: EditRef, to: { x?: number; y?: number; z?: number }): RoomConfiguration {
  switch (ref.type) {
    case 'source': {
      const s = c.audio.sources.find((x) => x.id === ref.id);
      if (!s || s.locked) return c;
      return patchSource(c, ref.id, { position: { x: to.x ?? s.position.x, y: to.y ?? s.position.y, z: to.z ?? s.position.z } });
    }
    case 'listener': {
      const l = c.listening.listeners.find((x) => x.id === ref.id);
      if (!l || l.locked) return c;
      return patchListener(c, ref.id, { position: { x: to.x ?? l.position.x, y: to.y ?? l.position.y, z: to.z ?? l.position.z } });
    }
    case 'obstacle': {
      const z = c.interior.obstacles.find((o) => o.id === ref.id);
      if (!z || z.locked) return c;
      const dx = to.x === undefined ? 0 : to.x - (z.x0 + z.x1) / 2, dy = to.y === undefined ? 0 : to.y - (z.y0 + z.y1) / 2;
      return patchObstacle(c, ref.id, { x0: z.x0 + dx, x1: z.x1 + dx, y0: z.y0 + dy, y1: z.y1 + dy });
    }
    case 'treatment': {
      const t = c.treatment.items.find((x) => x.id === ref.id);
      if (!t || t.locked) return c;
      if (t.kind === 'cloud') return patchTreatment(c, ref.id, { x: to.x ?? t.x, y: to.y ?? t.y } as Partial<Treatment>);
      if (t.kind === 'corner') return c;
      const along = t.wall === 'front' || t.wall === 'back' ? to.y : to.x;
      return patchTreatment(c, ref.id, { at: along ?? t.at, z: to.z ?? t.z } as Partial<TreatmentItem>);
    }
    case 'covering': {
      const cv = c.interior.coverings.find((x) => x.id === ref.id);
      if (!cv || cv.surface !== 'floor') return c;
      const g = rect(c), w = cv.u1 - cv.u0, h = cv.v1 - cv.v0;
      const u0 = clamp((to.x ?? (cv.u0 + cv.u1) / 2) - w / 2, 0, g.depth - w), v0 = clamp((to.y ?? (cv.v0 + cv.v1) / 2) - h / 2, 0, g.width - h);
      return patchCovering(c, ref.id, { u0, u1: u0 + w, v0, v1: v0 + h });
    }
    case 'opening': {
      const o = c.openings.find((x) => x.id === ref.id);
      if (!o) return c;
      const along = o.wall === 'front' || o.wall === 'back' ? to.y : to.x;
      if (along === undefined) return c;
      const w = o.a1 - o.a0, L = wallLen(c, o.wall);
      const a0 = r2(clamp(along - w / 2, 0, L - w));
      return upsertOpening(c, { ...o, a0, a1: r2(a0 + w) });
    }
  }
}

/** Перемещение с симметрией: пара стереоколонок (L/R, SL/SR) повторяет движение зеркально. */
export function moveSymmetric(c: RoomConfiguration, ref: EditRef, to: { x?: number; y?: number; z?: number }): RoomConfiguration {
  const next = moveRef(c, ref, to);
  return ref.type === 'source' && next !== c && mirrorOf(next, ref.id) ? mirrorSource(next, ref.id) : next;
}

export function isLocked(c: RoomConfiguration, ref: EditRef): boolean {
  const list: { id: string; locked?: boolean }[] = ref.type === 'source' ? c.audio.sources : ref.type === 'listener' ? c.listening.listeners
    : ref.type === 'obstacle' ? c.interior.obstacles : ref.type === 'treatment' ? c.treatment.items : [];
  return !!list.find((x) => x.id === ref.id)?.locked;
}

export function lockRef(c: RoomConfiguration, ref: EditRef, locked: boolean): RoomConfiguration {
  const set = <T extends { id: string }>(xs: T[]) => xs.map((x) => (x.id === ref.id ? { ...x, locked } : x));
  switch (ref.type) {
    case 'source': return { ...c, audio: { ...c.audio, sources: set(c.audio.sources) } };
    case 'listener': return { ...c, listening: { ...c.listening, listeners: set(c.listening.listeners) } };
    case 'obstacle': return { ...c, interior: { ...c.interior, obstacles: set(c.interior.obstacles) } };
    case 'treatment': return { ...c, treatment: { ...c.treatment, items: set(c.treatment.items) } };
    default: return c;
  }
}

export function removeRef(c: RoomConfiguration, ref: EditRef): RoomConfiguration {
  switch (ref.type) {
    case 'source': return { ...c, audio: { ...c.audio, layout: 'custom', sources: c.audio.sources.filter((s) => s.id !== ref.id) } };
    case 'listener': return removeListener(c, ref.id);
    case 'obstacle': return removeObstacle(c, ref.id);
    case 'treatment': return removeTreatment(c, ref.id);
    case 'covering': return removeCovering(c, ref.id);
    case 'opening': return removeOpening(c, ref.id);
  }
}

// ---------- Проверка расстановки ----------

const inZone = (p: { x: number; y: number }, z: Zone, pad = 0) => p.x > z.x0 - pad && p.x < z.x1 + pad && p.y > z.y0 - pad && p.y < z.y1 + pad;
const overlap = (a0: number, a1: number, b0: number, b1: number) => Math.min(a1, b1) - Math.max(a0, b0) > 0.01;
const cmText = (m: number) => `${Math.round(m * 100)} см`;

/**
 * Столкновения и допустимые области: источники у стен (с учётом корпуса, если размеры известны), источники и слушатели
 * в мебели, элементы на стене поверх проёмов, пересекающиеся проёмы. Это предупреждения, а не запреты.
 */
export function placementIssues(c: RoomConfiguration): Issue[] {
  if (c.geometry.kind !== 'rect') return [];
  const g = c.geometry;
  const pl = c.simulation.placement;
  const out: Issue[] = [];
  const blocking = c.interior.obstacles.filter((z) => !z.canSit || z.kind !== 'furniture');
  for (const s of c.audio.sources) {
    const box = s.box && !('missing' in s.box) ? s.box : null;
    const halfD = box ? box.d / 2 : 0, halfW = box ? box.w / 2 : 0;
    const front = s.position.x - halfD, side = Math.min(s.position.y - halfW, g.width - s.position.y - halfW);
    const path = `source:${s.id}`;
    if (front < -1e-6 || side < -1e-6 || s.position.x + halfD > g.depth + 1e-6) out.push({ severity: 'error', path, message: `${s.name}: корпус выходит за стены.` });
    else if (s.kind === 'speaker' && front < pl.speakerMinFront - 1e-6) out.push({ severity: 'warning', path, message: `${s.name}: до передней стены ${cmText(front)} — меньше заданных ${cmText(pl.speakerMinFront)}.` });
    else if (s.kind === 'speaker' && side < pl.speakerMinSide - 1e-6) out.push({ severity: 'warning', path, message: `${s.name}: до боковой стены ${cmText(side)} — меньше заданных ${cmText(pl.speakerMinSide)}.` });
    const hit = blocking.find((z) => inZone(s.position, z));
    if (hit) out.push({ severity: 'warning', path, message: `${s.name} стоит на месте предмета «${hit.name ?? 'интерьер'}».` });
  }
  for (const l of c.listening.listeners) {
    const hit = c.interior.obstacles.find((z) => !z.canSit && inZone(l.position, z));
    if (hit) out.push({ severity: 'warning', path: `listener:${l.id}`, message: `${l.name}: на месте предмета «${hit.name ?? 'интерьер'}», где нельзя сидеть.` });
    const near = c.audio.sources.find((s) => Math.hypot(s.position.x - l.position.x, s.position.y - l.position.y) < 0.5);
    if (near) out.push({ severity: 'warning', path: `listener:${l.id}`, message: `${l.name}: ближе 50 см к источнику «${near.name}».` });
  }
  for (const t of c.treatment.items) {
    if (t.kind === 'cloud' || t.kind === 'corner') continue;
    const a0 = (t.at ?? 0) - t.width / 2, a1 = (t.at ?? 0) + t.width / 2, z0 = (t.z ?? 0) - t.height / 2, z1 = (t.z ?? 0) + t.height / 2;
    const o = c.openings.find((x) => x.wall === t.wall && overlap(a0, a1, x.a0, x.a1) && overlap(z0, z1, x.bottom, x.top));
    if (o) out.push({ severity: 'warning', path: `treatment:${t.id}`, message: `Элемент обработки закрывает ${o.kind === 'window' ? 'окно' : o.kind === 'door' ? 'дверь' : 'проём'} на стене (${WALL_LABEL[o.wall]}).` });
  }
  c.openings.forEach((o, i) => {
    const other = c.openings.slice(i + 1).find((x) => x.wall === o.wall && overlap(o.a0, o.a1, x.a0, x.a1) && overlap(o.bottom, o.top, x.bottom, x.top));
    if (other) out.push({ severity: 'warning', path: `opening:${o.id}`, message: `Проёмы на стене (${WALL_LABEL[o.wall]}) пересекаются.` });
  });
  return out;
}
