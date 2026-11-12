import type { Constraints, Covering, Room, SourceSpec, SurfaceId, PlacementResult, Setup, Treatment, Vec3, Zone } from '../core/types';
import { baselinePositions } from '../core/placement';
import { clampToRoom } from '../core/system';
import { sameLayout } from './variant';
import { rotateExtension, rotateOpening, validateExtension, validateSlope } from '../core/geometry';
import type { DetectSummary, Units } from '../scan/detect';
import type { ScanRect } from '../scan/apply';
import type { VoiceSettings } from '../core/voice';
import type { Precision } from '../core/precision';

export interface Project {
  id: string;
  name: string;
  updatedAt: string;
  room: Room;
  sources: SourceSpec[];
  constraints: Constraints;
  /** Сведения о применённом скане; rotation — сколько раз после скана нажимали «Колонки у другой стены» (020). */
  scanInfo: (DetectSummary & {
    rotation?: number;
    /**
     * Границы скана, по которым сейчас построена комната (026), в координатах скана при этих единицах. Хранятся в
     * проекте, чтобы откатываться вместе с ним: от них считается сдвиг при следующей поправке границ.
     */
    applied?: { rect: ScanRect; units: Units };
  }) | null;
  result: (PlacementResult & { stale?: boolean }) | null;
  selectedIndex: number;
  /** Текущая расстановка (ручной режим, настройка). */
  current: Setup;
  /** Сохранённые варианты. */
  setups: Setup[];
  /** Запись голоса: микрофон, полоса частот, где стоит исполнитель. */
  voice?: VoiceSettings;
  /** Точность расчёта (026): общая для расстановки, настройки и голоса. Нет — стандартная. */
  precision?: Precision;
  /**
   * Комната создана (021): применён скан или ручной ввод сохранён кнопкой «Сохранить».
   * До этого экраны с расчётами предлагают сначала создать комнату.
   */
  roomReady: boolean;
}

export function defaultRoom(): Room {
  return {
    depth: 5,
    width: 4,
    height: 2.5,
    temperatureC: 20,
    materials: {
      floor: 'parquet',
      ceiling: 'concrete-painted',
      front: 'plaster',
      back: 'plaster',
      left: 'plaster',
      right: 'plaster',
    },
    furnishing: 'typical',
    source: 'manual',
    zones: [],
    leakage: 'typical',
    calibration: null,
    openings: [],
    features: [],
    treatments: [],
    treatmentsOn: false,
    coverings: [],
    furnitureList: false,
    slope: null,
    extensions: [],
    model: 'auto',
  };
}

/** Пустая комната после «Очистить»: 4 × 3 м (глубина от стены с колонками × ширина), потолок 2,7 м — без скана, проёмов, окон, мебели и обработки. */
export function emptyRoom(): Room {
  return { ...defaultRoom(), depth: 4, width: 3, height: 2.7 };
}

/**
 * «Очистить комнату»: всё, что пришло из скана или введено на экране «Комната» (проёмы, коридоры, окна, двери, скос,
 * мебель и зоны, обработка, материалы), удаляется; колонки и слушатель встают на места по умолчанию, замер текущей
 * расстановки и результаты автоподбора сбрасываются. Остаются система (колонки, сабвуферы и их настройки),
 * цель подбора и сохранённые варианты.
 */
export function clearedRoom(p: Project): Partial<Project> & { room: Room } {
  const room = emptyRoom();
  const d = defaultConstraints(room);
  const constraints: Constraints = { ...p.constraints, listenerMinX: d.listenerMinX, listenerMaxX: d.listenerMaxX };
  const b = baselinePositions(room, p.sources, constraints);
  // места — снова исходные по умолчанию: «не выбраны», иначе после новой комнаты они не пересчитались бы под неё
  const current: Setup = { ...p.current, listener: b.listener, positions: b.positions, measurement: null, history: undefined, placed: false };
  return { room, constraints, current, scanInfo: null, result: null, selectedIndex: 0, roomReady: false };
}

/** Колонки (1 — моно по центру, 2 — стерео-пара) и сабвуферы с диапазонами по умолчанию. */
export function defaultSources(speakers: number, subs: number): SourceSpec[] {
  const out: SourceSpec[] = [];
  const spkLow = subs > 0 ? 80 : 50;
  if (speakers === 1) out.push({ id: 'spkC', kind: 'speaker', fLow: spkLow, fHigh: 20000, height: 1.0 });
  if (speakers >= 2) {
    out.push({ id: 'spkL', kind: 'speaker', fLow: spkLow, fHigh: 20000, height: 1.0 });
    out.push({ id: 'spkR', kind: 'speaker', fLow: spkLow, fHigh: 20000, height: 1.0 });
  }
  for (let i = 1; i <= subs; i++) out.push(defaultSub(i));
  return out;
}

export function defaultSub(i: number): SourceSpec {
  return {
    id: `sub${i}`, kind: 'sub', fLow: 20, fHigh: 80, height: 0.3,
    delayMode: 'none', maxDelayMs: 20, phaseMode: 'polarity', levelAdjustable: true,
  };
}

const r05 = (v: number) => Math.round(v * 20) / 20;

export function defaultConstraints(room: Room): Constraints {
  return {
    speakerMinFront: 0.2,
    speakerMinSide: 0.3,
    listenerMinX: r05(0.3 * room.depth),
    listenerMaxX: r05(room.depth - 0.6),
    earHeight: 1.1,
    subZone: 'walls',
    subWallGap: 0.15,
    seats: { count: 1, spacing: 0.6 },
    crossover: { adjustable: false, min: 60, max: 120 },
  };
}

/** Расстановка по умолчанию — базовый вариант. */
export function defaultSetup(room: Room, sources: SourceSpec[], c: Constraints, name = 'Текущая'): Setup {
  const b = baselinePositions(room, sources, c);
  return { id: makeId(), name, listener: b.listener, positions: b.positions, subSettings: {}, crossoverHz: null, measurement: null, placed: false };
}

/** Приводит расстановку к текущему набору источников: добавляет недостающие, убирает лишние. */
export function syncSetup(setup: Setup, room: Room, sources: SourceSpec[], c: Constraints): Setup {
  const b = baselinePositions(room, sources, c);
  const positions: Record<string, Vec3> = {};
  for (const s of sources) positions[s.id] = setup.positions[s.id] ? { ...setup.positions[s.id], z: s.height } : b.positions[s.id];
  const subSettings = Object.fromEntries(Object.entries(setup.subSettings).filter(([id]) => positions[id]));
  return { ...setup, positions, subSettings, listener: { ...setup.listener, z: c.earHeight } };
}

export function newProject(name = 'Моя комната'): Project {
  const room = defaultRoom();
  const sources = defaultSources(2, 1);
  const constraints = defaultConstraints(room);
  return {
    id: makeId(),
    name,
    updatedAt: new Date().toISOString(),
    room,
    sources,
    constraints,
    scanInfo: null,
    result: null,
    selectedIndex: 0,
    current: defaultSetup(room, sources, constraints),
    setups: [],
    roomReady: false,
  };
}

/**
 * Проекты до 021 не знали о признаке «комната создана». Не создана она только у нетронутого проекта:
 * без скана, с размерами комнаты по умолчанию или пустой комнаты после «Очистить» (прежнее правило карточки
 * «С чего начать»), без своих объектов, материалов и обстановки и без следов работы в других разделах
 * (результат подбора, замер, сохранённые варианты, запись голоса). Иначе проект открывается как раньше.
 */
export function legacyRoomReady(room: Room, raw: {
  scanInfo?: unknown; result?: unknown; voice?: unknown; setups?: unknown[]; current?: { measurement?: unknown };
} = {}): boolean {
  if (room.source === 'scan' || raw.scanInfo) return true;
  const same = (r: Room) => room.depth === r.depth && room.width === r.width && room.height === r.height;
  if (!(same(defaultRoom()) || same(emptyRoom()))) return true;
  const base = defaultRoom();
  const objects = [room.zones, room.openings, room.features, room.extensions, room.coverings, room.treatments].some((a) => (a ?? []).length > 0);
  const surfaces = (Object.keys(base.materials) as (keyof Room['materials'])[]).some((k) => room.materials[k] !== base.materials[k]);
  const used = !!raw.result || !!raw.voice || !!raw.current?.measurement || (raw.setups ?? []).length > 0;
  return objects || !!room.slope || surfaces || room.furnishing !== base.furnishing || !!room.furnitureList || used;
}

/**
 * Проекты до 022 не хранили признак «места выбраны». Не выбраны — если стоят места по умолчанию: для этой
 * комнаты или места по умолчанию новой (5 × 4 м) либо очищенной комнаты, сдвинутые внутрь стен при смене
 * размеров (так они оставались до 022). Расстановка с замером считается выбранной.
 */
export function legacyPlaced(cur: Setup, room: Room, sources: SourceSpec[], c: Constraints): boolean {
  if (cur.measurement) return true;
  const stretched = (base: Room) => {
    const d = syncSetup(defaultSetup(base, sources, defaultConstraints(base)), room, sources, c);
    return {
      listener: clampToRoom(room, d.listener, 0.1),
      positions: Object.fromEntries(Object.entries(d.positions).map(([k, v]) => [k, clampToRoom(room, v)])),
    };
  };
  return ![defaultSetup(room, sources, c), stretched(defaultRoom()), stretched(emptyRoom())].some((d) => sameLayout(cur, d));
}

export function makeId(): string {
  const g = globalThis as { crypto?: Crypto };
  if (g.crypto && 'randomUUID' in g.crypto) return g.crypto.randomUUID();
  return 'p-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/** Точка при повороте комнаты: новая передняя стена — бывшая левая. */
export function rotatePoint(room: Room, p: Vec3): Vec3 {
  return { x: p.y, y: room.depth - p.x, z: p.z };
}

export function rotateZone(room: Room, z: Zone): Zone {
  return { ...z, x0: z.y0, x1: z.y1, y0: room.depth - z.x1, y1: room.depth - z.x0 };
}

const CORNER_ROT = { 'front-left': 'front-right', 'front-right': 'back-right', 'back-right': 'back-left', 'back-left': 'front-left' } as const;

export function rotateTreatment(room: Room, t: Treatment): Treatment {
  if (t.kind === 'corner') return { ...t, corner: CORNER_ROT[t.corner ?? 'front-left'] };
  if (t.kind === 'cloud') { const p = rotatePoint(room, { x: t.x ?? 0, y: t.y ?? 0, z: 0 }); return { ...t, x: p.x, y: p.y }; }
  const r = rotateOpening(room, { wall: t.wall ?? 'left', a0: t.at ?? 0, a1: t.at ?? 0 });
  return { ...t, wall: r.wall, at: r.a0 };
}

/** Покрытие при повороте: на стене — как проём, на полу — как зона. */
export function rotateCovering(room: Room, c: Covering): Covering {
  if (c.surface === 'floor') return { ...c, u0: c.v0, u1: c.v1, v0: room.depth - c.u1, v1: room.depth - c.u0 };
  const r = rotateOpening(room, { wall: c.surface, a0: c.u0, a1: c.u1 });
  return { ...c, surface: r.wall, u0: r.a0, u1: r.a1 };
}

export function rotateSetup(room: Room, s: Setup): Setup {
  return {
    ...s,
    listener: rotatePoint(room, s.listener),
    positions: Object.fromEntries(Object.entries(s.positions).map(([k, v]) => [k, rotatePoint(room, v)])),
  };
}

/** Поворот комнаты: колонки переносятся к другой (соседней) стене. */
export function rotateRoom(room: Room): Room {
  const m = room.materials;
  const materials: Record<SurfaceId, string> = {
    floor: m.floor,
    ceiling: m.ceiling,
    front: m.left,
    back: m.right,
    left: m.back,
    right: m.front,
  };
  return {
    ...room,
    depth: room.width,
    width: room.depth,
    materials,
    zones: (room.zones ?? []).map((z) => rotateZone(room, z)),
    openings: (room.openings ?? []).map((o) => rotateOpening(room, o)),
    features: (room.features ?? []).map((f) => rotateOpening(room, f)),
    treatments: (room.treatments ?? []).map((t) => rotateTreatment(room, t)),
    coverings: (room.coverings ?? []).map((c) => rotateCovering(room, c)),
    slope: room.slope ? { ...room.slope, wall: rotateOpening(room, { wall: room.slope.wall, a0: 0, a1: 0 }).wall } : room.slope,
    extensions: (room.extensions ?? []).map((e) => rotateExtension(room, e)),
  };
}

// ---- Валидация ----

export interface FieldError {
  field: string;
  message: string;
}

export function validateRoom(room: Room): FieldError[] {
  const errs: FieldError[] = [];
  const dim = (field: 'depth' | 'width' | 'height', label: string, max: number) => {
    const v = room[field];
    if (!Number.isFinite(v) || v < 1 || v > max) errs.push({ field, message: `${label}: от 1 до ${max} м` });
  };
  dim('depth', 'Глубина', 50);
  dim('width', 'Ширина', 50);
  dim('height', 'Высота', 20);
  if (!Number.isFinite(room.temperatureC) || room.temperatureC < -10 || room.temperatureC > 40) {
    errs.push({ field: 'temperatureC', message: 'Температура: от −10 до 40 °C' });
  }
  const se = validateSlope(room);
  if (se) errs.push({ field: 'slope', message: se });
  for (const e of room.extensions ?? []) {
    const err = validateExtension(room, e);
    if (err) errs.push({ field: `ext.${e.id}`, message: `${e.name || 'Коридор'}: ${err}` });
  }
  for (const z of room.zones ?? []) {
    if (!(z.x0 < z.x1 && z.y0 < z.y1 && z.x0 >= 0 && z.y0 >= 0 && z.x1 <= room.depth + 1e-6 && z.y1 <= room.width + 1e-6)) {
      errs.push({ field: `zone.${z.id}`, message: 'Зона должна лежать внутри комнаты' });
    }
  }
  return errs;
}

export function validateSources(sources: SourceSpec[]): FieldError[] {
  const errs: FieldError[] = [];
  const spk = sources.filter((s) => s.kind === 'speaker').length;
  const sub = sources.filter((s) => s.kind === 'sub').length;
  if (spk > 2) errs.push({ field: 'sources', message: 'Не больше 2 фронтальных колонок' });
  if (sub > 4) errs.push({ field: 'sources', message: 'Не больше 4 сабвуферов' });
  if (spk + sub === 0) errs.push({ field: 'sources', message: 'Добавьте хотя бы один источник' });
  for (const s of sources) {
    if (!(s.fLow >= 10 && s.fHigh <= 24000 && s.fLow < s.fHigh)) {
      errs.push({ field: `${s.id}.range`, message: 'Диапазон: 10 ≤ нижняя < верхняя ≤ 24000 Гц' });
    }
    if (!(s.height >= 0 && s.height <= 3)) errs.push({ field: `${s.id}.height`, message: 'Высота источника: 0–3 м' });
  }
  return errs;
}
