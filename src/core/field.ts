// Тепловые карты (research R11): оценка ровности АЧХ для каждого места слушателя
// или каждого места выбранного сабвуфера при фиксированных остальных элементах.
import type { Constraints, Room, Setup, SourceSpec, Vec3 } from './types';
import { logFreqs } from './frequency';
import { applyKernel, modeShapes, receiverKernel } from './response';
import { makeScorer, objectivePpo, type Scorer } from './objective';
import {
  filterSet, makeCtx, objectiveSys, receiverSet, seatAllowed, sourceAllowed, speakerPenalties, sumPenalties,
  type EvalCtx, type Spectrum,
} from './system';
import { isWave } from './geometry';
import { waveFMax, waveSpectra } from './acoustics';

/** Оценка суммы источников по их откликам в точке (фильтры уже включают регулировки). */
function flatFromSpectra(parts: { h: Spectrum; f: Spectrum }[], target: number[], score: Scorer, fixed?: Spectrum): number {
  const n = target.length;
  const re = fixed ? Float64Array.from(fixed.re) : new Float64Array(n);
  const im = fixed ? Float64Array.from(fixed.im) : new Float64Array(n);
  for (const { h, f } of parts)
    for (let j = 0; j < n; j++) {
      re[j] += h.re[j] * f.re[j] - h.im[j] * f.im[j];
      im[j] += h.re[j] * f.im[j] + h.im[j] * f.re[j];
    }
  const d = new Float64Array(n);
  for (let j = 0; j < n; j++) d[j] = 10 * Math.log10(Math.max(re[j] * re[j] + im[j] * im[j], 1e-24));
  return score(d, target);
}

export interface Heatmap {
  kind: 'listener' | 'sub';
  subId?: string;
  x0: number;
  y0: number;
  step: number;
  nx: number;
  ny: number;
  /** Оценка в узлах (индекс ix*ny + iy); NaN — точка недоступна. */
  scores: Float32Array;
  /** 1 — точка допустима для рекомендации (зона сабвуфера, запретные зоны). */
  allowed: Uint8Array;
  best: { pos: { x: number; y: number }; score: number }[];
  current: number;
  min: number;
  max: number;
  elapsedMs: number;
}

type SetupLike = Pick<Setup, 'listener' | 'positions' | 'subSettings' | 'crossoverHz'>;

const MIN_SPACING = 0.4;

function pickBest(xs: number[], ys: number[], scores: Float32Array, allowed: Uint8Array, ny: number, count = 3) {
  const idx: number[] = [];
  for (let i = 0; i < scores.length; i++) if (allowed[i] && Number.isFinite(scores[i])) idx.push(i);
  idx.sort((a, b) => scores[a] - scores[b]);
  const best: Heatmap['best'] = [];
  for (const i of idx) {
    const pos = { x: xs[Math.floor(i / ny)], y: ys[i % ny] };
    if (best.some((b) => Math.hypot(b.pos.x - pos.x, b.pos.y - pos.y) < MIN_SPACING)) continue;
    best.push({ pos, score: scores[i] });
    if (best.length >= count) break;
  }
  return best;
}

function grid(lo: number, hi: number, step: number): number[] {
  const out: number[] = [];
  const n = Math.floor((hi - lo) / step + 1e-9);
  for (let i = 0; i <= n; i++) out.push(Math.round((lo + i * step) * 1000) / 1000);
  return out;
}

function minMax(a: Float32Array) {
  let mn = Infinity, mx = -Infinity;
  for (const v of a) if (Number.isFinite(v)) { if (v < mn) mn = v; if (v > mx) mx = v; }
  return { min: mn, max: mx };
}

/** Сумма источников в точке r (фильтры уже включают регулировки) → оценка по цели подбора. */
function flatAt(ctx: EvalCtx, r: Vec3, freqs: number[], psis: { psi: Float64Array; f: Spectrum }[], target: number[], score: Scorer, fixed?: Spectrum): number {
  const k = receiverKernel(ctx.pm, r, freqs);
  const n = freqs.length;
  const re = fixed ? Float64Array.from(fixed.re) : new Float64Array(n);
  const im = fixed ? Float64Array.from(fixed.im) : new Float64Array(n);
  for (const { psi, f } of psis) {
    const [hr, hi] = applyKernel(k, psi);
    for (let j = 0; j < n; j++) {
      re[j] += hr[j] * f.re[j] - hi[j] * f.im[j];
      im[j] += hr[j] * f.im[j] + hi[j] * f.re[j];
    }
  }
  const d = new Float64Array(n);
  for (let j = 0; j < n; j++) d[j] = 10 * Math.log10(Math.max(re[j] * re[j] + im[j] * im[j], 1e-24));
  return score(d, target);
}

/**
 * Карта мест слушателя: источники фиксированы. Неровность считается в каждом узле сетки один раз,
 * оценка места — взвешенная сумма по его точкам (места ряда или сдвиги головы), взятым из ближайших узлов.
 */
export function listenerHeatmap(room: Room, sources: SourceSpec[], c: Constraints, setup: SetupLike, opts: { step?: number; ppo?: number; onProgress?: (v: number) => void } = {}): Heatmap {
  const t0 = Date.now();
  const step = opts.step ?? 0.1;
  const ctx = makeCtx(room, sources);
  const freqs = logFreqs(ctx.fLo, ctx.fHi, opts.ppo ?? objectivePpo(c.objective, 12));
  const { filt, target } = filterSet(sources, freqs, setup.crossoverHz, setup.subSettings);
  const score = makeScorer(freqs, c.objective, room, objectiveSys(room, c));
  const active = sources.filter((s) => setup.positions[s.id]);
  const psis = active.map((s) => ({ psi: modeShapes(ctx.pm, setup.positions[s.id]), f: filt[s.id] }));
  const spk = sources.filter((s) => s.kind === 'speaker' && setup.positions[s.id]).map((s) => setup.positions[s.id]);
  const z = c.earHeight;

  // Неровность в каждом узле полной сетки (отступ 0,1 м от стен)
  const fx = grid(0.1, room.depth - 0.1, step);
  const fy = grid(0.1, room.width - 0.1, step);
  const fNy = fy.length;
  const flat = new Float32Array(fx.length * fNy);
  const wave = isWave(room);
  const fMax = waveFMax(ctx.fHi);
  if (wave) {
    // по расчёту из каждого источника: отклики во всех узлах слоя высоты ушей
    const pts: Vec3[] = [];
    for (let i = 0; i < fx.length; i++) for (let j = 0; j < fNy; j++) pts.push({ x: fx[i], y: fy[j], z });
    const per = active.map((s, k) => waveSpectra(room, fMax, setup.positions[s.id], pts, freqs, opts.onProgress && ((v) => opts.onProgress!((k + v) / active.length))));
    for (let q = 0; q < pts.length; q++) flat[q] = flatFromSpectra(active.map((s, k) => ({ h: per[k][q], f: filt[s.id] })), target, score);
  } else {
    for (let i = 0; i < fx.length; i++)
      for (let j = 0; j < fNy; j++) flat[i * fNy + j] = flatAt(ctx, { x: fx[i], y: fy[j], z }, freqs, psis, target, score);
  }
  const lookup = (p: { x: number; y: number }) => {
    const i = Math.round((p.x - 0.1) / step);
    const j = Math.round((p.y - 0.1) / step);
    if (i < 0 || j < 0 || i >= fx.length || j >= fNy) return NaN;
    return flat[i * fNy + j];
  };

  // Кандидаты мест (отступ 0,3 м, не ближе 0,4 м к источникам, вне зон «нельзя сидеть»)
  const xs = grid(0.3, room.depth - 0.3, step);
  const ys = grid(0.3, room.width - 0.3, step);
  const ny = ys.length;
  const scores = new Float32Array(xs.length * ny).fill(NaN);
  const allowed = new Uint8Array(xs.length * ny);
  const multi = (c.seats?.count ?? 1) > 1;
  for (let i = 0; i < xs.length; i++)
    for (let j = 0; j < ny; j++) {
      const p = { x: xs[i], y: ys[j], z };
      if (active.some((s) => Math.hypot(setup.positions[s.id].x - p.x, setup.positions[s.id].y - p.y) < 0.4)) continue;
      const { pts, weights } = receiverSet(room, c, p);
      const seats = multi ? pts : [p];
      if (!seats.every((q) => seatAllowed(room, q))) continue;
      let s = 0;
      for (let r = 0; r < pts.length; r++) s += weights[r] * lookup(pts[r]);
      if (!Number.isFinite(s)) continue;
      s += sumPenalties(speakerPenalties(ctx, p, spk).penalties);
      scores[i * ny + j] = s;
      allowed[i * ny + j] = 1;
    }

  // Текущее место — точно, без привязки к сетке
  const cur = receiverSet(room, c, setup.listener);
  let current = 0;
  if (wave) {
    const per = active.map((s) => waveSpectra(room, fMax, setup.positions[s.id], cur.pts, freqs));
    cur.pts.forEach((_, r) => (current += cur.weights[r] * flatFromSpectra(active.map((s, k) => ({ h: per[k][r], f: filt[s.id] })), target, score)));
  } else {
    cur.pts.forEach((p, r) => (current += cur.weights[r] * flatAt(ctx, p, freqs, psis, target, score)));
  }
  current += sumPenalties(speakerPenalties(ctx, setup.listener, spk).penalties);

  return {
    kind: 'listener', x0: xs[0], y0: ys[0], step, nx: xs.length, ny, scores, allowed,
    best: pickBest(xs, ys, scores, allowed, ny), current, ...minMax(scores), elapsedMs: Date.now() - t0,
  };
}

/** Допустима ли точка для сабвуфера по зоне «углы / вдоль стен / где угодно». */
function subZoneOk(room: Room, c: Constraints, p: { x: number; y: number }): boolean {
  const dx = Math.min(p.x, room.depth - p.x);
  const dy = Math.min(p.y, room.width - p.y);
  if (c.subZone === 'corners') return dx <= c.subWallGap + 0.35 && dy <= c.subWallGap + 0.35;
  if (c.subZone === 'walls') return Math.min(dx, dy) <= c.subWallGap + 0.3;
  return true;
}

/**
 * Карта мест сабвуфера (цифровой subwoofer crawl): слушатель и остальные источники фиксированы.
 * По взаимности H(сабвуфер→слушатель) = H(слушатель→сабвуфер), как при ползании с микрофоном.
 */
export function subHeatmap(room: Room, sources: SourceSpec[], c: Constraints, setup: SetupLike, subId: string, opts: { step?: number; ppo?: number; onProgress?: (v: number) => void } = {}): Heatmap {
  const t0 = Date.now();
  const step = opts.step ?? 0.1;
  const ctx = makeCtx(room, sources);
  const freqs = logFreqs(ctx.fLo, ctx.fHi, opts.ppo ?? objectivePpo(c.objective, 12));
  const n = freqs.length;
  const { filt, target } = filterSet(sources, freqs, setup.crossoverHz, setup.subSettings);
  const score = makeScorer(freqs, c.objective, room, objectiveSys(room, c));
  const sub = sources.find((s) => s.id === subId);
  if (!sub) throw new Error(`Нет сабвуфера ${subId}`);
  const { pts, weights } = receiverSet(room, c, setup.listener);
  const others = sources.filter((s) => s.id !== subId && setup.positions[s.id]);
  const spk = sources.filter((s) => s.kind === 'speaker' && setup.positions[s.id]).map((s) => setup.positions[s.id]);
  const pen = sumPenalties(speakerPenalties(ctx, setup.listener, spk).penalties);
  const fs = filt[subId];
  const g = Math.max(0.05, c.subWallGap);
  const xs = grid(g, room.depth - g, step);
  const ys = grid(g, room.width - g, step);
  const ny = ys.length;
  const scores = new Float32Array(xs.length * ny).fill(NaN);
  const allowed = new Uint8Array(xs.length * ny);
  const cands: { idx: number; p: Vec3 }[] = [];
  for (let i = 0; i < xs.length; i++)
    for (let j = 0; j < ny; j++) {
      const p = { x: xs[i], y: ys[j], z: sub.height };
      if (!sourceAllowed(room, p, 0.1)) continue;
      if (Math.hypot(p.x - setup.listener.x, p.y - setup.listener.y) < 0.4) continue;
      cands.push({ idx: i * ny + j, p });
      allowed[i * ny + j] = subZoneOk(room, c, p) ? 1 : 0;
    }
  const cur = setup.positions[subId];

  // отклики «точка → приёмник r»: остальные источники, кандидаты и текущее место сабвуфера
  const fixed: Spectrum[] = [];
  const candResp: Spectrum[][] = pts.map(() => []);
  const curResp: (Spectrum | null)[] = pts.map(() => null);
  if (isWave(room)) {
    const fMax = waveFMax(ctx.fHi);
    const pointList = [...others.map((s) => setup.positions[s.id]), ...cands.map((q) => q.p), ...(cur ? [cur] : [])];
    pts.forEach((r, ri) => {
      const sp = waveSpectra(room, fMax, r, pointList, freqs, opts.onProgress && ((v) => opts.onProgress!((ri + v) / pts.length)));
      const re = new Float64Array(n), im = new Float64Array(n);
      others.forEach((s, k) => {
        const h = sp[k], f = filt[s.id];
        for (let j = 0; j < n; j++) { re[j] += h.re[j] * f.re[j] - h.im[j] * f.im[j]; im[j] += h.re[j] * f.im[j] + h.im[j] * f.re[j]; }
      });
      fixed.push({ re, im });
      candResp[ri] = sp.slice(others.length, others.length + cands.length);
      curResp[ri] = cur ? sp[sp.length - 1] : null;
    });
  } else {
    pts.forEach((r, ri) => {
      const k = receiverKernel(ctx.pm, r, freqs);
      const re = new Float64Array(n), im = new Float64Array(n);
      for (const s of others) {
        const [hr, hi] = applyKernel(k, modeShapes(ctx.pm, setup.positions[s.id]));
        const f = filt[s.id];
        for (let j = 0; j < n; j++) { re[j] += hr[j] * f.re[j] - hi[j] * f.im[j]; im[j] += hr[j] * f.im[j] + hi[j] * f.re[j]; }
      }
      fixed.push({ re, im });
      candResp[ri] = cands.map((q) => { const [a, b] = applyKernel(k, modeShapes(ctx.pm, q.p)); return { re: a, im: b }; });
      if (cur) { const [a, b] = applyKernel(k, modeShapes(ctx.pm, cur)); curResp[ri] = { re: a, im: b }; }
    });
  }
  const d = new Float64Array(n);
  const scoreFrom = (resp: (ri: number) => Spectrum) => {
    let s = pen;
    for (let ri = 0; ri < pts.length; ri++) {
      const h = resp(ri);
      for (let j = 0; j < n; j++) {
        const re = fixed[ri].re[j] + h.re[j] * fs.re[j] - h.im[j] * fs.im[j];
        const im = fixed[ri].im[j] + h.re[j] * fs.im[j] + h.im[j] * fs.re[j];
        d[j] = 10 * Math.log10(Math.max(re * re + im * im, 1e-24));
      }
      s += weights[ri] * score(d, target);
    }
    return s;
  };
  cands.forEach((q, ci) => (scores[q.idx] = scoreFrom((ri) => candResp[ri][ci])));
  return {
    kind: 'sub', subId, x0: xs[0], y0: ys[0], step, nx: xs.length, ny, scores, allowed,
    best: pickBest(xs, ys, scores, allowed, ny), current: cur ? scoreFrom((ri) => curResp[ri]!) : NaN, ...minMax(scores),
    elapsedMs: Date.now() - t0,
  };
}

/**
 * Карта устойчивости: в каждой точке — насколько сильно меняется оценка при сдвиге на ~10 см
 * (наибольшая разница с соседями на расстоянии ≤ 10 см). Меньше — устойчивее.
 */
export function robustnessMap(h: Heatmap, radius = 0.1): Heatmap {
  const r = Math.max(1, Math.round(radius / h.step));
  const out = new Float32Array(h.scores.length).fill(NaN);
  for (let i = 0; i < h.nx; i++)
    for (let j = 0; j < h.ny; j++) {
      const v = h.scores[i * h.ny + j];
      if (!Number.isFinite(v)) continue;
      let m = 0;
      for (let di = -r; di <= r; di++)
        for (let dj = -r; dj <= r; dj++) {
          if (!di && !dj) continue;
          if (di * di + dj * dj > r * r) continue;
          const a = i + di, b = j + dj;
          if (a < 0 || b < 0 || a >= h.nx || b >= h.ny) continue;
          const w = h.scores[a * h.ny + b];
          if (Number.isFinite(w)) m = Math.max(m, Math.abs(w - v));
        }
      out[i * h.ny + j] = m;
    }
  return { ...h, scores: out, ...minMax(out) };
}
