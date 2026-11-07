import type { Constraints, Room, SourceSpec, SurfaceId, PlacementResult } from '../core/types';
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
  for (let i = 1; i <= subs; i++) out.push({ id: `sub${i}`, kind: 'sub', fLow: 20, fHigh: 80, height: 0.3 });
  return out;
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
  };
}

export function newProject(name = 'Моя комната'): Project {
  const room = defaultRoom();
  return {
    id: makeId(),
    name,
    updatedAt: new Date().toISOString(),
    room,
    sources: defaultSources(2, 1),
    constraints: defaultConstraints(room),
    scanInfo: null,
    result: null,
    selectedIndex: 0,
  };
}

export function makeId(): string {
  const g = globalThis as { crypto?: Crypto };
  if (g.crypto && 'randomUUID' in g.crypto) return g.crypto.randomUUID();
  return 'p-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
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
  return { ...room, depth: room.width, width: room.depth, materials };
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
