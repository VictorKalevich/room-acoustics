// Многокритериальный подбор (V2-050): поиск мест с учётом закреплённых объектов и ограничений комнаты, фронт Парето
// «неровность баса — объём перестановки» и чувствительность варианта к неточной установке. Оценку каждого варианта
// считает ядро (`evaluateSetup`, в воркере — задача 'evaluate'); здесь только перебор и отбор, формулы ядра те же.
// Поиск — покоординатный спуск от нынешней расстановки: лучший найденный вариант, глобальная оптимальность не доказана.
import { clampToRoom, MIN_LISTEN_DIST, receiverSet, seatAllowed, type SetupEval } from '../../core/system';
import { range, subCandidates } from '../../core/placement';
import { ROBUST_LISTENER_SHIFT, ROBUST_SOURCE_SHIFT } from '../../core/metric';
import { isWave } from '../../core/geometry';
import type { Setup, Vec3 } from '../../core/types';
import type { CoreInputs } from '../adapters/core';
import type { Goals, RoomConfiguration } from '../domain/model';
import { applyLayout } from '../domain/operations';

export type Layout = Pick<Setup, 'listener' | 'positions'>;
export type Evaluate = (l: Layout) => Promise<SetupEval>;

/** Что поиск может менять и почему остальное неподвижно. */
export interface SearchSpace {
  listener: number[];
  speakers: string[];
  speakerX: number[];
  /** Полуразнос стереопары от оси слушателя; пусто — разнос не меняется. */
  speakerHalf: number[];
  subs: { id: string; points: Vec3[] }[];
  fixed: string[];
}

export interface ParetoPoint {
  key: string;
  layout: Layout;
  /** Оценка по цели подбора (со штрафами расстановки), меньше — лучше. */
  score: number;
  /** Сумма сдвигов по полу, м. */
  shift: number;
  moved: string[];
  angleDeg: number | null;
  penalties: string[];
  response: SetupEval['response'];
}

export interface ParetoResult {
  baseline: ParetoPoint;
  front: ParetoPoint[];
  evaluated: number;
  rounds: number;
  stopped: 'converged' | 'budget';
  fixed: string[];
}

const EPS = 1e-6;
const cm = (v: number) => Math.round(v * 100);
const keyOf = (l: Layout) => [cm(l.listener.x), cm(l.listener.y), ...Object.keys(l.positions).sort().map((id) => `${id}:${cm(l.positions[id].x)},${cm(l.positions[id].y)}`)].join('|');
const flat = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

/** Пространство поиска: закреплённое, запрещённое целями и колонки, у которых закреплена хотя бы одна, не двигаются. */
export function searchSpace(c: RoomConfiguration, goals: Goals, i: CoreInputs): SearchSpace {
  const { room, constraints: k, setup } = i;
  const fixed: string[] = [];
  const name = (id: string) => c.audio.sources.find((s) => s.id === id)?.name ?? id;
  const l = c.listening.listeners.find((x) => x.primary);
  const equip = goals.constraints.canMoveEquipment;
  let listener: number[] = [];
  if (l?.locked) fixed.push('Место слушателя закреплено.');
  else if (!goals.constraints.canMoveFurniture) fixed.push('Мебель переставлять нельзя: место слушателя не меняется.');
  else {
    const step = isWave(room) ? 0.25 : 0.1;
    listener = range(k.listenerMinX, k.listenerMaxX, step).filter((x) => {
      if (x <= 0 || x >= room.depth) return false;
      const { pts } = receiverSet(room, k, { ...setup.listener, x });
      return ((k.seats?.count ?? 1) > 1 ? pts : [pts[0]]).every((p) => seatAllowed(room, p));
    });
  }
  const placed = c.audio.sources.filter((s) => setup.positions[s.id]);
  if (!equip) {
    if (placed.length) fixed.push('Оборудование перемещать нельзя (ограничение комнаты): колонки и сабвуферы не меняются.');
    return { listener, speakers: [], speakerX: [], speakerHalf: [], subs: [], fixed };
  }
  const spk = placed.filter((s) => s.kind === 'speaker');
  const lockedSpk = spk.filter((s) => s.locked);
  let speakers: string[] = [], speakerX: number[] = [], speakerHalf: number[] = [];
  if (lockedSpk.length) fixed.push(`Закреплены: ${lockedSpk.map((s) => s.name).join(', ')}. Колонки двигаются только вместе, поэтому не меняются.`);
  else if (spk.length) {
    speakers = spk.map((s) => s.id);
    speakerX = range(k.speakerMinFront, Math.max(k.speakerMinFront, k.listenerMaxX - MIN_LISTEN_DIST), 0.1);
    if (spk.length === 2) {
      const ly = setup.listener.y;
      speakerHalf = range(0.4, Math.min(ly - k.speakerMinSide, room.width - k.speakerMinSide - ly), 0.1);
    }
  }
  const subs = placed.filter((s) => s.kind === 'sub');
  const lockedSubs = subs.filter((s) => s.locked);
  if (lockedSubs.length) fixed.push(`Закреплены: ${lockedSubs.map((s) => name(s.id)).join(', ')}.`);
  return {
    listener, speakers, speakerX, speakerHalf, fixed,
    subs: subs.filter((s) => !s.locked).map((s) => ({ id: s.id, points: subCandidates(room, k, setup.positions[s.id].z) })),
  };
}

type Move = (l: Layout) => Layout | null;

/** Измерения поиска: каждое — набор вариантов, отличающихся от данного одной координатой. */
function dimensions(space: SearchSpace, base: Layout): Move[][] {
  const near = (l: Layout, id: string, p: Vec3) => Object.entries(l.positions).some(([o, q]) => o !== id && flat(p, q) < 0.3);
  const gap = (l: Layout) => Math.min(Infinity, ...space.speakers.map((id) => l.listener.x - l.positions[id].x));
  const baseGap = gap(base);
  const ok = (l: Layout) => !space.speakers.length || gap(l) >= Math.min(MIN_LISTEN_DIST, baseGap) - EPS;
  const dims: Move[][] = [];
  for (const s of space.subs) dims.push(s.points.map((p) => (l) => (near(l, s.id, p) ? null : { ...l, positions: { ...l.positions, [s.id]: { ...p } } })));
  if (space.listener.length) dims.push(space.listener.map((x) => (l) => { const n = { ...l, listener: { ...l.listener, x } }; return ok(n) ? n : null; }));
  if (space.speakerX.length) {
    dims.push(space.speakerX.map((x) => (l) => {
      const positions = { ...l.positions };
      for (const id of space.speakers) positions[id] = { ...positions[id], x };
      const n = { ...l, positions };
      return ok(n) ? n : null;
    }));
  }
  if (space.speakerHalf.length) {
    const [a, b] = [...space.speakers].sort((p, q) => base.positions[p].y - base.positions[q].y);
    dims.push(space.speakerHalf.map((h) => (l) => ({ ...l, positions: { ...l.positions, [a]: { ...l.positions[a], y: l.listener.y - h }, [b]: { ...l.positions[b], y: l.listener.y + h } } })));
  }
  return dims;
}

function point(base: Layout, l: Layout, e: SetupEval): ParetoPoint {
  const moved = [...(flat(base.listener, l.listener) > 0.01 ? ['listener'] : []), ...Object.keys(l.positions).filter((id) => flat(base.positions[id], l.positions[id]) > 0.01)];
  const shift = flat(base.listener, l.listener) + Object.keys(l.positions).reduce((a, id) => a + flat(base.positions[id], l.positions[id]), 0);
  return { key: keyOf(l), layout: l, score: e.objScore, shift: Math.round(shift * 100) / 100, moved, angleDeg: e.angleDeg, penalties: e.penalties.map((p) => p.name), response: e.response };
}

/** Фронт Парето: каждый следующий вариант двигает больше и заметно (на 0,05) лучше предыдущего. */
export function paretoFront(points: readonly ParetoPoint[], minGain = 0.05): ParetoPoint[] {
  const sorted = [...points].sort((a, b) => a.shift - b.shift || a.score - b.score);
  const out: ParetoPoint[] = [];
  for (const p of sorted) if (!out.length || p.score < out[out.length - 1].score - minGain) out.push(p);
  return out;
}

/** Не больше `n` вариантов фронта: без перестановки, лучший и равномерно по объёму перестановки между ними. */
export function thinFront(front: readonly ParetoPoint[], n = 8): ParetoPoint[] {
  if (front.length <= n) return [...front];
  const idx = new Set([0, front.length - 1]);
  for (let k = 1; idx.size < n && k < n - 1; k++) idx.add(Math.round((k * (front.length - 1)) / (n - 1)));
  return [...idx].sort((a, b) => a - b).map((k) => front[k]);
}

export interface SearchOptions { budget?: number; rounds?: number; onProgress?: (v: number) => void }

/** Покоординатный спуск от нынешней расстановки; все оценённые варианты идут в отбор фронта. */
export async function paretoSearch(space: SearchSpace, base: Layout, evaluate: Evaluate, o: SearchOptions = {}): Promise<ParetoResult> {
  const budget = o.budget ?? 800, maxRounds = o.rounds ?? 3;
  const seen = new Map<string, ParetoPoint>();
  const run = async (ls: Layout[]) => {
    const fresh = ls.filter((l, k) => !seen.has(keyOf(l)) && ls.findIndex((m) => keyOf(m) === keyOf(l)) === k).slice(0, Math.max(0, budget - seen.size));
    const es = await Promise.all(fresh.map((l) => evaluate(l)));
    fresh.forEach((l, k) => seen.set(keyOf(l), point(base, l, es[k])));
    o.onProgress?.(Math.min(1, seen.size / budget));
    return ls.map((l) => seen.get(keyOf(l))).filter((p): p is ParetoPoint => !!p);
  };
  const [baseline] = await run([base]);
  const dims = dimensions(space, base);
  let cur = baseline, rounds = 0, stopped: ParetoResult['stopped'] = 'converged';
  for (; rounds < maxRounds; rounds++) {
    const before = cur.score;
    for (const d of dims) {
      if (seen.size >= budget) { stopped = 'budget'; break; }
      const ps = await run(d.map((m) => m(cur.layout)).filter((l): l is Layout => !!l));
      const best = ps.reduce((a, p) => (p.score < a.score ? p : a), cur);
      if (best.score < cur.score - 0.02) cur = best;
    }
    if (stopped === 'budget' || cur.score > before - 0.02) { rounds++; break; }
  }
  o.onProgress?.(1);
  return { baseline, front: paretoFront([...seen.values()]), evaluated: seen.size, rounds, stopped, fixed: space.fixed };
}

export interface Sensitivity { id: string; worse: number; shift: number }

/**
 * Чувствительность варианта к неточной установке: насколько в среднем хуже оценка при сдвиге объекта по четырём
 * направлениям — слушателя на 25 см, источников на 10 см (сдвиги ядра `robustness`). Отсортировано по убыванию.
 */
export async function sensitivity(i: CoreInputs, l: Layout, base: number, evaluate: Evaluate): Promise<Sensitivity[]> {
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const ids = ['listener', ...Object.keys(l.positions)];
  const out: Sensitivity[] = [];
  for (const id of ids) {
    const shift = id === 'listener' ? ROBUST_LISTENER_SHIFT : ROBUST_SOURCE_SHIFT;
    const at = id === 'listener' ? l.listener : l.positions[id];
    const ls = dirs.map(([dx, dy]) => {
      const p = clampToRoom(i.room, { ...at, x: at.x + dx * shift, y: at.y + dy * shift }, id === 'listener' ? 0.1 : 0.05);
      return id === 'listener' ? { ...l, listener: p } : { ...l, positions: { ...l.positions, [id]: p } };
    });
    const es = await Promise.all(ls.map(evaluate));
    out.push({ id, shift, worse: Math.round((es.reduce((a, e) => a + Math.max(0, e.objScore - base), 0) / dirs.length) * 100) / 100 });
  }
  return out.sort((a, b) => b.worse - a.worse);
}

/** Вариант фронта → операция над конфигурацией эксперимента: места; настройки сабвуферов и раздел частот прежние. */
export function paretoOp(l: Layout): (c: RoomConfiguration) => RoomConfiguration {
  return (c) => applyLayout(c, {
    listener: { ...l.listener },
    positions: Object.fromEntries(Object.entries(l.positions).map(([id, p]) => [id, { ...p }])),
    subSettings: {},
    crossoverHz: c.audio.crossoverHz,
  });
}
