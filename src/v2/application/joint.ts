// Совместная оптимизация и неопределённость (V2-054, экспертный уровень). Совместный подбор: для вариантов фронта
// Парето (места) — с планом обработки и без, затем согласование сабвуферов ядром (`optimizeSubs`) и эквалайзер
// по модели (`autoEq`, «осторожная коррекция»); сравнение по одной мере — неровности (СКО отклонения от цели в полосе
// эквалайзера). Неопределённость: Монте-Карло с равномерными распределениями в пределах допусков пользователя —
// размеры комнаты, множитель затухания мод (ядро, `calibration.dampingScale`), положения слушателя и источников;
// варианты сравниваются на одних и тех же выборках (парное сравнение). Формулы ядра не меняются.
import { clampToRoom, type SetupEval } from '../../core/system';
import { isWave } from '../../core/geometry';
import type { IntegrationResult } from '../../core/integration';
import { DAMPING_MODEL, type Room as CoreRoom, type Setup } from '../../core/types';
import type { CoreInputs } from '../adapters/core';
import { autoEq, DEFAULT_LIMITS, preampFor } from './autoeq';
import type { EqFilter } from './tools';
import type { Layout, ParetoPoint } from './pareto';

/** mulberry32: повторяемая псевдослучайная выборка по зерну. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Tolerances {
  /** Размеры комнаты, ± м. */
  dims: number;
  /** Множитель затухания мод (поглощение границ), ± доля. */
  absorption: number;
  /** Положение слушателя и источников по полу, ± м. */
  listener: number;
  sources: number;
}
export const DEFAULT_TOL: Tolerances = { dims: 0.02, absorption: 0.2, listener: 0.05, sources: 0.05 };

export interface Draw { depth: number; width: number; height: number; damping: number; listener: [number, number]; sources: Record<string, [number, number]> }

/** Выборка возмущений U(−t, t); в волновой модели размеры не варьируются (форма — не три размера). */
export function draws(n: number, tol: Tolerances, ids: readonly string[], seed: number, dims = true): Draw[] {
  const r = rng(seed);
  const u = (t: number) => (2 * r() - 1) * t;
  return Array.from({ length: n }, () => ({
    depth: dims ? u(tol.dims) : 0, width: dims ? u(tol.dims) : 0, height: dims ? u(tol.dims) : 0,
    damping: 1 + u(tol.absorption),
    listener: [u(tol.listener), u(tol.listener)],
    sources: Object.fromEntries(ids.map((id) => [id, [u(tol.sources), u(tol.sources)]])),
  }));
}

export function perturb(room: CoreRoom, setup: Setup, l: Layout, d: Draw): { room: CoreRoom; setup: Setup } {
  const scale = room.calibration?.dampingScale ?? 1;
  const r: CoreRoom = {
    ...room, depth: room.depth + d.depth, width: room.width + d.width, height: room.height + d.height,
    calibration: { ...room.calibration, dampingScale: scale * d.damping, model: room.calibration?.model ?? DAMPING_MODEL },
  };
  const move = (p: Setup['listener'], [dx, dy]: [number, number], m: number) => clampToRoom(r, { ...p, x: p.x + dx, y: p.y + dy }, m);
  return {
    room: r,
    setup: { ...setup, listener: move(l.listener, d.listener, 0.1), positions: Object.fromEntries(Object.entries(l.positions).map(([id, p]) => [id, move(p, d.sources[id] ?? [0, 0], 0.05)])) },
  };
}

export interface Stats { p10: number; median: number; p90: number }
const quantile = (s: readonly number[], q: number) => {
  const x = (s.length - 1) * q, lo = Math.floor(x), hi = Math.ceil(x);
  return s[lo] + (s[hi] - s[lo]) * (x - lo);
};
export function stats(v: readonly number[]): Stats {
  const s = [...v].sort((a, b) => a - b);
  return { p10: quantile(s, 0.1), median: quantile(s, 0.5), p90: quantile(s, 0.9) };
}

export interface Band { f: number[]; p10: number[]; p50: number[]; p90: number[] }
function band(rs: readonly SetupEval['response'][]): Band {
  const f = rs[0].f;
  const at = (k: number) => stats(rs.map((r) => r.db[k]));
  const s = f.map((_, k) => at(k));
  return { f: [...f], p10: s.map((x) => x.p10), p50: s.map((x) => x.median), p90: s.map((x) => x.p90) };
}

export interface MonteCarlo {
  n: number;
  dims: boolean;
  a: Stats;
  b: Stats;
  /** Оценка B − A на одних выборках: меньше нуля — B лучше. */
  diff: Stats;
  /** Доля выборок, где B лучше A хотя бы на 0,1 дБ, и где хуже на столько же. */
  better: number;
  worse: number;
  bandA: Band;
  bandB: Band;
}

export type EvaluateAt = (room: CoreRoom, setup: Setup) => Promise<SetupEval>;

/** Парное Монте-Карло: вариант B против A на одних и тех же возмущениях; оценка ядра (objScore). */
export async function monteCarlo(i: CoreInputs, a: Layout, b: Layout, tol: Tolerances, n: number, seed: number, evaluate: EvaluateAt, onProgress?: (v: number) => void): Promise<MonteCarlo> {
  const dims = !isWave(i.room);
  const ds = draws(n, tol, Object.keys({ ...a.positions, ...b.positions }), seed, dims);
  const ea: SetupEval[] = [], eb: SetupEval[] = [];
  for (let k = 0; k < ds.length; k += 8) {
    const chunk = ds.slice(k, k + 8);
    const res = await Promise.all(chunk.flatMap((d) => [a, b].map((l) => { const p = perturb(i.room, i.setup, l, d); return evaluate(p.room, p.setup); })));
    chunk.forEach((_, j) => { ea.push(res[2 * j]); eb.push(res[2 * j + 1]); });
    onProgress?.(Math.min(1, (k + chunk.length) / ds.length));
  }
  const sa = ea.map((e) => e.objScore), sb = eb.map((e) => e.objScore);
  const d = sb.map((v, k) => v - sa[k]);
  return {
    n, dims, a: stats(sa), b: stats(sb), diff: stats(d),
    better: d.filter((x) => x < -0.1).length / n, worse: d.filter((x) => x > 0.1).length / n,
    bandA: band(ea.map((e) => e.response)), bandB: band(eb.map((e) => e.response)),
  };
}

// ---------- Совместный подбор ----------

export interface JointRow {
  key: string;
  point: ParetoPoint;
  treatments: boolean;
  /** Неровность, дБ: только места → с сабвуферами → с эквалайзером. */
  raw: number;
  subs: number | null;
  eq: number;
  settings: IntegrationResult['settings'];
  crossoverHz: number | null;
  filters: EqFilter[];
  preamp: number;
  response: { f: number[]; db: number[]; target: number[] };
}

export interface JointRunner {
  evaluate: EvaluateAt;
  integrate: ((room: CoreRoom, setup: Setup) => Promise<IntegrationResult>) | null;
}

/** Неровность по мере эквалайзера: СКО отклонения от цели в полосе подбора EQ. */
const roughness = (r: { f: readonly number[]; db: readonly number[]; target: readonly number[] }, newId: () => string) => autoEq(r, 'gentle', DEFAULT_LIMITS, { measured: false, newId });

export async function jointSearch(i: CoreInputs, points: readonly ParetoPoint[], plan: boolean, run: JointRunner, newId: () => string, onProgress?: (v: number) => void): Promise<JointRow[]> {
  const combos = points.flatMap((p) => (plan ? [true, false] : [!!i.room.treatmentsOn]).map((t) => ({ p, t })));
  const rows: JointRow[] = [];
  for (const [k, { p, t }] of combos.entries()) {
    const room: CoreRoom = { ...i.room, treatmentsOn: t };
    const setup: Setup = { ...i.setup, ...p.layout };
    const e = await run.evaluate(room, setup);
    const integ = run.integrate ? await run.integrate(room, setup) : null;
    const resp = integ ? integ.responseAfter : e.response;
    const raw = roughness(e.response, newId).stdBefore;
    const fin = roughness(resp, newId);
    rows.push({
      key: `${p.key}|${t ? 'T' : '-'}`, point: p, treatments: t, raw, subs: integ ? fin.stdBefore : null, eq: fin.stdAfter,
      settings: integ?.settings ?? {}, crossoverHz: integ?.crossoverHz ?? null, filters: fin.filters, preamp: preampFor(fin.filters),
      response: { f: fin.f, db: fin.after, target: fin.target },
    });
    onProgress?.((k + 1) / combos.length);
  }
  return rows.sort((x, y) => x.eq - y.eq);
}
