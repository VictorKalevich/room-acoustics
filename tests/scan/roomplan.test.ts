import { describe, expect, it } from 'vitest';
import { detectRoom } from '../../src/scan/detect';
import { analyzeLayout, type ScanLabels } from '../../src/scan/layout';

// Скан в стиле RoomPlan/Polycam: стены — плиты 10 см из крупных треугольников с дырами под дверь,
// полотно двери и окна — отдельные прямоугольники по оси стены, пол и потолок — плиты.
type P = [number, number, number];
const tris: number[] = [];
const ids: number[] = [];
const objects: ScanLabels['objects'] = [];
function quad(a: P, b: P, c: P, d: P, id = 0) {
  tris.push(...a, ...b, ...c, ...a, ...c, ...d);
  ids.push(id, id);
}
/** Вертикальная грань x = const от y0 до y1, z0..z1, с дырой [hy0, hy1] × [0, hz] (крупные треугольники). */
function wallX(x: number, y0: number, y1: number, z1: number, hole?: [number, number, number]) {
  if (!hole) { quad([x, y0, 0], [x, y1, 0], [x, y1, z1], [x, y0, z1]); return; }
  const [hy0, hy1, hz] = hole;
  quad([x, y0, 0], [x, hy0, 0], [x, hy0, z1], [x, y0, z1]);
  quad([x, hy1, 0], [x, y1, 0], [x, y1, z1], [x, hy1, z1]);
  quad([x, hy0, hz], [x, hy1, hz], [x, hy1, z1], [x, hy0, z1]);
}
function wallY(y: number, x0: number, x1: number, z1: number, hole?: [number, number, number]) {
  if (!hole) { quad([x0, y, 0], [x1, y, 0], [x1, y, z1], [x0, y, z1]); return; }
  const [hx0, hx1, hz] = hole;
  quad([x0, y, 0], [hx0, y, 0], [hx0, y, z1], [x0, y, z1]);
  quad([hx1, y, 0], [x1, y, 0], [x1, y, z1], [hx1, y, z1]);
  quad([hx0, y, hz], [hx1, y, hz], [hx1, y, z1], [hx0, y, z1]);
}
const D = 4.1, W = 3.9, H = 3.1, t = 0.1;
// стены-плиты: внутренняя и внешняя грань
for (const s of [-t / 2, t / 2]) {
  wallX(s, 0, W, H, [1.9, 3.0, 2.4]); // передняя (x = 0), дверь 1,1 × 2,4
  wallX(D + s, 0, W, H, [1.7, 2.25, 1.9]); // задняя, дверь 0,55 × 1,9
  wallY(s, 0, D, H); // левая
  wallY(W + s, 0, D, H); // правая (окно в ней — без дыры до пола)
}
// пол и потолок — плиты
for (const z of [-0.1, 0]) quad([0, 0, z], [D, 0, z], [D, W, z], [0, W, z]);
quad([0, 0, H], [D, 0, H], [D, W, H], [0, W, H]);
// полотна дверей и окно по оси стены
objects.push('door'); quad([0, 1.9, 0], [0, 3.0, 0], [0, 3.0, 2.4], [0, 1.9, 2.4], 1);
objects.push('door'); quad([D, 1.7, 0], [D, 2.25, 0], [D, 2.25, 1.9], [D, 1.7, 1.9], 2);
objects.push('window'); quad([1, W, 0.9], [2, W, 0.9], [2, W, 2.9], [1, W, 2.9], 3);
const raw = new Float32Array(tris);
const labels: ScanLabels = { ids: Uint16Array.from(ids), objects };

describe('скан RoomPlan с плитами и крупными треугольниками', () => {
  const det = detectRoom(raw, { units: 'm' });

  it('высота — до верхней грани плиты пола', () => {
    expect(det.height).toBeCloseTo(H, 1);
    expect(Math.abs(det.height - H)).toBeLessThan(0.03);
  });

  it('двери из разметки находятся точно, лишних проёмов нет', () => {
    const lay = analyzeLayout(raw, det.transform, det, labels);
    expect(lay.openings).toHaveLength(2);
    const widths = lay.openings.map((o) => o.a1 - o.a0).sort((a, b) => a - b);
    expect(widths[0]).toBeCloseTo(0.55, 1);
    expect(widths[1]).toBeCloseTo(1.1, 1);
    expect(lay.openings.every((o) => o.kind === 'door')).toBe(true);
    expect(lay.openings.map((o) => o.height).sort()).toEqual([1.9, 2.4]);
  });

  it('без разметки и полотен дверей: дыры в стенах из крупных треугольников находятся на своих местах', () => {
    const bare = raw.filter((_, i) => labels.ids[Math.floor(i / 9)] === 0);
    const lay = analyzeLayout(bare, det.transform, det);
    // узкая дверь 0,55 м уже порога 0,6 м — не проём; широкая — на своём месте, без ложных дыр
    expect(lay.openings).toHaveLength(1);
    const o = lay.openings[0];
    expect(o.kind).toBe('gap');
    expect(o.a0).toBeGreaterThan(1.7);
    expect(o.a1).toBeLessThan(3.2);
    expect(o.a1 - o.a0).toBeGreaterThan(0.95);
  });
});
