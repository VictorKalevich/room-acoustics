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
    expect(g1.h).toBe(g0.h);
    // узлов меньше настолько, насколько меньше объём, и ни одного узла над наклонным потолком
    expect(g1.N / g0.N).toBeCloseTo(roomVolume(room) / roomVolume(p.room), 1);
    let above = 0;
    for (let n = 0; n < g1.N; n++) {
      const cell = g1.nodeCell[n];
      const x = g1.x0 + (cell % g1.nx) * g1.h, y = g1.y0 + (Math.floor(cell / g1.nx) % g1.ny) * g1.h, z = g1.z0 + Math.floor(cell / (g1.nx * g1.ny)) * g1.h;
      if (z > ceilingAt(room, x, y) + 1e-9) above++;
    }
    expect(above).toBe(0);
  });
  it('поворот переносит скос к другой стене', () => {
    expect(rotateRoom(room).slope!.wall).toBe('right');
  });
});
