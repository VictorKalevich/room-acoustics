import { describe, expect, it } from 'vitest';
import { roomModel, quadNormal, type Quad } from '../../src/core/roomModel';
import { ceilingAt } from '../../src/core/geometry';
import { clearedRoom, emptyRoom, newProject } from '../../src/state/project';
import type { Room } from '../../src/core/types';

const room = (patch: Partial<Room> = {}): Room => ({ ...emptyRoom(), ...patch });
/** Площадь четырёхугольника (две половинки). */
const area = (q: Quad) => {
  const [a, b, c, d] = q.pts;
  const tri = (p: number[], r: number[], s: number[]) => {
    const u = [r[0] - p[0], r[1] - p[1], r[2] - p[2]], v = [s[0] - p[0], s[1] - p[1], s[2] - p[2]];
    return Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]) / 2;
  };
  return tri(a, b, c) + tri(a, c, d);
};
const sumArea = (qs: Quad[]) => qs.reduce((s, q) => s + area(q), 0);
const centre = (q: Quad) => [0, 1, 2].map((k) => q.pts.reduce((s, p) => s + p[k], 0) / 4);

describe('модель комнаты без скана', () => {
  it('пустая комната: пол и четыре стены, без потолка; стены смотрят внутрь', () => {
    const r = room();
    const m = roomModel(r);
    expect(m.filter((q) => q.kind === 'floor')).toHaveLength(1);
    const walls = m.filter((q) => q.kind === 'wall' || q.kind === 'front');
    expect(walls).toHaveLength(4);
    expect(m.filter((q) => q.kind === 'front')).toHaveLength(1);
    // ничего горизонтального на высоте потолка
    expect(m.some((q) => q.pts.every((p) => Math.abs(p[2] - r.height) < 1e-9))).toBe(false);
    // площадь стен — периметр × высота
    expect(sumArea(walls)).toBeCloseTo(2 * (r.depth + r.width) * r.height, 9);
    // нормаль каждой стены — к центру комнаты
    for (const q of walls) {
      const n = quadNormal(q), c = centre(q);
      const toMid = [r.depth / 2 - c[0], r.width / 2 - c[1], 0];
      expect(n[0] * toMid[0] + n[1] * toMid[1]).toBeGreaterThan(0);
    }
    const floor = m.find((q) => q.kind === 'floor')!;
    expect(quadNormal(floor)[2]).toBeGreaterThan(0);
  });

  it('проём вырезан из стены, над ним — перемычка; окно и дверь — на стене, чуть внутри', () => {
    const r = room({
      openings: [{ id: 'o', wall: 'right', a0: 1, a1: 2, height: 2.1 }],
      features: [
        { id: 'w', kind: 'window', wall: 'left', a0: 1, a1: 2.2, bottom: 0.9, top: 2.3 },
        { id: 'd', kind: 'door', wall: 'back', a0: 0.3, a1: 1.2, bottom: 0, top: 2.1 },
      ],
    });
    const m = roomModel(r);
    const right = m.filter((q) => q.kind === 'wall' && q.pts.every((p) => Math.abs(p[1] - r.width) < 1e-9));
    expect(right).toHaveLength(3);
    expect(sumArea(right)).toBeCloseTo(r.depth * r.height - 1 * 2.1, 9);
    const win = m.find((q) => q.kind === 'window')!;
    expect(area(win)).toBeCloseTo(1.2 * 1.4, 9);
    expect(win.pts.every((p) => p[1] > 0 && p[1] < 0.02)).toBe(true);
    const door = m.find((q) => q.kind === 'door')!;
    expect(Math.min(...door.pts.map((p) => p[2]))).toBe(0);
    expect(door.pts.every((p) => p[0] < r.depth && p[0] > r.depth - 0.02)).toBe(true);
  });

  it('проём во всю высоту делит стену на две части', () => {
    const m = roomModel(room({ openings: [{ id: 'o', wall: 'front', a0: 1, a1: 2, height: 2.7 }] }));
    expect(m.filter((q) => q.kind === 'front')).toHaveLength(2);
  });

  it('скос: у его стены стена ниже, у боковых верх идёт по наклону; сам скос — наклонная плоскость', () => {
    const r = room({ slope: { wall: 'front', low: 1.2, run: 1.5 } });
    const m = roomModel(r);
    const front = m.filter((q) => q.kind === 'front');
    expect(Math.max(...front.flatMap((q) => q.pts.map((p) => p[2])))).toBeCloseTo(1.2, 9);
    const left = m.filter((q) => q.kind === 'wall' && q.pts.every((p) => p[1] === 0));
    for (const q of left) for (const p of q.pts) if (p[2] > 0) expect(p[2]).toBeCloseTo(ceilingAt(r, p[0], 0), 9);
    expect(sumArea(left)).toBeCloseTo(r.depth * r.height - (1.5 * 1.5) / 2, 9);
    const slope = m.find((q) => q.kind === 'slope')!;
    expect(area(slope)).toBeCloseTo(r.width * Math.hypot(1.5, 1.5), 9);
  });

  it('коридор: пол и стены за аркой, открытый конец не рисуется, коридор за углом — со своей стеной', () => {
    const base = { id: 'e', name: 'Коридор', wall: 'right' as const, a0: -1, a1: 4, depth: 1.2, height: 2.5, arch: { a0: 1, a1: 2.4, height: 2.1 }, openStart: false, openEnd: false, openFar: false };
    const r = room({ extensions: [base] });
    const m = roomModel(r);
    // в стене комнаты — арка: три куска со стороны комнаты
    const roomSide = m.filter((q) => q.kind === 'wall' && q.pts.every((p) => Math.abs(p[1] - r.width) < 1e-9) && quadNormal(q)[1] < 0);
    expect(roomSide).toHaveLength(3);
    expect(sumArea(roomSide)).toBeCloseTo(r.depth * r.height - 1.4 * 2.1, 9);
    const floors = m.filter((q) => q.kind === 'floor');
    expect(floors).toHaveLength(2);
    expect(sumArea(floors)).toBeCloseTo(r.depth * r.width + 5 * 1.2, 9);
    // стены коридора: торцы, дальняя, общая со стороны коридора и кусок за углом
    const corridorWalls = m.filter((q) => q.kind === 'wall' && q.pts.some((p) => p[1] > r.width + 1e-9 || p[0] < -1e-9));
    const open = roomModel(room({ extensions: [{ ...base, openEnd: true, openFar: true }] }));
    const openWalls = open.filter((q) => q.kind === 'wall' && q.pts.some((p) => p[1] > r.width + 1e-9 || p[0] < -1e-9));
    expect(sumArea(corridorWalls) - sumArea(openWalls)).toBeCloseTo(1.2 * 2.5 + 5 * 2.5, 9);
    // кусок общей плоскости за углом комнаты (x от −1 до 0) — стена коридора
    expect(corridorWalls.some((q) => q.pts.every((p) => Math.abs(p[1] - r.width) < 1e-9) && q.pts.some((p) => p[0] < 0))).toBe(true);
  });
});

describe('очистка комнаты', () => {
  it('пустая комната 4 × 3 × 2,7 м; колонки и слушатель — по умолчанию; система, цель и варианты остаются', () => {
    const p = newProject();
    p.room = { ...p.room, source: 'scan', openings: [{ id: 'o', wall: 'right', a0: 1, a1: 2, height: 2 }], treatments: [{ id: 't', kind: 'cloud', thickness: 0.1, width: 1, height: 1 }], treatmentsOn: true, materials: { ...p.room.materials, floor: 'carpet-thick' } };
    p.constraints = { ...p.constraints, objective: { id: 'lowDips' }, earHeight: 1.2 };
    p.setups = [{ ...p.current, id: 's1', name: 'Вариант' }];
    p.current = { ...p.current, listener: { x: 9, y: 9, z: 1.2 } };
    const c = clearedRoom(p);
    expect(c.room).toEqual(emptyRoom());
    expect([c.room.depth, c.room.width, c.room.height]).toEqual([4, 3, 2.7]);
    expect(c.scanInfo).toBeNull();
    expect(c.result).toBeNull();
    expect(c.constraints!.objective).toEqual({ id: 'lowDips' });
    expect(c.constraints!.earHeight).toBe(1.2);
    expect(c.constraints!.listenerMaxX).toBeLessThan(4);
    expect(c.current!.listener.x).toBeLessThan(4);
    expect(c.current!.listener.y).toBeLessThan(3);
    expect(c.setups).toBeUndefined();
    expect(c.sources).toBeUndefined();
  });
});
