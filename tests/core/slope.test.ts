import { describe, expect, it } from 'vitest';
import { newProject, rotateRoom } from '../../src/state/project';
import { ceilingAt, effectiveModel, roomVolume } from '../../src/core/geometry';
import { computeReverb, surfaceAreas } from '../../src/core/reverb';
import { buildGrid } from '../../src/core/fdtd';

describe('скос потолка', () => {
  const p = newProject();
  const room = { ...p.room, slope: { wall: 'front' as const, low: 1.2, run: 2 } };
  it('высота и объём', () => {
    expect(ceilingAt(room, 0, 1)).toBeCloseTo(1.2);
    expect(ceilingAt(room, 1, 1)).toBeCloseTo(1.85);
    expect(ceilingAt(room, 3, 1)).toBeCloseTo(2.5);
    expect(roomVolume(room)).toBeCloseTo(5 * 4 * 2.5 - (4 * 2 * 1.3) / 2);
    expect(effectiveModel(room)).toBe('wave');
  });
  it('площади: стена у скоса ниже, потолок больше', () => {
    const a = surfaceAreas(room), b = surfaceAreas(p.room);
    expect(a.front).toBeCloseTo(4 * 1.2);
    expect(a.ceiling).toBeGreaterThan(b.ceiling);
    expect(a.left).toBeLessThan(b.left);
    expect(computeReverb(room).volume).toBeLessThan(computeReverb(p.room).volume);
  });
  it('волновая сетка без воздуха под скосом', () => {
    const g0 = buildGrid(p.room, 120), g1 = buildGrid(room, 120);
    expect(g1.N).toBeLessThan(g0.N);
  });
  it('поворот переносит скос к другой стене', () => {
    expect(rotateRoom(room).slope!.wall).toBe('right');
  });
});
