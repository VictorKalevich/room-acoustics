// V2-041–V2-045: правила советов (поля, порядок, цели, ограничения, подтверждение замером), предложения только в
// эксперимент, автоэквализация по сценариям, план работ, подбор (ограничения варианта, устаревание прогона), проверка
// «до и после» и отчёт.
import { describe, expect, it } from 'vitest';
import { designEq } from '../../src/core/eq';
import { houseDb } from '../../src/core/houseCurve';
import type { Placement } from '../../src/core/types';
import { calcOverview, calcReverb, calcSetup } from '../../src/v2/adapters/calculations';
import { buildAdvice, proposalOp, sortAdvice, type AdviceInput } from '../../src/v2/application/advice';
import { DEFAULT_LIMITS, autoEq, averageOnGrid, preampFor } from '../../src/v2/application/autoeq';
import { applyProposal } from '../../src/v2/application/experiment';
import { placementOp, runRecord, runStale, variantConflicts } from '../../src/v2/application/optimize';
import { addToPlan, blockers, freshness, planCost, refreshItem, setCost, setStatus, verifies } from '../../src/v2/application/plan';
import { roomReport, spreadDb, verification } from '../../src/v2/application/report';
import { buildRoom, DEFAULT_NEW_ROOM } from '../../src/v2/application/rooms';
import { logFreqs } from '../../src/v2/application/tools';
import { ADVICE_GROUPS, type ActionPlan, type Recommendation } from '../../src/v2/domain/advice';
import type { MeasurementRecord } from '../../src/v2/domain/measurement';
import { DEFAULT_GOALS, type Goals, type Room, type RoomConfiguration } from '../../src/v2/domain/model';
import { moveObject } from '../../src/v2/domain/operations';
import { UNSET } from '../../src/v2/domain/units';

const NOW = '2026-11-28T10:00:00.000Z';
let n = 0;
const id = () => `id${++n}`;
const room = (layout: '2.0' | '2.1' = '2.1'): Room => buildRoom({ ...DEFAULT_NEW_ROOM, name: 'Тест', depth: 5, width: 4, height: 2.5, layout }, id, NOW);

function analysis(c: RoomConfiguration): AdviceInput['analysis'] {
  const ev = calcSetup(c, NOW), ov = calcOverview(c, NOW), rev = calcReverb(c, NOW);
  if (!ev.ok || !ov.ok || !rev.ok) throw new Error('расчёт недоступен');
  return { ev: ev.result.value, overview: ov.result.value.overview, reverb: rev.result.value };
}
const input = (c: RoomConfiguration, o: Partial<AdviceInput> = {}): AdviceInput => ({ config: c, goals: structuredClone(DEFAULT_GOALS), analysis: analysis(c), measurements: [], measured: null, warnings: [], ...o });
const goals = (patch: Partial<Goals> = {}, k: Partial<Goals['constraints']> = {}): Goals => ({ ...structuredClone(DEFAULT_GOALS), ...patch, constraints: { ...DEFAULT_GOALS.constraints, ...k } });
const mid = (c: RoomConfiguration) => { const l = c.listening.listeners[0]; return moveObject(c, { type: 'listener', id: l.id }, { x: 2.5, y: l.position.y }); };
const meas = (p: Partial<MeasurementRecord>): MeasurementRecord => ({
  id: id(), roomId: 'r', configId: null, kind: 'frequency-response', name: 'Замер', recordedAt: NOW, source: { kind: 'app', device: 'тест' },
  provenance: { kind: 'measured', method: 'свип', algorithmVersion: 't', inputHash: '', createdAt: NOW, warnings: [], limitations: [] },
  snapshotId: null, lateBinding: false, summary: { fMin: 20, fMax: 200, count: 10 }, ...p,
});

describe('059 V2-041 · правила советов', () => {
  it('каждая рекомендация полная, правило с версией; порядок групп — данные, расстановка, настройка, обработка, DSP, покупка; повтор даёт то же', () => {
    const c = mid(room().current);
    const recs = buildAdvice(input(c));
    expect(recs.length).toBeGreaterThan(3);
    for (const r of recs) {
      for (const k of ['id', 'rule', 'ruleVersion', 'title', 'cause', 'source', 'method', 'applicability', 'effect', 'sideEffects', 'verify'] as const) expect(r[k], `${r.id}.${k}`).not.toBe('');
      expect(r.actions.length, r.id).toBeGreaterThan(0);
      expect(['measured', 'predicted', 'assumption', 'needs-check']).toContain(r.evidence);
    }
    const { active } = sortAdvice(recs);
    const order = active.map((r) => ADVICE_GROUPS.indexOf(r.group));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(active[0].group).toBe('data');
    expect(buildAdvice(input(c))).toEqual(recs);
  });

  it('слушатель посередине — бесплатный совет с предложением; применяется только к эксперименту; закреплённое место — конфликт', () => {
    const r = room();
    r.current = mid(r.current);
    const rec = buildAdvice(input(r.current)).find((x) => x.rule === 'listener-mid')!;
    expect(rec.cost).toEqual({ kind: 'free' });
    expect(rec.proposal?.kind).toBe('move-listener');
    const next = applyProposal(r, proposalOp(rec.proposal!, id), id, NOW);
    expect(next.current).toEqual(r.current);
    expect(next.experimental!.listening.listeners[0].position.x).toBeCloseTo(0.38 * 5, 2);
    const locked = { ...r.current, listening: { ...r.current.listening, listeners: r.current.listening.listeners.map((l) => ({ ...l, locked: true })) } };
    const blocked = buildAdvice(input(locked)).find((x) => x.rule === 'listener-mid')!;
    expect(blocked.conflicts).toContain('Место слушателя закреплено на плане.');
    expect(sortAdvice([blocked]).blocked).toHaveLength(1);
  });

  it('ограничения: оборудование не двигать — советы расстановки колонок противоречат; бюджет 0 — покупки противоречат, неизвестный — оговорка не ставится', () => {
    const c = room('2.0').current;
    const wide = c.audio.sources.reduce((x, s) => (s.kind === 'speaker' ? { ...x, audio: { ...x.audio, sources: x.audio.sources.map((y) => (y.id === s.id ? { ...y, position: { ...y.position, y: s.channel === 'L' ? 0.3 : 3.7 } } : y)) } } : x), c);
    const fixed = buildAdvice(input(wide, { goals: goals({}, { canMoveEquipment: false }) }));
    const angle = fixed.find((r) => r.rule === 'stereo-angle')!;
    expect(angle.conflicts).toContain('Оборудование перемещать нельзя (ограничение комнаты).');
    const zero = buildAdvice(input(wide, { goals: goals({ budget: 0 }) }));
    for (const r of zero.filter((x) => x.cost.kind === 'purchase')) expect(r.conflicts).toContain('Бюджет — ноль.');
    const unset = buildAdvice(input(wide, { goals: goals({ budget: UNSET }) }));
    for (const r of unset.filter((x) => x.cost.kind === 'purchase')) {
      expect(r.conflicts).not.toContain('Бюджет — ноль.');
      expect(r.notes).not.toContain('Стоимость неизвестна: сверьте с бюджетом.');
    }
  });

  it('цель меняет актуальность: для речи сабвуфер для кино неактуален, для глубины баса — в приоритете', () => {
    const c = room('2.0').current;
    const speech = buildAdvice(input(c, { goals: goals({ primary: 'speech', use: 'cinema' }) })).find((r) => r.rule === 'add-sub')!;
    expect(speech.relevance).toBe('off-goal');
    expect(sortAdvice([speech]).offGoal).toHaveLength(1);
    const deep = buildAdvice(input(c, { goals: goals({ primary: 'bass-depth' }) })).find((r) => r.rule === 'add-sub')!;
    expect(deep.relevance).toBe('goal');
  });

  it('замер подтверждает: пик из замера даёт совет DSP «подтверждено измерением» на частоте замера; без замера — совет измерить', () => {
    const c = room().current;
    const a = analysis(c)!;
    const resp = a.ev.response;
    const db = resp.f.map((f, k) => resp.target[k] + 10 * Math.exp(-((Math.log2(f / 63)) ** 2) / (2 * 0.05 ** 2)));
    const recs = buildAdvice(input(c, { measured: { name: 'Замер 1', response: { f: resp.f, db, target: resp.target } } }));
    const dsp = recs.find((r) => r.rule === 'dsp-peaks')!;
    expect(dsp.evidence).toBe('measured');
    expect(dsp.cause).toContain('по замеру «Замер 1»');
    expect(dsp.title).toMatch(/6[23] Гц|63,\d Гц/);
    expect(buildAdvice(input(c)).some((r) => r.rule === 'data-measure')).toBe(true);
  });

  it('замер старше конфигурации — совет повторить; допустимая глубина выбирает толщину панелей и делает ловушки недопустимыми', () => {
    const c = { ...room().current, revision: 5 };
    const old = meas({ configId: c.id, provenance: { ...meas({}).provenance, revision: 3 } });
    expect(buildAdvice(input(c, { measurements: [old] })).some((r) => r.rule === 'data-stale')).toBe(true);
    const shallow = buildAdvice(input(c, { goals: goals({}, { maxDepthM: 0.12 }) }));
    const refl = shallow.find((r) => r.rule === 'reflections')!;
    expect(refl.proposal?.kind).toBe('add-treatments');
    for (const t of refl.proposal!.kind === 'add-treatments' ? refl.proposal!.items : []) expect(t.thickness).toBe(0.05);
    expect(refl.conflicts).toEqual([]);
    const thin = buildAdvice(input(c, { goals: goals({}, { maxDepthM: 0.05 }) })).find((r) => r.rule === 'reflections')!;
    expect(thin.conflicts[0]).toContain('не помещаются');
    const traps = buildAdvice(input(c, { goals: goals({}, { maxDepthM: 0.15 }) })).find((r) => r.rule === 'bass-traps')!;
    expect(traps.conflicts[0]).toContain('от 20 см');
    expect(buildAdvice(input(c)).find((r) => r.rule === 'bass-traps')!.conflicts).toEqual([]);
  });

  it('мягкие ограничения: площадь и внешний вид добавляют оговорки, не убирая советы', () => {
    const c = room().current;
    const recs = buildAdvice(input(c, { goals: goals({}, { keepArea: true, looks: true }) }));
    const traps = recs.find((r) => r.rule === 'bass-traps')!;
    expect(traps.notes.some((x) => x.startsWith('Занимает площадь пола'))).toBe(true);
    expect(traps.conflicts).toEqual([]);
    expect(recs.find((r) => r.rule === 'reflections')!.notes.some((x) => x.startsWith('Внешний вид важен'))).toBe(true);
    expect(buildAdvice(input(c)).find((r) => r.rule === 'bass-traps')!.notes.some((x) => x.startsWith('Занимает'))).toBe(false);
  });

  it('модель, которую ядро не считает, — один совет проверить модель', () => {
    const c = room().current;
    const noListener = { ...c, listening: { ...c.listening, listeners: [] } };
    const recs = buildAdvice({ ...input(c), config: noListener, analysis: null });
    expect(recs.map((r) => r.rule)).toEqual(['data-model']);
  });
});

describe('059 V2-043 · автоматическая эквализация', () => {
  const f = logFreqs(20, 200, 48);
  const target = f.map(() => 0);
  const bump = (f0: number, db: number, w: number) => f.map((x) => db * Math.exp(-((Math.log2(x / f0)) ** 2) / (2 * w * w)));
  const sum = (...xs: number[][]) => f.map((_, k) => xs.reduce((s, x) => s + x[k], 0));

  it('«только ослабление» — фильтры ядра designEq без подъёмов; пределы числа фильтров и Q соблюдаются', () => {
    const db = sum(bump(45, 9, 0.08), bump(90, 7, 0.06), bump(150, 6, 0.1));
    const r = autoEq({ f, db, target }, 'cut', { ...DEFAULT_LIMITS, maxFilters: 2, maxQ: 5 }, { measured: false, newId: id });
    const core = designEq(f, db, target, { maxFilters: 2, maxCut: 12, maxQ: 5 });
    expect(r.filters.map((p) => [p.f, p.gainDb, p.q]).sort()).toEqual(core.filters.map((p) => [p.f, p.gainDb, p.q]).sort());
    expect(r.filters.length).toBeLessThanOrEqual(2);
    for (const p of r.filters) { expect(p.gainDb).toBeLessThan(0); expect(p.q).toBeLessThanOrEqual(5); }
    expect(r.stdAfter).toBeLessThan(r.stdBefore);
  });

  it('«осторожная» поднимает широкий неглубокий провал не выше предела, глубокий узкий — пропускает', () => {
    const db = sum(bump(60, -4, 0.35), bump(140, -15, 0.03));
    const r = autoEq({ f, db, target }, 'gentle', { ...DEFAULT_LIMITS, maxBoost: 3 }, { measured: true, newId: id });
    const boosts = r.filters.filter((p) => p.gainDb > 0);
    expect(boosts.length).toBeGreaterThan(0);
    for (const p of boosts) expect(p.gainDb).toBeLessThanOrEqual(3);
    expect(boosts.some((p) => Math.abs(Math.log2(p.f / 60)) < 0.3)).toBe(true);
    expect(boosts.some((p) => Math.abs(Math.log2(p.f / 140)) < 0.3)).toBe(false);
    expect(r.skipped.some((s) => Math.abs(Math.log2(s.f / 140)) < 0.2)).toBe(true);
    const cut = autoEq({ f, db, target }, 'cut', DEFAULT_LIMITS, { measured: true, newId: id });
    expect(cut.filters.every((p) => p.gainDb < 0)).toBe(true);
  });

  it('«по целевой кривой» — цель с подъёмом низа ядра; предусилитель — минус наибольший подъём; среднее замеров', () => {
    const r = autoEq({ f, db: f.map(() => 0), target }, 'target', DEFAULT_LIMITS, { measured: false, rise: 6, newId: id });
    expect(r.target[0]).toBeCloseTo(houseDb(6, f[0]), 9);
    const boost = [{ id: 'a', type: 'peaking' as const, f: 50, gainDb: 3, q: 1, enabled: true }, { id: 'b', type: 'peaking' as const, f: 100, gainDb: -6, q: 2, enabled: true }];
    expect(preampFor([boost[0]])).toBeCloseTo(-3, 1);
    expect(preampFor(boost)).toBeGreaterThan(preampFor([boost[0]]));
    expect(preampFor([{ ...boost[1] }])).toBe(0);
    expect(averageOnGrid([[1, 2, null], [3, 4, 5]])).toEqual([2, 3, null]);
  });
});

describe('059 V2-044 · план работ', () => {
  const rec = (patch: Partial<Recommendation> = {}): Recommendation => ({
    id: 'listener-mid', rule: 'listener-mid', ruleVersion: 'v1', group: 'placement', evidence: 'predicted', severity: 'medium', title: 'Сместите слушателя',
    cause: 'c', source: 's', method: 'm', applicability: 'a', effect: 'e', sideEffects: 'x', cost: { kind: 'free' }, effort: 'minutes', actions: ['Перенести'],
    verify: 'Замер', relevance: 'normal', conflicts: [], notes: [], ...patch,
  });
  const empty: ActionPlan = { id: 'plan-r', roomId: 'r', updatedAt: '', items: [] };

  it('пункт добавляется один раз; «подтверждено» — только замером АЧХ после выполнения', () => {
    let p = addToPlan(empty, rec(), id, NOW);
    expect(addToPlan(p, rec(), id, NOW)).toBe(p);
    const it0 = p.items[0];
    expect(() => setStatus(p, it0.id, 'verified', NOW, { measurement: meas({}) })).toThrow();
    p = setStatus(p, it0.id, 'done', '2026-11-28T11:00:00.000Z');
    const early = meas({ recordedAt: '2026-11-28T10:30:00.000Z' });
    const late = meas({ recordedAt: '2026-11-28T12:00:00.000Z' });
    expect(verifies(p.items[0], early)).toBe(false);
    expect(verifies(p.items[0], late)).toBe(true);
    p = setStatus(p, it0.id, 'verified', '2026-11-28T12:30:00.000Z', { measurement: late });
    expect(p.items[0].verifiedBy).toBe(late.id);
    expect(p.items[0].history.map((h) => h.status)).toEqual(['planned', 'done', 'verified']);
  });

  it('стоимость этапов: неизвестная не считается нулём, отложенные не входят в сумму', () => {
    let p = addToPlan(empty, rec(), id, NOW);
    p = addToPlan(p, rec({ id: 'b', rule: 'bass-traps', group: 'treatment' }), id, NOW);
    p = addToPlan(p, rec({ id: 'c', rule: 'add-sub', group: 'equipment' }), id, NOW);
    expect(planCost(p)).toEqual({ known: 0, unknown: 3 });
    p = setCost(p, p.items[1].id, 20000, NOW);
    p = setCost(p, p.items[2].id, 50000, NOW);
    expect(planCost(p)).toEqual({ known: 70000, unknown: 1 });
    p = setStatus(p, p.items[2].id, 'deferred', NOW);
    expect(planCost(p)).toEqual({ known: 20000, unknown: 1 });
    p = setCost(p, p.items[1].id, NaN, NOW);
    expect(p.items[1].cost).toBeUndefined();
  });

  it('зависимости по группам, пересмотр: совет ушёл или изменился', () => {
    let p = addToPlan(empty, rec(), id, NOW);
    p = addToPlan(p, rec({ id: 'dsp-peaks', rule: 'dsp-peaks', group: 'dsp', title: 'Срежьте пики' }), id, NOW);
    const dsp = p.items.find((x) => x.group === 'dsp')!;
    expect(blockers(p, dsp).map((x) => x.recId)).toEqual(['listener-mid']);
    expect(freshness(p.items[0], [])).toBe('gone');
    const changed = rec({ ruleVersion: 'v2', title: 'Сместите слушателя на 1,9 м' });
    expect(freshness(p.items[0], [changed])).toBe('changed');
    p = refreshItem(p, p.items[0].id, changed, NOW);
    expect(freshness(p.items[0], [changed])).toBe('actual');
  });
});

describe('059 V2-043 · подбор', () => {
  const variant = (c: RoomConfiguration, dx: number): Placement => ({
    listener: { ...c.listening.listeners[0].position, x: c.listening.listeners[0].position.x + dx }, seats: [],
    sources: c.audio.sources.map((s) => ({ id: s.id, pos: { ...s.position, x: s.position.x + dx } })), score: 3, scoreCenter: 3, scoreSeats: 3, penalties: [], angleDeg: 60,
    response: { f: [], db: [], target: [] },
  });

  it('вариант не применяется, если двигает закреплённое или оборудование запрещено двигать; применённый меняет только эксперимент', () => {
    const r = room();
    const c = r.current;
    const p = variant(c, 0.3);
    expect(variantConflicts(c, p, goals())).toEqual([]);
    expect(variantConflicts(c, p, goals({}, { canMoveEquipment: false }))).toContain('Оборудование перемещать нельзя (ограничение комнаты).');
    const locked = { ...c, audio: { ...c.audio, sources: c.audio.sources.map((s, k) => (k === 0 ? { ...s, locked: true } : s)) } };
    expect(variantConflicts(locked, p, goals())[0]).toMatch(/^Двигает закреплённые/);
    const next = applyProposal(r, placementOp(p), id, NOW);
    expect(next.current).toEqual(c);
    expect(next.experimental!.audio.sources[0].position.x).toBeCloseTo(c.audio.sources[0].position.x + 0.3, 9);
  });

  it('прогон устаревает при смене входов поиска, но не при перестановке мест', () => {
    const c = room().current;
    const run = runRecord(c, 'r', { best: [], baseline: variant(c, 0), fLo: 20, fHi: 200, schroeder: 150, evaluated: 1, elapsedMs: 1, notes: [] }, 'run1', NOW);
    expect(runStale(run, c)).toBe(false);
    expect(runStale(run, mid(c))).toBe(false);
    const g = c.geometry.kind === 'rect' ? c.geometry : null;
    expect(runStale(run, { ...c, geometry: { ...g!, depth: 5.5 } })).toBe(true);
    expect(run.provenance.limitations[0]).toContain('Лучший найденный вариант');
  });
});

describe('059 V2-045 · проверка и отчёт', () => {
  it('разброс ровного замера — ноль; «до и после» берёт последний замер до и первый после отметки', () => {
    const f = logFreqs(15, 250, 24);
    const flat = { f, db: f.map(() => 70) };
    const bumpy = { f, db: f.map((x) => 70 + 6 * Math.sin(Math.log2(x) * 4)) };
    expect(spreadDb(flat)).toBeCloseTo(0, 9);
    expect(spreadDb(bumpy)!).toBeGreaterThan(3);
    const before = { m: meas({ recordedAt: '2026-11-28T09:00:00.000Z' }), data: { id: 'b', ref: 'dB re unknown' as const, ...bumpy } };
    const after = { m: meas({ recordedAt: '2026-11-28T12:00:00.000Z' }), data: { id: 'a', ref: 'dB re unknown' as const, ...flat } };
    const v = verification('2026-11-28T10:00:00.000Z', [after, before])!;
    expect(v.before!.m.id).toBe(before.m.id);
    expect(v.delta!).toBeLessThan(-3);
    expect(verification('2026-11-28T13:00:00.000Z', [after, before])).toBeNull();
  });

  it('отчёт различает расчёт, измерение и рекомендации и перечисляет план', () => {
    const r = room();
    const c = mid(r.current);
    const recs = buildAdvice(input(c));
    const plan = addToPlan({ id: 'p', roomId: r.id, updatedAt: '', items: [] }, recs.find((x) => x.rule === 'listener-mid')!, id, NOW);
    const text = roomReport({ room: r, config: c, label: 'Текущая', now: NOW, analysis: { score: 5, rt60: 0.4, volume: 50, problems: ['Гул'], limitations: ['Модель'] }, recs, plan, runs: [], eq: null, measurements: [] });
    for (const s of ['# Отчёт по комнате «Тест»', '## Расчёт', '## Измерения', '## Рекомендации', '## План работ', 'Расчёт не заменяет измерение', 'Сместите место слушателя']) expect(text).toContain(s);
  });
});
