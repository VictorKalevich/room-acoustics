import { describe, expect, it } from 'vitest';
import { analyzeLayout, type ScanLabels } from '../../src/scan/layout';
import { defaultChoice, scanRoom } from '../../src/scan/apply';
import { fitRoomObjects } from '../../src/core/fitRoom';
import { defaultRoom } from '../../src/state/project';

// 048: размеры комнаты из скана — в миллиметрах (стены по шумному скану), разметка RoomPlan — до сантиметра.
// Стол у задней стены, шкаф до потолка у правой и окно в углу заходят за стены на миллиметры; до 048 край,
// округлённый вверх после обрезки по стене, оставался за ней на 1–5 мм, и конструктор сообщал «за стенами».
type P = [number, number, number];
const D = 4.137, W = 3.627, H = 2.537;
const tris: number[] = [];
const ids: number[] = [];
const objects: ScanLabels['objects'] = [];
const names: string[] = [];
const quad = (a: P, b: P, c: P, d: P, id = 0) => { tris.push(...a, ...b, ...c, ...a, ...c, ...d); ids.push(id, id); };
function box(x0: number, x1: number, y0: number, y1: number, z1: number, id: number) {
  quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], id);
  quad([x0, y0, 0], [x1, y0, 0], [x1, y0, z1], [x0, y0, z1], id);
  quad([x0, y1, 0], [x1, y1, 0], [x1, y1, z1], [x0, y1, z1], id);
  quad([x0, y0, 0], [x0, y1, 0], [x0, y1, z1], [x0, y0, z1], id);
  quad([x1, y0, 0], [x1, y1, 0], [x1, y1, z1], [x1, y0, z1], id);
}
quad([0, 0, 0], [0, W, 0], [0, W, H], [0, 0, H]);
quad([D, 0, 0], [D, W, 0], [D, W, H], [D, 0, H]);
quad([0, 0, 0], [D, 0, 0], [D, 0, H], [0, 0, H]);
quad([0, W, 0], [D, W, 0], [D, W, H], [0, W, H]);
quad([0, 0, 0], [D, 0, 0], [D, W, 0], [0, W, 0]);
quad([0, 0, H], [D, 0, H], [D, W, H], [0, W, H]);
objects.push('furniture'); names.push('table'); box(3.337, 4.157, 1, 2.2, 0.75, 1);
objects.push('furniture'); names.push('storage'); box(1, 1.6, 3.03, 3.633, 2.541, 2);
objects.push('window'); quad([D, 2.6, 0.9], [D, 3.631, 0.9], [D, 3.631, 2.539], [D, 2.6, 2.539], 3);
const raw = new Float32Array(tris);
const labels: ScanLabels = { ids: Uint16Array.from(ids), objects, names };
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

describe('048: найденное в скане — внутри стен комнаты', () => {
  const lay = analyzeLayout(raw, identity, { depth: D, width: W, height: H }, labels);

  it('мебель и окно в разметке не выходят за стены и потолок', () => {
    expect(lay.furniture).toHaveLength(2);
    for (const f of lay.furniture) {
      expect(f.x0).toBeGreaterThanOrEqual(0);
      expect(f.x1).toBeLessThanOrEqual(D);
      expect(f.y1).toBeLessThanOrEqual(W);
      expect(f.top).toBeLessThanOrEqual(H);
    }
    expect(lay.furniture[0]).toMatchObject({ x0: 3.34, x1: D, y0: 1, y1: 2.2, top: 0.75 });
    expect(lay.furniture[1]).toMatchObject({ y1: W, top: H });
    expect(lay.windows).toEqual([{ wall: 'back', a0: 2.6, a1: W, bottom: 0.9, top: H }]);
  });

  it('применённая комната без объектов за стенами — даже на миллиметр', () => {
    let n = 0;
    const room = scanRoom(defaultRoom(), defaultChoice(lay, H, { x0: 0, x1: D, y0: 0, y1: W }), 'first',
      { furniture: () => 'Стол', corridor: 'Коридор', id: () => `s${++n}` });
    expect(room.zones.filter((z) => z.fromScan)).toHaveLength(2);
    const f = fitRoomObjects(room);
    expect(f.removed).toEqual([]);
    expect(f.trimmed).toEqual([]);
    expect(f.room).toBe(room);
  });
});
