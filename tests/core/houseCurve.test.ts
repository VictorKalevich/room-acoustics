import { describe, expect, it } from 'vitest';
import { HOUSE_F0, HOUSE_RISES, houseDb, normalizeHouseRise } from '../../src/core/houseCurve';
import { evaluateSetup, filterSet } from '../../src/core/system';
import { optimizePlacement } from '../../src/core/placement';
import { optimizeSubs, settingNotes } from '../../src/core/integration';
import { optimizeSubFilters } from '../../src/core/subfilters';
import { listenerHeatmap, subHeatmap } from '../../src/core/field';
import { designEq } from '../../src/core/eq';
import { compareTakes } from '../../src/core/measure';
import { logFreqs } from '../../src/core/frequency';
import { defaultConstraints, defaultRoom, defaultSources } from '../../src/state/project';
import type { Constraints, HouseRise, Measurement, Placement, SubSetting } from '../../src/core/types';

const room = defaultRoom();
const base = defaultConstraints(room);
const withRise = (rise: HouseRise, c: Constraints = base): Constraints => ({ ...c, houseCurve: rise });

describe('043: форма подъёма низа', () => {
  it('полка: полная величина ниже 40 Гц, половина на 105 Гц, не больше 10 % выше 200 Гц, монотонно', () => {
    for (const r of HOUSE_RISES) {
      for (const f of [15, 20, 30, 40]) expect(houseDb(r, f)).toBeGreaterThanOrEqual(0.97 * r);
      expect(houseDb(r, HOUSE_F0)).toBeCloseTo(r / 2, 2);
      for (const f of [200, 300, 1000]) expect(houseDb(r, f)).toBeLessThanOrEqual(0.1 * r);
      const fs = logFreqs(10, 2000, 48);
      for (let i = 1; i < fs.length; i++) expect(houseDb(r, fs[i])).toBeLessThanOrEqual(houseDb(r, fs[i - 1]) + 1e-12);
    }
    expect(houseDb(undefined, 30)).toBe(0);
  });

  it('из файла — только 3, 6 и 9 дБ', () => {
    expect([3, 6, 9].map(normalizeHouseRise)).toEqual([3, 6, 9]);
    for (const v of [undefined, null, 0, 5, -3, '6', 12, NaN]) expect(normalizeHouseRise(v)).toBeUndefined();
  });
});

describe('043: целевая кривая с подъёмом', () => {
  const sources = defaultSources(2, 1);
  const setup = { listener: { x: 2.6, y: 2, z: 1.1 }, positions: { spkL: { x: 0.6, y: 1.1, z: 1.1 }, spkR: { x: 0.6, y: 2.9, z: 1.1 }, sub1: { x: 0.3, y: 0.3, z: 0.3 } }, subSettings: {}, crossoverHz: null };

  it('цель оценки = номинальная сумма фильтров + подъём; без подъёма — прежняя', () => {
    const flat = evaluateSetup(room, sources, base, setup);
    const f = flat.response.f;
    expect(flat.response.target).toEqual(filterSet(sources, f, null, {}).target);
    for (const r of HOUSE_RISES) {
      const ev = evaluateSetup(room, sources, withRise(r), setup);
      ev.response.target.forEach((t, i) => expect(t).toBeCloseTo(flat.response.target[i] + houseDb(r, f[i]), 9));
      // АЧХ та же, оценка — по другой цели
      expect(ev.score).not.toBeCloseTo(flat.score, 3);
    }
  });

  it('подбор, карты и фильтры сабвуферов отсчитывают от цели с подъёмом', () => {
    const c = withRise(6);
    const best = optimizePlacement({ room, sources, constraints: c }).best[0];
    const positions = Object.fromEntries(best.sources.map((s) => [s.id, s.pos]));
    const ev = evaluateSetup(room, sources, c, { listener: best.listener, positions, subSettings: {}, crossoverHz: null });
    expect(best.score).toBeCloseTo(ev.score, 6);
    expect(best.response.target).toEqual(ev.response.target);
    // та же расстановка по ровной цели оценивается иначе
    expect(evaluateSetup(room, sources, base, { listener: best.listener, positions, subSettings: {}, crossoverHz: null }).score).not.toBeCloseTo(ev.score, 2);
    for (const map of [listenerHeatmap, (...a: Parameters<typeof listenerHeatmap>) => subHeatmap(a[0], a[1], a[2], a[3], 'sub1', a[4])]) {
      const a = map(room, sources, base, setup);
      const b = map(room, sources, c, setup);
      let differ = 0;
      for (let i = 0; i < a.scores.length; i++) if (Number.isFinite(a.scores[i]) && Math.abs(a.scores[i] - b.scores[i]) > 0.05) differ++;
      expect(differ).toBeGreaterThan(a.scores.length / 4);
    }
  });

  it('подбор ищет по цели с подъёмом: лучше подбора «Ровно» по этой цели и не хуже его', () => {
    const byGoal = (r: typeof room, src: typeof sources, c: Constraints, p: Placement) =>
      evaluateSetup(r, src, c, { listener: p.listener, positions: Object.fromEntries(p.sources.map((x) => [x.id, x.pos])), subSettings: {}, crossoverHz: null }).objScore;
    // 4 × 3,2 × 2,4 м, только колонки, «меньше провалов внизу», +6 дБ: 1,36 против 2,76 дБ (поиск по ровной цели с
    // итоговой сортировкой по цели с подъёмом нашёл бы 1,97)
    const r4 = { ...room, depth: 4, width: 3.2, height: 2.4 };
    const spk = defaultSources(2, 0);
    const low4 = { ...defaultConstraints(r4), objective: { id: 'lowDips' as const } };
    const a4 = optimizePlacement({ room: r4, sources: spk, constraints: withRise(6, low4) }).best[0];
    const b4 = optimizePlacement({ room: r4, sources: spk, constraints: low4 }).best[0];
    expect(byGoal(r4, spk, withRise(6, low4), a4)).toBeLessThan(byGoal(r4, spk, withRise(6, low4), b4) - 1);
    // 5 × 4 м с сабвуфером: не хуже подбора «Ровно» (с подъёмом в предотборе колонок было 5,08 против 4,63 дБ)
    const ra = optimizePlacement({ room, sources, constraints: withRise(6) });
    const rb = optimizePlacement({ room, sources, constraints: base });
    // результат помнит, по какой цели посчитан (подпись пунктира у устаревшего результата)
    expect(ra.houseCurve).toBe(6);
    expect(rb.houseCurve).toBeUndefined();
    const a = ra.best[0], b = rb.best[0];
    expect(byGoal(room, sources, withRise(6), a)).toBeLessThanOrEqual(byGoal(room, sources, withRise(6), b) + 0.01);
  });

  it('фильтры сабвуфера подбираются под цель с подъёмом', () => {
    const peqSrc = sources.map((s) => (s.kind === 'sub' ? { ...s, peqBands: 4, allpass: true } : s));
    const corner = { ...setup, listener: { x: 3.1, y: 2, z: 1.1 } };
    const c = withRise(6);
    const byHouse = (s: Record<string, SubSetting>) => evaluateSetup(room, peqSrc, c, { ...corner, subSettings: s }, { ppo: 24 }).score;
    const house = optimizeSubFilters(room, peqSrc, c, corner);
    const flat = optimizeSubFilters(room, peqSrc, base, corner);
    expect(house.after).toBeCloseTo(byHouse(house.settings), 9);
    expect(byHouse(house.settings)).toBeLessThan(byHouse(flat.settings) - 0.2);
  });
});

describe('043: настройка сабвуфера с подъёмом низа', () => {
  // та же расстановка, что в integration.test: при ровной цели уровень уходит на нижний предел −6 дБ
  const sources = defaultSources(2, 1).map((s) => (s.kind === 'sub' ? { ...s, delayMode: 'adjustable' as const, maxDelayMs: 20, phaseMode: 'full' as const } : s));
  const positions = { spkL: { x: 0.6, y: 1.1, z: 1.1 }, spkR: { x: 0.6, y: 2.9, z: 1.1 }, sub1: { x: 0.3, y: 0.3, z: 0.3 } };
  const setup = { listener: { x: 3.1, y: 2, z: 1.1 }, positions, subSettings: {}, crossoverHz: null };

  it('с подъёмом +6 дБ уровень выше, и по цели с подъёмом найденное не хуже найденного при «Ровно»', () => {
    const flat = optimizeSubs(room, sources, base, setup);
    const house = optimizeSubs(room, sources, withRise(6), setup);
    expect(flat.settings.sub1.gainDb).toBe(-6);
    expect(house.settings.sub1.gainDb).toBeGreaterThanOrEqual(flat.settings.sub1.gainDb + 2);
    const byHouse = (s: typeof flat.settings) => evaluateSetup(room, sources, withRise(6), { ...setup, subSettings: s }, { ppo: 24 }).score;
    expect(byHouse(house.settings)).toBeLessThanOrEqual(byHouse(flat.settings) + 1e-9);
    // пояснение у нижнего предела при ровной цели советует подъём; при подъёме, где предела нет, — пояснения нет
    expect(flat.notes.join(' ')).toMatch(/нижнем пределе.*выберите подъём низа/);
    expect(house.notes.join(' ')).not.toMatch(/нижнем пределе/);
    // при +3 дБ уровень здесь всё ещё на пределе — пояснение называет выбранный подъём
    const three = optimizeSubs(room, sources, withRise(3), setup);
    expect(three.settings.sub1.gainDb).toBe(-6);
    expect(three.notes.join(' ')).toMatch(/сильнее выбранного подъёма \(\+3 дБ\)/);
  });

  it('пояснение у нижнего предела называет выбранный подъём', () => {
    const spks = sources.slice(0, 2);
    const at = { sub1: { delayMs: 0, phaseDeg: 0, gainDb: -6 } };
    expect(settingNotes(room, [sources[2]], spks, setup, at, 3).join(' ')).toMatch(/сильнее выбранного подъёма \(\+3 дБ\).*подъём побольше/);
    const nine = settingNotes(room, [sources[2]], spks, setup, at, 9).join(' ');
    expect(nine).toMatch(/сильнее выбранного подъёма \(\+9 дБ\)/);
    expect(nine).not.toMatch(/побольше/);
  });
});

describe('043: эквалайзер и сравнение замеров', () => {
  const f = logFreqs(20, 200, 48);
  it('широкий подъём низа от комнаты: при ровной цели эквалайзер его срезает, при цели +6 дБ — нет', () => {
    // монотонную полку эквалайзер не режет и при ровной цели (пик — только внутри полосы), поэтому — горб +5 дБ на 40 Гц
    const db = f.map((x) => 80 + 5 * Math.exp(-0.5 * (Math.log2(x / 40) / 0.5) ** 2));
    const flat = designEq(f, db, f.map(() => 0));
    expect(flat.filters.some((p) => Math.abs(p.f - 40) < 5 && p.gainDb <= -3)).toBe(true);
    expect(designEq(f, db, f.map((x) => houseDb(6, x))).filters).toEqual([]);
  });

  it('замер, совпадающий с кривой подъёма, при этом подъёме — ровный', () => {
    const m: Measurement = { name: 'm', importedAt: '2026-11-16T00:00:00Z', f, db: f.map((x) => 80 + houseDb(9, x)) };
    expect(compareTakes(m, m, { target: (x) => houseDb(9, x) }).statsBefore.rms).toBeLessThan(0.3);
    expect(compareTakes(m, m).statsBefore.rms).toBeGreaterThan(2);
  });
});
