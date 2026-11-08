import { describe, expect, it } from 'vitest';
import { newProject, rotateRoom, makeId } from '../../src/state/project';
import { computeModes } from '../../src/core/modes';
import { computeReverb } from '../../src/core/reverb';
import { modeDecays } from '../../src/core/overview';
import { porousAlpha, suggestTreatments } from '../../src/core/treatments';
import { buildGrid } from '../../src/core/fdtd';

describe('обработка', () => {
  const p = newProject();
  it('толще — лучше на низах', () => {
    expect(porousAlpha(0.3)[0]).toBeGreaterThan(porousAlpha(0.1)[0]);
    expect(porousAlpha(0.1, 0.1)[1]).toBeGreaterThan(porousAlpha(0.1)[1]);
  });
  it('угловые ловушки сокращают затухание мод и RT60, только когда включены', () => {
    const modes = computeModes(p.room, 200);
    const base = modeDecays(p.room, modes, computeReverb(p.room), 150);
    const plan = suggestTreatments(p.room, [], makeId);
    const off = { ...p.room, treatments: plan, treatmentsOn: false };
    const on = { ...p.room, treatments: plan, treatmentsOn: true };
    expect(modeDecays(off, modes, computeReverb(off), 150)[0].t60).toBeCloseTo(base[0].t60, 6);
    const d1 = modeDecays(on, modes, computeReverb(on), 150);
    expect(d1[0].t60).toBeLessThan(base[0].t60 * 0.9);
    expect(computeReverb(on).tMid).toBeLessThan(computeReverb(p.room).tMid);
  });
  it('волновая модель видит обработку (другой ключ сетки, больше поглощение)', () => {
    const plan = suggestTreatments(p.room, [], makeId);
    const g0 = buildGrid(p.room, 120);
    const g1 = buildGrid({ ...p.room, treatments: plan, treatmentsOn: true }, 120);
    expect(g1.key).not.toBe(g0.key);
  });
  it('поворот комнаты 4 раза возвращает план', () => {
    const plan = suggestTreatments(p.room, [{ surface: 'left', point: { x: 1.5, y: 0, z: 1.1 } }, { surface: 'ceiling', point: { x: 1.4, y: 2, z: 2.5 } }], makeId);
    const r = { ...p.room, treatments: plan };
    const back = rotateRoom(rotateRoom(rotateRoom(rotateRoom(r))));
    expect(back.treatments!.map((t) => [t.corner, t.wall, +(t.at ?? 0).toFixed(6), +(t.x ?? 0).toFixed(6)])).toEqual(plan.map((t) => [t.corner, t.wall, +(t.at ?? 0).toFixed(6), +(t.x ?? 0).toFixed(6)]));
  });
});
