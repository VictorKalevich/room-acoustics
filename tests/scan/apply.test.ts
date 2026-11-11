import { describe, expect, it } from 'vitest';
import { defaultChoice, fixScan, scanProblem, scanRoom, shiftRoom, type ScanChoice, type ScanNames } from '../../src/scan/apply';
import type { LayoutResult } from '../../src/scan/layout';
import { defaultRoom, newProject, rotateRoom, rotateSetup } from '../../src/state/project';
import type { Covering, Room, Zone } from '../../src/core/types';
import { thinScan } from '../../src/state/storage';

let seq = 0;
const names: ScanNames = { furniture: (n) => `мебель ${n}`, corridor: 'Коридор', id: () => `id${++seq}` };
const layout = (o: Partial<LayoutResult> = {}): LayoutResult => ({
  outline: new Float32Array(), bounds: { x0: 0, x1: 6, y0: 0, y1: 5 },
  openings: [], windows: [], furniture: [], coverage: { front: 1, back: 1, left: 1, right: 1 }, labeled: true, extension: null, ...o,
});
/** Скан 6 × 5 м: дверь на задней стене, окно на левой, диван у задней стены. */
const scanLayout = layout({
  openings: [{ wall: 'back', a0: 0.5, a1: 1.3, height: 2, kind: 'door' }],
  windows: [{ wall: 'left', a0: 2, a1: 3.3, bottom: 0.9, top: 2.3 }],
  furniture: [{ name: 'sofa', x0: 5, x1: 5.9, y0: 1.5, y1: 3.5, top: 0.85 }],
});
const choice = (rect = { x0: 0, x1: 6, y0: 0, y1: 5 }, l = scanLayout): ScanChoice => defaultChoice(l, 2.6, rect);

describe('применение скана (020)', () => {
  it('первое применение: размеры, найденное с пометкой «из скана», типы и высота мебели', () => {
    const r = scanRoom(defaultRoom(), choice(), 'first', names);
    expect([r.depth, r.width, r.height, r.source]).toEqual([6, 5, 2.6, 'scan']);
    expect(r.features!.map((f) => [f.kind, f.wall, f.fromScan])).toEqual([['door', 'back', true], ['window', 'left', true]]);
    expect(r.zones.map((z) => [z.furniture, z.height, z.canSit, z.fromScan])).toEqual([['sofa', 0.85, true, true]]);
  });

  it('первое применение без найденных проёмов сохраняет введённое вручную', () => {
    const manual: Room = { ...defaultRoom(), features: [{ id: 'm', kind: 'window', wall: 'front', a0: 1, a1: 2, bottom: 1, top: 2 }] };
    const r = scanRoom(manual, choice(undefined, layout()), 'first', names);
    expect(r.features!.map((f) => f.id)).toEqual(['m']);
  });

  it('явно неверное распознавание не применяется', () => {
    expect(scanProblem({ depth: 5, width: 4, height: 2.5 })).toBeNull();
    expect(scanProblem({ depth: 500, width: 400, height: 250 })).not.toBeNull();
    expect(scanProblem({ depth: 0.05, width: 0.04, height: 0.025 })).not.toBeNull();
  });

  it('сдвиг начала координат оставляет ручные предметы на месте и обрезает лишнее', () => {
    const rug: Covering = { id: 'r', kind: 'carpet', grade: 'thick', surface: 'floor', u0: 2, u1: 4, v0: 1, v1: 3 };
    const curtain: Covering = { id: 'c', kind: 'curtain', grade: 'heavy', surface: 'left', u0: 0.5, u1: 2, v0: 0, v1: 2.4 };
    const chair: Zone = { id: 'z', kind: 'furniture', furniture: 'armchair', x0: 0.2, x1: 0.9, y0: 0.2, y1: 0.9, canSit: true };
    const room: Room = { ...defaultRoom(), depth: 6, width: 5, zones: [chair], coverings: [rug, curtain] };
    // передняя стена сдвинута на 1 м вглубь: всё, что было в первом метре, оказалось за стеной
    const s = shiftRoom(room, 1, 0, 5, 5);
    expect(s.zones).toEqual([]);
    expect(s.coverings!.find((c) => c.id === 'r')).toMatchObject({ u0: 1, u1: 3, v0: 1, v1: 3 });
    expect(s.coverings!.find((c) => c.id === 'c')).toMatchObject({ u0: 0, u1: 1 });
  });

  it('поправка границ пересоздаёт найденное, сохраняет ручное, материалы и ковры', () => {
    const first = scanRoom(defaultRoom(), choice(), 'first', names);
    const rug: Covering = { id: 'rug', kind: 'carpet', grade: 'thin', surface: 'floor', u0: 3, u1: 5, v0: 2, v1: 4 };
    const manual: Zone = { id: 'manual', kind: 'furniture', furniture: 'bed', x0: 1, x1: 3, y0: 2.5, y1: 4.1, canSit: true };
    const edited: Room = {
      ...first, materials: { ...first.materials, left: 'brick' }, coverings: [rug],
      zones: [...first.zones.map((z) => ({ ...z, furniture: 'sofa-open' as const })), manual],
    };
    const p = { ...newProject(), room: edited };
    // левая полоса 1 м была коридором вдоль комнаты: левая стена сдвигается вправо
    const fixedRect = { x0: 0, x1: 6, y0: 1, y1: 5 };
    const fixedLayout = layout({ furniture: [{ name: 'sofa', x0: 5, x1: 5.9, y0: 0.5, y1: 2.5, top: 0.85 }] });
    const r = fixScan(p, choice(fixedRect, fixedLayout), { x0: 0, x1: 6, y0: 0, y1: 5 }, 0, names).room;
    expect([r.depth, r.width]).toEqual([6, 4]);
    expect(r.materials.left).toBe('brick');
    // найденное пересоздано (правка типа сброшена), ручное сдвинуто на 1 м и осталось на месте в комнате
    expect(r.zones.filter((z) => z.fromScan).map((z) => z.furniture)).toEqual(['sofa']);
    expect(r.zones.find((z) => z.id === 'manual')).toMatchObject({ y0: 1.5, y1: 3.1 });
    expect(r.coverings!.find((c) => c.id === 'rug')).toMatchObject({ v0: 1, v1: 3 });
    expect(r.features).toEqual([]);
  });

  it('поправка после поворота комнаты: границы в координатах скана, ручное и места остаются на месте', () => {
    const first = scanRoom(defaultRoom(), choice(), 'first', names);
    const manual: Zone = { id: 'manual', kind: 'furniture', furniture: 'bed', x0: 1, x1: 3, y0: 2.5, y1: 4.1, canSit: true };
    const base = { ...newProject(), room: { ...first, zones: [...first.zones, manual] } };
    const listener = { ...base.current, listener: { x: 3, y: 3, z: 1.1 } };
    // поворот после скана
    const rotated = { room: rotateRoom(base.room), current: rotateSetup(base.room, listener), setups: [] };
    const rect = { x0: 0, x1: 6, y0: 1, y1: 5 };
    const fixed = fixScan(rotated, choice(rect, layout()), { x0: 0, x1: 6, y0: 0, y1: 5 }, 1, names);
    // ожидание: та же поправка без поворота, затем поворот
    const plain = fixScan({ room: base.room, current: listener, setups: [] }, choice(rect, layout()), { x0: 0, x1: 6, y0: 0, y1: 5 }, 0, names);
    const expected = rotateRoom(plain.room);
    expect([fixed.room.depth, fixed.room.width]).toEqual([expected.depth, expected.width]);
    expect(fixed.room.zones.find((z) => z.id === 'manual')).toEqual(expected.zones.find((z) => z.id === 'manual'));
    expect(fixed.current.listener).toEqual(rotateSetup(plain.room, plain.current).listener);
  });

  it('скан для хранения облегчается вместе с разметкой', () => {
    const tri = new Float32Array(9 * 10).map((_, i) => i);
    const labels = { ids: Uint16Array.from({ length: 10 }, (_, i) => i), objects: [], names: [] };
    const t = thinScan(tri, labels, 4);
    expect(t.thinned).toBe(true);
    expect(t.triangles.length / 9).toBe(4);
    expect(Array.from(t.labels!.ids)).toEqual([0, 3, 6, 9]);
    expect(Array.from(t.triangles.subarray(9, 18))).toEqual(Array.from(tri.subarray(27, 36)));
    expect(thinScan(tri, labels, 100).thinned).toBe(false);
  });
});
