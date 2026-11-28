// Автоматическая эквализация комнаты (V2-043, measurement-dsp §9): четыре сценария поверх `designEq` ядра.
// Срезы пиков — алгоритм ядра без изменений. Подъём (сценарии 2–4) — правило v2 (R43): только широкие неглубокие
// провалы, не глубже удвоенного предела подъёма; глубокие интерференционные провалы не компенсируются. Точные Gain
// и Q по модели не определяются: для модели Q ограничен сильнее, чем для замера.
import { designEq, peqGainDb, smoothLog, type PeqFilter } from '../../core/eq';
import { houseDb } from '../../core/houseCurve';
import type { HouseRise } from '../../core/types';
import type { EqFilter } from './tools';

export type EqScenario = 'cut' | 'gentle' | 'target' | 'multi';
export const EQ_SCENARIOS: readonly EqScenario[] = ['cut', 'gentle', 'target', 'multi'];
export const EQ_SCENARIO_LABEL: Record<EqScenario, string> = {
  cut: 'Только ослабление пиков', gentle: 'Осторожная коррекция', target: 'По целевой кривой', multi: 'Несколько мест',
};

export interface EqLimits {
  fLo: number;
  fHi: number;
  maxFilters: number;
  /** Наибольший срез одного фильтра, дБ (положительное число). */
  maxCut: number;
  /** Наибольший подъём одного фильтра, дБ; в сценарии «только ослабление» не используется. */
  maxBoost: number;
  maxQ: number;
}

export const DEFAULT_LIMITS: EqLimits = { fLo: 20, fHi: 200, maxFilters: 8, maxCut: 12, maxBoost: 3, maxQ: 8 };

export interface AutoEqResult {
  f: number[];
  before: number[];
  after: number[];
  target: number[];
  filters: EqFilter[];
  stdBefore: number;
  stdAfter: number;
  /** Провалы, которые не поднимаются: глубокие или узкие (интерференция). */
  skipped: { f: number; depth: number }[];
  notes: string[];
}

const std = (a: readonly number[]) => {
  const m = a.reduce((x, y) => x + y, 0) / a.length;
  return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length);
};
const median = (a: readonly number[]) => {
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;

/** Проверка пределов: пустой список — пределы допустимы. */
export function limitIssues(l: EqLimits): string[] {
  const out: string[] = [];
  if (!(l.fLo > 0 && l.fHi > l.fLo * 1.5)) out.push('Верхняя частота коррекции должна быть хотя бы в 1,5 раза выше нижней.');
  if (!(l.maxFilters >= 1 && l.maxFilters <= 20)) out.push('Фильтров — от 1 до 20.');
  if (!(l.maxCut > 0 && l.maxCut <= 24)) out.push('Наибольший срез — от 0 до 24 дБ.');
  if (!(l.maxBoost >= 0 && l.maxBoost <= 6)) out.push('Подъём — не больше 6 дБ: провалы комнаты подъёмом не исправляются.');
  if (!(l.maxQ >= 0.5 && l.maxQ <= 20)) out.push('Добротность — от 0,5 до 20.');
  return out;
}

/**
 * Подбор фильтров. `resp` — отклик на сетке (модель или замер, выровненный по цели); `measured` — по замеру частоты
 * пиков точные, фильтры могут быть уже (как в legacy: Q до 12, по модели — до 8). `rise` — подъём низа для сценария
 * «По целевой кривой»; в остальных сценариях цель — та, что пришла с откликом.
 */
export function autoEq(resp: { f: readonly number[]; db: readonly number[]; target: readonly number[] }, scenario: EqScenario, l: EqLimits, o: { measured: boolean; rise?: HouseRise | 0; newId: () => string }): AutoEqResult {
  const idx = resp.f.map((f, k) => (f >= l.fLo && f <= l.fHi ? k : -1)).filter((k) => k >= 0);
  const f = idx.map((k) => resp.f[k]);
  const before = idx.map((k) => resp.db[k]);
  const target = scenario === 'target' ? f.map((x) => houseDb(o.rise || undefined, x)) : idx.map((k) => resp.target[k]);
  const notes: string[] = [];
  if (f.length < 8) return { f, before, after: before, target, filters: [], stdBefore: NaN, stdAfter: NaN, skipped: [], notes: ['В выбранной полосе слишком мало точек отклика.'] };
  const maxQ = Math.min(l.maxQ, o.measured ? 12 : 8);
  if (maxQ < l.maxQ) notes.push(`Добротность ограничена ${maxQ}: ${o.measured ? 'предел подбора по замеру' : 'по модели частоты мод известны неточно'}.`);
  const cut = designEq(f, before, target, { maxFilters: l.maxFilters, maxCut: l.maxCut, maxQ });
  const peq: PeqFilter[] = [...cut.filters];
  const skipped: AutoEqResult['skipped'] = [];
  if (scenario !== 'cut' && l.maxBoost > 0) {
    // отклонение после срезов, сглаженное по 1/6 октавы: подъём только там, где провал широкий
    const dev = cut.after.map((v, k) => v - target[k]);
    const sm = smoothLog(f, dev, 1 / 6);
    const ref = median(sm);
    for (let pass = 0; pass < l.maxFilters && peq.length < l.maxFilters; pass++) {
      let im = -1;
      for (let k = 1; k < f.length - 1; k++) {
        if (sm[k] > sm[k - 1] || sm[k] > sm[k + 1] || sm[k] - ref > -2) continue;
        if (skipped.some((s) => Math.abs(Math.log2(s.f / f[k])) < 1 / 6) || peq.some((p) => p.gainDb > 0 && Math.abs(Math.log2(p.f / f[k])) < 1 / 3)) continue;
        if (im < 0 || sm[k] < sm[im]) im = k;
      }
      if (im < 0) break;
      const depth = sm[im] - ref;
      const half = ref + depth / 2;
      let lo = im, hi = im;
      while (lo > 0 && sm[lo] < half) lo--;
      while (hi < f.length - 1 && sm[hi] < half) hi++;
      const bw = Math.log2(f[hi] / f[lo]);
      // глубокий или узкий провал — интерференция: подъём тратит запас и не помогает в соседних местах
      if (depth < -2 * l.maxBoost || bw < 1 / 3) { skipped.push({ f: round(f[im], 1), depth: round(depth, 1) }); continue; }
      const p = 2 ** bw;
      const q = Math.min(maxQ, 3, Math.max(0.5, Math.sqrt(p) / (p - 1)));
      const next: PeqFilter = { f: round(f[im], 1), gainDb: round(Math.min(l.maxBoost, -0.7 * depth), 1), q: round(q, 2) };
      const trial = sm.map((v, k) => v + peqGainDb(next, f[k]));
      if (std(trial) >= std(sm) - 1e-6) { skipped.push({ f: next.f, depth: round(depth, 1) }); continue; }
      peq.push(next);
      for (let k = 0; k < sm.length; k++) sm[k] = trial[k];
    }
    for (const d of cut.dips) if (!skipped.some((s) => Math.abs(Math.log2(s.f / d.f)) < 1 / 6) && !peq.some((p) => p.gainDb > 0 && Math.abs(Math.log2(p.f / d.f)) < 1 / 6)) skipped.push(d);
  } else {
    skipped.push(...cut.dips);
  }
  const after = before.map((v, k) => v + peq.reduce((s, p) => s + peqGainDb(p, f[k]), 0));
  const filters = peq.sort((x, y) => x.f - y.f).map((p): EqFilter => ({ id: o.newId(), type: 'peaking', f: p.f, gainDb: p.gainDb, q: p.q, enabled: true }));
  return { f, before, after, target, filters, stdBefore: std(before.map((v, k) => v - target[k])), stdAfter: std(after.map((v, k) => v - target[k])), skipped: skipped.sort((x, y) => x.f - y.f), notes };
}

/** Отклик с выбранными (включёнными) фильтрами — пересчёт после правки списка. */
export function withFilters(f: readonly number[], before: readonly number[], filters: readonly EqFilter[]): number[] {
  const on = filters.filter((p) => p.enabled && p.type === 'peaking');
  return before.map((v, k) => v + on.reduce((s, p) => s + peqGainDb(p, f[k]), 0));
}

/** Предусилитель против перегрузки: наибольший подъём цепочки со знаком минус. */
export function preampFor(filters: readonly EqFilter[]): number {
  const on = filters.filter((p) => p.enabled && p.type === 'peaking');
  let max = 0;
  for (let x = 10; x <= 20000; x *= 2 ** (1 / 48)) max = Math.max(max, on.reduce((s, p) => s + peqGainDb(p, x), 0));
  return max > 0 ? -Math.ceil(max * 10) / 10 : 0;
}

export const toPeq = (filters: readonly EqFilter[]): PeqFilter[] => filters.filter((p) => p.enabled && p.type === 'peaking').map((p) => ({ f: p.f, gainDb: p.gainDb, q: p.q }));

/** Средняя АЧХ нескольких замеров на одной сетке (дБ); null там, где хотя бы один замер не покрывает частоту. */
export function averageOnGrid(curves: readonly (readonly (number | null)[])[]): (number | null)[] {
  if (!curves.length) return [];
  return curves[0].map((_, k) => (curves.every((c) => c[k] != null) ? curves.reduce((s, c) => s + (c[k] as number), 0) / curves.length : null));
}
