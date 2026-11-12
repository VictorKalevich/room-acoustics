// Подбор настроек сабвуферов: задержка, фаза/полярность, уровень, частота кроссовера (research R12).
// Используются только регулировки, которые есть у конкретного устройства.
import type { Constraints, Room, Setup, SourceSpec, SubSetting } from './types';
import { logFreqs } from './frequency';
import { speedOfSound } from './physics';
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

/** Насколько сабвуфер может отставать от колонок без риска «вялого» баса, мс (порог заметности на басу — 10–20 мс). */
const LAG_WARN_MS = 10;

/**
 * Пояснения к найденным настройкам. Подбор ищет самую ровную АЧХ у слушателя, и проверка полным перебором
 * подтверждает, что он находит лучшее по этой оценке (расхождение ≤ 0,02 дБ). Но оценка не видит времени:
 * большая задержка иногда выравнивает АЧХ интерференцией ценой отставания баса от колонок; а нижний предел
 * уровня означает, что комната сильно поднимает низ — плоская цель срезает его целиком, хотя в комнате
 * обычно предпочитают небольшой подъём низа (+3…6 дБ; Olive, Welti — исследования Harman).
 */
export function settingNotes(room: Room, subs: SourceSpec[], spks: SourceSpec[], setup: SetupLike, settings: Record<string, SubSetting>): string[] {
  const out: string[] = [];
  const c = speedOfSound(room.temperatureC);
  const L = setup.listener;
  const dist = (id: string) => { const p = setup.positions[id]; return Math.hypot(p.x - L.x, p.y - L.y, p.z - L.z); };
  const mainMs = spks.length ? (spks.reduce((a, s) => a + dist(s.id), 0) / spks.length / c) * 1000 : null;
  for (const s of subs) {
    const set = settings[s.id];
    if (!set) continue;
    const name = s.id.replace('sub', 'сабвуфер ').trim();
    const Name = `${name[0].toUpperCase()}${name.slice(1)}`;
    if (mainMs != null && set.delayMs > 0) {
      const lag = (dist(s.id) / c) * 1000 + set.delayMs - mainMs;
      if (lag > LAG_WARN_MS) {
        out.push(`${Name}: с задержкой ${set.delayMs.toFixed(1).replace('.', ',')} мс он звучит на ${Math.round(lag)} мс позже колонок. По расчёту так ровнее, но удары баса могут «отставать» — если бас на слух вялый, уменьшите задержку.`);
      }
    }
    if (s.levelAdjustable && set.gainDb <= -5.75) {
      out.push(`${Name}: уровень на нижнем пределе (−6 дБ) — комната сильно поднимает низ, и ровная цель срезает этот подъём целиком. Если бас кажется тонким, прибавьте 2–4 дБ: в комнате обычно нравится небольшой подъём низа.`);
    }
  }
  return out;
}

/** ppo — сетка частот поиска и оценок «до/после», точек на октаву (026: точность расчёта; по умолчанию 24). */
export function optimizeSubs(room: Room, sources: SourceSpec[], c: Constraints, setup: SetupLike, precision: { ppo?: number } = {}): IntegrationResult {
  const ppo = Math.max(24, precision.ppo ?? 24);
  const t0 = Date.now();
  const ctx = makeCtx(room, sources);
  const subs = sources.filter((s) => s.kind === 'sub' && setup.positions[s.id]);
  const spks = sources.filter((s) => s.kind === 'speaker' && setup.positions[s.id]);
  const notes: string[] = [];
  const beforeEval = evaluateSetup(room, sources, c, setup, { ctx, ppo });

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
  const freqs = logFreqs(ctx.fLo, ctx.fHi, ppo);
  const n = freqs.length;
  const { pts, weights } = receiverSet(room, c, setup.listener);
  const nR = pts.length;
  const raw = rawResponses(ctx, pts, freqs, setup.positions);
  const pen = sumPenalties(speakerPenalties(ctx, setup.listener, spks.map((s) => setup.positions[s.id])).penalties);
  const opts = subs.map(optionsFor);

  const xoAdjustable = c.crossover?.adjustable && spks.length > 0;
  let xos: (number | null)[] = xoAdjustable ? steps(c.crossover.min, c.crossover.max, 10) : [setup.crossoverHz ?? null];
  if (xoAdjustable) {
    // пределы самой техники, если указаны: раздел не ниже того, что отыграют колонки, и не выше того, что отыграет сабвуфер
    const lo = c.crossover.spkLimit ?? -Infinity, hi = c.crossover.subLimit ?? Infinity;
    const fit = xos.filter((x) => x != null && x >= lo - 1e-9 && x <= hi + 1e-9);
    if (fit.length < xos.length) {
      if (fit.length) {
        xos = fit;
        notes.push(`Частота раздела подбиралась в пределах техники: ${fit[0]}–${fit[fit.length - 1]} Гц.`);
      } else {
        // пределы не оставляют ни одной частоты из диапазона регулировки — раздел не трогаем
        xos = [setup.crossoverHz ?? null];
        notes.push('Пределы техники не оставляют ни одной частоты раздела в диапазоне регулировки — частота раздела не подбиралась. Проверьте пределы в «Расстановка → Регулировки сабвуфера».');
      }
    }
  }

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
  const crossoverHz = best.xo ?? setup.crossoverHz ?? null;
  let afterEval = evaluateSetup(room, sources, c, { ...setup, subSettings: settings, crossoverHz }, { ctx, ppo });
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
  notes.push(...settingNotes(room, subs, spks, setup, finalSettings));
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
