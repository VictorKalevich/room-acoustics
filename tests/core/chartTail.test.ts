import { describe, expect, it } from 'vitest';
import { TAIL_MIN_HZ, passportApplies, tailCurves, tailFloor, tailGrid, tailHighPass } from '../../src/core/chartTail';
import { butterworthHp, deepPlan, passportRolloff, rolloffAt } from '../../src/core/deepBass';
import { sourceHighPass } from '../../src/core/filters';
import { cabs, db20, logFreqs } from '../../src/core/frequency';
import { evaluateSetup, filterSet, makeCtx, rawResponses, receiverSet, sumDb, type SetupEval } from '../../src/core/system';
import { optimizePlacement } from '../../src/core/placement';
import { defaultConstraints, defaultRoom, defaultSetup, emptyRoom } from '../../src/state/project';
import type { BassObjective, Constraints, ObjectiveId, Passport, Room, SourceSpec } from '../../src/core/types';

const room = defaultRoom();
const base = defaultConstraints(room);
const spk = (id: string, fLow = 80, passport?: Passport): SourceSpec => ({ id, kind: 'speaker', fLow, fHigh: 20000, height: 1, ...(passport ? { passport } : {}) });
const sub = (passport?: Passport, fLow = 30): SourceSpec => ({ id: 'sub1', kind: 'sub', fLow, fHigh: 80, height: 0.3, ...(passport ? { passport } : {}) });
const S104: Passport = { f3: 30, f10: 27 };
const withSub = (p?: Passport, fLow = 30, spkPassport?: Passport) => [spk('spkL', 80, spkPassport), spk('spkR', 80, spkPassport), sub(p, fLow)];
const noSub = (p?: Passport) => [spk('spkL', 45, p), spk('spkR', 45, p)];
const goal = (o: BassObjective): Constraints => ({ ...base, objective: o });
const ev = (sources: SourceSpec[], c: Constraints = base, chart = true, r: Room = room) =>
  evaluateSetup(r, sources, c, defaultSetup(r, sources, c), { ppo: 24, ...(chart ? { chart } : {}) });
const lvl = (s: SourceSpec, sys: SourceSpec[], f: number, fLo: number) => db20(cabs(tailHighPass(s, sys, f, tailCurves(sys, fLo))));
/** Сколько точек кривой графика ниже полосы оценки. */
const tailLen = (e: SetupEval) => e.chart!.f.findIndex((f) => f >= e.fLo);

describe('045: модель спада в хвосте графика', () => {
  it('сшивка без скачка: на нижней границе полосы спад по паспорту равен номинальному, ниже — форма паспорта', () => {
    // «Диапазон от» 35 Гц, а паспорт — S10.4 (30 / 27 Гц): номинальный и паспортный спад на границе разные
    const sys = withSub(S104, 35);
    const s = sys[2];
    const fLo = makeCtx(room, sys).fLo;
    expect(fLo).toBe(35);
    const curves = tailCurves(sys, fLo);
    const a = tailHighPass(s, sys, fLo, curves), b = sourceHighPass(s, sys, fLo);
    expect(a.re).toBeCloseTo(b.re, 12);
    expect(a.im).toBeCloseTo(b.im, 12);
    // фильтры и цель на границе — те же, что в полосе
    const band = filterSet(sys, [fLo]), tail = filterSet(sys, [fLo], null, {}, undefined, null, curves);
    expect(tail.target[0]).toBeCloseTo(band.target[0], 12);
    for (const id of Object.keys(band.filt)) expect(tail.filt[id].re[0]).toBeCloseTo(band.filt[id].re[0], 12);
    const { order, fc } = passportRolloff(s);
    const shape = (f: number) => db20(cabs(butterworthHp(order, fc, f)));
    expect(lvl(s, sys, 24, fLo) - lvl(s, sys, 31, fLo)).toBeCloseTo(shape(24) - shape(31), 9);
  });

  it('граница — где спад источника по модели −20 дБ; не ниже 20 Гц', () => {
    const sys = withSub(S104);
    const floor = tailFloor(sys, 30, tailCurves(sys, 30));
    expect(floor).toBeGreaterThan(23);
    expect(floor).toBeLessThan(25);
    expect(lvl(sys[2], sys, floor, 30)).toBeCloseTo(-20, 3);
    // номинальный спад 12 дБ на октаву от 30 Гц доходит до −20 дБ только на 9,5 Гц — граница 20 Гц
    const nominal = withSub();
    expect(tailFloor(nominal, 30, tailCurves(nominal, 30))).toBe(TAIL_MIN_HZ);
    const e = ev(withSub(S104));
    expect(e.chart!.f[0]).toBeCloseTo(floor, 12);
    expect(ev(nominal).chart!.f[0]).toBe(20);
  });

  it('хвоста нет, если граница не ниже полосы оценки', () => {
    const e = ev(withSub(undefined, 20));
    expect(e.fLo).toBe(20);
    expect(e.chart).toBeUndefined();
    expect(tailGrid(logFreqs(30, 300, 24), 30)).toEqual([]);
    expect(tailGrid(logFreqs(30, 300, 24), 40)).toEqual([]);
  });

  it('сетка хвоста — с шагом полосы, первая точка — граница', () => {
    const band = logFreqs(30, 300, 24);
    const q = band[1] / band[0];
    const t = tailGrid(band, 20);
    expect(t[0]).toBe(20);
    for (let i = 2; i < t.length; i++) expect(t[i] / t[i - 1]).toBeCloseTo(q, 12);
    expect(band[0] / t[t.length - 1]).toBeCloseTo(q, 12);
    expect(t[1] / t[0]).toBeGreaterThan(Math.pow(q, 0.25));
  });

  it('паспорт колонок — только без сабвуфера', () => {
    const sealed: Passport = { f3: 48, f10: 36, box: 'sealed' };
    const two = withSub(S104, 30, sealed);
    expect(passportApplies(two[0], two)).toBe(false);
    expect(passportApplies(noSub(sealed)[0], noSub(sealed))).toBe(true);
    expect(ev(two).chart).toEqual(ev(withSub(S104)).chart);
    // без сабвуфера: номинальный спад колонок от 45 Гц — до 20 Гц, по паспорту — круче, граница выше
    const nominal = ev(noSub()).chart!, own = ev(noSub(sealed)).chart!;
    expect(nominal.f[0]).toBe(20);
    expect(own.f[0]).toBeGreaterThan(24);
    expect(own.f[0]).toBeLessThan(30);
    // цель на границе — на 20 дБ ниже полосы пропускания (две колонки: +6 дБ)
    expect(own.target[0] - own.target[own.target.length - 1]).toBeCloseTo(-20, 0);
  });
});

describe('045: кривая графика «Расстановки»', () => {
  it('в полосе оценки — ровно `response`; хвост — с тем же сдвигом, граница оценки — нижняя граница полосы', () => {
    for (const sources of [withSub(S104), withSub(), noSub({ f10: 30, box: 'ported' })]) {
      const e = ev(sources);
      const k = tailLen(e);
      expect(k).toBeGreaterThan(0);
      expect(e.chart!.scoredFrom).toBe(e.fLo);
      expect(e.chart!.f.slice(k)).toEqual(e.response.f);
      expect(e.chart!.db.slice(k)).toEqual(e.response.db);
      expect(e.chart!.target.slice(k)).toEqual(e.response.target);
      expect(e.chart!.f.every((f) => f >= 20)).toBe(true);
    }
  });

  it('хвост — отклик комнаты той же моделью, с тем же сдвигом, что у кривой в полосе', () => {
    const sources = withSub(S104);
    const setup = defaultSetup(room, sources, base);
    const e = evaluateSetup(room, sources, base, setup, { ppo: 24, chart: true });
    const ctx = makeCtx(room, sources);
    const { pts } = receiverSet(room, base, setup.listener);
    const ids = sources.map((s) => s.id);
    const level = (f: number[], tail?: ReturnType<typeof tailCurves>) =>
      Array.from(sumDb(rawResponses(ctx, pts, f, setup.positions), filterSet(sources, f, null, {}, undefined, null, tail).filt, 0, f.length, ids));
    const band = level(e.response.f);
    const off = band.reduce((a, v, i) => a + v - e.response.target[i], 0) / band.length;
    const k = tailLen(e);
    const tail = level(e.chart!.f.slice(0, k), tailCurves(sources, e.fLo));
    tail.forEach((v, i) => expect(e.chart!.db[i]).toBeCloseTo(v - off, 9));
  });

  it('`response` и все оценки — те же, что без кривой графика, при любой цели и с паспортами', () => {
    const ids: ObjectiveId[] = ['flat', 'dips', 'lowDips', 'wideLow', 'modes', 'deep'];
    for (const sources of [withSub(S104, 30, { f3: 50 }), withSub(), noSub({ f3: 48 })]) {
      for (const id of ids) {
        for (const houseCurve of [undefined, 6 as const]) {
          const c = { ...goal({ id, ...(id === 'deep' ? { deepHz: 25 } : {}) }), ...(houseCurve ? { houseCurve } : {}) };
          const { chart: _c, ...withChart } = ev(sources, c);
          void _c;
          expect(withChart, `${id} ${houseCurve ?? 0}`).toEqual(ev(sources, c, false));
        }
      }
    }
  });

  it('«Глубже низ»: отклик и цель этой цели, ниже — до −20 дБ спада сабвуфера; выше среза кривая в среднем по цели', () => {
    const sources = withSub(S104);
    const c = goal({ id: 'deep', deepHz: 25 });
    const e = ev(sources, c);
    const plan = deepPlan(sources, c.objective)!;
    const k = e.chart!;
    expect(k.f[0]).toBeCloseTo(rolloffAt(plan.curves.sub1, 20), 6);
    expect(k.scoredFrom).toBe(25);
    // цель — без спада сабвуфера снизу
    const t = filterSet(sources, k.f, null, {}, undefined, plan).target;
    k.target.forEach((v, i) => expect(v).toBeCloseTo(t[i], 9));
    const at40 = k.target[k.f.findIndex((f) => f >= 40)];
    expect(Math.abs(k.target[0] - at40)).toBeLessThan(0.5);
    const dev = k.f.flatMap((f, i) => (f >= plan.split ? [k.db[i] - k.target[i]] : [])).sort((a, b) => a - b);
    expect(dev[dev.length >> 1]).toBeCloseTo(0, 9);
    // частота цели выше границы полосы — график не уже прежнего: от «Диапазона от»
    const high = ev(sources, goal({ id: 'deep', deepHz: 40 })).chart!;
    expect(high.f[0]).toBeCloseTo(rolloffAt(plan.curves.sub1, 20), 6);
    expect(high.scoredFrom).toBe(30);
    // без паспорта — спад по корпусу (фазоинвертор, 4-й порядок от 30 Гц): −20 дБ ниже 20 Гц
    expect(ev(withSub(), goal({ id: 'deep' })).chart!.f[0]).toBe(20);
  });

  it('другая цель — хвост номинальный или по паспорту, без модели «Глубже низ»', () => {
    const sources = withSub(S104);
    const flat = ev(sources).chart!;
    expect(ev(sources, goal({ id: 'lowDips' })).chart).toEqual(flat);
    // цель графика по паспорту со сшивкой спадает в хвосте, у «Глубже низ» — нет
    expect(flat.target[0] - flat.target[tailLen(ev(sources))]).toBeLessThan(-15);
  });

  it('автоподбор: у вариантов и базовой — кривая графика, её часть в полосе — `response`', () => {
    const sources = withSub(S104);
    const r = optimizePlacement({ room, sources, constraints: base });
    for (const p of [...r.best, r.baseline]) {
      expect(p.chart!.scoredFrom).toBe(r.fLo);
      const k = p.chart!.f.findIndex((f) => f >= r.fLo);
      expect(k).toBeGreaterThan(0);
      expect(p.chart!.db.slice(k)).toEqual(p.response.db);
    }
  });

  it('волновая модель: хвост считается той же моделью, часть в полосе — `response`', () => {
    const wave: Room = {
      ...emptyRoom(), depth: 5, width: 4, height: 2.5,
      extensions: [{ id: 'e', name: 'к', wall: 'right', a0: 0.5, a1: 4, depth: 1.2, height: 2.4, arch: { a0: 1, a1: 2.2, height: 2.1 }, openStart: false, openEnd: true, openFar: false }],
    };
    const c = defaultConstraints(wave);
    const e = ev(withSub(S104), c, true, wave);
    expect(e.model).toBe('wave');
    const k = tailLen(e);
    expect(k).toBeGreaterThan(0);
    expect(e.chart!.db.slice(k)).toEqual(e.response.db);
    expect(e.chart!.db.slice(0, k).every(Number.isFinite)).toBe(true);
  }, 60_000);
});
