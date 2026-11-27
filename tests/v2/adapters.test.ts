// V2-007: адаптер v2 ↔ ядро — обратимость и совпадение расчётов с прямым вызовом ядра (формулы не меняются).
import { describe, expect, it } from 'vitest';
import { newProject } from '../../src/state/project';
import { computeModes } from '../../src/core/modes';
import { computeReverb } from '../../src/core/reverb';
import { evaluateSetup } from '../../src/core/system';
import { buildOverview } from '../../src/core/overview';
import { speedOfSound } from '../../src/core/physics';
import type { Constraints, Room, Setup, SourceSpec } from '../../src/core/types';
import { fromCore, layoutOf, toCore, type CoreInputs } from '../../src/v2/adapters/core';
import { calcModes, calcOverview, calcReverb, calcSetup, modesFMax } from '../../src/v2/adapters/calculations';
import { moveObject } from '../../src/v2/domain/operations';
import type { RoomConfiguration } from '../../src/v2/domain/model';

const NOW = '2026-11-27T00:00:00.000Z';

function legacyInputs(): CoreInputs {
  const p = newProject();
  return { room: p.room, sources: p.sources, constraints: p.constraints, setup: p.current };
}

function richInputs(): CoreInputs {
  const room: Room = {
    depth: 4.5, width: 3.8, height: 2.7, temperatureC: 23,
    materials: { floor: 'carpet-thin', ceiling: 'gypsum', front: 'plaster', back: 'brick', left: 'plaster', right: 'gypsum' },
    furnishing: 'heavy', source: 'scan', leakage: 'door', model: 'modal',
    calibration: { dampingScale: 1.2, model: 5, source: 'Замер 1', leakageBefore: 'typical' },
    zones: [{ id: 'z1', kind: 'furniture', x0: 3, x1: 4, y0: 0.5, y1: 2.5, canSit: true, name: 'Диван', furniture: 'sofa', height: 0.8, fromScan: true }],
    openings: [{ id: 'o1', wall: 'right', a0: 3.2, a1: 4.1, height: 2.0 }],
    features: [{ id: 'w1', kind: 'window', wall: 'left', a0: 1, a1: 2.4, bottom: 0.9, top: 2.3 }, { id: 'd1', kind: 'door', wall: 'back', a0: 0.2, a1: 1.0, bottom: 0, top: 2.0, fromScan: true }],
    extensions: [{ id: 'e1', name: 'Коридор', wall: 'back', a0: 2, a1: 3.4, depth: 3, height: 2.5, arch: { a0: 2.2, a1: 3.0, height: 2.1 }, openStart: false, openEnd: true, openFar: false }],
    slope: { wall: 'right', low: 2.1, run: 1.2 },
    treatments: [{ id: 't1', kind: 'corner', thickness: 0.1, width: 0.6, height: 2.4, corner: 'front-left' }, { id: 't2', kind: 'cloud', thickness: 0.1, gap: 0.1, width: 1.2, height: 1.2, x: 1.8, y: 1.9, enabled: false }],
    treatmentsOn: true,
    coverings: [{ id: 'c1', kind: 'carpet', grade: 'thick', surface: 'floor', u0: 1, u1: 3, v0: 0.8, v1: 3 }],
    furnitureList: true,
  };
  const sources: SourceSpec[] = [
    { id: 'spkL', kind: 'speaker', fLow: 80, fHigh: 20000, height: 1.0 },
    { id: 'spkR', kind: 'speaker', fLow: 80, fHigh: 20000, height: 1.0, passport: { f3: 55, box: 'sealed' } },
    { id: 'sub1', kind: 'sub', fLow: 25, fHigh: 120, height: 0.3, delayMode: 'adjustable', maxDelayMs: 20, phaseMode: 'continuous', levelAdjustable: true, peqBands: 4, allpass: true, passport: { f3: 28, f10: 20 } },
    { id: 'sub2', kind: 'sub', fLow: 25, fHigh: 120, height: 0.3 },
  ];
  const constraints: Constraints = {
    speakerMinFront: 0.25, speakerMinSide: 0.35, listenerMinX: 1.35, listenerMaxX: 3.9, earHeight: 1.15, subZone: 'anywhere', subWallGap: 0.2,
    seats: { count: 3, spacing: 0.55 }, crossover: { adjustable: true, min: 50, max: 150 }, dba: true,
    objective: { id: 'modes', modePreset: 'custom', modes: [[1, 0, 0], [0, 1, 0]] }, houseCurve: 6,
  };
  const setup: Setup = {
    id: 'setup-1', name: 'Текущая', listener: { x: 1.9, y: 1.9, z: 1.15 },
    positions: { spkL: { x: 0.4, y: 1, z: 1 }, spkR: { x: 0.4, y: 2.8, z: 1 }, sub1: { x: 0.2, y: 0.2, z: 0.3 }, sub2: { x: 4.3, y: 3.6, z: 0.3 } },
    subSettings: { sub1: { delayMs: 2.5, phaseDeg: 90, gainDb: -3, peq: [{ f: 42, gainDb: -6, q: 4 }], allpass: [{ f: 60, q: 0.7 }] } },
    crossoverHz: 90, measurement: null, placed: true,
  };
  return { room, sources, constraints, setup, precision: 'high', voice: { mic: 'cardioid', distance: 0.2, posture: 'standing', mouthZ: 1.6, fLo: 80, fHi: 12000, spot: { x: 2, y: 1, facing: 0 } } };
}

const v2 = (i: CoreInputs, id = i.setup.id): RoomConfiguration => fromCore(i, { id, role: 'current', revision: 1 });

describe('059 V2-007 · адаптер v2 ↔ ядро', () => {
  for (const [name, make] of [['новый проект legacy', legacyInputs], ['насыщенная комната', richInputs]] as const) {
    it(`обратимость: ${name}`, () => {
      const inputs = make();
      const back = toCore(v2(inputs));
      expect(back.ok).toBe(true);
      if (!back.ok) return;
      expect(back.inputs.room).toEqual(inputs.room);
      expect(back.inputs.sources).toEqual(inputs.sources);
      expect(back.inputs.constraints).toEqual(inputs.constraints);
      expect(back.inputs.setup).toEqual(inputs.setup);
      expect(back.inputs.precision).toEqual(inputs.precision);
      expect(back.inputs.voice).toEqual(inputs.voice);
    });
  }

  it('конфигурация не делит изменяемые объекты с входом ядра', () => {
    const inputs = richInputs();
    const c = v2(inputs);
    c.interior.obstacles[0].x0 = 0;
    c.audio.sources[2].settings!.peq![0].gainDb = 0;
    expect(inputs.room.zones[0].x0).toBe(3);
    expect(inputs.setup.subSettings.sub1.peq![0].gainDb).toBe(-6);
  });

  it('состав системы и подписи источников', () => {
    const c = v2(richInputs());
    expect(c.audio.sources.map((s) => [s.name, s.channel])).toEqual([['Левая колонка', 'L'], ['Правая колонка', 'R'], ['Сабвуфер 1', 'LFE'], ['Сабвуфер 2', 'LFE']]);
    expect(c.audio.layout).toBe('2.2');
    expect(layoutOf(legacyInputs().sources)).toBe('2.1');
    expect(c.openings.map((o) => [o.id, o.kind, o.state])).toEqual([['w1', 'window', 'closed'], ['d1', 'door', 'closed'], ['o1', 'passage', 'permanent']]);
  });

  it('открытый проём выше пола и неописанное соседнее пространство — предупреждения, не тихая подмена', () => {
    const c = v2(legacyInputs());
    c.openings.push({ id: 'ow', kind: 'window', wall: 'left', a0: 1, a1: 2, bottom: 0.9, top: 2.1, state: 'open' });
    c.openings.push({ id: 'ox', kind: 'passage', wall: 'back', a0: 1, a1: 2, bottom: 0, top: 2, state: 'unknown-neighbour' });
    const r = toCore(c);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.inputs.room.openings).toEqual([{ id: 'ow', wall: 'left', a0: 1, a1: 2, height: 2.1 - 0.9 }, { id: 'ox', wall: 'back', a0: 1, a1: 2, height: 2 }]);
    expect(r.warnings).toHaveLength(2);
  });

  it('контур и диффузоры: отказ или ограничение с причиной', () => {
    const c = v2(legacyInputs());
    expect(toCore({ ...c, geometry: { kind: 'polygon', outline: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }], height: 2.5 } })).toMatchObject({ ok: false });
    c.treatment = { enabled: true, items: [{ id: 'd', kind: 'diffuser', design: 'qrd-1d', wall: 'back', at: 2, z: 1.5, width: 0.6, height: 0.6, depth: 0.2 }] };
    const r = toCore(c);
    expect(r.ok && r.inputs.room.treatments).toEqual([]);
    expect(r.ok && r.limitations.join(' ')).toMatch(/Диффузоры/);
  });
});

describe('059 V2-007 · расчёты через адаптер совпадают с ядром', () => {
  it('первая осевая мода по длине 4,5 м — c/(2·4,5)', () => {
    const r = calcModes(v2(richInputs()), NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const m = r.result.value.modes.find((x) => x.n[0] === 1 && x.n[1] === 0 && x.n[2] === 0)!;
    expect(m.f).toBeCloseTo(speedOfSound(23) / 9, 9);
  });

  for (const [name, make] of [['новый проект legacy', legacyInputs], ['насыщенная комната', richInputs]] as const) {
    it(`моды, реверберация, отклик и сводка: ${name}`, () => {
      const i = make();
      const c = v2(i);
      const rev = computeReverb(i.room);
      const modes = computeModes(i.room, modesFMax(rev));
      const r = calcReverb(c, NOW), m = calcModes(c, NOW), s = calcSetup(c, NOW), o = calcOverview(c, NOW);
      if (!r.ok || !m.ok || !s.ok || !o.ok) throw new Error('расчёт недоступен');
      expect(r.result.value).toEqual(rev);
      expect(m.result.value.modes).toEqual(modes);
      const ppo = i.precision === 'high' ? 48 : 24;
      const ev = evaluateSetup(i.room, i.sources, i.constraints, i.setup, { ppo, chart: true });
      expect(s.result.value).toEqual(ev);
      const evNoChart = evaluateSetup(i.room, i.sources, i.constraints, i.setup, { ppo });
      expect(o.result.value.overview).toEqual(buildOverview(i.room, i.sources, i.setup, evNoChart, modes, rev));
    });
  }

  it('происхождение: ревизия, версия ядра, хеш входа', () => {
    const c = v2(legacyInputs());
    const a = calcModes(c, NOW), b = calcSetup(c, NOW);
    if (!a.ok || !b.ok) throw new Error('расчёт недоступен');
    expect(a.result.provenance).toMatchObject({ kind: 'calculated', configId: c.id, revision: 1, algorithmVersion: 'core-damping-5' });
    const moved = moveObject(c, { type: 'source', id: 'spkL' }, { x: 0.6, y: 1.2 });
    const a2 = calcModes(moved, NOW), b2 = calcSetup(moved, NOW);
    if (!a2.ok || !b2.ok) throw new Error('расчёт недоступен');
    expect(a2.result.provenance.inputHash).toBe(a.result.provenance.inputHash);
    expect(b2.result.provenance.inputHash).not.toBe(b.result.provenance.inputHash);
  });
});
