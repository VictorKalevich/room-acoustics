import { describe, expect, it } from 'vitest';
import { clearedRoom, defaultSources, newProject } from '../../src/state/project';
import { normalizeProject, serializeProject } from '../../src/state/storage';
import { markPlaced } from '../../src/state/variant';
import { optimizePlacement } from '../../src/core/placement';
import { DAMPING_MODEL } from '../../src/core/types';
import { computeReverb } from '../../src/core/reverb';
import { roomPatches } from '../../src/core/patches';
import { evaluateSetup } from '../../src/core/system';

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

describe('неверная форма сохранённых данных не роняет отрисовку и расчёт (028)', () => {
  const proj = richProject();
  const good = raw(proj);
  const open = (patch: (r: any) => void) => {
    const r = structuredClone(good);
    patch(r);
    return normalizeProject(r);
  };

  it('проект из воспроизведения открывается без результата подбора', () => {
    const n = normalizeProject({ id: 'poison', name: 'Проверка', room: {}, roomReady: true, result: { best: 'x', baseline: 5 } });
    expect([n.id, n.name, n.roomReady, n.result, n.selectedIndex]).toEqual(['poison', 'Проверка', true, null, 0]);
  });

  it('результат неверной формы отбрасывается целиком, выбранный вариант — первый', () => {
    const broken: ((r: any) => void)[] = [
      (r) => { delete r.result.baseline; },
      (r) => { r.result.best = {}; },
      (r) => { r.result.notes = 'нет'; },
      (r) => { r.result.fLo = '20'; },
      (r) => { r.result.best[0] = null; },
      (r) => { r.result.best[0].listener = { x: null, y: 1, z: 1 }; },
      (r) => { delete r.result.best[0].sources[0].pos; },
      (r) => { r.result.best[0].sources[0].id = 7; },
      (r) => { r.result.best[0].response.f = 'f'; },
      (r) => { r.result.baseline.response = null; },
      (r) => { r.result.best[0].penalties = [null]; },
      (r) => { r.result.best[0].seats = [{ x: 1 }]; },
      (r) => { r.result.best[0].score = '5'; },
      (r) => { r.result.best[0].robust = 'да'; },
      (r) => { r.result.best[0].scheme = 1; },
      (r) => { r.result.best[0].subSettings = { sub1: { delayMs: 1, phaseDeg: 0, gainDb: 0, peq: 3 } }; },
    ];
    for (const [i, f] of broken.entries()) {
      const n = open(f);
      expect(n.result, `случай ${i}`).toBeNull();
      expect(n.selectedIndex, `случай ${i}`).toBe(0);
      // остальное не тронуто
      expect(n.current.subSettings).toEqual(good.current.subSettings);
    }
  });

  it('выбранный вариант — целое неотрицательное число', () => {
    for (const v of [-1, 1.5, '1', null]) expect(open((r) => { r.selectedIndex = v; }).selectedIndex).toBe(0);
    expect(open((r) => { r.selectedIndex = 2; }).selectedIndex).toBe(2);
  });

  it('сведения о скане: имя файла, уверенность и поворот своего типа, остальное хранится', () => {
    const n = open((r) => { r.scanInfo.fileName = 5; r.scanInfo.confidence = 'высокая'; r.scanInfo.rotation = 1.5; });
    expect(n.scanInfo!.fileName).toBe('');
    expect('confidence' in n.scanInfo!).toBe(false);
    expect('rotation' in n.scanInfo!).toBe(false);
    expect(n.scanInfo!.applied).toEqual(good.scanInfo.applied);
    expect(n.scanInfo!.warnings).toEqual(['Пример']);
    expect(open((r) => { r.scanInfo = 'скан'; }).scanInfo).toBeNull();
  });

  it('расстановки: id и имя — строки, настройки сабвуферов и частота раздела — числа', () => {
    const n = open((r) => {
      r.current.id = 5;
      r.current.name = { x: 1 };
      r.current.crossoverHz = '80';
      r.current.subSettings = {
        sub1: { delayMs: 2, phaseDeg: 0, gainDb: 1, peq: 3, allpass: [{ f: 'a', q: 1 }] },
        sub2: { delayMs: '2', phaseDeg: 0, gainDb: 0 },
      };
      r.setups[0].name = 12;
      r.setups[0].subSettings = 'нет';
    });
    expect(typeof n.current.id).toBe('string');
    expect(n.current.name).toBe('Текущая');
    expect(n.current.crossoverHz).toBeNull();
    expect(n.current.subSettings).toEqual({ sub1: { delayMs: 2, phaseDeg: 0, gainDb: 1 } });
    expect(n.setups[0].name).toBe('Вариант');
    expect(n.setups[0].subSettings).toEqual({});
  });

  it('частота раздела и регулировки сабвуфера — своего типа, иначе умолчания', () => {
    const n = open((r) => {
      r.constraints.crossover = { adjustable: 'да', min: 'шестьдесят', max: null };
      const sub = r.sources.find((s: any) => s.kind === 'sub');
      Object.assign(sub, { delayMode: 'x', phaseMode: 7, maxDelayMs: 'много', peqBands: 'две' });
    });
    expect(n.constraints.crossover).toEqual({ adjustable: false, min: 60, max: 120 });
    const sub = n.sources.find((s) => s.kind === 'sub')!;
    expect([sub.delayMode, sub.phaseMode, sub.maxDelayMs, 'peqBands' in sub]).toEqual(['none', 'polarity', 20, false]);
  });

  it('элементы комнаты неверной формы убираются или получают умолчания', () => {
    const n = open((r) => {
      r.room.openings.push({ id: 'o2', wall: 'потолок', a0: 1, a1: 2, height: 2 }, { id: 'o3', wall: 'left', a0: 3, a1: 4 });
      // без арки проект раньше не открывался
      r.room.extensions.push({ id: 'e2', name: 'Без арки', wall: 'left', a0: 1, a1: 2, depth: 2, height: 2.5 });
      r.room.treatments[0].corner = 'центр';
      r.room.treatments[1].wall = 'пол';
      r.room.treatments[1].at = 'середина';
      r.room.treatments.push({ id: 't4', kind: 'panel', thickness: 0.1, width: '1', height: 1, wall: 'left' });
      r.room.zones[0].kind = 'диван';
      r.room.zones[0].name = 5;
      r.room.calibration.source = 5;
    });
    expect(n.room.openings.map((o) => o.id)).toEqual(['o1']);
    expect(n.room.extensions.map((e) => e.id)).toEqual(['e1']);
    expect(n.room.treatments!.map((t) => t.id)).toEqual(['t1', 't2', 't3']);
    expect('corner' in n.room.treatments![0]).toBe(false);
    expect(['wall' in n.room.treatments![1], 'at' in n.room.treatments![1], n.room.treatments![1].z]).toEqual([false, false, 1.2]);
    expect(n.room.zones[0].kind).toBe('other');
    expect('name' in n.room.zones[0]).toBe(false);
    expect(n.room.calibration).toEqual({ dampingScale: 1.2, model: DAMPING_MODEL, leakageBefore: 'typical' });
    expect(open((r) => { r.room.calibration.dampingScale = '1.2'; }).room.calibration).toBeNull();
    expect(open((r) => { r.room.slope.low = '1.8'; }).room.slope).toBeNull();
  });

  it('по исправленному проекту считаются отклик, затухание и места обработки', () => {
    const n = open((r) => {
      r.current.subSettings = { sub1: { delayMs: 1, phaseDeg: 0, gainDb: 0, peq: {} } };
      r.current.crossoverHz = {};
      r.room.treatments[0].corner = 5;
      r.room.openings.push({ id: 'o2', wall: 3, a0: 1, a1: 2 });
    });
    expect(() => computeReverb(n.room)).not.toThrow();
    expect(() => roomPatches(n.room)).not.toThrow();
    const ev = evaluateSetup(n.room, n.sources, n.constraints, n.current);
    expect(Number.isFinite(ev.score)).toBe(true);
  });
});
