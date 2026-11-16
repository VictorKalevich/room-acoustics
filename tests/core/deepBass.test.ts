import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DROP, autoDeepHz, boxOrder, butterworthHp, deepPlan, normalizePassport, rolloffAt, passportRolloff,
} from '../../src/core/deepBass';
import { bw2 } from '../../src/core/filters';
import { cabs, logFreqs } from '../../src/core/frequency';
import { lowReach, makeScorer, normalizeObjective } from '../../src/core/objective';
import { evaluateSetup, filterSet } from '../../src/core/system';
import { optimizePlacement } from '../../src/core/placement';
import { listenerHeatmap, subHeatmap } from '../../src/core/field';
import { defaultConstraints, defaultRoom } from '../../src/state/project';
import type { BassObjective, Constraints, ObjectiveId, SourceSpec, Passport } from '../../src/core/types';

const room = defaultRoom();
const base = defaultConstraints(room);
const spk = (id: string): SourceSpec => ({ id, kind: 'speaker', fLow: 80, fHigh: 20000, height: 1 });
const sub = (passport?: Passport, fLow = 30, id = 'sub1'): SourceSpec => ({ id, kind: 'sub', fLow, fHigh: 80, height: 0.3, ...(passport ? { passport } : {}) });
const S104: Passport = { f3: 30, f10: 27, box: 'ported' };
const deep = (o: Partial<BassObjective> = {}): BassObjective => ({ id: 'deep', ...o });
const level = (order: number, fc: number, f: number) => 20 * Math.log10(cabs(butterworthHp(order, fc, f)));

describe('044: спад сабвуфера по паспорту', () => {
  it('Баттерворт порядка 1–12: −3,01 дБ на частоте среза, |H|² = 1/(1 + (fc/f)^2N), далеко ниже — 6·N дБ на октаву', () => {
    for (let n = 1; n <= 12; n++) {
      expect(level(n, 40, 40)).toBeCloseTo(-10 * Math.log10(2), 9);
      for (const f of [12, 25, 33, 55, 200]) expect(level(n, 40, f)).toBeCloseTo(-10 * Math.log10(1 + Math.pow(40 / f, 2 * n)), 9);
      expect(level(n, 40, 0.4) - level(n, 40, 0.2)).toBeCloseTo(20 * n * Math.log10(2), 2);
    }
  });

  it('2-й порядок — тот же фильтр, что прежний спад источника', () => {
    for (const f of [10, 20, 31.5, 50, 120]) {
      const a = butterworthHp(2, 30, f), b = bw2('hp', 30, f);
      expect(a.re).toBeCloseTo(b.re, 12);
      expect(a.im).toBeCloseTo(b.im, 12);
    }
  });

  it('обе точки: порядок по ним, −10 дБ ровно на своей частоте; KRK S10.4 (30 / 27 Гц) — 10-й порядок', () => {
    const r = passportRolloff(sub(S104));
    expect(r).toMatchObject({ order: 10, by: 'both', conflict: false });
    expect(level(r.order, r.fc, 27)).toBeCloseTo(-10, 9);
    expect(level(r.order, r.fc, 30)).toBeGreaterThan(-3.5);
    expect(level(r.order, r.fc, 30)).toBeLessThan(-2.5);
    // корпус при двух точках не нужен
    expect(passportRolloff(sub({ ...S104, box: 'sealed' }))).toEqual(r);
    // границы крутизны
    expect(passportRolloff(sub({ f3: 30, f10: 29.9 })).order).toBe(12);
    expect(passportRolloff(sub({ f3: 100, f10: 10 })).order).toBe(1);
  });

  it('одна точка: крутизна по корпусу (закрытый — 2-й порядок, фазоинвертор и не указано — 4-й)', () => {
    expect([boxOrder('sealed'), boxOrder('ported'), boxOrder(undefined)]).toEqual([2, 4, 4]);
    for (const box of ['sealed', 'ported'] as const) {
      const r10 = passportRolloff(sub({ f10: 28, box }));
      expect(r10).toMatchObject({ order: boxOrder(box), by: 'f10', conflict: false });
      expect(level(r10.order, r10.fc, 28)).toBeCloseTo(-10, 9);
      expect(rolloffAt(r10, 10)).toBeCloseTo(28, 9);
      const r3 = passportRolloff(sub({ f3: 35, box }));
      expect(r3).toMatchObject({ order: boxOrder(box), fc: 35, by: 'f3' });
    }
  });

  it('без паспорта — от «Диапазона от» и корпуса; −10 дБ не ниже −3 дБ — по точке −10 дБ с предупреждением', () => {
    expect(passportRolloff(sub(undefined, 25))).toMatchObject({ order: 4, fc: 25, by: 'range' });
    expect(passportRolloff(sub({ box: 'sealed' }, 25))).toMatchObject({ order: 2, fc: 25, by: 'range' });
    const bad = passportRolloff(sub({ f3: 27, f10: 30 }));
    expect(bad).toMatchObject({ order: 4, by: 'f10', conflict: true });
    expect(rolloffAt(bad, 10)).toBeCloseTo(30, 9);
  });

  it('план цели: только у «Глубже низ» и с сабвуфером; частота по умолчанию — −10 дБ самого глубокого сабвуфера', () => {
    const sources = [spk('spkL'), spk('spkR'), sub(S104), sub({ f10: 32, box: 'sealed' }, 35, 'sub2')];
    expect(deepPlan(sources, { id: 'lowDips' })).toBeNull();
    expect(deepPlan(sources, undefined)).toBeNull();
    expect(deepPlan([spk('spkL'), spk('spkR')], deep())).toBeNull();
    const p = deepPlan(sources, deep())!;
    expect(p.fT).toBe(27);
    expect(autoDeepHz(sources)).toBe(27);
    expect(p.drop).toBe(DEFAULT_DROP);
    expect(p.split).toBeCloseTo(Math.min(p.curves.sub1.fc, p.curves.sub2.fc), 12);
    expect(deepPlan(sources, deep({ deepHz: 24, deepDrop: 3 }))).toMatchObject({ fT: 24, drop: 3 });
    // значение вне пределов (не из файла) — в пределах 20–60 Гц
    expect(deepPlan(sources, deep({ deepHz: 90 }))!.fT).toBe(60);
    expect(autoDeepHz([sub({ f10: 12 })])).toBe(20);
  });

  it('из файла: неверные точки, корпус, частота и спад отбрасываются', () => {
    expect(normalizePassport({ f3: 30, f10: 27, box: 'sealed' })).toEqual({ f3: 30, f10: 27, box: 'sealed' });
    expect(normalizePassport({ f3: '30', f10: 5, box: 'horn' })).toBeUndefined();
    expect(normalizePassport({ f3: 30, f10: NaN })).toEqual({ f3: 30 });
    expect(normalizePassport(null)).toBeUndefined();
    expect(normalizeObjective({ id: 'deep', deepHz: 25, deepDrop: 10 })).toEqual({ id: 'deep', deepHz: 25, deepDrop: 10 });
    expect(normalizeObjective({ id: 'deep', deepHz: 15, deepDrop: 5 })).toEqual({ id: 'deep' });
    expect(normalizeObjective({ id: 'deep', deepHz: '25', deepDrop: '6' })).toEqual({ id: 'deep' });
  });
});

describe('044: оценка «Глубже низ»', () => {
  const freqs = logFreqs(25, 150, 24);
  const split = 30;
  const plan = { curves: {}, split, fT: 25, drop: 6 };
  const score = makeScorer(freqs, deep(), undefined, undefined, plan);
  const target = freqs.map(() => -3);
  // спад ниже полутона под частотой среза: окна точек от частоты среза его не захватывают
  const step = (below: number) => freqs.map((f, i) => target[i] - (f < split / Math.pow(2, 1 / 12) ? below : 0));

  it('отклик как цель — 0; спад самого низа в пределах допустимого — 0, глубже — растёт', () => {
    expect(score(target, target)).toBe(0);
    expect(score(step(5), target)).toBe(0);
    expect(score(step(9), target)).toBeGreaterThan(0);
    expect(score(step(12), target)).toBeGreaterThan(score(step(9), target));
  });

  it('пики не считаются, провал выше частоты среза — с допуском 1 дБ', () => {
    const peaks = target.map((t, i) => t + (freqs[i] > 60 && freqs[i] < 70 ? 10 : 0));
    expect(score(peaks, target)).toBe(0);
    const dip = (d: number) => target.map((t, i) => t - (freqs[i] > 70 && freqs[i] < 90 ? d : 0));
    expect(score(dip(1), target)).toBeLessThan(1e-6);
    expect(score(dip(4), target)).toBeGreaterThan(0);
  });

  it('уровень на частоте цели и до какой частоты бас не ниже допустимого спада', () => {
    const same = lowReach(freqs, target, target, plan);
    expect(same).toMatchObject({ fT: 25, drop: 6, reach: 25 });
    expect(same.atT).toBeCloseTo(0, 9);
    const r = lowReach(freqs, step(9), target, plan);
    expect(r.atT).toBeCloseTo(-9, 6);
    expect(r.reach!).toBeGreaterThan(25);
    expect(r.reach!).toBeLessThan(split);
  });
});

describe('044: где действует цель', () => {
  const sources = [spk('spkL'), spk('spkR'), sub(S104)];
  const setup = { listener: { x: 2.3, y: 2, z: 1.1 }, positions: { spkL: { x: 0.6, y: 1.2, z: 1 }, spkR: { x: 0.6, y: 2.8, z: 1 }, sub1: { x: 0.3, y: 0.3, z: 0.3 } }, subSettings: {}, crossoverHz: null };
  const cDeep: Constraints = { ...base, objective: deep() };

  it('другие цели и расчёты не читают паспорт и поля цели', () => {
    const bare = [spk('spkL'), spk('spkR'), sub()];
    for (const id of ['flat', 'dips', 'lowDips', 'wideLow', 'modes'] as ObjectiveId[]) {
      const c: Constraints = { ...base, objective: { id } };
      const withFields: Constraints = { ...base, objective: { id, deepHz: 25, deepDrop: 3 } };
      expect(evaluateSetup(room, sources, withFields, setup)).toEqual(evaluateSetup(room, bare, c, setup));
    }
    const f = logFreqs(30, 200, 24);
    expect(filterSet(sources, f, null, {}, undefined, null)).toEqual(filterSet(bare, f, null, {}));
  });

  it('неровность и график — по номинальным фильтрам; оценка по цели — со спадом по паспорту и строкой о низе', () => {
    const flat = evaluateSetup(room, sources, base, setup);
    const ev = evaluateSetup(room, sources, cDeep, setup);
    expect(ev.score).toBe(flat.score);
    expect(ev.response).toEqual(flat.response);
    expect(flat.low).toBeUndefined();
    expect(ev.low).toMatchObject({ fT: 27, drop: 6 });
    expect(ev.objScore).not.toBe(flat.objScore);
  });

  it('без сабвуферов — как «Меньше провалов внизу»', () => {
    const only = [spk('spkL'), spk('spkR')];
    const s2 = { ...setup, positions: { spkL: setup.positions.spkL, spkR: setup.positions.spkR } };
    const a = evaluateSetup(room, only, cDeep, s2);
    expect(a.objScore).toBe(evaluateSetup(room, only, { ...base, objective: { id: 'lowDips' } }, s2).objScore);
    expect(a.low).toBeUndefined();
  });

  it('подбор, карты и оценка варианта согласованы', () => {
    const res = optimizePlacement({ room, sources, constraints: cDeep });
    const b = res.best[0];
    const positions = Object.fromEntries(b.sources.map((s) => [s.id, s.pos]));
    const s = { listener: b.listener, positions, subSettings: {}, crossoverHz: null };
    const ev = evaluateSetup(room, sources, cDeep, s);
    expect(b.objScore).toBeCloseTo(ev.objScore, 9);
    expect(b.low).toEqual(ev.low);
    expect(subHeatmap(room, sources, cDeep, s, 'sub1').current).toBeCloseTo(ev.objScore, 6);
    expect(listenerHeatmap(room, sources, cDeep, s).current).toBeCloseTo(ev.objScore, 6);
  });

  it('KRK S10.4, цель 27 Гц: подбор держит низ лучше, чем лучший по ровности, ценой небольшой ровности', () => {
    const src = sources;
    const c = cDeep;
    const pick = (cc: Constraints) => {
      const b = optimizePlacement({ room, sources: src, constraints: cc }).best[0];
      const positions = Object.fromEntries(b.sources.map((s) => [s.id, s.pos]));
      return evaluateSetup(room, src, c, { listener: b.listener, positions, subSettings: {}, crossoverHz: null });
    };
    const d = pick(c);
    const f = pick({ ...base, objective: { id: 'flat' } });
    expect(d.objScore).toBeLessThan(f.objScore);
    // поиск со спадом по паспорту находит 0,88 дБ; поиск по номинальным фильтрам с той же итоговой оценкой — 1,00 дБ
    expect(d.objScore).toBeLessThan(0.95);
    expect(d.low!.atT).toBeGreaterThan(f.low!.atT + 3);
    expect(d.low!.reach!).toBeLessThan(f.low!.reach!);
    expect(d.score - f.score).toBeLessThan(1.5);
  });
});
