// Показатели разделов анализа (V2-031–V2-034), производные от ядра. Формулы ядра не меняются; здесь — геометрия
// (расстояния, углы, длины путей) и стандартные соотношения поверх величин ядра (R26):
// - первый провал SBIR — четверть длины волны до поверхности: f = c / (4·d);
// - добротность и полоса изолированной моды по затуханию ядра: T60 = 6,91/δ, Q = π·f/δ = π·f·T60/6,91 ≈ T60·f/2,2,
//   полоса −3 дБ = f/Q (spec analysis §1: «T60 ≈ 2,2·Q/f0» для изолированного слабо затухающего резонанса);
// - задержка отражения — разность путей отражённого и прямого звука, делённая на скорость звука ядра;
// - ослабление отражения — только расхождение (20·lg отношения путей) и поглощение материала поверхности на 1 кГц.
import { alphaAt } from '../../core/materials';
import { surfaceAlpha } from './profiles';
import { modeWhere } from '../../core/modes';
import type { ModeDecay } from '../../core/overview';
import { speedOfSound } from '../../core/physics';
import { surfaceAbsorptionAt, surfaceAreas } from '../../core/reverb';
import { porousLowLimit, reflectionPoints, type ReflectSurface } from '../../core/treatment';
import { treatmentAlpha, treatmentArea } from '../../core/treatments';
import { SURFACES, type Mode, type SurfaceId, type Vec3 } from '../../core/types';
import { coreInputs } from '../adapters/core';
import type { RoomConfiguration, Source } from '../domain/model';

const deg = (r: number) => (r * 180) / Math.PI;
const dist = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

function rectOf(c: RoomConfiguration) {
  if (c.geometry.kind !== 'rect') throw new Error('Показатель считается для прямоугольной комнаты.');
  return c.geometry;
}

const primary = (c: RoomConfiguration) => c.listening.listeners.find((l) => l.primary) ?? c.listening.listeners[0];
export const soundSpeed = (c: RoomConfiguration) => speedOfSound(c.simulation.temperatureC);

// ---------- Колонки ----------

export interface SurfaceDistances { front: number; back: number; left: number; right: number; floor: number; ceiling: number }

export function surfaceDistances(c: RoomConfiguration, p: Vec3): SurfaceDistances {
  const g = rectOf(c);
  return { front: p.x, back: g.depth - p.x, left: p.y, right: g.width - p.y, floor: p.z, ceiling: g.height - p.z };
}

export interface SpeakerGeometry {
  id: string;
  name: string;
  channel?: string;
  distances: SurfaceDistances;
  /** До основного места, м (по прямой, с учётом высоты). */
  toListener: number;
  /** Направление на основное место в плане, ° (0 — к задней стене, плюс — к правой). */
  aimDeg: number;
  /** Поворот колонки минус направление на слушателя, °: 0 — смотрит точно на слушателя. */
  aimErrorDeg: number;
  /** Высота акустического центра минус высота ушей, м. */
  heightToEar: number;
}

const wrap180 = (a: number) => ((((a + 180) % 360) + 360) % 360) - 180;

export function speakerGeometry(c: RoomConfiguration): SpeakerGeometry[] {
  const l = primary(c);
  return c.audio.sources.filter((s) => s.kind === 'speaker').map((s) => {
    const aim = deg(Math.atan2(l.position.y - s.position.y, l.position.x - s.position.x));
    return {
      id: s.id, name: s.name, channel: s.channel, distances: surfaceDistances(c, s.position), toListener: dist(s.position, l.position),
      aimDeg: aim, aimErrorDeg: wrap180(s.rotationDeg - aim), heightToEar: s.position.z - l.position.z,
    };
  });
}

export interface StereoPair {
  /** Расстояние между колонками в плане, м. */
  spacing: number;
  /** Угол между направлениями на колонки из основного места, ° (начальная цель — 60°, не обязательная). */
  angleDeg: number;
  /** Разница расстояний до слушателя, м, и соответствующая задержка, мс. */
  pathDiff: number;
  delayMs: number;
  /** Несимметричность: разница отступов от боковых стен и от передней стены, м. */
  sideOffset: number;
  frontOffset: number;
}

export function stereoPair(c: RoomConfiguration): StereoPair | null {
  const L = c.audio.sources.find((s) => s.channel === 'L'), R = c.audio.sources.find((s) => s.channel === 'R');
  if (!L || !R) return null;
  const g = rectOf(c), l = primary(c).position;
  const va = { x: L.position.x - l.x, y: L.position.y - l.y }, vb = { x: R.position.x - l.x, y: R.position.y - l.y };
  const cos = (va.x * vb.x + va.y * vb.y) / (Math.hypot(va.x, va.y) * Math.hypot(vb.x, vb.y));
  const dl = dist(L.position, l), dr = dist(R.position, l);
  return {
    spacing: Math.hypot(L.position.x - R.position.x, L.position.y - R.position.y),
    angleDeg: deg(Math.acos(Math.max(-1, Math.min(1, cos)))),
    pathDiff: Math.abs(dl - dr), delayMs: (Math.abs(dl - dr) / soundSpeed(c)) * 1000,
    sideOffset: Math.abs(L.position.y - (g.width - R.position.y)), frontOffset: Math.abs(L.position.x - R.position.x),
  };
}

export interface SbirNotch { sourceId: string; surface: SurfaceId; distance: number; f: number }

/** Первый провал SBIR от каждой из шести поверхностей (оценка по четверти длины волны), в пределах 20–500 Гц. */
export function sbirNotches(c: RoomConfiguration, sources: readonly Source[] = c.audio.sources): SbirNotch[] {
  const v = soundSpeed(c);
  const out: SbirNotch[] = [];
  for (const s of sources) {
    const d = surfaceDistances(c, s.position);
    for (const k of SURFACES) {
      const dd = d[k];
      if (dd <= 0.01) continue;
      const f = v / (4 * dd);
      if (f >= 20 && f <= 500) out.push({ sourceId: s.id, surface: k, distance: dd, f });
    }
  }
  return out.sort((a, b) => a.f - b.f);
}

// ---------- Отражения ----------

export interface ReflectionPath {
  sourceId: string;
  surface: ReflectSurface;
  point: Vec3;
  /** Путь отражения и прямой путь, м. */
  path: number;
  direct: number;
  /** Задержка относительно прямого звука, мс. */
  delayMs: number;
  /** Угол падения от нормали к поверхности, °. */
  incidenceDeg: number;
  /** Уровень относительно прямого звука, дБ: расхождение и поглощение материала на 1 кГц (без панелей). */
  levelDb: number;
  /** Точка на окне, двери или проёме. */
  on: 'window' | 'door' | 'opening' | null;
  /** Точку закрывает элемент обработки. */
  treated: boolean;
}

const NORMAL_AXIS: Record<ReflectSurface, 'x' | 'y' | 'z'> = { front: 'x', back: 'x', left: 'y', right: 'y', ceiling: 'z' };

export function reflectionPaths(c: RoomConfiguration): ReflectionPath[] {
  const i = coreInputs(c);
  const l = primary(c).position;
  const v = soundSpeed(c);
  const speakers = c.audio.sources.filter((s) => s.kind === 'speaker').map((s) => ({ id: s.id, pos: s.position }));
  return reflectionPoints(i.room, speakers, l).map((r) => {
    const s = speakers.find((x) => x.id === r.speakerId)!.pos;
    const a = dist(s, r.point), b = dist(r.point, l), direct = dist(s, l);
    const ax = NORMAL_AXIS[r.surface];
    const incidence = deg(Math.acos(Math.min(1, Math.abs(r.point[ax] - l[ax]) / b)));
    const alpha = alphaAt(surfaceAlpha(c.surfaces[r.surface]), 1000);
    const levelDb = 20 * Math.log10(direct / (a + b)) + 10 * Math.log10(Math.max(1e-6, 1 - alpha));
    return {
      sourceId: r.speakerId, surface: r.surface, point: r.point, path: a + b, direct, delayMs: ((a + b - direct) / v) * 1000,
      incidenceDeg: incidence, levelDb, on: r.on ?? null, treated: treatedAt(c, r.surface, r.point),
    };
  });
}

/** Элемент обработки (включённый) накрывает точку стены или потолка. */
export function treatedAt(c: RoomConfiguration, surface: ReflectSurface, p: Vec3): boolean {
  if (!c.treatment.enabled) return false;
  return c.treatment.items.some((t) => {
    if (t.enabled === false) return false;
    if (surface === 'ceiling') {
      if (t.kind !== 'cloud') return false;
      const x = t.x ?? 0, y = t.y ?? 0;
      return Math.abs(p.x - x) <= t.height / 2 && Math.abs(p.y - y) <= t.width / 2;
    }
    if (t.kind === 'corner' || t.kind === 'cloud' || t.wall !== surface) return false;
    const along = surface === 'front' || surface === 'back' ? p.y : p.x;
    return Math.abs(along - (t.at ?? 0)) <= t.width / 2 && Math.abs(p.z - (t.z ?? 0)) <= t.height / 2;
  });
}

// ---------- Моды ----------

export interface ModeRow {
  f: number;
  n: [number, number, number];
  kind: Mode['kind'];
  where: string;
  /** Длина волны, м. */
  lambda: number;
  /** Время затухания моды по ядру, с, и предел для этого объёма; null — выше границы расчёта затухания. */
  t60: number | null;
  limit: number | null;
  q: number | null;
  /** Ширина резонанса по уровню −3 дБ, Гц. */
  bandwidth: number | null;
  degenerate: boolean;
}

export function modeRows(c: RoomConfiguration, modes: readonly Mode[], decays: readonly ModeDecay[]): ModeRow[] {
  const v = soundSpeed(c);
  return modes.map((m) => {
    const d = decays.find((x) => x.n.join() === m.n.join());
    const q = d ? (Math.PI * m.f * d.t60) / 6.91 : null;
    return {
      f: m.f, n: m.n, kind: m.kind, where: modeWhere(m.n), lambda: v / m.f, t60: d?.t60 ?? null, limit: d?.limit ?? null,
      q, bandwidth: q ? m.f / q : null, degenerate: m.degenerate,
    };
  });
}

// ---------- Поглощение ----------

export interface AbsorptionShare { id: string; label: string; area: number }

const SURFACE_NAME: Record<SurfaceId, string> = { floor: 'Пол', ceiling: 'Потолок', front: 'Передняя стена', back: 'Задняя стена', left: 'Левая стена', right: 'Правая стена' };

/**
 * Вклад поверхностей в эквивалентную площадь поглощения на частоте f, м² (по ядру: отделка, доля обстановки, окна,
 * двери, проёмы и обработка на этой поверхности).
 */
export function absorptionShares(c: RoomConfiguration, f: number): AbsorptionShare[] {
  const room = coreInputs(c).room;
  const a = surfaceAbsorptionAt(room, f);
  return SURFACES.map((k) => ({ id: k, label: SURFACE_NAME[k], area: a[k] }));
}

export interface TreatmentEffect {
  id: string;
  kind: string;
  area: number;
  /** α по октавам 63…4000 Гц (пористый слой ядра); null — вид не входит в расчёт ядра. */
  alpha: readonly number[] | null;
  /** Ниже этой частоты пористый слой работает слабо (оценка ядра по четверти волны), Гц. */
  lowLimit: number | null;
}

export function treatmentEffects(c: RoomConfiguration): TreatmentEffect[] {
  return c.treatment.items.map((t) => {
    if (t.kind === 'diffuser' || t.kind === 'resonator') return { id: t.id, kind: t.kind, area: t.width * t.height, alpha: null, lowLimit: null };
    return { id: t.id, kind: t.kind, area: treatmentArea(t), alpha: treatmentAlpha(t), lowLimit: porousLowLimit(t.thickness, t.gap ?? 0, soundSpeed(c)) };
  });
}

// ---------- Порхающее эхо ----------

export interface FlutterPair { a: SurfaceId; b: SurfaceId; distance: number; alphaA: number; alphaB: number; repeatMs: number }

const PAIRS: [SurfaceId, SurfaceId][] = [['front', 'back'], ['left', 'right'], ['floor', 'ceiling']];

/**
 * Пары параллельных поверхностей, где возможно порхающее эхо: обе отражают (α материала на 2 кГц < 0,1), на них нет
 * обработки и покрытий. Это диагностика по материалам, а не расчёт: проверяется хлопком в комнате.
 */
export function flutterRisk(c: RoomConfiguration): FlutterPair[] {
  const g = rectOf(c);
  const v = soundSpeed(c);
  const covered = (s: SurfaceId) => c.interior.coverings.some((x) => x.surface === s)
    || (c.treatment.enabled && c.treatment.items.some((t) => t.enabled !== false && ((s === 'ceiling' && t.kind === 'cloud') || ('wall' in t && t.wall === s))));
  const len: Record<string, number> = { front: g.depth, left: g.width, floor: g.height };
  const out: FlutterPair[] = [];
  for (const [a, b] of PAIRS) {
    const alphaA = alphaAt(surfaceAlpha(c.surfaces[a]), 2000);
    const alphaB = alphaAt(surfaceAlpha(c.surfaces[b]), 2000);
    if (alphaA < 0.1 && alphaB < 0.1 && !covered(a) && !covered(b) && !(a === 'floor' && c.interior.furnishing !== 'empty')) {
      out.push({ a, b, distance: len[a], alphaA, alphaB, repeatMs: ((2 * len[a]) / v) * 1000 });
    }
  }
  return out;
}

export { surfaceAreas };
