import type {
  Constraints, Placement, PlacementResult, Penalty, Room, SourceSpec, Vec3, Complex, ReverbResult,
} from './types';
import { PlacementError } from './types';
import { computeReverb } from './reverb';
import { speedOfSound } from './physics';
import { logFreqs, db20 } from './frequency';
import { sourceFilter } from './filters';
import { prepareModes, receiverKernel, applyKernel, modeShapes, type PreparedModes, type Kernel } from './response';
import { flatnessScore } from './metric';

export interface PlacementInput {
  room: Room;
  sources: SourceSpec[];
  constraints: Constraints;
}

const SEAT_OFFSET = 0.3; // м, смещение головы влево/вправо для оценки устойчивости
const W_CENTER = 0.6;
const W_SEATS = 0.4;
const MIN_LISTEN_DIST = 1.0; // м, минимальное расстояние от колонок до слушателя
const EPS = 1e-9;

// ---------- Контекст расчёта ----------

interface Ctx {
  room: Room;
  sources: SourceSpec[];
  rev: ReverbResult;
  c: number;
  fLo: number;
  fHi: number;
  pm: PreparedModes;
  notes: string[];
}

function makeCtx(room: Room, sources: SourceSpec[]): Ctx {
  const rev = computeReverb(room);
  const notes: string[] = [];
  const fHi = Math.min(300, Math.max(120, rev.schroeder));
  const minLow = Math.min(...sources.map((s) => s.fLow));
  let fLo = Math.max(20, minLow);
  if (fLo > fHi / 1.5) {
    notes.push(
      'Все источники воспроизводят только частоты выше модальной области — оценка модальной ' +
        'неровности ограничена; расстановка выбирается в основном по геометрическим правилам.',
    );
    fLo = Math.max(20, fHi / 2);
  }
  const fModes = Math.max(fHi * 1.3, fHi + 40);
  return {
    room, sources, rev, c: speedOfSound(room.temperatureC), fLo, fHi,
    pm: prepareModes(room, fModes, rev), notes,
  };
}

/** Комплексные характеристики фильтров источников и целевая кривая (дБ) на частотах. */
function filterSet(ctx: Ctx, freqs: number[]) {
  const filt: Record<string, { re: Float64Array; im: Float64Array }> = {};
  const tRe = new Float64Array(freqs.length);
  const tIm = new Float64Array(freqs.length);
  for (const s of ctx.sources) {
    const re = new Float64Array(freqs.length);
    const im = new Float64Array(freqs.length);
    freqs.forEach((f, i) => {
      const h: Complex = sourceFilter(s, ctx.sources, f);
      re[i] = h.re;
      im[i] = h.im;
      tRe[i] += h.re;
      tIm[i] += h.im;
    });
    filt[s.id] = { re, im };
  }
  const target = Array.from(tRe, (r, i) => db20(Math.hypot(r, tIm[i])));
  return { filt, target };
}

/** Целевая кривая только для подмножества источников. */
function targetFor(ids: string[], filt: Record<string, { re: Float64Array; im: Float64Array }>, n: number) {
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (const id of ids) for (let i = 0; i < n; i++) { re[i] += filt[id].re[i]; im[i] += filt[id].im[i]; }
  return Array.from(re, (r, i) => db20(Math.hypot(r, im[i])));
}

// ---------- Геометрия и штрафы ----------

function speakerPenalties(ctx: Ctx, listener: Vec3, spk: Vec3[]): { penalties: Penalty[]; angle: number | null } {
  const penalties: Penalty[] = [];
  let angle: number | null = null;
  if (!spk.length) return { penalties, angle };
  const { room, c, fHi } = ctx;
  if (spk.length === 2) {
    const half = Math.abs(spk[1].y - spk[0].y) / 2;
    const dist = listener.x - spk[0].x;
    angle = (2 * Math.atan2(half, dist) * 180) / Math.PI;
    const off = angle < 50 ? 50 - angle : angle > 70 ? angle - 70 : 0;
    if (off > 0) penalties.push({ name: `Угол раскрытия ${angle.toFixed(0)}° вне 50–70°`, value: 0.1 * off });
  }
  const s = spk[0];
  const qFront = c / (4 * s.x);
  if (qFront > fHi && qFront <= 500) {
    penalties.push({ name: `Провал от передней стены около ${qFront.toFixed(0)} Гц`, value: 0.5 });
  }
  const side = Math.min(s.y, room.width - s.y);
  const qSide = c / (4 * side);
  if (qSide > fHi && qSide <= 500) {
    penalties.push({ name: `Провал от боковой стены около ${qSide.toFixed(0)} Гц`, value: 0.3 });
  }
  return { penalties, angle };
}

const sum = (p: Penalty[]) => p.reduce((a, b) => a + b.value, 0);

// ---------- Кандидаты ----------

function range(lo: number, hi: number, step: number): number[] {
  const out: number[] = [];
  if (hi < lo - EPS) return out;
  const n = Math.floor((hi - lo) / step + EPS);
  for (let i = 0; i <= n; i++) out.push(round(lo + i * step));
  return out;
}
const round = (v: number) => Math.round(v * 1e6) / 1e6;

interface SpeakerCfg {
  x: number;
  half: number; // полуразнос; 0 для моно
}

function speakerPoints(cfg: SpeakerCfg, room: Room, h: number): Vec3[] {
  if (cfg.half === 0) return [{ x: cfg.x, y: room.width / 2, z: h }];
  return [
    { x: cfg.x, y: round(room.width / 2 - cfg.half), z: h },
    { x: cfg.x, y: round(room.width / 2 + cfg.half), z: h },
  ];
}

function subCandidates(room: Room, c: Constraints, h: number): Vec3[] {
  const g = c.subWallGap;
  const X = room.depth;
  const Y = room.width;
  const pts: Vec3[] = [];
  const add = (x: number, y: number) => {
    const p = { x: round(x), y: round(y), z: h };
    if (!pts.some((q) => Math.abs(q.x - p.x) < 1e-6 && Math.abs(q.y - p.y) < 1e-6)) pts.push(p);
  };
  // углы — первыми (детерминированный порядок)
  add(g, g); add(g, Y - g); add(X - g, g); add(X - g, Y - g);
  if (c.subZone === 'corners') return pts;
  for (const x of range(g, X - g, 0.25)) { add(x, g); add(x, Y - g); }
  for (const y of range(g, Y - g, 0.25)) { add(g, y); add(X - g, y); }
  if (c.subZone === 'anywhere') {
    for (const x of range(0.5, X - 0.5, 0.5))
      for (const y of range(0.5, Y - 0.5, 0.5)) {
        const inListenerZone = x >= c.listenerMinX - 0.3 && x <= c.listenerMaxX + 0.3 && Math.abs(y - Y / 2) < 0.6;
        if (!inListenerZone) add(x, y);
      }
  }
  return pts;
}

function listenerPositions(room: Room, c: Constraints): number[] {
  const len = c.listenerMaxX - c.listenerMinX;
  const step = Math.max(0.05, Math.ceil((len / 30) * 20) / 20);
  return range(c.listenerMinX, c.listenerMaxX, step).filter((x) => x > 0 && x < room.depth);
}

function validate(input: PlacementInput) {
  const { room, sources, constraints: c } = input;
  const spk = sources.filter((s) => s.kind === 'speaker');
  const subs = sources.filter((s) => s.kind === 'sub');
  if (spk.length > 2 || subs.length > 4 || spk.length + subs.length === 0) {
    throw new PlacementError('Нужно от 1 до 2 колонок и от 0 до 4 сабвуферов (хотя бы один источник).');
  }
  if (c.listenerMinX >= c.listenerMaxX || c.listenerMinX <= 0 || c.listenerMaxX >= room.depth) {
    throw new PlacementError('Зона слушателя задана неверно: начало должно быть меньше конца и внутри комнаты.');
  }
  if (spk.length) {
    if (c.speakerMinFront + MIN_LISTEN_DIST > c.listenerMaxX + EPS) {
      throw new PlacementError(
        'Колонки не помещаются перед слушателем: уменьшите отступ колонок от передней стены ' +
          'или сдвиньте зону слушателя дальше (нужно не меньше 1 м между ними).',
      );
    }
    if (spk.length === 2 && room.width / 2 - c.speakerMinSide < 0.4 - EPS) {
      throw new PlacementError('Комната слишком узкая для стерео-пары при заданном отступе от боковых стен.');
    }
  }
}

// ---------- Оценка ----------

function receivers(room: Room, c: Constraints, x: number): Vec3[] {
  const y = room.width / 2;
  const off = Math.min(SEAT_OFFSET, y - 0.1);
  return [
    { x, y, z: c.earHeight },
    { x, y: y - off, z: c.earHeight },
    { x, y: y + off, z: c.earHeight },
  ];
}

/** dB суммы источников с фильтрами: H = Σ filt_s · Hroom(p_s). */
function combinedDb(
  parts: { re: Float64Array; im: Float64Array; fre: Float64Array; fim: Float64Array }[],
  n: number,
): Float64Array {
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (const p of parts) {
    for (let i = 0; i < n; i++) {
      re[i] += p.re[i] * p.fre[i] - p.im[i] * p.fim[i];
      im[i] += p.re[i] * p.fim[i] + p.im[i] * p.fre[i];
    }
  }
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = 20 * Math.log10(Math.max(Math.hypot(re[i], im[i]), 1e-12));
  return out;
}

/** Полная оценка одного варианта на частотах freqs (используется для финальных и базового). */
function evaluateFull(
  ctx: Ctx,
  constraints: Constraints,
  listenerX: number,
  positions: Record<string, Vec3>,
  freqs: number[],
): Placement {
  const { room, sources, pm } = ctx;
  const { filt, target } = filterSet(ctx, freqs);
  const rcv = receivers(room, constraints, listenerX);
  const dbs = rcv.map((r) => {
    const k = receiverKernel(pm, r, freqs);
    const parts = sources.map((s) => {
      const [re, im] = applyKernel(k, modeShapes(pm, positions[s.id]));
      return { re, im, fre: filt[s.id].re, fim: filt[s.id].im };
    });
    return combinedDb(parts, freqs.length);
  });
  const scores = dbs.map((d) => flatnessScore(d, target));
  const spk = sources.filter((s) => s.kind === 'speaker').map((s) => positions[s.id]);
  const { penalties, angle } = speakerPenalties(ctx, rcv[0], spk);
  const seats = (scores[1] + scores[2]) / 2;
  const center = dbs[0];
  let off = 0;
  for (let i = 0; i < center.length; i++) off += center[i] - target[i];
  off /= center.length;
  return {
    listener: rcv[0],
    sources: sources.map((s) => ({ id: s.id, pos: positions[s.id] })),
    score: W_CENTER * scores[0] + W_SEATS * seats + sum(penalties),
    scoreCenter: scores[0],
    scoreSeats: seats,
    penalties,
    angleDeg: angle,
    response: { f: freqs, db: Array.from(center, (v) => v - off), target },
  };
}

function baselinePositions(room: Room, sources: SourceSpec[], c: Constraints): { listenerX: number; positions: Record<string, Vec3> } {
  const listenerX = Math.min(c.listenerMaxX, Math.max(c.listenerMinX, 0.38 * room.depth));
  const positions: Record<string, Vec3> = {};
  const g = c.subWallGap;
  const corners = [
    [g, g], [g, room.width - g], [room.depth - g, g], [room.depth - g, room.width - g],
  ];
  const spkX = Math.max(c.speakerMinFront, Math.min(0.5, listenerX - MIN_LISTEN_DIST));
  let subIdx = 0;
  for (const s of sources) {
    if (s.id === 'spkC') positions[s.id] = { x: spkX, y: room.width / 2, z: s.height };
    else if (s.id === 'spkL') positions[s.id] = { x: spkX, y: Math.max(c.speakerMinSide, room.width / 4), z: s.height };
    else if (s.id === 'spkR') positions[s.id] = { x: spkX, y: Math.min(room.width - c.speakerMinSide, (3 * room.width) / 4), z: s.height };
    else {
      const [x, y] = corners[subIdx++ % 4];
      positions[s.id] = { x, y, z: s.height };
    }
  }
  return { listenerX, positions };
}

/** Базовый вариант: сабвуфер в переднем углу, колонки на ¼ ширины, слушатель на 38 % глубины. */
export function baselinePlacement(room: Room, sources: SourceSpec[], c: Constraints): Placement {
  const ctx = makeCtx(room, sources);
  const { listenerX, positions } = baselinePositions(room, sources, c);
  return evaluateFull(ctx, c, listenerX, positions, logFreqs(ctx.fLo, ctx.fHi, 24));
}

/** Оценка произвольного варианта (например, расстановки пользователя). */
export function evaluatePlacement(
  room: Room, sources: SourceSpec[], c: Constraints, listenerX: number, positions: Record<string, Vec3>,
): Placement {
  const ctx = makeCtx(room, sources);
  return evaluateFull(ctx, c, listenerX, positions, logFreqs(ctx.fLo, ctx.fHi, 24));
}

// ---------- Поиск ----------

interface Found {
  score: number;
  listenerX: number;
  positions: Record<string, Vec3>;
}

/**
 * Перебор расстановок на дискретной сетке (research R8). Детерминирован.
 * onProgress получает долю выполненной работы 0…1.
 */
export function optimizePlacement(input: PlacementInput, onProgress?: (p: number) => void): PlacementResult {
  const t0 = Date.now();
  validate(input);
  const { room, sources, constraints: c } = input;
  const ctx = makeCtx(room, sources);
  const { pm } = ctx;
  const freqs = logFreqs(ctx.fLo, ctx.fHi, 12);
  const nF = freqs.length;
  const { filt, target } = filterSet(ctx, freqs);

  const spkSpecs = sources.filter((s) => s.kind === 'speaker');
  const subSpecs = sources.filter((s) => s.kind === 'sub');
  const spkIds = spkSpecs.map((s) => s.id);
  const spkTarget = spkSpecs.length ? targetFor(spkIds, filt, nF) : [];
  // Полоса, где колонки влияют на НЧ-оценку
  const spkLow = spkSpecs.length ? Math.min(...spkSpecs.map((s) => s.fLow)) : Infinity;
  const spkBandStart = freqs.findIndex((f) => f >= spkLow * 0.7);
  const spkBandOk = subSpecs.length > 0 && spkBandStart >= 0 && nF - spkBandStart >= 6;

  // Кандидаты колонок
  const spkH = spkSpecs[0]?.height ?? 1;
  const xsAll = range(c.speakerMinFront, Math.max(c.speakerMinFront, 0.45 * room.depth), 0.1);
  const halves = spkSpecs.length === 2 ? range(0.4, room.width / 2 - c.speakerMinSide, 0.1) : [0];
  const cfgs: SpeakerCfg[] = [];
  for (const x of xsAll) for (const half of halves) cfgs.push({ x, half });

  // Кандидаты сабвуферов
  const subH = subSpecs[0]?.height ?? 0.3;
  const subPts = subSpecs.length ? subCandidates(room, c, subH) : [];

  // Собственные функции всех точек
  const cfgPts = cfgs.map((cfg) => speakerPoints(cfg, room, spkH));
  const cfgPsi = cfgPts.map((pts) => pts.map((p) => modeShapes(pm, p)));
  const subPsi = subPts.map((p) => modeShapes(pm, p));

  const listeners = listenerPositions(room, c);
  const found: Found[] = [];
  let evaluated = 0;
  const filtOf = (id: string) => filt[id];

  listeners.forEach((lx, li) => {
    const rcv = receivers(room, c, lx);
    const kernels: Kernel[] = rcv.map((r) => receiverKernel(pm, r, freqs));
    const okCfg = cfgs
      .map((cfg, i) => ({ cfg, i }))
      .filter(({ cfg }) => lx - cfg.x >= MIN_LISTEN_DIST - EPS);
    if (spkSpecs.length && okCfg.length === 0) return;

    // Отклики колонок для каждой конфигурации и приёмника (уже с фильтрами)
    type Resp = { re: Float64Array; im: Float64Array };
    const withFilter = (h: [Float64Array, Float64Array], id: string): Resp => {
      const f = filtOf(id);
      const re = new Float64Array(nF);
      const im = new Float64Array(nF);
      for (let j = 0; j < nF; j++) {
        re[j] = h[0][j] * f.re[j] - h[1][j] * f.im[j];
        im[j] = h[0][j] * f.im[j] + h[1][j] * f.re[j];
      }
      return { re, im };
    };
    const addInto = (acc: Resp, r: Resp) => {
      for (let j = 0; j < nF; j++) { acc.re[j] += r.re[j]; acc.im[j] += r.im[j]; }
    };
    const toDb = (r: Resp, from = 0) => {
      const out = new Float64Array(nF - from);
      for (let j = from; j < nF; j++) out[j - from] = 20 * Math.log10(Math.max(Math.hypot(r.re[j], r.im[j]), 1e-12));
      return out;
    };
    const scoreOf = (rs: Resp[], tgt: number[], from = 0) => {
      const t = from ? tgt.slice(from) : tgt;
      const s = rs.map((r) => flatnessScore(toDb(r, from), t));
      return { center: s[0], seats: (s[1] + s[2]) / 2, total: W_CENTER * s[0] + W_SEATS * (s[1] + s[2]) / 2 };
    };

    // Этап 1: колонки
    type SpkEval = { cfg: SpeakerCfg; idx: number; resp: Resp[]; pen: number; rank: number };
    const spkEvals: SpkEval[] = [];
    if (spkSpecs.length) {
      for (const { cfg, i } of okCfg) {
        const resp = kernels.map((k) => {
          const acc: Resp = { re: new Float64Array(nF), im: new Float64Array(nF) };
          cfgPsi[i].forEach((psi, si) => addInto(acc, withFilter(applyKernel(k, psi), spkIds[si])));
          return acc;
        });
        const { penalties } = speakerPenalties(ctx, rcv[0], cfgPts[i]);
        const pen = sum(penalties);
        let rank = pen;
        if (!subSpecs.length) rank += scoreOf(resp, target).total;
        else if (spkBandOk) rank += scoreOf(resp, spkTarget, spkBandStart).total;
        spkEvals.push({ cfg, idx: i, resp, pen, rank });
        evaluated++;
      }
      spkEvals.sort((a, b) => a.rank - b.rank);
    }

    const recordFound = (score: number, se: SpkEval | null, subs: number[]) => {
      const positions: Record<string, Vec3> = {};
      if (se) cfgPts[se.idx].forEach((p, k) => (positions[spkIds[k]] = p));
      subs.forEach((pi, k) => (positions[subSpecs[k].id] = subPts[pi]));
      found.push({ score, listenerX: lx, positions });
    };

    if (!subSpecs.length) {
      const best = spkEvals[0];
      recordFound(best.rank, best, []);
      onProgress?.((li + 1) / listeners.length);
      return;
    }

    // Отклики сабвуферов в каждой точке-кандидате (для каждого сабвуфера свой фильтр)
    const subResp: Resp[][][] = subSpecs.map((s) =>
      subPts.map((_, pi) => kernels.map((k) => withFilter(applyKernel(k, subPsi[pi]), s.id))),
    );

    const top = spkSpecs.length ? spkEvals.slice(0, subSpecs.length > 1 ? 3 : 4) : [null];
    let bestScore = Infinity;
    let bestSe: SpkEval | null = null;
    let bestSubs: number[] = [];

    // Предвыделенные буферы: оценка комбинации без аллокаций
    const accRe = new Float64Array(nF);
    const accIm = new Float64Array(nF);
    const dev = new Float64Array(nF);
    const scoreRcv = (r: number, se: SpkEval | null, subs: number[]) => {
      if (se) { accRe.set(se.resp[r].re); accIm.set(se.resp[r].im); }
      else { accRe.fill(0); accIm.fill(0); }
      for (let k = 0; k < subs.length; k++) {
        const sr = subResp[k][subs[k]][r];
        for (let j = 0; j < nF; j++) { accRe[j] += sr.re[j]; accIm[j] += sr.im[j]; }
      }
      for (let j = 0; j < nF; j++) {
        dev[j] = 10 * Math.log10(Math.max(accRe[j] * accRe[j] + accIm[j] * accIm[j], 1e-24));
      }
      return flatnessScore(dev, target);
    };
    const evalCombo = (se: SpkEval | null, subs: number[]) => {
      evaluated++;
      const c0 = scoreRcv(0, se, subs);
      const c1 = scoreRcv(1, se, subs);
      const c2 = scoreRcv(2, se, subs);
      return W_CENTER * c0 + W_SEATS * (c1 + c2) / 2 + (se ? se.pen : 0);
    };

    // Индекс зеркальной точки (через ось комнаты по ширине и по глубине)
    const findPt = (x: number, y: number) =>
      subPts.findIndex((q) => Math.abs(q.x - x) < 1e-6 && Math.abs(q.y - y) < 1e-6);

    for (const se of top) {
      const n = subSpecs.length;
      if (n === 1) {
        for (let a = 0; a < subPts.length; a++) {
          const s = evalCombo(se, [a]);
          if (s < bestScore) { bestScore = s; bestSe = se; bestSubs = [a]; }
        }
      } else if (n === 2) {
        // Пары из 24 лучших одиночных позиций + все зеркальные пары
        const singles = subPts.map((_, a) => ({ a, s: evalCombo(se, [a]) })).sort((p, q) => p.s - q.s);
        const pool = singles.slice(0, 24).map((x) => x.a);
        const pairs = new Set<string>();
        const pairList: [number, number][] = [];
        const addPair = (a: number, b: number) => {
          if (a < 0 || b < 0 || a === b) return;
          const key = a < b ? `${a},${b}` : `${b},${a}`;
          if (pairs.has(key)) return;
          pairs.add(key);
          pairList.push(a < b ? [a, b] : [b, a]);
        };
        for (let i = 0; i < pool.length; i++) for (let j = i + 1; j < pool.length; j++) addPair(pool[i], pool[j]);
        subPts.forEach((p, a) => {
          addPair(a, findPt(p.x, room.width - p.y));
          addPair(a, findPt(room.depth - p.x, p.y));
        });
        for (const [a, b] of pairList) {
          const s = evalCombo(se, [a, b]);
          if (s < bestScore) { bestScore = s; bestSe = se; bestSubs = [a, b]; }
        }
      } else {
        // Жадный выбор + одно уточнение по координатам
        const chosen: number[] = [];
        for (let k = 0; k < n; k++) {
          let bS = Infinity;
          let bI = 0;
          for (let a = 0; a < subPts.length; a++) {
            if (chosen.includes(a)) continue;
            const trial = [...chosen, a];
            // недостающие сабвуферы временно не учитываются
            const s = evalCombo(se, trial);
            if (s < bS) { bS = s; bI = a; }
          }
          chosen.push(bI);
        }
        for (let k = 0; k < n; k++) {
          let bS = evalCombo(se, chosen);
          for (let a = 0; a < subPts.length; a++) {
            if (chosen.includes(a)) continue;
            const trial = chosen.slice();
            trial[k] = a;
            const s = evalCombo(se, trial);
            if (s < bS) { bS = s; chosen[k] = a; }
          }
        }
        const s = evalCombo(se, chosen);
        if (s < bestScore) { bestScore = s; bestSe = se; bestSubs = chosen.slice(); }
      }
    }
    recordFound(bestScore, bestSe, bestSubs);
    onProgress?.((li + 1) / listeners.length);
  });

  if (!found.length) {
    throw new PlacementError('Не удалось подобрать ни одного варианта: ослабьте ограничения расстановки.');
  }

  // Финальная оценка на подробной сетке; базовый вариант тоже участвует в отборе
  const finalFreqs = logFreqs(ctx.fLo, ctx.fHi, 24);
  const base = baselinePositions(room, sources, c);
  const baseline = evaluateFull(ctx, c, base.listenerX, base.positions, finalFreqs);

  found.sort((a, b) => a.score - b.score);
  const shortlist = found.slice(0, 8).map((f) => evaluateFull(ctx, c, f.listenerX, f.positions, finalFreqs));
  shortlist.push(baseline);
  shortlist.sort((a, b) => a.score - b.score);

  const best: Placement[] = [];
  for (const p of shortlist) {
    if (best.length >= 3) break;
    if (best.some((q) => Math.abs(q.listener.x - p.listener.x) < 0.2 && samePositions(q, p))) continue;
    if (best.some((q) => Math.abs(q.listener.x - p.listener.x) < 0.2 - EPS)) continue;
    best.push(p);
  }
  for (const p of shortlist) {
    if (best.length >= 3) break;
    if (!best.includes(p)) best.push(p);
  }
  best.sort((a, b) => a.score - b.score);

  const notes = [...ctx.notes];
  if (baseline.score - best[0].score < 0.3) {
    notes.push('Базовая расстановка уже близка к оптимальной для этой комнаты.');
  }
  return {
    best,
    baseline,
    fLo: ctx.fLo,
    fHi: ctx.fHi,
    schroeder: ctx.rev.schroeder,
    evaluated,
    elapsedMs: Date.now() - t0,
    notes,
  };
}

function samePositions(a: Placement, b: Placement): boolean {
  return a.sources.every((s) => {
    const o = b.sources.find((x) => x.id === s.id);
    return !!o && Math.hypot(o.pos.x - s.pos.x, o.pos.y - s.pos.y) < 0.3;
  });
}
