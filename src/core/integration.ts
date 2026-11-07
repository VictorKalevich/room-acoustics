// Подбор настроек сабвуферов: задержка, фаза/полярность, уровень, частота кроссовера (research R12).
// Используются только регулировки, которые есть у конкретного устройства.
import type { Constraints, Room, Setup, SourceSpec, SubSetting } from './types';
import { logFreqs } from './frequency';
import { flatnessScore } from './metric';
import {
  evaluateSetup, filterSet, makeCtx, rawResponses, receiverSet, speakerPenalties, sumPenalties, type Spectrum,
} from './system';

export interface SubOptions {
  delays: number[];
  phases: number[];
  gains: number[];
}

const steps = (lo: number, hi: number, step: number) => {
  const out: number[] = [];
  for (let v = lo; v <= hi + 1e-9; v += step) out.push(Math.round(v * 1000) / 1000);
  return out;
};

/** Допустимые значения регулировок сабвуфера. */
export function optionsFor(s: SourceSpec): SubOptions {
  const delays = s.delayMode === 'adjustable' ? steps(0, s.maxDelayMs ?? 20, 0.5) : [0];
  const phases =
    s.phaseMode === 'polarity' ? [0, 180] :
    s.phaseMode === 'continuous' ? steps(0, 180, 15) :
    s.phaseMode === 'full' ? steps(0, 345, 15) : [0];
  const gains = s.levelAdjustable ? steps(-6, 6, 1) : [0];
  return { delays, phases, gains };
}

export function hasAdjustments(sources: SourceSpec[], c: Constraints): boolean {
  const subs = sources.filter((s) => s.kind === 'sub');
  const xo = c.crossover?.adjustable && subs.length > 0 && sources.some((s) => s.kind === 'speaker');
  return !!xo || subs.some((s) => { const o = optionsFor(s); return o.delays.length > 1 || o.phases.length > 1 || o.gains.length > 1; });
}

export interface IntegrationResult {
  settings: Record<string, SubSetting>;
  crossoverHz: number | null;
  before: number;
  after: number;
  responseBefore: { f: number[]; db: number[]; target: number[] };
  responseAfter: { f: number[]; db: number[]; target: number[] };
  notes: string[];
  elapsedMs: number;
}

type SetupLike = Pick<Setup, 'listener' | 'positions' | 'subSettings' | 'crossoverHz'>;

export function optimizeSubs(room: Room, sources: SourceSpec[], c: Constraints, setup: SetupLike): IntegrationResult {
  const t0 = Date.now();
  const ctx = makeCtx(room, sources);
  const subs = sources.filter((s) => s.kind === 'sub' && setup.positions[s.id]);
  const spks = sources.filter((s) => s.kind === 'speaker' && setup.positions[s.id]);
  const notes: string[] = [];
  const beforeEval = evaluateSetup(room, sources, c, setup, { ctx });

  const zero: SubSetting = { delayMs: 0, phaseDeg: 0, gainDb: 0 };
  if (!subs.length) {
    return {
      settings: {}, crossoverHz: setup.crossoverHz, before: beforeEval.score, after: beforeEval.score,
      responseBefore: beforeEval.response, responseAfter: beforeEval.response,
      notes: ['В системе нет сабвуфера — настраивать нечего.'], elapsedMs: Date.now() - t0,
    };
  }
  if (!hasAdjustments(sources, c)) {
    notes.push('У сабвуфера нет регулировок задержки, фазы и уровня — улучшить отклик можно только расстановкой или эквалайзером.');
  }

  // 24 точки на октаву: модальные пики узкие, на более редкой сетке оценка неустойчива
  const freqs = logFreqs(ctx.fLo, ctx.fHi, 24);
  const n = freqs.length;
  const { pts, weights } = receiverSet(room, c, setup.listener);
  const nR = pts.length;
  const raw = rawResponses(ctx, pts, freqs, setup.positions);
  const pen = sumPenalties(speakerPenalties(ctx, setup.listener, spks.map((s) => setup.positions[s.id])).penalties);
  const opts = subs.map(optionsFor);

  const xoAdjustable = c.crossover?.adjustable && spks.length > 0;
  const xos: (number | null)[] = xoAdjustable ? steps(c.crossover.min, c.crossover.max, 10) : [setup.crossoverHz ?? null];

  const dev = new Float64Array(n);
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  let best = { score: Infinity, xo: null as number | null, settings: subs.map(() => ({ ...zero })) };

  for (const xo of xos) {
    const { filt, target } = filterSet(sources, freqs, xo);
    // сумма колонок и «базовые» отклики сабвуферов (с фильтром, без регулировок) в каждой точке
    const spkSum: Spectrum[] = [];
    const subBase: Spectrum[][] = subs.map(() => []);
    for (let r = 0; r < nR; r++) {
      const sr = new Float64Array(n), si = new Float64Array(n);
      for (const s of spks) {
        const h = raw[s.id][r], f = filt[s.id];
        for (let j = 0; j < n; j++) { sr[j] += h.re[j] * f.re[j] - h.im[j] * f.im[j]; si[j] += h.re[j] * f.im[j] + h.im[j] * f.re[j]; }
      }
      spkSum.push({ re: sr, im: si });
      subs.forEach((s, k) => {
        const h = raw[s.id][r], f = filt[s.id];
        const br = new Float64Array(n), bi = new Float64Array(n);
        for (let j = 0; j < n; j++) { br[j] = h.re[j] * f.re[j] - h.im[j] * f.im[j]; bi[j] = h.re[j] * f.im[j] + h.im[j] * f.re[j]; }
        subBase[k].push({ re: br, im: bi });
      });
    }
    const score = (set: SubSetting[]) => {
      let total = pen;
      for (let r = 0; r < nR; r++) {
        re.set(spkSum[r].re); im.set(spkSum[r].im);
        for (let k = 0; k < subs.length; k++) {
          const g = Math.pow(10, set[k].gainDb / 20);
          const ph0 = (set[k].phaseDeg * Math.PI) / 180;
          const tau = set[k].delayMs / 1000;
          const b = subBase[k][r];
          for (let j = 0; j < n; j++) {
            const ph = ph0 - 2 * Math.PI * freqs[j] * tau;
            const ar = g * Math.cos(ph), ai = g * Math.sin(ph);
            re[j] += b.re[j] * ar - b.im[j] * ai;
            im[j] += b.re[j] * ai + b.im[j] * ar;
          }
        }
        for (let j = 0; j < n; j++) dev[j] = 10 * Math.log10(Math.max(re[j] * re[j] + im[j] * im[j], 1e-24));
        total += weights[r] * flatnessScore(dev, target);
      }
      return total;
    };

    const set = subs.map(() => ({ ...zero }));
    const passes = subs.length > 1 ? 3 : 1;
    for (let pass = 0; pass < passes; pass++) {
      for (let k = 0; k < subs.length; k++) {
        const o = opts[k];
        const sp = subs[k];
        let bS = score(set);
        let bSet = { ...set[k] };
        const tryGrid = (ds: number[], ps: number[], gs: number[]) => {
          for (const d of ds)
            for (const p of ps)
              for (const g of gs) {
                set[k] = { delayMs: d, phaseDeg: p, gainDb: g };
                const v = score(set);
                if (v < bS - 1e-12) { bS = v; bSet = { ...set[k] }; }
              }
          set[k] = bSet;
        };
        // грубая сетка
        const maxD = o.delays[o.delays.length - 1];
        const coarseD = o.delays.length > 1 ? steps(0, maxD, 1) : [0];
        const coarseP = sp.phaseMode === 'continuous' ? steps(0, 180, 30) : sp.phaseMode === 'full' ? steps(0, 330, 30) : o.phases;
        const coarseG = o.gains.length > 1 ? steps(-6, 6, 2) : [0];
        tryGrid(coarseD, coarseP, coarseG);
        // уточнение вокруг лучшего
        const around = (v: number, r: number, st: number, lo: number, hi: number) =>
          steps(Math.max(lo, v - r), Math.min(hi, v + r), st);
        const fineP = sp.phaseMode === 'continuous' ? around(bSet.phaseDeg, 30, 15, 0, 180)
          : sp.phaseMode === 'full' ? [-15, 0, 15].map((dp) => (bSet.phaseDeg + dp + 360) % 360)
          : [bSet.phaseDeg];
        tryGrid(
          o.delays.length > 1 ? around(bSet.delayMs, 1, 0.25, 0, maxD) : [0],
          fineP,
          o.gains.length > 1 ? around(bSet.gainDb, 2, 0.5, -6, 6) : [0],
        );
        if (o.delays.length > 1) {
          const tenths: number[] = [];
          for (let t = Math.max(0, Math.round((bSet.delayMs - 0.3) * 10)); t <= Math.min(Math.round(maxD * 10), Math.round((bSet.delayMs + 0.3) * 10)); t++) tenths.push(t / 10);
          tryGrid(tenths, [bSet.phaseDeg], [bSet.gainDb]);
        }
      }
    }
    const s = score(set);
    if (s < best.score - 1e-12) best = { score: s, xo, settings: set.map((x) => ({ ...x })) };
  }

  const settings: Record<string, SubSetting> = {};
  // Округление до шага, который можно выставить на устройстве
  subs.forEach((s, k) => {
    const b = best.settings[k];
    settings[s.id] = { delayMs: Math.round(b.delayMs * 10) / 10, phaseDeg: Math.round(b.phaseDeg) % 360, gainDb: Math.round(b.gainDb * 2) / 2 };
  });
  const crossoverHz = xoAdjustable ? best.xo : setup.crossoverHz ?? null;
  let afterEval = evaluateSetup(room, sources, c, { ...setup, subSettings: settings, crossoverHz }, { ctx });
  // Не ухудшаем: если текущие настройки лучше (поиск идёт на более грубой сетке частот) — оставляем их
  let finalSettings = settings;
  let finalXo = crossoverHz;
  if (afterEval.score > beforeEval.score) {
    afterEval = beforeEval;
    finalSettings = Object.fromEntries(subs.map((s) => [s.id, setup.subSettings[s.id] ?? { ...zero }]));
    finalXo = setup.crossoverHz ?? null;
  }
  if (beforeEval.score - afterEval.score < 0.05 && hasAdjustments(sources, c)) {
    notes.push('Текущие настройки уже близки к оптимальным для этой расстановки.');
  }
  return {
    settings: finalSettings,
    crossoverHz: finalXo,
    before: beforeEval.score,
    after: afterEval.score,
    responseBefore: beforeEval.response,
    responseAfter: afterEval.response,
    notes,
    elapsedMs: Date.now() - t0,
  };
}
