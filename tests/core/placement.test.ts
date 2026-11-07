import { describe, expect, it } from 'vitest';
import { optimizePlacement, baselinePlacement } from '../../src/core/placement';
import { defaultConstraints, defaultRoom, defaultSources } from '../../src/state/project';
import { PlacementError, type Placement, type Constraints, type Room } from '../../src/core/types';

const room = defaultRoom();
const sources = defaultSources(2, 1);
const constraints = defaultConstraints(room);

function checkConstraints(p: Placement, r: Room, c: Constraints) {
  for (const s of p.sources) {
    expect(s.pos.x).toBeGreaterThanOrEqual(0);
    expect(s.pos.x).toBeLessThanOrEqual(r.depth);
    expect(s.pos.y).toBeGreaterThanOrEqual(0);
    expect(s.pos.y).toBeLessThanOrEqual(r.width);
    if (s.id.startsWith('spk')) {
      expect(s.pos.x).toBeGreaterThanOrEqual(c.speakerMinFront - 1e-9);
      expect(s.pos.y).toBeGreaterThanOrEqual(c.speakerMinSide - 1e-9);
      expect(r.width - s.pos.y).toBeGreaterThanOrEqual(c.speakerMinSide - 1e-9);
    }
  }
  expect(p.listener.x).toBeGreaterThanOrEqual(c.listenerMinX - 1e-9);
  expect(p.listener.x).toBeLessThanOrEqual(c.listenerMaxX + 1e-9);
}

describe('optimizePlacement', () => {
  const res = optimizePlacement({ room, sources, constraints });

  it('возвращает до 3 вариантов, удовлетворяющих ограничениям', () => {
    expect(res.best.length).toBe(3);
    for (const p of res.best) checkConstraints(p, room, constraints);
    expect(res.best[0].score).toBeLessThanOrEqual(res.best[1].score);
  });

  it('лучший вариант не хуже базового', () => {
    expect(res.best[0].score).toBeLessThanOrEqual(res.baseline.score);
  });

  it('детерминирован', () => {
    const again = optimizePlacement({ room, sources, constraints });
    expect(again.best[0]).toEqual(res.best[0]);
  });

  it('стерео-пара симметрична, угол раскрытия посчитан', () => {
    const p = res.best[0];
    const l = p.sources.find((s) => s.id === 'spkL')!.pos;
    const r = p.sources.find((s) => s.id === 'spkR')!.pos;
    expect(l.x).toBeCloseTo(r.x, 9);
    expect(l.y + r.y).toBeCloseTo(room.width, 9);
    expect(p.angleDeg).not.toBeNull();
  });

  it('диапазон сабвуфера влияет на оценку', () => {
    const wide = sources.map((s) => (s.kind === 'sub' ? { ...s, fHigh: 120 } : { ...s, fLow: 120 }));
    const res2 = optimizePlacement({ room, sources: wide, constraints });
    expect(res2.best[0].score).not.toBeCloseTo(res.best[0].score, 3);
  });

  it('сабвуферы в зоне «углы» стоят в углах', () => {
    const c2 = { ...constraints, subZone: 'corners' as const };
    const r2 = optimizePlacement({ room, sources, constraints: c2 });
    const sub = r2.best[0].sources.find((s) => s.id === 'sub1')!.pos;
    const nearX = Math.min(sub.x, room.depth - sub.x);
    const nearY = Math.min(sub.y, room.width - sub.y);
    expect(nearX).toBeCloseTo(c2.subWallGap, 6);
    expect(nearY).toBeCloseTo(c2.subWallGap, 6);
  });

  it('два сабвуфера: подбор работает и не хуже одного', () => {
    const r2 = optimizePlacement({ room, sources: defaultSources(2, 2), constraints });
    expect(r2.best[0].sources.filter((s) => s.id.startsWith('sub')).length).toBe(2);
    expect(r2.best[0].scoreCenter).toBeLessThanOrEqual(res.best[0].scoreCenter + 0.5);
  });

  it('невыполнимые ограничения → PlacementError', () => {
    const bad = { ...constraints, listenerMinX: 4.8, listenerMaxX: 4.9 };
    expect(() => optimizePlacement({ room: { ...room, depth: 5 }, sources, constraints: { ...bad, speakerMinFront: 4.5 } })).toThrow(PlacementError);
  });

  it('базовый вариант: сабвуфер в переднем углу, слушатель на 38 % глубины', () => {
    const b = baselinePlacement(room, sources, constraints);
    expect(b.listener.x).toBeCloseTo(0.38 * room.depth, 6);
    const sub = b.sources.find((s) => s.id === 'sub1')!.pos;
    expect(sub.x).toBeLessThan(0.5);
  });
});

describe('места и зоны в автоподборе', () => {
  it('три места: все внутри комнаты, оценка по местам', () => {
    const c3 = { ...constraints, seats: { count: 3, spacing: 0.6 } };
    const r = optimizePlacement({ room, sources, constraints: c3 });
    expect(r.best[0].seats.length).toBe(3);
    for (const s of r.best[0].seats) { expect(s.y).toBeGreaterThan(0); expect(s.y).toBeLessThan(room.width); }
  });

  it('зона на лучшем месте сабвуфера → сабвуфер ставится в другом месте', () => {
    const r1 = optimizePlacement({ room, sources, constraints });
    const p = r1.best[0].sources.find((s) => s.id === 'sub1')!.pos;
    const zr = { ...room, zones: [{ id: 'z', kind: 'furniture' as const, x0: Math.max(0, p.x - 0.4), x1: Math.min(room.depth, p.x + 0.4), y0: Math.max(0, p.y - 0.4), y1: Math.min(room.width, p.y + 0.4), canSit: false }] };
    const r2 = optimizePlacement({ room: zr, sources, constraints });
    for (const v of r2.best) {
      const q = v.sources.find((s) => s.id === 'sub1')!.pos;
      const inside = q.x >= zr.zones[0].x0 && q.x <= zr.zones[0].x1 && q.y >= zr.zones[0].y0 && q.y <= zr.zones[0].y1;
      if (v !== r2.baseline) expect(inside).toBe(false);
    }
  });
});
