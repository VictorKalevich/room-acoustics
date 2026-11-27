// Адаптер v2 ↔ ядро (059, V2-007). Ядро `src/core` не меняется: конфигурация v2 переводится в его входы
// (Room, SourceSpec[], Constraints, Setup) и обратно. Оси совпадают (R01), перестановок нет.
import type { Constraints, Room as CoreRoom, Opening as CoreOpening, Setup, SourceSpec, Treatment, WallFeature } from '../../core/types';
import type { Precision } from '../../core/precision';
import type { VoiceSettings } from '../../core/voice';
import type { Opening, RoomConfiguration, Source, SourceCapabilities, SystemLayout } from '../domain/model';

export interface CoreInputs {
  room: CoreRoom;
  sources: SourceSpec[];
  constraints: Constraints;
  setup: Setup;
  precision?: Precision;
  voice?: VoiceSettings;
}

export type CoreConversion =
  | { ok: true; inputs: CoreInputs; warnings: string[]; limitations: string[] }
  | { ok: false; reason: string };

const OPEN_BOTTOM_TOLERANCE = 0.05;

function splitOpenings(openings: Opening[], warnings: string[]): { openings: CoreOpening[]; features: WallFeature[] } {
  const outO: CoreOpening[] = [];
  const outF: WallFeature[] = [];
  for (const o of openings) {
    const tag = o.fromScan ? { fromScan: true } : {};
    if (o.state === 'closed' && o.kind !== 'passage') {
      outF.push({ id: o.id, kind: o.kind, wall: o.wall, ...tag, a0: o.a0, a1: o.a1, bottom: o.bottom, top: o.top });
      continue;
    }
    // Открытый проём в ядре начинается от пола: проём выше пола передаётся той же площади, о чём сообщается.
    const raised = o.bottom > OPEN_BOTTOM_TOLERANCE;
    if (raised) warnings.push(`Открытый проём «${o.id}» поднят над полом: в расчёте он учтён от пола с той же площадью.`);
    if (o.state === 'unknown-neighbour') warnings.push(`За проёмом «${o.id}» неописанное пространство: оно считается большим открытым объёмом.`);
    outO.push({ id: o.id, wall: o.wall, ...tag, a0: o.a0, a1: o.a1, height: raised ? o.top - o.bottom : o.top });
  }
  return { openings: outO, features: outF };
}

const pick = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

function toSourceSpec(s: Source): SourceSpec {
  return pick({ id: s.id, kind: s.kind, fLow: s.fLow, fHigh: s.fHigh, height: s.position.z, ...s.capabilities, passport: s.passport });
}

/** Конфигурация v2 → входы ядра. Произвольный контур ядро не считает: результат — отказ с причиной. */
export function toCore(c: RoomConfiguration): CoreConversion {
  if (c.geometry.kind !== 'rect') return { ok: false, reason: 'Расчёт ядра доступен для прямоугольной комнаты (со скосом потолка и смежными зонами).' };
  const listener = c.listening.listeners.find((l) => l.primary);
  if (!listener) return { ok: false, reason: 'Нужен основной слушатель.' };
  const warnings: string[] = [];
  const limitations: string[] = [];
  const { openings, features } = splitOpenings(c.openings, warnings);
  const porous = c.treatment.items.filter((t): t is Treatment => t.kind === 'corner' || t.kind === 'panel' || t.kind === 'cloud');
  if (c.treatment.enabled && porous.length < c.treatment.items.filter((t) => t.enabled !== false).length) {
    limitations.push('Диффузоры и резонаторы в расчёт ядра не входят: учтено только пористое поглощение.');
  }
  if (c.listening.listeners.length > 1) limitations.push('Ядро оценивает основное место и ряд мест вокруг него; другие слушатели учитываются отдельно.');
  const g = c.geometry;
  const sp = c.simulation;
  const room: CoreRoom = {
    depth: g.depth, width: g.width, height: g.height, temperatureC: sp.temperatureC,
    materials: {
      floor: c.surfaces.floor.material, ceiling: c.surfaces.ceiling.material, front: c.surfaces.front.material,
      back: c.surfaces.back.material, left: c.surfaces.left.material, right: c.surfaces.right.material,
    },
    furnishing: c.interior.furnishing, source: c.geometrySource, zones: structuredClone(c.interior.obstacles), leakage: sp.leakage,
    calibration: sp.calibration ? { ...sp.calibration } : null, openings, extensions: structuredClone(c.zones), model: sp.model, features,
    slope: g.slope ? { ...g.slope } : null, treatments: structuredClone(porous), treatmentsOn: c.treatment.enabled,
    coverings: structuredClone(c.interior.coverings), furnitureList: c.interior.furnitureList,
  };
  const sources = c.audio.sources.map(toSourceSpec);
  const pl = sp.placement;
  const constraints: Constraints = pick({
    speakerMinFront: pl.speakerMinFront, speakerMinSide: pl.speakerMinSide, listenerMinX: pl.listenerMinX, listenerMaxX: pl.listenerMaxX,
    earHeight: listener.position.z, subZone: pl.subZone, subWallGap: pl.subWallGap, seats: { ...c.listening.seats },
    crossover: { ...c.audio.crossover }, dba: pl.dba, objective: sp.objective ? structuredClone(sp.objective) : undefined, houseCurve: sp.houseCurve,
  });
  const setup: Setup = {
    id: c.id, name: c.role === 'current' ? 'Текущая' : 'Эксперимент', listener: { ...listener.position },
    positions: Object.fromEntries(c.audio.sources.map((s) => [s.id, { ...s.position }])),
    subSettings: Object.fromEntries(c.audio.sources.filter((s) => s.settings).map((s) => [s.id, structuredClone(s.settings!)])),
    crossoverHz: c.audio.crossoverHz, measurement: null, placed: c.placed,
  };
  const inputs: CoreInputs = pick({ room, sources, constraints, setup, precision: sp.precision, voice: c.voice ?? undefined });
  return { ok: true, inputs, warnings, limitations };
}

export function coreInputs(c: RoomConfiguration): CoreInputs {
  const r = toCore(c);
  if (!r.ok) throw new Error(r.reason);
  return r.inputs;
}

const SOURCE_NAMES: Record<string, { name: string; channel: string }> = {
  spkL: { name: 'Левая колонка', channel: 'L' },
  spkR: { name: 'Правая колонка', channel: 'R' },
  spkC: { name: 'Центральная колонка', channel: 'C' },
};

export function sourceLabel(s: SourceSpec, subIndex: number): { name: string; channel: string } {
  return SOURCE_NAMES[s.id] ?? (s.kind === 'sub' ? { name: `Сабвуфер ${subIndex}`, channel: 'LFE' } : { name: `Колонка ${s.id}`, channel: s.id });
}

export function layoutOf(sources: SourceSpec[]): SystemLayout {
  const spk = sources.filter((s) => s.kind === 'speaker').map((s) => s.id).sort().join(',');
  const subs = sources.filter((s) => s.kind === 'sub').length;
  if (spk === 'spkC' && subs === 0) return 'mono';
  if (spk === 'spkL,spkR' && subs <= 2) return (['2.0', '2.1', '2.2'] as const)[subs];
  return 'custom';
}

/** Входы ядра → конфигурация v2 (для миграции legacy и проверки обратимости адаптера). */
export function fromCore(inputs: CoreInputs, meta: { id: string; role: RoomConfiguration['role']; revision: number; scan?: unknown }): RoomConfiguration {
  const { room, sources, constraints: k, setup } = inputs;
  let subN = 0;
  const v2Sources: Source[] = sources.map((s) => {
    const label = sourceLabel(s, s.kind === 'sub' ? ++subN : 0);
    const p = setup.positions[s.id] ?? { x: 0, y: 0, z: s.height };
    const capabilities: SourceCapabilities = pick({
      delayMode: s.delayMode, maxDelayMs: s.maxDelayMs, phaseMode: s.phaseMode, levelAdjustable: s.levelAdjustable, peqBands: s.peqBands, allpass: s.allpass,
    });
    return pick({
      id: s.id, kind: s.kind, name: label.name, channel: label.channel, position: { x: p.x, y: p.y, z: s.height }, rotationDeg: 0,
      fLow: s.fLow, fHigh: s.fHigh, capabilities, passport: s.passport ? structuredClone(s.passport) : undefined,
      settings: setup.subSettings[s.id] ? structuredClone(setup.subSettings[s.id]) : undefined,
    });
  });
  const openings: Opening[] = [
    ...room.features.map((f): Opening => pick({ id: f.id, kind: f.kind, wall: f.wall, a0: f.a0, a1: f.a1, bottom: f.bottom, top: f.top, state: 'closed' as const, fromScan: f.fromScan })),
    ...room.openings.map((o): Opening => pick({ id: o.id, kind: 'passage' as const, wall: o.wall, a0: o.a0, a1: o.a1, bottom: 0, top: o.height, state: 'permanent' as const, fromScan: o.fromScan })),
  ];
  return {
    id: meta.id, role: meta.role, revision: meta.revision, geometrySource: room.source,
    geometry: { kind: 'rect', depth: room.depth, width: room.width, height: room.height, slope: room.slope ? { ...room.slope } : null },
    surfaces: {
      floor: { material: room.materials.floor }, ceiling: { material: room.materials.ceiling }, front: { material: room.materials.front },
      back: { material: room.materials.back }, left: { material: room.materials.left }, right: { material: room.materials.right },
    },
    openings,
    zones: structuredClone(room.extensions ?? []),
    audio: { layout: layoutOf(sources), sources: v2Sources, crossoverHz: setup.crossoverHz, crossover: { ...k.crossover } },
    listening: {
      listeners: [{ id: 'main', name: 'Основное место', position: { x: setup.listener.x, y: setup.listener.y, z: k.earHeight }, weight: 1, primary: true }],
      seats: { ...k.seats },
    },
    interior: { obstacles: structuredClone(room.zones), coverings: structuredClone(room.coverings ?? []), furnitureList: !!room.furnitureList, furnishing: room.furnishing },
    treatment: { items: structuredClone(room.treatments ?? []), enabled: !!room.treatmentsOn },
    simulation: pick({
      model: room.model, precision: inputs.precision, temperatureC: room.temperatureC, leakage: room.leakage,
      calibration: room.calibration ? { ...room.calibration } : null,
      objective: k.objective ? structuredClone(k.objective) : undefined, houseCurve: k.houseCurve,
      placement: pick({
        speakerMinFront: k.speakerMinFront, speakerMinSide: k.speakerMinSide, listenerMinX: k.listenerMinX, listenerMaxX: k.listenerMaxX,
        subZone: k.subZone, subWallGap: k.subWallGap, dba: k.dba,
      }),
    }),
    placed: !!setup.placed,
    voice: inputs.voice ? structuredClone(inputs.voice) : null,
    scan: meta.scan ?? null,
  };
}
