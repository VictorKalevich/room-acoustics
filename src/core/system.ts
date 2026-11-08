// Общие элементы оценки системы: контекст расчёта, фильтры, места прослушивания, зоны,
// регулировки сабвуфера и оценка произвольного варианта расстановки.
import type {
  Complex, Constraints, Penalty, ReverbResult, Room, Setup, SourceSpec, SubSetting, Vec3, Zone,
} from './types';
import { computeReverb } from './reverb';
import { speedOfSound } from './physics';
import { db20, logFreqs } from './frequency';
import { sourceFilter } from './filters';
import { applyKernel, modeShapes, prepareModes, receiverKernel, type PreparedModes } from './response';
import { flatnessScore } from './metric';
import { isFlat, makeScorer } from './objective';
import { isWave } from './geometry';
import { hasSim, waveFMax, waveSpectra } from './acoustics';

export const MIN_LISTEN_DIST = 1.0; // м, минимум между колонками и слушателем
export const SEAT_OFFSET = 0.3; // м, сдвиг головы влево/вправо при одном месте
const EPS = 1e-9;

// ---------- Контекст ----------

export interface EvalCtx {
  room: Room;
  sources: SourceSpec[];
  rev: ReverbResult;
  c: number;
  fLo: number;
  fHi: number;
  pm: PreparedModes;
  notes: string[];
}

/** Полоса оценки баса: от нижней границы системы (не ниже 20 Гц) до частоты Шрёдера (120–300 Гц). */
export function evalBand(room: Room, sources: SourceSpec[], rev: ReverbResult = computeReverb(room)): { fLo: number; fHi: number; narrow: boolean } {
  const fHi = Math.min(300, Math.max(120, rev.schroeder));
  const minLow = Math.min(...sources.map((s) => s.fLow));
  let fLo = Math.max(20, minLow);
  const narrow = fLo > fHi / 1.5;
  if (narrow) fLo = Math.max(20, fHi / 2);
  return { fLo, fHi, narrow };
}

export function makeCtx(room: Room, sources: SourceSpec[]): EvalCtx {
  const rev = computeReverb(room);
  const notes: string[] = [];
  const { fLo, fHi, narrow } = evalBand(room, sources, rev);
  if (narrow) {
    notes.push(
      'Все источники воспроизводят только частоты выше модальной области — оценка модальной ' +
        'неровности ограничена; расстановка выбирается в основном по геометрическим правилам.',
    );
  }
  const fModes = Math.max(fHi * 2, fHi + 60);
  return { room, sources, rev, c: speedOfSound(room.temperatureC), fLo, fHi, pm: prepareModes(room, fModes, rev), notes };
}

// ---------- Фильтры и регулировки ----------

/** Источники с изменённой частотой кроссовера (колонки ФВЧ, сабвуферы ФНЧ). */
export function withCrossover(sources: SourceSpec[], xo: number | null | undefined): SourceSpec[] {
  if (!xo) return sources;
  if (!sources.some((s) => s.kind === 'sub') || !sources.some((s) => s.kind === 'speaker')) return sources;
  return sources.map((s) => (s.kind === 'speaker' ? { ...s, fLow: xo } : { ...s, fHigh: xo }));
}

/** Комплексный отклик аналогового прототипа пикового фильтра (PEQ) на частоте f. */
export function peqComplex(p: { f: number; gainDb: number; q: number }, f: number): Complex {
  const A = Math.pow(10, p.gainDb / 40);
  const w = f / p.f;
  // (1 − w² + j·w·A/Q) / (1 − w² + j·w/(A·Q))
  const nr = 1 - w * w, ni = (w * A) / p.q, dr = 1 - w * w, di = w / (A * p.q);
  const d = dr * dr + di * di;
  return { re: (nr * dr + ni * di) / d, im: (ni * dr - nr * di) / d };
}

/** All-pass 2-го порядка: (1 − w² − j·w/Q) / (1 − w² + j·w/Q) — модуль 1, сдвиг фазы до −360°. */
export function allpassComplex(p: { f: number; q: number }, f: number): Complex {
  const w = f / p.f;
  const r = 1 - w * w, i = w / p.q;
  const d = r * r + i * i;
  return { re: (r * r - i * i) / d, im: (-2 * r * i) / d };
}

const cmul = (a: Complex, b: Complex): Complex => ({ re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re });

/** Регулировки сабвуфера на частоте f: G·e^{j(φ − 2πfτ)} × PEQ × all-pass. */
export function subAdjust(set: SubSetting | undefined, f: number): Complex {
  if (!set) return { re: 1, im: 0 };
  const g = Math.pow(10, set.gainDb / 20);
  const ph = (set.phaseDeg * Math.PI) / 180 - 2 * Math.PI * f * (set.delayMs / 1000);
  let out: Complex = { re: g * Math.cos(ph), im: g * Math.sin(ph) };
  for (const p of set.peq ?? []) out = cmul(out, peqComplex(p, f));
  for (const p of set.allpass ?? []) out = cmul(out, allpassComplex(p, f));
  return out;
}

export type Spectrum = { re: Float64Array; im: Float64Array };

/**
 * Фильтры источников на частотах (с учётом кроссовера и регулировок сабвуферов) и целевая кривая
 * (сумма номинальных фильтров без регулировок, дБ).
 */
export function filterSet(
  sources: SourceSpec[],
  freqs: number[],
  crossoverHz?: number | null,
  settings?: Record<string, SubSetting>,
): { filt: Record<string, Spectrum>; target: number[] } {
  const sys = withCrossover(sources, crossoverHz);
  const n = freqs.length;
  const tRe = new Float64Array(n);
  const tIm = new Float64Array(n);
  const filt: Record<string, Spectrum> = {};
  for (const s of sys) {
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const h = sourceFilter(s, sys, freqs[i]);
      tRe[i] += h.re;
      tIm[i] += h.im;
      const a = s.kind === 'sub' ? subAdjust(settings?.[s.id], freqs[i]) : { re: 1, im: 0 };
      re[i] = h.re * a.re - h.im * a.im;
      im[i] = h.re * a.im + h.im * a.re;
    }
    filt[s.id] = { re, im };
  }
  return { filt, target: Array.from(tRe, (r, i) => db20(Math.hypot(r, tIm[i]))) };
}

// ---------- Места прослушивания ----------

/** Места в ряд поперёк комнаты, центрированные на основном месте; шаг уменьшается, если не помещается. */
export function seatPositions(room: Room, listener: Vec3, c: Pick<Constraints, 'seats'>): Vec3[] {
  const n = Math.max(1, Math.min(5, Math.round(c.seats?.count ?? 1)));
  if (n === 1) return [listener];
  const margin = 0.2;
  const maxSpacing = (room.width - 2 * margin) / (n - 1);
  const s = Math.min(c.seats.spacing, maxSpacing);
  const half = (s * (n - 1)) / 2;
  const y0 = Math.min(room.width - margin - 2 * half, Math.max(margin, listener.y - half));
  return Array.from({ length: n }, (_, i) => ({ x: listener.x, y: y0 + i * s, z: listener.z }));
}

/**
 * Точки оценки и их веса: при одном месте — центр и сдвиги головы ±0,3 м (в волновой модели — только
 * центр, чтобы не умножать число расчётов), иначе все места поровну.
 */
export function receiverSet(room: Room, c: Constraints, listener: Vec3): { pts: Vec3[]; weights: number[] } {
  const n = Math.max(1, Math.round(c.seats?.count ?? 1));
  if (n > 1) {
    const pts = seatPositions(room, listener, c);
    return { pts, weights: pts.map(() => 1 / pts.length) };
  }
  if (isWave(room)) return { pts: [listener], weights: [1] };
  const off = Math.min(SEAT_OFFSET, listener.y - 0.1, room.width - listener.y - 0.1);
  return {
    pts: [listener, { ...listener, y: listener.y - off }, { ...listener, y: listener.y + off }],
    weights: [0.6, 0.2, 0.2],
  };
}

// ---------- Зоны ----------

export function inZone(z: Zone, x: number, y: number, margin = 0): boolean {
  return x >= z.x0 - margin && x <= z.x1 + margin && y >= z.y0 - margin && y <= z.y1 + margin;
}

/** Можно ли поставить источник в точку (вне всех зон). */
export function sourceAllowed(room: Room, p: { x: number; y: number }, margin = 0.05): boolean {
  return !(room.zones ?? []).some((z) => inZone(z, p.x, p.y, margin));
}

/** Можно ли сидеть в точке (вне зон, где сидеть нельзя). */
export function seatAllowed(room: Room, p: { x: number; y: number }): boolean {
  return !(room.zones ?? []).some((z) => !z.canSit && inZone(z, p.x, p.y));
}

// ---------- Геометрические штрафы колонок ----------

export function speakerPenalties(ctx: EvalCtx, listener: Vec3, spk: Vec3[]): { penalties: Penalty[]; angle: number | null } {
  const penalties: Penalty[] = [];
  let angle: number | null = null;
  if (!spk.length) return { penalties, angle };
  const { room, c, fHi } = ctx;
  if (spk.length === 2) {
    const a1 = Math.atan2(spk[0].y - listener.y, listener.x - spk[0].x);
    const a2 = Math.atan2(spk[1].y - listener.y, listener.x - spk[1].x);
    angle = (Math.abs(a1 - a2) * 180) / Math.PI;
    const off = angle < 50 ? 50 - angle : angle > 70 ? angle - 70 : 0;
    if (off > 0) penalties.push({ name: `Угол раскрытия ${angle.toFixed(0)}° вне 50–70°`, value: 0.1 * off });
  }
  const s = spk[0];
  const qFront = c / (4 * Math.max(s.x, 0.02));
  if (qFront > fHi && qFront <= 500) {
    penalties.push({ name: `Провал от передней стены около ${qFront.toFixed(0)} Гц`, value: 0.5 });
  }
  const side = Math.max(0.02, Math.min(s.y, room.width - s.y));
  const qSide = c / (4 * side);
  if (qSide > fHi && qSide <= 500) {
    penalties.push({ name: `Провал от боковой стены около ${qSide.toFixed(0)} Гц`, value: 0.3 });
  }
  return { penalties, angle };
}

export const sumPenalties = (p: Penalty[]) => p.reduce((a, b) => a + b.value, 0);

// ---------- Отклики и оценка ----------

/**
 * Отклик комнаты (без фильтра) от источников points к приёмникам rcv: out[id][r].
 * В волновой модели выбирается расчёт из источников или из приёмников (по взаимности) — что уже есть в кэше
 * или требует меньше расчётов.
 */
export function rawResponses(ctx: EvalCtx, rcv: Vec3[], freqs: number[], points: Record<string, Vec3>, onProgress?: (v: number) => void): Record<string, Spectrum[]> {
  const out: Record<string, Spectrum[]> = {};
  if (isWave(ctx.room)) {
    const fMax = waveFMax(ctx.fHi);
    const ids = Object.keys(points);
    const srcHeights = ids.map((id) => points[id].z);
    const rcvHeights = rcv.map((r) => r.z);
    const srcCached = ids.every((id) => hasSim(ctx.room, fMax, points[id], rcvHeights));
    const rcvCached = rcv.every((r) => hasSim(ctx.room, fMax, r, srcHeights));
    const fromReceivers = rcvCached || (!srcCached && rcv.length <= ids.length);
    if (fromReceivers) {
      const pts = ids.map((id) => points[id]);
      ids.forEach((id) => (out[id] = []));
      rcv.forEach((r, ri) => {
        const sp = waveSpectra(ctx.room, fMax, r, pts, freqs, onProgress && ((v) => onProgress((ri + v) / rcv.length)));
        ids.forEach((id, k) => (out[id][ri] = sp[k]));
      });
    } else {
      ids.forEach((id, k) => {
        out[id] = waveSpectra(ctx.room, fMax, points[id], rcv, freqs, onProgress && ((v) => onProgress((k + v) / ids.length)));
      });
    }
    return out;
  }
  const kernels = rcv.map((r) => receiverKernel(ctx.pm, r, freqs));
  for (const [id, p] of Object.entries(points)) {
    const psi = modeShapes(ctx.pm, p);
    out[id] = kernels.map((k) => {
      const [re, im] = applyKernel(k, psi);
      return { re, im };
    });
  }
  return out;
}

/** Сумма источников с фильтрами в одной точке → дБ. */
export function sumDb(raw: Record<string, Spectrum[]>, filt: Record<string, Spectrum>, r: number, n: number, ids: string[]): Float64Array {
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (const id of ids) {
    const h = raw[id][r];
    const f = filt[id];
    for (let j = 0; j < n; j++) {
      re[j] += h.re[j] * f.re[j] - h.im[j] * f.im[j];
      im[j] += h.re[j] * f.im[j] + h.im[j] * f.re[j];
    }
  }
  const out = new Float64Array(n);
  for (let j = 0; j < n; j++) out[j] = 10 * Math.log10(Math.max(re[j] * re[j] + im[j] * im[j], 1e-24));
  return out;
}

export interface SetupEval {
  score: number;
  /** Оценка по цели подбора (со штрафами); при «ровном басе» равна score. */
  objScore: number;
  perReceiver: number[];
  weights: number[];
  receivers: Vec3[];
  seats: Vec3[];
  penalties: Penalty[];
  angleDeg: number | null;
  /** АЧХ (основное место или среднее по местам), выровненная по цели. */
  response: { f: number[]; db: number[]; target: number[] };
  fLo: number;
  fHi: number;
  model: 'modal' | 'wave';
}

/** Оценка произвольного варианта расстановки с регулировками сабвуферов. */
export function evaluateSetup(
  room: Room,
  sources: SourceSpec[],
  c: Constraints,
  setup: Pick<Setup, 'listener' | 'positions' | 'subSettings' | 'crossoverHz'>,
  opts: { ppo?: number; ctx?: EvalCtx; onProgress?: (v: number) => void } = {},
): SetupEval {
  const ctx = opts.ctx ?? makeCtx(room, sources);
  const freqs = logFreqs(ctx.fLo, ctx.fHi, opts.ppo ?? 24);
  const n = freqs.length;
  const { filt, target } = filterSet(sources, freqs, setup.crossoverHz, setup.subSettings);
  const { pts, weights } = receiverSet(room, c, setup.listener);
  const raw = rawResponses(ctx, pts, freqs, setup.positions, opts.onProgress);
  const ids = sources.map((s) => s.id).filter((id) => setup.positions[id]);
  const dbs = pts.map((_, r) => sumDb(raw, filt, r, n, ids));
  const perReceiver = dbs.map((d) => flatnessScore(d, target));
  const scorer = isFlat(c.objective) ? null : makeScorer(freqs, c.objective, room);
  const perObj = scorer ? dbs.map((d) => scorer(d, target)) : perReceiver;
  const spk = sources.filter((s) => s.kind === 'speaker' && setup.positions[s.id]).map((s) => setup.positions[s.id]);
  const { penalties, angle } = speakerPenalties(ctx, setup.listener, spk);
  const multi = (c.seats?.count ?? 1) > 1;
  const shown = multi
    ? Array.from({ length: n }, (_, j) => dbs.reduce((a, d) => a + d[j], 0) / dbs.length)
    : Array.from(dbs[0]);
  let off = 0;
  for (let j = 0; j < n; j++) off += shown[j] - target[j];
  off /= n;
  const pen = sumPenalties(penalties);
  return {
    score: perReceiver.reduce((a, s, i) => a + s * weights[i], 0) + pen,
    objScore: perObj.reduce((a, s, i) => a + s * weights[i], 0) + pen,
    perReceiver,
    weights,
    receivers: pts,
    seats: seatPositions(room, setup.listener, c),
    penalties,
    angleDeg: angle,
    response: { f: freqs, db: shown.map((v) => v - off), target },
    fLo: ctx.fLo,
    fHi: ctx.fHi,
    model: isWave(room) ? 'wave' : 'modal',
  };
}

/** Точка внутри комнаты с отступом от стен. */
export function clampToRoom(room: Room, p: Vec3, margin = 0.05): Vec3 {
  return {
    x: Math.min(room.depth - margin, Math.max(margin, p.x)),
    y: Math.min(room.width - margin, Math.max(margin, p.y)),
    z: p.z,
  };
}

export const roundTo = (v: number, step: number) => Math.round(v / step + EPS) * step;
