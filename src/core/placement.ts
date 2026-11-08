import type { Constraints, Placement, PlacementResult, Room, SourceSpec, SubSetting, Vec3 } from './types';
import { PlacementError } from './types';
import { logFreqs, db20 } from './frequency';
import { receiverKernel, applyKernel, modeShapes, type Kernel } from './response';
import { flatnessScore } from './metric';
import {
  MIN_LISTEN_DIST, clampToRoom, evaluateSetup, filterSet, makeCtx, receiverSet, seatAllowed, sourceAllowed,
  speakerPenalties, sumPenalties, type EvalCtx, type Spectrum,
} from './system';
import { isWave } from './geometry';
import { speedOfSound } from './physics';
import { waveSpectra } from './acoustics';

export interface PlacementInput {
  room: Room;
  sources: SourceSpec[];
  constraints: Constraints;
}

const EPS = 1e-9;

// ---------- Кандидаты ----------

export function range(lo: number, hi: number, step: number): number[] {
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

/** Кандидаты положения сабвуфера по зоне «углы / вдоль стен / где угодно», без запретных зон. */
export function subCandidates(room: Room, c: Constraints, h: number, step = 0.25): Vec3[] {
  const g = c.subWallGap;
  const X = room.depth;
  const Y = room.width;
  const pts: Vec3[] = [];
  const add = (x: number, y: number) => {
    const p = { x: round(x), y: round(y), z: h };
    if (!sourceAllowed(room, p)) return;
    if (!pts.some((q) => Math.abs(q.x - p.x) < 1e-6 && Math.abs(q.y - p.y) < 1e-6)) pts.push(p);
  };
  // углы — первыми (детерминированный порядок)
  add(g, g); add(g, Y - g); add(X - g, g); add(X - g, Y - g);
  if (c.subZone === 'corners') return pts;
  for (const x of range(g, X - g, step)) { add(x, g); add(x, Y - g); }
  for (const y of range(g, Y - g, step)) { add(g, y); add(X - g, y); }
  if (c.subZone === 'anywhere') {
    for (const x of range(0.5, X - 0.5, step * 2))
      for (const y of range(0.5, Y - 0.5, step * 2)) {
        const inListenerZone = x >= c.listenerMinX - 0.3 && x <= c.listenerMaxX + 0.3 && Math.abs(y - Y / 2) < 0.6;
        if (!inListenerZone) add(x, y);
      }
  }
  return pts;
}

function listenerPositions(room: Room, c: Constraints): number[] {
  const len = c.listenerMaxX - c.listenerMinX;
  // волновая модель: каждое место слушателя — отдельный расчёт, поэтому шаг крупнее
  const step = isWave(room) ? Math.max(0.25, Math.ceil((len / 12) * 20) / 20) : Math.max(0.05, Math.ceil((len / 30) * 20) / 20);
  return range(c.listenerMinX, c.listenerMaxX, step).filter((x) => {
    if (x <= 0 || x >= room.depth) return false;
    const { pts } = receiverSet(room, c, { x, y: room.width / 2, z: c.earHeight });
    const seats = (c.seats?.count ?? 1) > 1 ? pts : [pts[0]];
    return seats.every((p) => seatAllowed(room, p));
  });
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

// ---------- Базовый вариант ----------

export function baselinePositions(room: Room, sources: SourceSpec[], c: Constraints): { listener: Vec3; positions: Record<string, Vec3> } {
  const listenerX = Math.min(c.listenerMaxX, Math.max(c.listenerMinX, 0.38 * room.depth));
  const positions: Record<string, Vec3> = {};
  const g = c.subWallGap;
  const corners = [[g, g], [g, room.width - g], [room.depth - g, g], [room.depth - g, room.width - g]];
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
  return { listener: { x: listenerX, y: room.width / 2, z: c.earHeight }, positions };
}

function toPlacement(ctx: EvalCtx, sources: SourceSpec[], c: Constraints, listener: Vec3, positions: Record<string, Vec3>, subSettings: Record<string, SubSetting> = {}): Placement {
  const e = evaluateSetup(ctx.room, sources, c, { listener, positions, subSettings, crossoverHz: null }, { ctx });
  const single = (c.seats?.count ?? 1) <= 1;
  const others = e.perReceiver.slice(1);
  return {
    listener,
    seats: e.seats,
    sources: sources.map((s) => ({ id: s.id, pos: positions[s.id] })),
    score: e.score,
    scoreCenter: e.perReceiver[0],
    scoreSeats: single ? (others[0] + others[1]) / 2 : e.perReceiver.reduce((a, b) => a + b, 0) / e.perReceiver.length,
    penalties: e.penalties,
    angleDeg: e.angleDeg,
    response: e.response,
  };
}

/** Базовый вариант: сабвуфер в переднем углу, колонки на ¼ ширины, слушатель на 38 % глубины. */
export function baselinePlacement(room: Room, sources: SourceSpec[], c: Constraints): Placement {
  const ctx = makeCtx(room, sources);
  const b = baselinePositions(room, sources, c);
  return toPlacement(ctx, sources, c, b.listener, b.positions);
}

/** Оценка произвольного варианта (например, расстановки пользователя) без регулировок. */
export function evaluatePlacement(room: Room, sources: SourceSpec[], c: Constraints, listener: Vec3, positions: Record<string, Vec3>): Placement {
  return toPlacement(makeCtx(room, sources), sources, c, listener, positions);
}

// ---------- Поиск ----------

interface Found {
  score: number;
  listener: Vec3;
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
  const wave = isWave(room);
  // волновая модель: поиск на более грубой сетке (≤ 180 Гц), итог — на полной
  const searchFMax = 180;
  const freqs = logFreqs(ctx.fLo, wave ? Math.min(ctx.fHi, searchFMax / 1.08) : ctx.fHi, 12);
  const nF = freqs.length;
  const { filt, target } = filterSet(sources, freqs);

  const spkSpecs = sources.filter((s) => s.kind === 'speaker');
  const subSpecs = sources.filter((s) => s.kind === 'sub');
  const spkIds = spkSpecs.map((s) => s.id);
  // Целевая кривая только колонок и полоса, где они влияют на НЧ-оценку
  const spkTarget = (() => {
    const re = new Float64Array(nF);
    const im = new Float64Array(nF);
    for (const id of spkIds) for (let i = 0; i < nF; i++) { re[i] += filt[id].re[i]; im[i] += filt[id].im[i]; }
    return Array.from(re, (r, i) => db20(Math.hypot(r, im[i])));
  })();
  const spkLow = spkSpecs.length ? Math.min(...spkSpecs.map((s) => s.fLow)) : Infinity;
  const spkBandStart = freqs.findIndex((f) => f >= spkLow * 0.7);
  const spkBandOk = subSpecs.length > 0 && spkBandStart >= 0 && nF - spkBandStart >= 6;

  // Кандидаты колонок (вне запретных зон)
  const spkH = spkSpecs[0]?.height ?? 1;
  const xsAll = range(c.speakerMinFront, Math.max(c.speakerMinFront, 0.45 * room.depth), 0.1);
  const halves = spkSpecs.length === 2 ? range(0.4, room.width / 2 - c.speakerMinSide, 0.1) : [0];
  const cfgs: SpeakerCfg[] = [];
  for (const x of xsAll)
    for (const half of halves) {
      const cfg = { x, half };
      if (speakerPoints(cfg, room, spkH).every((p) => sourceAllowed(room, p))) cfgs.push(cfg);
    }
  if (spkSpecs.length && !cfgs.length) {
    throw new PlacementError('Все допустимые места колонок заняты запретными зонами — уменьшите зоны у передней стены.');
  }

  const subH = subSpecs[0]?.height ?? 0.3;
  const subPts = subSpecs.length ? subCandidates(room, c, subH) : [];
  if (subSpecs.length && subPts.length < subSpecs.length) {
    throw new PlacementError('Для сабвуферов не осталось мест вне запретных зон — расширьте зону сабвуфера или уменьшите зоны.');
  }

  const cfgPts = cfgs.map((cfg) => speakerPoints(cfg, room, spkH));
  const cfgPsi = wave ? [] : cfgPts.map((pts) => pts.map((p) => modeShapes(pm, p)));
  const subPsi = wave ? [] : subPts.map((p) => modeShapes(pm, p));
  // волновая модель: все точки-кандидаты одним списком
  const cfgOffset: number[] = [];
  const allPts: Vec3[] = [];
  cfgPts.forEach((pts) => { cfgOffset.push(allPts.length); allPts.push(...pts); });
  const subOffset = allPts.length;
  allPts.push(...subPts);

  const listeners = listenerPositions(room, c);
  if (!listeners.length) {
    throw new PlacementError('В зоне слушателя все места попадают в запретные зоны — поправьте зоны или зону слушателя.');
  }
  const found: Found[] = [];
  let evaluated = 0;

  type Resp = Spectrum;
  const withFilter = (h: [Float64Array, Float64Array], id: string): Resp => {
    const f = filt[id];
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
    for (let j = from; j < nF; j++) out[j - from] = 10 * Math.log10(Math.max(r.re[j] * r.re[j] + r.im[j] * r.im[j], 1e-24));
    return out;
  };

  listeners.forEach((lx, li) => {
    const listener = { x: lx, y: room.width / 2, z: c.earHeight };
    const { pts: rcv, weights } = receiverSet(room, c, listener);
    const nR = rcv.length;
    const kernels: Kernel[] = wave ? [] : rcv.map((r) => receiverKernel(pm, r, freqs));
    const waveResp = wave
      ? rcv.map((r, ri) => waveSpectra(room, searchFMax, r, allPts, freqs, onProgress && ((v) => onProgress((li + (ri + v) / nR) / listeners.length))))
      : [];
    /** Отклик точки-кандидата (индекс в allPts) в приёмнике r. */
    const respAt = (r: number, idx: number, psi?: Float64Array): [Float64Array, Float64Array] => {
      if (wave) { const sp = waveResp[r][idx]; return [sp.re, sp.im]; }
      return applyKernel(kernels[r], psi!);
    };
    const weighted = (rs: Resp[], tgt: number[], from = 0) => {
      const t = from ? tgt.slice(from) : tgt;
      let s = 0;
      for (let r = 0; r < nR; r++) s += weights[r] * flatnessScore(toDb(rs[r], from), t);
      return s;
    };
    const okCfg = cfgs.map((cfg, i) => ({ cfg, i })).filter(({ cfg }) => lx - cfg.x >= MIN_LISTEN_DIST - EPS);
    if (spkSpecs.length && okCfg.length === 0) return;

    // Этап 1: колонки
    type SpkEval = { idx: number; resp: Resp[]; pen: number; rank: number };
    const spkEvals: SpkEval[] = [];
    if (spkSpecs.length) {
      for (const { i } of okCfg) {
        const resp = rcv.map((_, r) => {
          const acc: Resp = { re: new Float64Array(nF), im: new Float64Array(nF) };
          cfgPts[i].forEach((_p, si) => addInto(acc, withFilter(respAt(r, cfgOffset[i] + si, cfgPsi[i]?.[si]), spkIds[si])));
          return acc;
        });
        const pen = sumPenalties(speakerPenalties(ctx, listener, cfgPts[i]).penalties);
        let rank = pen;
        if (!subSpecs.length) rank += weighted(resp, target);
        else if (spkBandOk) rank += weighted(resp, spkTarget, spkBandStart);
        spkEvals.push({ idx: i, resp, pen, rank });
        evaluated++;
      }
      spkEvals.sort((a, b) => a.rank - b.rank);
    }

    const recordFound = (score: number, se: SpkEval | null, subs: number[]) => {
      const positions: Record<string, Vec3> = {};
      if (se) cfgPts[se.idx].forEach((p, k) => (positions[spkIds[k]] = p));
      subs.forEach((pi, k) => (positions[subSpecs[k].id] = subPts[pi]));
      found.push({ score, listener, positions });
    };

    if (!subSpecs.length) {
      recordFound(spkEvals[0].rank, spkEvals[0], []);
      onProgress?.((li + 1) / listeners.length);
      return;
    }

    const subResp: Resp[][][] = subSpecs.map((s) =>
      subPts.map((_, pi) => rcv.map((_r, r) => withFilter(respAt(r, subOffset + pi, subPsi[pi]), s.id))),
    );

    const top = spkSpecs.length ? spkEvals.slice(0, subSpecs.length > 1 ? 3 : 4) : [null];
    let bestScore = Infinity;
    let bestSe: SpkEval | null = null;
    let bestSubs: number[] = [];

    const accRe = new Float64Array(nF);
    const accIm = new Float64Array(nF);
    const dev = new Float64Array(nF);
    const evalCombo = (se: SpkEval | null, subs: number[]) => {
      evaluated++;
      let total = se ? se.pen : 0;
      for (let r = 0; r < nR; r++) {
        if (se) { accRe.set(se.resp[r].re); accIm.set(se.resp[r].im); } else { accRe.fill(0); accIm.fill(0); }
        for (let k = 0; k < subs.length; k++) {
          const sr = subResp[k][subs[k]][r];
          for (let j = 0; j < nF; j++) { accRe[j] += sr.re[j]; accIm[j] += sr.im[j]; }
        }
        for (let j = 0; j < nF; j++) dev[j] = 10 * Math.log10(Math.max(accRe[j] * accRe[j] + accIm[j] * accIm[j], 1e-24));
        total += weights[r] * flatnessScore(dev, target);
      }
      return total;
    };
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
        const singles = subPts.map((_, a) => ({ a, s: evalCombo(se, [a]) })).sort((p, q) => p.s - q.s);
        const pool = singles.slice(0, 24).map((x) => x.a);
        const seen = new Set<string>();
        const pairList: [number, number][] = [];
        const addPair = (a: number, b: number) => {
          if (a < 0 || b < 0 || a === b) return;
          const key = a < b ? `${a},${b}` : `${b},${a}`;
          if (seen.has(key)) return;
          seen.add(key);
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
        const chosen: number[] = [];
        for (let k = 0; k < n; k++) {
          let bS = Infinity;
          let bI = 0;
          for (let a = 0; a < subPts.length; a++) {
            if (chosen.includes(a)) continue;
            const s = evalCombo(se, [...chosen, a]);
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

  const base = baselinePositions(room, sources, c);
  const baseline = toPlacement(ctx, sources, c, base.listener, base.positions);

  found.sort((a, b) => a.score - b.score);
  const shortlist = found.slice(0, wave ? 4 : 8).map((f) => toPlacement(ctx, sources, c, f.listener, f.positions));
  shortlist.push(baseline);
  shortlist.sort((a, b) => a.score - b.score);

  const best: Placement[] = [];
  for (const p of shortlist) {
    if (best.length >= 3) break;
    if (best.some((q) => Math.abs(q.listener.x - p.listener.x) < 0.2 - EPS)) continue;
    best.push(p);
  }
  for (const p of shortlist) {
    if (best.length >= 3) break;
    if (!best.includes(p)) best.push(p);
  }
  best.sort((a, b) => a.score - b.score);

  // схема DBA: сабвуферы у передней и задней стен, задние — с задержкой и в противофазе
  const notes = [...ctx.notes];
  if (c.dba && sources.filter((s) => s.kind === 'sub').length >= 2) {
    const d = dbaVariant(ctx, sources, c, best[0]);
    best.push(d);
    if (d.notes?.length) notes.push(...d.notes);
  }
  // устойчивость вариантов к сдвигу на 10 см
  for (const p of [...best, baseline]) p.robust = robustness(ctx, sources, c, p);
  if (wave) notes.push('Расчёт по волновой модели (комната со смежными помещениями): поиск на сетке до 180 Гц, итоговые варианты — на полной.');
  if (baseline.score - best[0].score < 0.3) notes.push('Базовая расстановка уже близка к оптимальной для этой комнаты.');
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

// ---------- DBA и устойчивость ----------

/** Расстановка сабвуферов DBA: половина у передней стены, половина у задней (зеркально), задние — задержка и 180°. */
export function dbaLayout(room: Room, sources: SourceSpec[], c: Constraints): { positions: Record<string, Vec3>; settings: Record<string, SubSetting>; notes: string[] } {
  const subs = sources.filter((s) => s.kind === 'sub');
  const nf = Math.ceil(subs.length / 2), nb = subs.length - nf;
  const g = Math.max(0.1, c.subWallGap);
  const positions: Record<string, Vec3> = {};
  const settings: Record<string, SubSetting> = {};
  const notes: string[] = [];
  const cAir = speedOfSound(room.temperatureC);
  const delayMs = ((room.depth - 2 * g) / cAir) * 1000;
  subs.forEach((s, i) => {
    const front = i < nf;
    const k = front ? i : i - nf;
    const cnt = front ? nf : nb;
    const y = (room.width * (2 * k + 1)) / (2 * cnt);
    positions[s.id] = { x: front ? g : room.depth - g, y, z: s.height };
    if (!front) {
      const canDelay = s.delayMode === 'adjustable' && (s.maxDelayMs ?? 20) >= delayMs;
      const canInvert = s.phaseMode && s.phaseMode !== 'none';
      settings[s.id] = { delayMs: canDelay ? Math.round(delayMs * 10) / 10 : 0, phaseDeg: canInvert ? 180 : 0, gainDb: 0 };
      if (!canDelay) notes.push(`DBA: задним сабвуферам нужна задержка ≈ ${delayMs.toFixed(1).replace('.', ',')} мс — у ${s.id.replace('sub', 'сабвуфера ')} её нет или не хватает, схема работает частично.`);
      if (!canInvert) notes.push(`DBA: задним сабвуферам нужна инверсия полярности (180°) — у ${s.id.replace('sub', 'сабвуфера ')} её нет.`);
    }
  });
  if (nf !== nb) notes.push('DBA лучше работает с чётным числом сабвуферов: поровну у передней и задней стен.');
  return { positions, settings, notes: [...new Set(notes)] };
}

function dbaVariant(ctx: EvalCtx, sources: SourceSpec[], c: Constraints, base: Placement): Placement {
  const { positions: subPos, settings, notes } = dbaLayout(ctx.room, sources, c);
  const positions: Record<string, Vec3> = {};
  for (const s of base.sources) if (s.pos) positions[s.id] = s.pos;
  Object.assign(positions, subPos);
  const p = toPlacement(ctx, sources, c, base.listener, positions, settings);
  return { ...p, subSettings: settings, scheme: 'dba', notes };
}

/** Среднее ухудшение оценки (дБ) при сдвиге каждого источника и слушателя на ±10 см по осям. В волновой модели — только слушатель. */
export function robustness(ctx: EvalCtx, sources: SourceSpec[], c: Constraints, p: Placement): number {
  const positions: Record<string, Vec3> = {};
  for (const s of p.sources) if (s.pos) positions[s.id] = s.pos;
  const settings = p.subSettings ?? {};
  const ev = (listener: Vec3, pos: Record<string, Vec3>) =>
    evaluateSetup(ctx.room, sources, c, { listener, positions: pos, subSettings: settings, crossoverHz: null }, { ctx, ppo: 12 }).score;
  const base = ev(p.listener, positions);
  const shifts = [[0.1, 0], [-0.1, 0], [0, 0.1], [0, -0.1]];
  const ids = isWave(ctx.room) ? [] : Object.keys(positions);
  let sum = 0, n = 0;
  for (const [dx, dy] of shifts) {
    const l = clampToRoom(ctx.room, { ...p.listener, x: p.listener.x + dx, y: p.listener.y + dy }, 0.1);
    sum += Math.max(0, ev(l, positions) - base); n++;
    for (const id of ids) {
      const q = positions[id];
      const moved = { ...positions, [id]: clampToRoom(ctx.room, { ...q, x: q.x + dx, y: q.y + dy }) };
      sum += Math.max(0, ev(p.listener, moved) - base); n++;
    }
  }
  return n ? Math.round((sum / n) * 100) / 100 : 0;
}
