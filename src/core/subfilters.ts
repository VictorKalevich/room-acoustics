// Свои PEQ и all-pass для каждого сабвуфера (как MSO): уменьшают разницу баса между местами
// и выравнивают сумму. Задержка, фаза и уровень берутся из текущих настроек и не меняются.
import type { Complex, Constraints, Room, Setup, SourceSpec, SubSetting } from './types';
import { logFreqs } from './frequency';
import { flatnessScore } from './metric';
import { allpassComplex, evaluateSetup, filterSet, makeCtx, peqComplex, rawResponses, receiverSet, subAdjust, type Spectrum } from './system';

export interface SubFilterResult {
  settings: Record<string, SubSetting>;
  before: number;
  after: number;
  responseBefore: { f: number[]; db: number[]; target: number[] };
  responseAfter: { f: number[]; db: number[]; target: number[] };
  notes: string[];
  elapsedMs: number;
}

type SetupLike = Pick<Setup, 'listener' | 'positions' | 'subSettings' | 'crossoverHz'>;

const grid = (lo: number, hi: number, ppo: number) => {
  const out: number[] = [];
  for (let f = lo; f <= hi * 1.0001; f *= Math.pow(2, 1 / ppo)) out.push(Math.round(f * 10) / 10);
  return out;
};

export function optimizeSubFilters(room: Room, sources: SourceSpec[], c: Constraints, setup: SetupLike, opts: { ppo?: number } = {}): SubFilterResult {
  // 026: оценки «до/после» и графики — на сетке точности; сам подбор фильтров — на прежней (24 точки на октаву)
  const ppo = Math.max(24, opts.ppo ?? 24);
  const t0 = Date.now();
  const ctx = makeCtx(room, sources);
  const subs = sources.filter((s) => s.kind === 'sub' && setup.positions[s.id] && ((s.peqBands ?? 0) > 0 || s.allpass));
  const notes: string[] = [];
  // настройки без прежних фильтров (подбираем заново)
  const baseSettings: Record<string, SubSetting> = Object.fromEntries(
    Object.entries(setup.subSettings).map(([k, v]) => [k, { delayMs: v.delayMs, phaseDeg: v.phaseDeg, gainDb: v.gainDb }]),
  );
  const beforeEval = evaluateSetup(room, sources, c, { ...setup, subSettings: baseSettings }, { ctx, ppo });
  if (!subs.length) {
    return {
      settings: baseSettings, before: beforeEval.score, after: beforeEval.score,
      responseBefore: beforeEval.response, responseAfter: beforeEval.response,
      notes: ['Ни у одного сабвуфера не указаны полосы PEQ или all-pass (экран «Расстановка» → «Возможности сабвуфера»).'],
      elapsedMs: Date.now() - t0,
    };
  }
  const freqs = logFreqs(ctx.fLo, ctx.fHi, 24);
  const n = freqs.length;
  const { pts, weights } = receiverSet(room, c, setup.listener);
  const nR = pts.length;
  const raw = rawResponses(ctx, pts, freqs, setup.positions);
  const { filt, target } = filterSet(sources, freqs, setup.crossoverHz);
  // всё, кроме подбираемых сабвуферов, — постоянная часть суммы в каждой точке
  const fixed: Spectrum[] = [];
  const base: Spectrum[][] = subs.map(() => []);
  for (let r = 0; r < nR; r++) {
    const fr = new Float64Array(n), fi = new Float64Array(n);
    for (const s of sources) {
      if (!setup.positions[s.id]) continue;
      const h = raw[s.id][r], f = filt[s.id];
      const k = subs.findIndex((x) => x.id === s.id);
      const adj = freqs.map((fq) => (s.kind === 'sub' ? subAdjust(baseSettings[s.id], fq) : { re: 1, im: 0 }));
      const br = new Float64Array(n), bi = new Float64Array(n);
      for (let j = 0; j < n; j++) {
        const hr = h.re[j] * f.re[j] - h.im[j] * f.im[j], hi = h.re[j] * f.im[j] + h.im[j] * f.re[j];
        br[j] = hr * adj[j].re - hi * adj[j].im;
        bi[j] = hr * adj[j].im + hi * adj[j].re;
      }
      if (k >= 0) base[k].push({ re: br, im: bi });
      else for (let j = 0; j < n; j++) { fr[j] += br[j]; fi[j] += bi[j]; }
    }
    fixed.push({ re: fr, im: fi });
  }
  // текущие множители фильтров каждого сабвуфера
  const mul: Spectrum[] = subs.map(() => ({ re: new Float64Array(n).fill(1), im: new Float64Array(n) }));
  const dev = new Float64Array(n);
  const score = (k = -1, cand?: Complex[]) => {
    let total = 0;
    for (let r = 0; r < nR; r++) {
      const re = Float64Array.from(fixed[r].re), im = Float64Array.from(fixed[r].im);
      for (let q = 0; q < subs.length; q++) {
        const b = base[q][r], m = mul[q];
        for (let j = 0; j < n; j++) {
          let mr = m.re[j], mi = m.im[j];
          if (q === k && cand) { const t = mr * cand[j].re - mi * cand[j].im; mi = mr * cand[j].im + mi * cand[j].re; mr = t; }
          re[j] += b.re[j] * mr - b.im[j] * mi;
          im[j] += b.re[j] * mi + b.im[j] * mr;
        }
      }
      for (let j = 0; j < n; j++) dev[j] = 10 * Math.log10(Math.max(re[j] * re[j] + im[j] * im[j], 1e-24));
      total += weights[r] * flatnessScore(dev, target);
    }
    return total;
  };
  const apply = (k: number, cand: Complex[]) => {
    const m = mul[k];
    for (let j = 0; j < n; j++) { const t = m.re[j] * cand[j].re - m.im[j] * cand[j].im; m.im[j] = m.re[j] * cand[j].im + m.im[j] * cand[j].re; m.re[j] = t; }
  };
  const chosen = subs.map(() => ({ peq: [] as { f: number; gainDb: number; q: number }[], allpass: [] as { f: number; q: number }[] }));
  let cur = score();
  const startScore = cur;
  // 1. all-pass для каждого сабвуфера, у которого он есть
  const apF = grid(25, Math.min(160, ctx.fHi), 6);
  subs.forEach((s, k) => {
    if (!s.allpass) return;
    let best: { s: number; p: { f: number; q: number }; c: Complex[] } | null = null;
    for (const f of apF) for (const q of [0.5, 0.7, 1, 1.5, 2.5]) {
      const cand = freqs.map((fq) => allpassComplex({ f, q }, fq));
      const sc = score(k, cand);
      if (!best || sc < best.s) best = { s: sc, p: { f, q }, c: cand };
    }
    if (best && best.s < cur - 0.05) { apply(k, best.c); chosen[k].allpass.push(best.p); cur = best.s; }
  });
  // 2. PEQ: жадно, на каждом шаге — лучший фильтр среди всех сабвуферов
  const pqF = grid(20, Math.min(200, ctx.fHi), 12);
  const gains = [-12, -10, -8, -6, -4, -3, -2, 2, 3];
  const qs = [1, 2, 4, 8];
  for (;;) {
    let best: { s: number; k: number; p: { f: number; gainDb: number; q: number }; c: Complex[] } | null = null;
    subs.forEach((s, k) => {
      if (chosen[k].peq.length >= (s.peqBands ?? 0)) return;
      for (const f of pqF) {
        // второй фильтр на ту же частоту (ближе 1/6 октавы) не ставим — суммарный срез не превысит 12 дБ
        if (chosen[k].peq.some((p) => Math.abs(Math.log2(f / p.f)) < 1 / 6)) continue;
        for (const g of gains) for (const q of qs) {
          const p = { f, gainDb: g, q };
          const cand = freqs.map((fq) => peqComplex(p, fq));
          const sc = score(k, cand);
          if (!best || sc < best.s) best = { s: sc, k, p, c: cand };
        }
      }
    });
    if (!best || (best as { s: number }).s > cur - 0.05) break;
    const b = best as { s: number; k: number; p: { f: number; gainDb: number; q: number }; c: Complex[] };
    apply(b.k, b.c);
    chosen[b.k].peq.push(b.p);
    cur = b.s;
  }
  const settings: Record<string, SubSetting> = { ...baseSettings };
  subs.forEach((s, k) => {
    settings[s.id] = { ...(baseSettings[s.id] ?? { delayMs: 0, phaseDeg: 0, gainDb: 0 }), peq: chosen[k].peq, allpass: chosen[k].allpass };
  });
  const afterEval = evaluateSetup(room, sources, c, { ...setup, subSettings: settings }, { ctx, ppo });
  if (startScore - cur < 0.1) notes.push('Свои фильтры сабвуферов почти не улучшают отклик в этой расстановке.');
  if ((c.seats?.count ?? 1) <= 1) notes.push('Фильтры подобраны для основного места (и сдвига головы ±30 см). При нескольких местах они выравнивают бас между местами.');
  return {
    settings, before: beforeEval.score, after: afterEval.score,
    responseBefore: beforeEval.response, responseAfter: afterEval.response,
    notes, elapsedMs: Date.now() - t0,
  };
}

/** Коэффициенты biquad all-pass (RBJ), нормированы по a0. */
export function allpassBiquad(p: { f: number; q: number }, fs: number) {
  const w0 = (2 * Math.PI * p.f) / fs;
  const alpha = Math.sin(w0) / (2 * p.q), cw = Math.cos(w0), a0 = 1 + alpha;
  return { b0: (1 - alpha) / a0, b1: (-2 * cw) / a0, b2: (1 + alpha) / a0, a1: (-2 * cw) / a0, a2: (1 - alpha) / a0 };
}
