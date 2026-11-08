import type { Constraints, Room, SourceSpec, SurfaceId, PlacementResult, Setup, Vec3, Zone } from '../core/types';
import { baselinePositions } from '../core/placement';
import { rotateExtension, rotateOpening, validateExtension } from '../core/geometry';
import type { DetectSummary } from '../scan/detect';

export interface Project {
  id: string;
  name: string;
  updatedAt: string;
  room: Room;
  sources: SourceSpec[];
  constraints: Constraints;
  scanInfo: DetectSummary | null;
  result: (PlacementResult & { stale?: boolean }) | null;
  selectedIndex: number;
  /** Текущая расстановка (ручной режим, настройка). */
  current: Setup;
  /** Сохранённые варианты. */
  setups: Setup[];
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
    extensions: [],
    model: 'auto',
  };
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
  return { id: makeId(), name, listener: b.listener, positions: b.positions, subSettings: {}, crossoverHz: null, measurement: null };
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
  };
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
