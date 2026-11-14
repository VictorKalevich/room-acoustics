import { describe, expect, it } from 'vitest';
import { clearedRoom, defaultSources, newProject } from '../../src/state/project';
import { normalizeProject, serializeProject } from '../../src/state/storage';
import { markPlaced } from '../../src/state/variant';
import { optimizePlacement } from '../../src/core/placement';
import { DAMPING_MODEL } from '../../src/core/types';

const raw = (p: unknown) => JSON.parse(serializeProject(p as never)).project;

describe('проект с частично неверными данными открывается, а не заменяется новым (026)', () => {
  it('неверный диапазон одного источника возвращается к значениям по умолчанию', () => {
    const p = newProject();
    const r = raw({ ...p, name: 'Студия', sources: p.sources.map((s) => (s.kind === 'sub' ? { ...s, fLow: 100, fHigh: 80 } : s)) });
    const n = normalizeProject(r);
    expect(n.name).toBe('Студия');
    const sub = n.sources.find((s) => s.kind === 'sub')!;
    expect([sub.fLow, sub.fHigh]).toEqual([20, 80]);
    // верные диапазоны не трогаются
    expect(n.sources.find((s) => s.id === 'spkL')!.fLow).toBe(80);
  });

  it('коридор мельче допустимого убирается, комната остаётся', () => {
    const p = newProject();
    const r = raw(p);
    r.room.extensions = [{ id: 'e1', name: 'Коридор', wall: 'back', a0: 1, a1: 2, depth: 0.28, width: 1, height: 2.2, arch: { a0: 1.2, a1: 1.8, height: 2 } }];
    const n = normalizeProject(r);
    expect(n.room.extensions).toEqual([]);
    expect(n.room.depth).toBe(p.room.depth);
  });

  it('мусор в списках, не-числа в ограничениях и координатах — к умолчаниям', () => {
    const p = newProject();
    const r = raw(p);
    r.sources = [null, ...r.sources];
    r.room.openings = [null];
    r.room.zones = [null];
    r.room.furnishing = 'zzz';
    r.constraints.earHeight = null;
    r.current.listener = { x: null, y: 1, z: 1 };
    r.current.positions.spkL = { x: null, y: null, z: null };
    const n = normalizeProject(r);
    expect(n.sources.length).toBe(p.sources.length);
    expect(n.room.openings).toEqual([]);
    expect(n.room.furnishing).toBe('typical');
    expect(n.constraints.earHeight).toBe(p.constraints.earHeight);
    for (const v of [n.current.listener, ...Object.values(n.current.positions)]) {
      expect([v.x, v.y, v.z].every(Number.isFinite)).toBe(true);
    }
    expect(Object.keys(n.current.positions).sort()).toEqual(p.sources.map((s) => s.id).sort());
  });

  it('точность расчёта сохраняется в файле; стандартная не пишется', () => {
    const p = newProject();
    expect(normalizeProject(raw({ ...p, precision: 'max' })).precision).toBe('max');
    expect('precision' in normalizeProject(raw(p))).toBe(false);
    expect('precision' in normalizeProject(raw({ ...p, precision: 'what' }))).toBe(false);
  });
});

describe('признак «места выбраны»', () => {
  it('сохранённые варианты — всегда выбранные места; загрузка варианта, совпадающего с текущей расстановкой, не сбрасывает признак', () => {
    const p = newProject();
    const current = { ...p.current, placed: true };
    const r = raw({ ...p, current, setups: [{ ...current, id: 'v1', name: 'Вариант 1' }] });
    delete r.setups[0].placed;
    const n = normalizeProject(r);
    expect(n.setups[0].placed).toBe(true);
    expect(markPlaced(current, { ...current, placed: false }).placed).toBe(true);
    expect(markPlaced(current, { ...current, placed: undefined }).placed).toBe(true);
    // не выбранные и не изменённые — остаются не выбранными
    expect(markPlaced(p.current, { ...p.current }).placed).toBe(false);
  });

  it('«Очистить комнату» возвращает места по умолчанию как не выбранные', () => {
    const p = newProject();
    const cleared = clearedRoom({ ...p, current: { ...p.current, placed: true } });
    expect(cleared.current!.placed).toBe(false);
  });
});

// 028: верные данные проходят проверку формы без изменений — в том числе результат настоящего подбора
// и необязательные поля прежних версий
const subOptions = { delayMode: 'adjustable' as const, maxDelayMs: 30, phaseMode: 'continuous' as const, levelAdjustable: true, peqBands: 3, allpass: true };

function richProject() {
  const base = newProject('Студия');
  const sources = defaultSources(2, 2).map((s) => (s.kind === 'sub' ? { ...s, ...subOptions } : s));
  const constraints = { ...base.constraints, dba: true, crossover: { adjustable: true, min: 60, max: 120, spkLimit: 50 } };
  // настоящий подбор: DBA даёт варианты с настройками сабвуферов, схемой и устойчивостью
  const result = optimizePlacement({ room: base.room, sources, constraints });
  const room = {
    ...base.room,
    zones: [{ id: 'z1', kind: 'furniture' as const, furniture: 'sofa' as const, name: 'Диван', height: 0.85, canSit: true, x0: 3.5, x1: 4.4, y0: 1, y1: 3 }],
    openings: [{ id: 'o1', wall: 'left' as const, a0: 1, a1: 2, height: 2.1 }],
    features: [{ id: 'w1', kind: 'window' as const, wall: 'front' as const, a0: 1, a1: 2, bottom: 0.9, top: 2 }],
    extensions: [{ id: 'e1', name: 'Коридор', wall: 'back' as const, a0: 1, a1: 2.5, depth: 2, height: 2.5, arch: { a0: 1.2, a1: 2, height: 2 }, openStart: false, openEnd: true, openFar: false }],
    treatments: [
      { id: 't1', kind: 'corner' as const, thickness: 0.1, gap: 0, width: 0.3, height: 2.5, corner: 'back-right' as const },
      { id: 't2', kind: 'panel' as const, thickness: 0.05, gap: 0.05, width: 1.2, height: 0.6, wall: 'left' as const, at: 2, z: 1.2, enabled: true },
      { id: 't3', kind: 'cloud' as const, thickness: 0.1, width: 1.2, height: 1.2, x: 2.5, y: 2, enabled: false },
    ],
    treatmentsOn: true,
    coverings: [{ id: 'c1', kind: 'carpet' as const, grade: 'thick' as const, surface: 'floor' as const, u0: 1, u1: 3, v0: 1, v1: 3 }],
    calibration: { dampingScale: 1.2, model: DAMPING_MODEL, source: 'Замер 1', leakageBefore: 'typical' as const },
    slope: { wall: 'back' as const, low: 1.8, run: 1.5 },
  };
  const subSettings = {
    sub1: { delayMs: 2.5, phaseDeg: 90, gainDb: -1, peq: [{ f: 45, gainDb: -4, q: 4 }], allpass: [{ f: 70, q: 0.7 }] },
    sub2: { delayMs: 0, phaseDeg: 0, gainDb: 0 },
  };
  const current = { ...base.current, subSettings, crossoverHz: 80, placed: true };
  const scanInfo = {
    depth: 5, width: 4, height: 2.5, units: 'm' as const, unitsGuessed: false, up: [0, 1, 0] as [number, number, number], rotationDeg: 3, tiltDeg: 0.5,
    confidence: 0.8, wallCoverage: [0.9, 0.8, 0.7, 0.6] as [number, number, number, number], hasCeiling: true, outsideFraction: 0.01, warnings: ['Пример'],
    triangleCount: 12000, fileName: 'Комната.usdz', format: 'usdz', rotation: 1, applied: { rect: { x0: 0, x1: 5, y0: 0, y1: 4 }, units: 'm' as const },
  };
  return {
    ...base, room, sources, constraints, scanInfo, result, selectedIndex: 1, current,
    setups: [{ ...current, id: 'v1', name: 'Вариант 1' }], roomReady: true,
  };
}

describe('верные данные проходят нормализацию без изменений (028)', () => {
  const proj = richProject();
  const rich = raw(proj);
  const n = normalizeProject(raw(proj));

  it('результат настоящего подбора и выбранный вариант', () => {
    expect(rich.result.best.some((b: { scheme?: string }) => b.scheme === 'dba')).toBe(true);
    expect(n.result).toEqual(rich.result);
    expect(n.selectedIndex).toBe(1);
  });

  it('результат прежней версии без необязательных полей', () => {
    const old = structuredClone(rich.result);
    for (const p of [...old.best, old.baseline]) for (const k of ['seats', 'objScore', 'robust', 'subSettings', 'scheme', 'notes']) delete p[k];
    old.best[0].scoreSeats = null;
    old.stale = true;
    expect(normalizeProject({ ...structuredClone(rich), result: old }).result).toEqual(old);
  });

  it('сведения о скане, расстановки, ограничения и источники', () => {
    expect(n.scanInfo).toEqual(rich.scanInfo);
    expect(n.current.subSettings).toEqual(rich.current.subSettings);
    expect(n.current.crossoverHz).toBe(80);
    expect(n.setups.map((s) => [s.id, s.name, s.subSettings])).toEqual([['v1', 'Вариант 1', rich.current.subSettings]]);
    expect(n.constraints.crossover).toEqual(rich.constraints.crossover);
    expect(n.constraints.dba).toBe(true);
    expect(n.sources).toEqual(rich.sources);
  });

  it('элементы комнаты', () => {
    for (const k of ['zones', 'openings', 'features', 'extensions', 'treatments', 'coverings', 'calibration', 'slope'] as const) {
      expect(n.room[k], k).toEqual(rich.room[k]);
    }
  });

  it('повторная нормализация ничего не меняет', () => {
    expect(normalizeProject(raw(n))).toEqual(n);
  });
});
