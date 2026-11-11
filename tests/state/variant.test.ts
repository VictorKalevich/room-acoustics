import { describe, expect, it } from 'vitest';
import type { Placement, Treatment } from '../../src/core/types';
import { defaultSetup, newProject } from '../../src/state/project';
import { markPlaced, placementLayout, sameLayout, setupFromPlacement, shouldAdoptBest } from '../../src/state/variant';
import { activeTreatments } from '../../src/core/treatments';

const p = newProject();
const def = defaultSetup(p.room, p.sources, p.constraints);
const ids = p.sources.map((s) => s.id);

function variant(shift: number, extra: Partial<Placement> = {}): Placement {
  return {
    listener: { ...def.listener, x: def.listener.x + shift },
    seats: [],
    sources: ids.map((id) => ({ id, pos: { ...def.positions[id], y: def.positions[id].y + shift } })),
    score: 1, scoreCenter: 1, scoreSeats: 1, penalties: [], angleDeg: null,
    response: { f: [], db: [], target: [] },
    ...extra,
  };
}

describe('варианты расстановки', () => {
  it('одинаковые места — одна расстановка, сдвиг на 1 см — уже другая', () => {
    expect(sameLayout(def, placementLayout(variant(0)))).toBe(true);
    expect(sameLayout(def, placementLayout(variant(0.0004)))).toBe(true);
    expect(sameLayout(def, placementLayout(variant(0.01)))).toBe(false);
  });

  it('лишний или недостающий источник — другая расстановка', () => {
    const v = placementLayout(variant(0));
    const fewer = { ...v, positions: { ...v.positions } };
    delete fewer.positions[ids[0]];
    expect(sameLayout(def, fewer)).toBe(false);
    expect(sameLayout(fewer, def)).toBe(false);
  });

  it('высота не важна: сравнение по плану', () => {
    const v = placementLayout(variant(0));
    v.listener = { ...v.listener, z: v.listener.z + 0.3 };
    expect(sameLayout(def, v)).toBe(true);
  });

  it('применение варианта: места и настройки сабвуферов из варианта, раздел сброшен, имя и замер на месте', () => {
    const cur = { ...def, name: 'Моя', crossoverHz: 80, subSettings: { x: { delayMs: 3, phaseDeg: 0, gainDb: 0 } } };
    const v = variant(0.5, { subSettings: { [ids[ids.length - 1]]: { delayMs: 1.5, phaseDeg: 180, gainDb: -2 } } });
    const s = setupFromPlacement(cur, v);
    expect(s.name).toBe('Моя');
    expect(s.id).toBe(cur.id);
    expect(s.measurement).toBe(cur.measurement);
    expect(s.crossoverHz).toBeNull();
    expect(s.subSettings).toEqual(v.subSettings);
    expect(sameLayout(s, placementLayout(v))).toBe(true);
    // вариант без настроек сабвуферов — настройки сбрасываются, а не остаются от прежних мест
    expect(setupFromPlacement(cur, variant(0.5)).subSettings).toEqual({});
  });

  it('лучший вариант становится текущим, только пока места не выбраны', () => {
    const best = variant(0.4);
    expect(shouldAdoptBest(def, best)).toBe(true);
    expect(shouldAdoptBest(setupFromPlacement(def, variant(0.2)), best)).toBe(false);
    expect(shouldAdoptBest(def, undefined)).toBe(false);
  });

  it('места выбраны после изменения мест; настройки сабвуфера и замер места не выбирают (022)', () => {
    expect(def.placed).toBe(false);
    expect(setupFromPlacement(def, variant(0.2)).placed).toBe(true);
    expect(markPlaced(def, { ...def, listener: { ...def.listener, x: def.listener.x + 0.3 } }).placed).toBe(true);
    expect(markPlaced(def, { ...def, crossoverHz: 90 }).placed).toBe(false);
    expect(markPlaced(def, { ...def, placed: true }).placed).toBe(true);
  });
});

describe('«что если» с обработкой', () => {
  const t = (id: string, enabled?: boolean): Treatment => ({ id, kind: 'corner', thickness: 0.1, width: 0.6, height: 2.4, corner: 'front-left', ...(enabled === undefined ? {} : { enabled }) }) as Treatment;
  it('учитываются только включённые элементы и только при включённом плане', () => {
    const room = { ...p.room, treatments: [t('a'), t('b', false), t('c', true)] };
    expect(activeTreatments({ ...room, treatmentsOn: false })).toEqual([]);
    expect(activeTreatments({ ...room, treatmentsOn: true }).map((x) => x.id)).toEqual(['a', 'c']);
    expect(activeTreatments({ ...room, treatments: undefined, treatmentsOn: true })).toEqual([]);
  });
});
