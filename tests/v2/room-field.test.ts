// V2-051: карты поля на высоте ушей — форма моды со знаком сверена с полем ядра, срез уровня, разница, общая шкала,
// модель расчёта, параметры сетки волновой модели.
import { describe, expect, it } from 'vitest';
import { computeField } from '../../src/core/field3d';
import { speedOfSound } from '../../src/core/physics';
import { toCore, type CoreInputs } from '../../src/v2/adapters/core';
import { diffMap, fieldGeometry, levelMap, modeShapeMap, symmetricRange, thirdOctave, valueAt, waveGridInfo, withModel } from '../../src/v2/application/roomField';
import { buildRoom, DEFAULT_NEW_ROOM } from '../../src/v2/application/rooms';

let n = 0;
const inputs = (): CoreInputs => {
  const r = buildRoom({ ...DEFAULT_NEW_ROOM, name: 'Т', depth: 5.2, width: 3.9, height: 2.6, layout: '2.1' }, () => `i${++n}`, '2026-11-28T10:00:00.000Z');
  const c = toCore(r.current);
  if (!c.ok) throw new Error(c.reason);
  return c.inputs;
};

describe('форма моды (V2-051)', () => {
  it('ψ² совпадает со срезом поля ядра «форма моды», знак меняется через узловую линию', () => {
    const i = inputs();
    for (const m of [[1, 0, 0], [1, 1, 0], [2, 1, 1]] as [number, number, number][]) {
      const res = computeField({ room: i.room, sources: i.sources, setup: i.setup, freqs: [50], kind: 'shape', modes: [m] });
      const z = res.z0 + 7 * res.sz;
      const core = levelMap(res, z);
      const mine = modeShapeMap(i.room, m, z, res.sx);
      expect([mine.nx, mine.ny]).toEqual([core.nx, core.ny]);
      // на сетке центров ячеек среднее cos² по оси с ненулевым индексом — ровно 1/2
      const mean = m.reduce((a, k) => a * (k ? 0.5 : 1), 1);
      for (let k = 0; k < mine.values.length; k += 37) {
        const v = mine.values[k] ** 2;
        if (v < 1e-4) continue;
        expect(10 * Math.log10(v / mean)).toBeCloseTo(core.values[k], 2);
      }
    }
    const s = modeShapeMap({ depth: 4, width: 3, height: 2.5 }, [1, 0, 0], 1.2);
    expect(valueAt(s, { x: 0.2, y: 1 })! > 0 && valueAt(s, { x: 3.8, y: 1 })! < 0).toBe(true);
    expect(Math.abs(valueAt(s, { x: 2, y: 1 })!)).toBeLessThan(0.05);
    expect(valueAt(s, { x: 9, y: 1 })).toBeNull();
  });
});

describe('уровень, разница и шкала (V2-051)', () => {
  it('срез уровня от источников; разница одинаковых — ноль; другая сетка — null; шкала симметрична и ограничена', () => {
    const i = inputs();
    const freqs = thirdOctave(50);
    expect(freqs.length).toBeGreaterThan(4);
    expect(freqs[0]).toBeCloseTo(50 / 2 ** (1 / 6), 6);
    const res = computeField({ room: i.room, sources: i.sources, setup: i.setup, freqs, kind: 'excited' });
    const m = levelMap(res, 1.1);
    expect(m.values.every((v) => Number.isFinite(v))).toBe(true);
    const r = symmetricRange(m);
    expect(r).toBeGreaterThanOrEqual(3);
    expect(r).toBeLessThanOrEqual(20);
    expect(Number.isInteger(r)).toBe(true);
    expect(diffMap(m, m)!.values.every((v) => v === 0)).toBe(true);
    expect(diffMap(m, modeShapeMap(i.room, [1, 0, 0], 1.1, 0.2))).toBeNull();
  });

  it('геометрия поля и принудительная модель', () => {
    const i = inputs();
    expect(fieldGeometry(i.room)).toBe(fieldGeometry({ ...i.room }));
    expect(fieldGeometry(i.room)).not.toBe(fieldGeometry({ ...i.room, slope: { wall: 'front', low: 1.5, run: 1 } }));
    expect(withModel(i, 'wave').room.model).toBe('wave');
    expect(i.room.model).not.toBe('wave');
  });

  it('сетка волновой модели: устойчивость по Куранту и не меньше 10 узлов на длину волны', () => {
    const i = inputs();
    const g = waveGridInfo(withModel(i, 'wave').room, 120);
    expect(g.courant).toBeLessThan(1 / Math.sqrt(3));
    expect(g.dt).toBeCloseTo((g.courant * g.h) / speedOfSound(i.room.temperatureC), 9);
    expect(g.perWave).toBeGreaterThanOrEqual(10);
    expect(g.fMax).toBeGreaterThanOrEqual(120);
    expect(g.steps).toBe(Math.ceil(g.duration / g.dt));
    expect(g.nodes).toBeGreaterThan(1000);
  });
});
