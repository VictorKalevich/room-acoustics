// V2-006: предметная модель v2 — единицы, неизвестные значения, две конфигурации, уровни сложности, происхождение.
import { describe, expect, it } from 'vitest';
import { amplitudeToDb, cmToM, dbToAmplitude, degToRad, isKnown, isMissing, knownOr, msToS, UNKNOWN, UNSET, type Maybe } from '../../src/v2/domain/units';
import { applyLayout, confirmExperiment, createExperiment, discardExperiment, moveObject, restoreArchived, setLocked, updateConfig } from '../../src/v2/domain/operations';
import { hiddenOverrides, resetParams, visibleAt } from '../../src/v2/domain/complexity';
import { hashInputs, isStale, stableStringify } from '../../src/v2/domain/provenance';
import { validateConfiguration, validateDimensions } from '../../src/v2/domain/validation';
import { DEFAULT_GOALS, ROOM_SCHEMA, type Room, type RoomConfiguration } from '../../src/v2/domain/model';

let n = 0;
const id = () => `id${++n}`;
const NOW = '2026-11-27T00:00:00.000Z';

export function sampleConfig(): RoomConfiguration {
  return {
    id: 'cfg-current', role: 'current', revision: 1, geometrySource: 'manual',
    geometry: { kind: 'rect', depth: 4.5, width: 3.8, height: 2.7, slope: null },
    surfaces: { floor: { material: 'parquet' }, ceiling: { material: 'concrete-painted' }, front: { material: 'plaster' }, back: { material: 'plaster' }, left: { material: 'plaster' }, right: { material: 'plaster' } },
    openings: [], zones: [],
    audio: {
      layout: '2.0', crossoverHz: null, crossover: { adjustable: false, min: 60, max: 120 },
      sources: [
        { id: 'spkL', kind: 'speaker', name: 'Левая', channel: 'L', position: { x: 0.5, y: 1, z: 1 }, rotationDeg: 0, fLow: 50, fHigh: 20000, capabilities: {} },
        { id: 'spkR', kind: 'speaker', name: 'Правая', channel: 'R', position: { x: 0.5, y: 2.8, z: 1 }, rotationDeg: 0, fLow: 50, fHigh: 20000, capabilities: {} },
      ],
    },
    listening: { listeners: [{ id: 'l1', name: 'Слушатель', position: { x: 1.7, y: 1.9, z: 1.1 }, weight: 1, primary: true }], seats: { count: 1, spacing: 0.6 } },
    interior: { obstacles: [], coverings: [], furnitureList: false, furnishing: 'typical' },
    treatment: { items: [], enabled: false },
    simulation: { model: 'auto', temperatureC: 20, leakage: 'typical', calibration: null, placement: { speakerMinFront: 0.2, speakerMinSide: 0.3, listenerMinX: 1.35, listenerMaxX: 3.9, subZone: 'walls', subWallGap: 0.15 } },
    placed: true, voice: null, scan: null,
  };
}

export function sampleRoom(): Room {
  return {
    schema: ROOM_SCHEMA, id: 'room1', name: 'Демонстрационная', createdAt: NOW, updatedAt: NOW,
    current: sampleConfig(), experimental: null, goals: DEFAULT_GOALS, archive: [], history: [], origin: { kind: 'created' },
  };
}

describe('059 V2-006 · единицы и неизвестные значения', () => {
  it('переводы единиц и децибел', () => {
    expect(cmToM(250)).toBe(2.5);
    expect(msToS(2.915)).toBeCloseTo(0.002915, 9);
    expect(degToRad(180)).toBeCloseTo(Math.PI, 12);
    expect(amplitudeToDb(2)).toBeCloseTo(6.0206, 4);
    expect(dbToAmplitude(-6.0206)).toBeCloseTo(0.5, 4);
  });

  it('неизвестное не равно нулю и не путается с объектом-значением', () => {
    const cost: Maybe<number> = UNKNOWN;
    expect(isKnown(cost)).toBe(false);
    expect(isKnown<number>(0)).toBe(true);
    expect(isMissing({ missing: 'unknown', extra: 1 })).toBe(false);
    expect(knownOr(UNSET as Maybe<number>, (m) => `нет: ${m.missing}`)).toBe('нет: unset');
  });
});

describe('059 V2-006 · текущая и экспериментальная конфигурации', () => {
  it('эксперимент — независимая копия; ревизии растут отдельно', () => {
    const room = createExperiment(sampleRoom(), id, NOW);
    expect(room.experimental).toMatchObject({ role: 'experimental', revision: 1, basedOn: { configId: 'cfg-current', revision: 1 } });
    expect(room.experimental!.id).not.toBe(room.current.id);
    const moved = updateConfig(room, 'experimental', (c) => moveObject(c, { type: 'source', id: 'spkL' }, { x: 1, y: 0.8 }), NOW);
    expect(moved.experimental!.audio.sources[0].position).toEqual({ x: 1, y: 0.8, z: 1 });
    expect(moved.current.audio.sources[0].position).toEqual({ x: 0.5, y: 1, z: 1 });
    expect(moved.experimental!.revision).toBe(2);
    expect(moved.current.revision).toBe(1);
    expect(createExperiment(moved, id, NOW)).toBe(moved);
  });

  it('изменение эксперимента без эксперимента — ошибка, а не тихое создание', () => {
    expect(() => updateConfig(sampleRoom(), 'experimental', () => undefined, NOW)).toThrow(/эксперимент/);
  });

  it('подтверждение: эксперимент становится текущим, прежняя текущая — снимок в истории', () => {
    let room = createExperiment(sampleRoom(), id, NOW);
    room = updateConfig(room, 'experimental', (c) => ({ ...c, interior: { ...c.interior, furnishing: 'heavy' } }), NOW);
    const expId = room.experimental!.id;
    const done = confirmExperiment(room, id, NOW);
    expect(done.experimental).toBeNull();
    expect(done.current).toMatchObject({ id: expId, role: 'current', interior: { furnishing: 'heavy' } });
    expect(done.current.basedOn).toBeUndefined();
    expect(done.history).toHaveLength(1);
    expect(done.history[0]).toMatchObject({ reason: 'experiment-confirmed', config: { id: 'cfg-current', interior: { furnishing: 'typical' } } });
    expect(() => confirmExperiment(done, id, NOW)).toThrow();
  });

  it('отмена эксперимента не трогает текущую конфигурацию', () => {
    const room = createExperiment(sampleRoom(), id, NOW);
    expect(discardExperiment(room, NOW)).toMatchObject({ experimental: null, current: room.current });
  });

  it('вариант из архива восстанавливается только в эксперимент', () => {
    const base = sampleRoom();
    base.archive.push({ id: 'a1', name: 'У стены', savedAt: NOW, origin: 'legacy-setup', measurementIds: [],
      layout: { listener: { x: 2, y: 1.9, z: 1.1 }, positions: { spkL: { x: 0.3, y: 0.9, z: 1 } }, subSettings: {}, crossoverHz: 80 } });
    const room = restoreArchived(base, 'a1', id, NOW);
    expect(room.current).toEqual(base.current);
    expect(room.experimental!.audio.sources[0].position).toEqual({ x: 0.3, y: 0.9, z: 1 });
    expect(room.experimental!.audio.sources[1].position).toEqual({ x: 0.5, y: 2.8, z: 1 });
    expect(room.experimental!.listening.listeners[0].position).toEqual({ x: 2, y: 1.9, z: 1.1 });
    expect(room.experimental!.audio.crossoverHz).toBe(80);
    expect(room.archive).toEqual(base.archive);
  });

  it('заблокированный объект не перемещается', () => {
    const c = setLocked(sampleConfig(), { type: 'source', id: 'spkL' }, true);
    expect(moveObject(c, { type: 'source', id: 'spkL' }, { x: 2, y: 2 })).toBe(c);
  });

  it('applyLayout отмечает места выбранными', () => {
    const c = { ...sampleConfig(), placed: false };
    expect(applyLayout(c, { listener: { x: 1, y: 1, z: 1.1 }, positions: {}, subSettings: {}, crossoverHz: null }).placed).toBe(true);
  });
});

describe('059 V2-006 · уровни сложности', () => {
  it('видимость по уровням', () => {
    expect(visibleAt('advanced', 'simple')).toBe(false);
    expect(visibleAt('advanced', 'expert')).toBe(true);
  });

  it('переключение уровня не меняет данные; скрытые изменённые параметры перечисляются и сбрасываются явно', () => {
    const c = { ...sampleConfig(), simulation: { ...sampleConfig().simulation, model: 'wave' as const, leakage: 'sealed' as const } };
    expect(hiddenOverrides(c, 'simple').map((p) => p.id)).toEqual(['leakage', 'model']);
    expect(hiddenOverrides(c, 'advanced').map((p) => p.id)).toEqual(['model']);
    expect(hiddenOverrides(c, 'expert')).toEqual([]);
    const reset = resetParams(c, ['model']);
    expect(reset.simulation).toMatchObject({ model: 'auto', leakage: 'sealed' });
    expect(c.simulation.model).toBe('wave');
  });
});

describe('059 V2-006 · происхождение и устаревание', () => {
  it('хеш не зависит от порядка ключей и undefined', () => {
    expect(stableStringify({ b: 1, a: [1, undefined], c: undefined })).toBe('{"a":[1,null],"b":1}');
    expect(hashInputs({ a: 1, b: 2 })).toBe(hashInputs({ b: 2, a: 1 }));
    expect(hashInputs({ a: 1 })).not.toBe(hashInputs({ a: 2 }));
  });

  it('результат устаревает при другой ревизии, конфигурации или входе', () => {
    const p = { kind: 'calculated' as const, method: 'm', algorithmVersion: '1', configId: 'c', revision: 3, inputHash: 'h', createdAt: NOW, warnings: [], limitations: [] };
    expect(isStale(p, { id: 'c', revision: 3 })).toBe(false);
    expect(isStale(p, { id: 'c', revision: 4 })).toBe(true);
    expect(isStale(p, { id: 'other', revision: 3 })).toBe(true);
    expect(isStale(p, { id: 'c', revision: 4 }, 'h')).toBe(false);
  });
});

describe('059 V2-006 · проверки', () => {
  it('размеры в пределах legacy', () => {
    expect(validateDimensions({ depth: 4.5, width: 3.8, height: 2.7 })).toEqual([]);
    expect(validateDimensions({ depth: 0.5, width: NaN, height: 25 }).map((i) => i.path)).toEqual(['geometry.depth', 'geometry.width', 'geometry.height']);
  });

  it('объект за стеной — предупреждение, нет основного слушателя — ошибка', () => {
    const c = sampleConfig();
    c.audio.sources[0].position.x = -1;
    c.listening.listeners[0].primary = false;
    const issues = validateConfiguration(c);
    expect(issues.filter((i) => i.severity === 'warning').map((i) => i.path)).toEqual(['audio.sources.0']);
    expect(issues.filter((i) => i.severity === 'error').map((i) => i.path)).toEqual(['listening']);
  });
});
