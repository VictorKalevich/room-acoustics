import { describe, expect, it } from 'vitest';
import { newProject, type Project } from '../../src/state/project';
import {
  applyPatch, changeConstraints, changePrecision, changeRoom, changeSetup, changeSetups, changeSources, changeVoice,
  fitConstraints, renameProject, replaceProject, selectVariant, setResult, type Transition,
} from '../../src/state/transitions';
import { baselinePositions } from '../../src/core/placement';
import type { Placement, PlacementResult, Setup } from '../../src/core/types';
import type { VoiceSettings } from '../../src/core/voice';

// 031: правила, которые держат проект согласованным при каждом изменении (раньше — внутри хука useProject)

const BEFORE = '2026-01-01T00:00:00.000Z';
const NOW = '2026-11-15T12:00:00.000Z';

const result: PlacementResult = { best: [], baseline: {} as Placement, fLo: 20, fHi: 120, schroeder: 180, evaluated: 10, elapsedMs: 5, notes: [] };
const voice: VoiceSettings = { mic: 'cardioid', distance: 0.2, posture: 'standing', mouthZ: 1.6, fLo: 100, fHi: 1000, spot: null };

/** Глубокая заморозка: переход, который правит прежний проект, падает с ошибкой. */
function frozen<T>(v: T): T {
  if (v && typeof v === 'object' && !Object.isFrozen(v)) {
    for (const x of Object.values(v)) frozen(x);
    Object.freeze(v);
  }
  return v;
}

/** Переход на замороженном прежнем проекте; прежний проект после перехода тот же. */
function run(t: Transition, prev: Project): Project {
  const before = JSON.stringify(prev);
  const next = t(frozen(prev), NOW);
  expect(JSON.stringify(prev)).toBe(before);
  return next;
}

/** Новый проект 5 × 4 × 2,5 м (spkL, spkR, sub1), места не выбраны. */
function fresh(over: Partial<Project> = {}): Project {
  return { ...newProject(), updatedAt: BEFORE, ...over };
}

/** Проект с результатом подбора, выбранными местами и сохранённым вариантом. */
function worked(): Project {
  const p = fresh();
  const current: Setup = { ...p.current, listener: { ...p.current.listener, x: 2.2 }, placed: true };
  const saved: Setup = { ...p.current, id: 'v1', name: 'Вариант', listener: { ...p.current.listener, x: 2.6 }, placed: true };
  return { ...p, result, selectedIndex: 1, current, setups: [saved] };
}

/** Все переходы, которые идут по общему правилу (`applyPatch`), на проекте `p`. */
function changes(p: Project): [string, Transition][] {
  return [
    ['комната', changeRoom({ ...p.room, height: 2.7 }, {}, p.constraints)],
    ['источники', changeSources(p.sources.slice(0, 2))],
    ['ограничения', changeConstraints({ ...p.constraints, earHeight: 1.2 })],
    ['точность', changePrecision('high')],
    ['расстановка', changeSetup({ ...p.current, listener: { ...p.current.listener, y: 1.5 } })],
    ['варианты', changeSetups([])],
    ['голос', changeVoice(voice)],
    ['название', renameProject('Студия')],
    ['результат', setResult(result, 0)],
  ];
}

describe('результат подбора', () => {
  it('изменения комнаты, источников, ограничений и точности помечают результат устаревшим', () => {
    const p = worked();
    for (const [name, t] of changes(p).slice(0, 4)) {
      expect(run(t, p).result, name).toEqual({ ...result, stale: true });
    }
  });

  it('без результата пометка не появляется', () => {
    const p = fresh();
    for (const [name, t] of changes(p).slice(0, 4)) expect(run(t, p).result, name).toBeNull();
  });

  it('изменения расстановки, вариантов, голоса и названия результат не трогают', () => {
    const p = worked();
    for (const [name, t] of changes(p).slice(4, 8)) expect(run(t, p).result, name).toBe(p.result);
  });

  it('явно переданный результат, в том числе null, важнее пометки «устарел»', () => {
    const p = worked();
    expect(run(changeRoom({ ...p.room, depth: 6 }, { result: null }, p.constraints), p).result).toBeNull();
    const other = { ...result, evaluated: 99 };
    expect(run(changeRoom({ ...p.room, depth: 6 }, { result: other }, p.constraints), p).result).toBe(other);
    expect(applyPatch(frozen(p), { name: 'x', result: other }, NOW).result).toBe(other);
  });

  it('результат автоподбора записывается как пришёл, вместе с выбранным вариантом', () => {
    const p = worked();
    const other = { ...result, evaluated: 99 };
    const a = run(setResult(other, 2), p);
    expect(a.result).toBe(other);
    expect(a.selectedIndex).toBe(2);
    const stale = { ...other, stale: true };
    expect(run(setResult(stale, 0), p).result).toBe(stale);
    const fromNone = run(setResult(other, 0), fresh());
    expect(fromNone.result).toBe(other);
  });

  it('общее правило: без явного результата устаревает, если не сказано иначе', () => {
    const p = worked();
    expect(applyPatch(frozen(p), { name: 'x' }, NOW).result).toEqual({ ...result, stale: true });
    expect(applyPatch(p, { name: 'x' }, NOW, false).result).toBe(p.result);
  });
});

describe('вписывание расстановок в комнату', () => {
  it('меньшая комната: текущая и сохранённые расстановки остаются внутри стен', () => {
    const p = worked();
    const far: Setup = { ...p.setups[0], listener: { ...p.setups[0].listener, x: 4.8 }, positions: { ...p.setups[0].positions, sub1: { x: 4.85, y: 3.85, z: 0.3 } } };
    const prev = { ...p, current: { ...p.current, listener: { ...p.current.listener, x: 4.8 } }, setups: [far] };
    const next = run(changeRoom({ ...prev.room, depth: 3.5, width: 3 }, {}, prev.constraints), prev);
    expect(next.current.listener.x).toBeCloseTo(3.4);
    expect(next.setups[0].listener.x).toBeCloseTo(3.4);
    expect(next.setups[0].positions.sub1.x).toBeCloseTo(3.45);
    expect(next.setups[0].positions.sub1.y).toBeCloseTo(2.95);
    expect(next.setups[0].positions.sub1.z).toBe(0.3);
    for (const s of [next.current, ...next.setups]) {
      for (const v of Object.values(s.positions)) {
        expect(v.x).toBeLessThanOrEqual(3.45 + 1e-9);
        expect(v.y).toBeLessThanOrEqual(2.95 + 1e-9);
      }
    }
  });

  it('другие источники: места текущей и сохранённых расстановок по новому набору, настройки убранного сабвуфера удаляются', () => {
    const p = worked();
    const sub = { gainDb: -3, delayMs: 2, phaseDeg: 180 };
    const prev = { ...p, current: { ...p.current, subSettings: { sub1: sub } }, setups: [{ ...p.setups[0], subSettings: { sub1: sub } }] };
    const sources = [{ id: 'spkC', kind: 'speaker' as const, fLow: 50, fHigh: 20000, height: 1.2 }];
    const next = run(changeSources(sources), prev);
    for (const s of [next.current, ...next.setups]) {
      expect(Object.keys(s.positions)).toEqual(['spkC']);
      expect(s.positions.spkC.z).toBe(1.2);
      expect(s.subSettings).toEqual({});
    }
  });

  it('ограничения и текущая расстановка вписывают только текущую расстановку', () => {
    const p = worked();
    const out: Setup = { ...p.setups[0], listener: { ...p.setups[0].listener, x: 9 } };
    const prev = { ...p, setups: [out] };
    const a = run(changeConstraints({ ...prev.constraints, earHeight: 1.25 }), prev);
    expect(a.current.listener.z).toBe(1.25);
    expect(a.setups).toBe(prev.setups);
    const b = run(changeSetup({ ...prev.current, listener: { ...prev.current.listener, x: 7 } }), prev);
    expect(b.current.listener.x).toBeCloseTo(4.9);
    expect(b.setups).toBe(prev.setups);
  });

  it('варианты, голос, название, точность и результат расстановки не вписывают', () => {
    const p = worked();
    const out: Setup = { ...p.current, listener: { ...p.current.listener, x: 9 } };
    const prev = { ...p, current: out, setups: [out] };
    for (const [name, t] of changes(prev).slice(3)) {
      if (name === 'расстановка') continue;
      const next = run(t, prev);
      expect(next.current, name).toBe(prev.current);
      if (name !== 'варианты') expect(next.setups, name).toBe(prev.setups);
    }
    const kept = [out];
    expect(run(changeSetups(kept), prev).setups).toBe(kept);
  });
});

describe('места по умолчанию, пока не выбраны (022)', () => {
  it('новая комната: текущая расстановка — места по умолчанию для неё', () => {
    const p = fresh();
    const room = { ...p.room, depth: 6.5, width: 3.6 };
    const next = run(changeRoom(room, {}, p.constraints), p);
    const b = baselinePositions(room, p.sources, next.constraints);
    expect(next.current.listener).toEqual(b.listener);
    expect(next.current.positions).toEqual(b.positions);
    expect(next.current.placed).toBe(false);
  });

  it('выбранные места остаются на своих местах', () => {
    const p = worked();
    const next = run(changeRoom({ ...p.room, depth: 6.5, width: 3.6 }, {}, p.constraints), p);
    expect(next.current.listener.x).toBe(2.2);
    expect(next.current.positions).toEqual(p.current.positions);
  });

  it('сохранённые варианты к местам по умолчанию не возвращаются, даже без признака', () => {
    const p = fresh();
    const v: Setup = { ...p.current, id: 'v', listener: { ...p.current.listener, x: 3.3 }, placed: false };
    const next = run(changeRoom({ ...p.room, depth: 6.5 }, {}, p.constraints), { ...p, setups: [v] });
    expect(next.setups[0].listener.x).toBe(3.3);
  });
});

describe('места выбраны после правки пользователем', () => {
  it('другие места — признак ставится', () => {
    const p = fresh();
    const next = run(changeSetup({ ...p.current, listener: { ...p.current.listener, x: 2.4 } }), p);
    expect(next.current.placed).toBe(true);
    expect(next.current.listener.x).toBe(2.4);
  });

  it('те же места без признака (например, только настройки сабвуфера) — места не выбраны', () => {
    const p = fresh();
    const next = run(changeSetup({ ...p.current, subSettings: { sub1: { gainDb: -2, delayMs: 0, phaseDeg: 0 } } }), p);
    expect(next.current.placed).toBeFalsy();
    expect(next.current.subSettings.sub1.gainDb).toBe(-2);
  });

  it('выбранные места остаются выбранными, если новая расстановка признака не несёт', () => {
    const p = worked();
    const { placed: _placed, ...plain } = p.current;
    void _placed;
    expect(run(changeSetup(plain), p).current.placed).toBe(true);
  });
});

describe('зона слушателя', () => {
  const p = fresh();

  it('выходит за новую комнату — к значениям по умолчанию для неё, остальные ограничения прежние', () => {
    const c = { ...p.constraints, earHeight: 1.3 };
    const room = { ...p.room, depth: 3 };
    expect(fitConstraints(c, room)).toEqual({ ...c, listenerMinX: 0.9, listenerMaxX: 2.4 });
    const next = run(changeRoom(room, {}, c), { ...p, constraints: c });
    expect(next.constraints).toEqual({ ...c, listenerMinX: 0.9, listenerMaxX: 2.4 });
  });

  it('неверная зона (начало не меньше конца, начало у стены) — тоже к умолчаниям; верная — без изменений', () => {
    expect(fitConstraints({ ...p.constraints, listenerMinX: 3, listenerMaxX: 3 }, p.room)).toMatchObject({ listenerMinX: 1.5, listenerMaxX: 4.4 });
    expect(fitConstraints({ ...p.constraints, listenerMinX: 0 }, p.room)).toMatchObject({ listenerMinX: 1.5, listenerMaxX: 4.4 });
    expect(fitConstraints({ ...p.constraints, listenerMaxX: 4.95 }, p.room)).toMatchObject({ listenerMinX: 1.5, listenerMaxX: 4.4 });
    const ok = { ...p.constraints, listenerMinX: 2, listenerMaxX: 4.9 };
    expect(fitConstraints(ok, p.room)).toBe(ok);
  });
});

describe('точность', () => {
  it('стандартная точность в проект не пишется, другая — пишется', () => {
    const p = fresh({ precision: 'high' });
    const std = run(changePrecision('standard'), p);
    expect(std.precision).toBeUndefined();
    expect(JSON.parse(JSON.stringify(std))).not.toHaveProperty('precision');
    expect(run(changePrecision('max'), fresh()).precision).toBe('max');
  });
});

describe('время изменения и замена проекта', () => {
  it('изменения по общему правилу ставят время перехода', () => {
    const p = worked();
    for (const [name, t] of changes(p)) expect(run(t, p).updatedAt, name).toBe(NOW);
  });

  it('выбор варианта: только номер — время, результат и расстановки прежние', () => {
    const p = worked();
    const next = run(selectVariant(3), p);
    expect(next).toEqual({ ...p, selectedIndex: 3 });
    expect(next.updatedAt).toBe(BEFORE);
    expect(next.result).toBe(p.result);
    expect(next.current).toBe(p.current);
    expect(next.setups).toBe(p.setups);
  });

  it('замена проекта: новый проект как есть, без вписывания и без нового времени', () => {
    const p = worked();
    const out: Setup = { ...p.current, listener: { ...p.current.listener, x: 9 }, positions: { spkL: { x: 9, y: 9, z: 1 } } };
    const other = frozen({ ...fresh({ name: 'Другой' }), current: out, setups: [out], result });
    expect(run(replaceProject(other), p)).toBe(other);
  });
});

describe('откуда берутся значения', () => {
  it('комната без ограничений в extra берёт ограничения отрисовки: изменение ограничений до новой отрисовки перекрывается', () => {
    const shown = fresh();
    // два изменения подряд до новой отрисовки: сначала ограничения, затем комната с ограничениями из отрисовки
    const first = run(changeConstraints({ ...shown.constraints, earHeight: 1.3 }), shown);
    const second = run(changeRoom({ ...shown.room, height: 2.6 }, {}, shown.constraints), first);
    expect(second.constraints).toEqual(shown.constraints);
    expect(second.current.listener.z).toBe(1.1);
  });

  it('ограничения из extra важнее ограничений отрисовки', () => {
    const p = fresh();
    const own = { ...p.constraints, earHeight: 1.4 };
    const next = run(changeRoom({ ...p.room, height: 2.6 }, { constraints: own }, { ...p.constraints, earHeight: 1.2 }), p);
    expect(next.constraints).toEqual(own);
    expect(next.current.listener.z).toBe(1.4);
  });

  it('поля из extra переходят в проект; переданная текущая расстановка вписывается', () => {
    const p = worked();
    const current: Setup = { ...p.current, listener: { ...p.current.listener, x: 8 }, placed: true };
    const next = run(changeRoom({ ...p.room, depth: 4 }, { roomReady: true, current, setups: [] }, p.constraints), p);
    expect(next.roomReady).toBe(true);
    expect(next.setups).toEqual([]);
    expect(next.current.listener.x).toBeCloseTo(3.9);
  });

  it('расстановка сравнивается с текущей расстановкой предыдущего состояния', () => {
    const shown = fresh();
    const placedBefore = run(changeSetup({ ...shown.current, listener: { ...shown.current.listener, x: 2.4 } }), shown);
    // изменение пришло из отрисовки, где места ещё не выбраны, и совпадает с ними; предыдущее состояние уже выбрано
    expect(run(changeSetup(shown.current), placedBefore).current.placed).toBe(true);
  });
});
