// Расширенные акустические модели (V2-048) поверх величин ядра; ядро не меняется (R48).
// - Реверберация по Фицрою (1959) и Арау-Пучадесу (1988): время спада по Эйрингу для каждой пары противоположных
//   поверхностей T_k = 0,161V/(−S·ln(1 − ᾱ_k) + 4mV), затем среднее с весами долей площади пар S_k/S —
//   арифметическое (Фицрой) или геометрическое (Арау-Пучадес). Поглощение поверхностей и воздуха — из ядра.
// - Ясность и прямой звук по пересмотренной теории Баррона (Barron, Lee, 1988): прямой d = 100·G/r²,
//   отражённый R = (31200·T/V)·e^(−13,82·r/(c·T)), ранняя часть до t — R·(1 − e^(−13,82·t/T)), поздняя — R·e^(−13,82·t/T).
// - Первые отражения высших порядков — методом мнимых источников для прямоугольной комнаты (Allen, Berkley, 1979):
//   уровень = расхождение по пути, поглощение (1 − α) в каждой точке отражения и направленность колонки.
import { OCTAVES, alphaAt } from '../../core/materials';
import { computeReverb, surfaceAbsorptionAt, surfaceAreas } from '../../core/reverb';
import { treatmentAlpha } from '../../core/treatments';
import type { SurfaceId, Vec3 } from '../../core/types';
import { coreInputs } from '../adapters/core';
import type { Directivity, OpeningKind, RoomConfiguration, Source } from '../domain/model';
import { panelAt, soundSpeed } from './analysis';
import { surfaceAlpha } from './profiles';

const dist = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const lg = (v: number) => 10 * Math.log10(v);

// ---------- Реверберация: Фицрой и Арау-Пучадес ----------

export type Axis = 'x' | 'y' | 'z';
export const AXIS_PAIR: Record<Axis, [SurfaceId, SurfaceId]> = { x: ['front', 'back'], y: ['left', 'right'], z: ['floor', 'ceiling'] };
const AXES: Axis[] = ['x', 'y', 'z'];

export interface ReverbModels {
  bands: number[];
  sabine: number[];
  eyring: number[];
  fitzroy: number[];
  arau: number[];
  /** Принятое ядром время (Эйринг при ᾱ > 0,2, иначе Сэбин). */
  used: number[];
  /** Средний α пары поверхностей по октавам и доля площади пары. */
  pairAlpha: Record<Axis, number[]>;
  pairShare: Record<Axis, number>;
  /** Наибольшее отношение времён четырёх моделей в полосе. */
  spread: number[];
  volume: number;
  schroeder: number;
}

export function reverbModels(c: RoomConfiguration): ReverbModels {
  const room = coreInputs(c).room;
  const rev = computeReverb(room);
  const S = surfaceAreas(room);
  const total = rev.surfaceArea, V = rev.volume;
  const pairArea = (k: Axis) => S[AXIS_PAIR[k][0]] + S[AXIS_PAIR[k][1]];
  const pairShare = { x: pairArea('x') / total, y: pairArea('y') / total, z: pairArea('z') / total };
  const pairAlpha: Record<Axis, number[]> = { x: [], y: [], z: [] };
  const fitzroy: number[] = [], arau: number[] = [], spread: number[] = [];
  OCTAVES.forEach((f, i) => {
    const A = surfaceAbsorptionAt(room, f);
    // 4mV ядра: из его времени по Сэбину T = 0,161V/(A + 4mV)
    const air = Math.max(0, (0.161 * V) / rev.sabine[i] - rev.absorptionArea[i]);
    const t: Record<Axis, number> = { x: 0, y: 0, z: 0 };
    for (const k of AXES) {
      const a = (A[AXIS_PAIR[k][0]] + A[AXIS_PAIR[k][1]]) / pairArea(k);
      pairAlpha[k].push(a);
      t[k] = (0.161 * V) / (-total * Math.log(1 - Math.min(a, 0.99)) + air);
    }
    fitzroy.push(AXES.reduce((s, k) => s + pairShare[k] * t[k], 0));
    arau.push(AXES.reduce((s, k) => s * t[k] ** pairShare[k], 1));
    const all = [rev.sabine[i], rev.eyring[i], fitzroy[i], arau[i]];
    spread.push(Math.max(...all) / Math.min(...all));
  });
  return { bands: [...OCTAVES], sabine: rev.sabine, eyring: rev.eyring, fitzroy, arau, used: rev.used, pairAlpha, pairShare, spread, volume: V, schroeder: rev.schroeder };
}

// ---------- Направленность ----------

/** Направление оси колонки в плане: 0° — к задней стене (+x), плюс — к правой (+y). */
export const axisOf = (s: Source): Vec3 => ({ x: Math.cos((s.rotationDeg * Math.PI) / 180), y: Math.sin((s.rotationDeg * Math.PI) / 180), z: 0 });

/**
 * Энергетический множитель направленности относительно всенаправленного источника той же мощности.
 * Параметрическая модель (R48): выше частоты сужения на оси Q = 41253/θ² (Molloy, θ — ширина по −6 дБ; не меньше 1),
 * вне оси спад −6·(φ/(θ/2))² дБ, не глубже −25 дБ; ниже частоты сужения — всенаправленный.
 */
export function directivityGain(d: Directivity | undefined, axis: Vec3, dir: Vec3, f: number): number {
  if (!d || d.kind === 'omni' || f < d.aboveHz) return 1;
  const n = Math.hypot(dir.x, dir.y, dir.z) || 1;
  const phi = (Math.acos(Math.max(-1, Math.min(1, (axis.x * dir.x + axis.y * dir.y + axis.z * dir.z) / n))) * 180) / Math.PI;
  const q = Math.max(1, 41253 / d.beamDeg ** 2);
  return q * 10 ** (Math.max(-25, -6 * (phi / (d.beamDeg / 2)) ** 2) / 10);
}

// ---------- Ясность и прямой звук (Баррон) ----------

export interface ClarityBand {
  f: number;
  /** Время реверберации, принятое ядром, с. */
  t: number;
  /** Ниже частоты Шрёдера поле не диффузное — показатели не считаются. */
  below: boolean;
  c50: number | null;
  c80: number | null;
  d50: number | null;
  drr: number | null;
  /** Расстояние, где прямой и отражённый звук равны (без запаздывания отражённого), м. */
  critical: number | null;
}

export interface Clarity { sourceId: string; distance: number; bands: ClarityBand[] }

export function clarity(c: RoomConfiguration, models: ReverbModels, sourceId: string): Clarity {
  const s = c.audio.sources.find((x) => x.id === sourceId);
  if (!s) throw new Error('Источник не найден.');
  const l = (c.listening.listeners.find((x) => x.primary) ?? c.listening.listeners[0]).position;
  const r = Math.max(0.1, dist(s.position, l));
  const v = soundSpeed(c), V = models.volume;
  const dir = { x: l.x - s.position.x, y: l.y - s.position.y, z: l.z - s.position.z };
  const bands = models.bands.map((f, i): ClarityBand => {
    const t = models.used[i];
    if (f < models.schroeder) return { f, t, below: true, c50: null, c80: null, d50: null, drr: null, critical: null };
    const g = directivityGain(s.directivity, axisOf(s), dir, f);
    const d = (100 * g) / r ** 2;
    const R = ((31200 * t) / V) * Math.exp((-13.82 * r) / (v * t));
    const late = (ms: number) => R * Math.exp((-13.82 * ms) / 1000 / t);
    const c50 = lg((d + R - late(50)) / late(50)), c80 = lg((d + R - late(80)) / late(80));
    return { f, t, below: false, c50, c80, d50: (d + R - late(50)) / (d + R), drr: lg(d / R), critical: Math.sqrt((0.161 * g * V) / (16 * Math.PI * t)) };
  });
  return { sourceId, distance: r, bands };
}

// ---------- Мнимые источники ----------

export interface ImageArrival {
  id: string;
  sourceId: string;
  order: number;
  /** Поверхности по ходу звука от колонки к слушателю и точки отражения на них. */
  surfaces: SurfaceId[];
  points: Vec3[];
  path: number;
  delayMs: number;
  /** Уровень относительно прямого звука этой колонки, дБ. */
  levelDb: number;
  /** Откуда приходит к слушателю, смотрящему на переднюю стену: азимут (плюс — справа) и возвышение, °. */
  azimuthDeg: number;
  elevationDeg: number;
  /** Сколько точек пути закрыто поглощающими панелями; есть ли на пути диффузор, закрытое окно или дверь. */
  absorbed: number;
  diffused: boolean;
  via: OpeningKind[];
}

export type ImageResult = { ok: true; f: number; arrivals: ImageArrival[]; notes: string[] } | { ok: false; reason: string };

const SIDE: Record<Axis, [SurfaceId, SurfaceId]> = AXIS_PAIR;

/** Отражение координаты из пространства мнимых источников в комнату [0, L]. */
function fold(u: number, L: number): number {
  const m = ((u % (2 * L)) + 2 * L) % (2 * L);
  return m <= L ? m : 2 * L - m;
}

/** Мнимые координаты по оси (Allen, Berkley): (1 − 2q)·p + 2nL; отражений от стенки 0 — |n − q|, от стенки L — |n|. */
function axisImages(p: number, L: number, max: number): { u: number; k: number }[] {
  const out: { u: number; k: number }[] = [];
  for (let n = -max; n <= max; n++) for (const q of [0, 1]) {
    const k = Math.abs(n - q) + Math.abs(n);
    if (k <= max) out.push({ u: (1 - 2 * q) * p + 2 * n * L, k });
  }
  return out;
}

function openingAt(c: RoomConfiguration, s: SurfaceId, p: Vec3) {
  if (s === 'floor' || s === 'ceiling') return null;
  const along = s === 'front' || s === 'back' ? p.y : p.x;
  return c.openings.find((o) => o.wall === s && along >= Math.min(o.a0, o.a1) && along <= Math.max(o.a0, o.a1) && p.z >= o.bottom && p.z <= o.top) ?? null;
}

/**
 * Отражения порядков 1…maxOrder от всех шести поверхностей на основном месте для колонок (сабвуферы — моды).
 * Открытый проём на пути — отражения нет; поглощающая панель — α панели (пористый слой ядра); диффузор — путь
 * помечается, зеркальный уровень не снижается; закрытые окно и дверь — помечаются, α — стены.
 */
export function imageSources(c: RoomConfiguration, f = 1000, maxOrder = 3): ImageResult {
  if (c.geometry.kind !== 'rect') return { ok: false, reason: 'Мнимые источники считаются для прямоугольной комнаты.' };
  if (c.geometry.slope) return { ok: false, reason: 'Скос потолка: метод мнимых источников применим только к прямоугольному параллелепипеду — для скоса нужна трассировка лучей, её пока нет.' };
  const { depth: D, width: W, height: H } = c.geometry;
  const size: Record<Axis, number> = { x: D, y: W, z: H };
  const l = (c.listening.listeners.find((x) => x.primary) ?? c.listening.listeners[0]).position;
  const v = soundSpeed(c);
  const notes: string[] = [];
  if (c.shape || c.zones.length) notes.push('Части комнаты и смежные зоны не учитываются: отражения — от стен основной части.');
  const arrivals: ImageArrival[] = [];
  for (const s of c.audio.sources.filter((x) => x.kind === 'speaker')) {
    const p = s.position, ax = axisOf(s);
    const direct = dist(p, l);
    const g0 = directivityGain(s.directivity, ax, { x: l.x - p.x, y: l.y - p.y, z: l.z - p.z }, f);
    const xs = axisImages(p.x, D, maxOrder), ys = axisImages(p.y, W, maxOrder), zs = axisImages(p.z, H, maxOrder);
    for (const ix of xs) for (const iy of ys) for (const iz of zs) {
      const order = ix.k + iy.k + iz.k;
      if (order < 1 || order > maxOrder) continue;
      const img = { x: ix.u, y: iy.u, z: iz.u };
      const cross: { t: number; s: SurfaceId }[] = [];
      for (const a of AXES) {
        const a0 = l[a], a1 = img[a], L = size[a];
        for (let j = Math.floor(Math.min(a0, a1) / L) + 1; j * L < Math.max(a0, a1); j++) {
          cross.push({ t: (j * L - a0) / (a1 - a0), s: SIDE[a][Math.abs(j) % 2] });
        }
      }
      cross.sort((a, b) => b.t - a.t);
      const points = cross.map(({ t }) => ({ x: fold(l.x + t * (img.x - l.x), D), y: fold(l.y + t * (img.y - l.y), W), z: fold(l.z + t * (img.z - l.z), H) }));
      let energy = 1, absorbed = 0, diffused = false, blocked = false;
      const via: OpeningKind[] = [];
      cross.forEach(({ s: surf }, k) => {
        const pt = points[k];
        const o = openingAt(c, surf, pt);
        if (o && (o.state !== 'closed' || o.kind === 'passage')) { blocked = true; return; }
        if (o) via.push(o.kind);
        const panel = surf === 'floor' ? null : panelAt(c, surf, pt);
        if (panel && (panel.kind === 'panel' || panel.kind === 'cloud')) {
          absorbed++;
          energy *= 1 - Math.min(0.999, alphaAt(treatmentAlpha(panel), f));
          return;
        }
        if (panel?.kind === 'diffuser') diffused = true;
        energy *= 1 - Math.min(0.999, alphaAt(surfaceAlpha(c.surfaces[surf]), f));
      });
      if (blocked) continue;
      const path = dist(img, l);
      const dep = { x: points[0].x - p.x, y: points[0].y - p.y, z: points[0].z - p.z };
      energy *= (direct / path) ** 2 * (directivityGain(s.directivity, ax, dep, f) / g0);
      const arr = { x: img.x - l.x, y: img.y - l.y, z: img.z - l.z };
      arrivals.push({
        id: `${s.id}:${img.x.toFixed(3)},${img.y.toFixed(3)},${img.z.toFixed(3)}`,
        sourceId: s.id, order, surfaces: cross.map((x) => x.s), points, path, delayMs: ((path - direct) / v) * 1000, levelDb: lg(energy),
        azimuthDeg: (Math.atan2(arr.y, -arr.x) * 180) / Math.PI, elevationDeg: (Math.atan2(arr.z, Math.hypot(arr.x, arr.y)) * 180) / Math.PI,
        absorbed, diffused, via,
      });
    }
  }
  return { ok: true, f, arrivals: arrivals.sort((a, b) => a.delayMs - b.delayMs), notes };
}
