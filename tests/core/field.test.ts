import { describe, expect, it } from 'vitest';
import { listenerHeatmap, subHeatmap } from '../../src/core/field';
import { evaluateSetup } from '../../src/core/system';
import { defaultConstraints, defaultRoom, defaultSetup, defaultSources } from '../../src/state/project';

const room = defaultRoom();
const sources = defaultSources(2, 1);
const c = defaultConstraints(room);
const setup = defaultSetup(room, sources, c);

describe('карта мест слушателя', () => {
  const h = listenerHeatmap(room, sources, c, setup);

  it('3 лучшие точки, разнесены ≥ 0,4 м, отсортированы', () => {
    expect(h.best.length).toBe(3);
    for (let i = 0; i < 3; i++)
      for (let j = i + 1; j < 3; j++)
        expect(Math.hypot(h.best[i].pos.x - h.best[j].pos.x, h.best[i].pos.y - h.best[j].pos.y)).toBeGreaterThanOrEqual(0.4 - 1e-9);
    expect(h.best[0].score).toBeLessThanOrEqual(h.best[1].score);
  });

  it('лучшая точка не хуже текущего места (с допуском привязки к сетке)', () => {
    expect(h.best[0].score).toBeLessThanOrEqual(h.current + 0.3);
  });

  it('текущая оценка совпадает с evaluateSetup на той же сетке частот', () => {
    const e = evaluateSetup(room, sources, c, setup, { ppo: 12 });
    expect(h.current).toBeCloseTo(e.score, 6);
  });

  it('точки в зоне «нельзя сидеть» не оцениваются', () => {
    const zr = { ...room, zones: [{ id: 'z', kind: 'furniture' as const, x0: 2, x1: 3.5, y0: 1, y1: 3, canSit: false }] };
    const hz = listenerHeatmap(zr, sources, c, setup);
    expect(hz.best.length).toBe(3);
    for (const b of hz.best) expect(b.pos.x >= 2 && b.pos.x <= 3.5 && b.pos.y >= 1 && b.pos.y <= 3).toBe(false);
    const cell = (x: number, y: number) => Math.round((x - hz.x0) / hz.step) * hz.ny + Math.round((y - hz.y0) / hz.step);
    expect(Number.isNaN(hz.scores[cell(2.5, 2)])).toBe(true);
    expect(hz.allowed[cell(2.5, 2)]).toBe(0);
    // вне зоны точка оценивается, как и без зоны
    expect(hz.scores[cell(1.5, 2)]).toBeCloseTo(h.scores[cell(1.5, 2)], 9);
    expect(Number.isFinite(h.scores[cell(2.5, 2)])).toBe(true);
  });
});

describe('карта мест сабвуфера', () => {
  const h = subHeatmap(room, sources, c, setup, 'sub1');

  it('лучшая точка — минимум среди допустимых и не хуже текущего положения', () => {
    let min = Infinity;
    h.scores.forEach((v, i) => { if (h.allowed[i] && v < min) min = v; });
    expect(h.best[0].score).toBeCloseTo(min, 6);
    expect(h.best[0].score).toBeLessThanOrEqual(h.current + 1e-6);
  });

  it('зона «углы» — рекомендации только в углах', () => {
    const hc = subHeatmap(room, sources, { ...c, subZone: 'corners' }, setup, 'sub1');
    expect(hc.best.length).toBe(3);
    // допустимы только узлы у двух стен сразу (не дальше 0,5 м), и такие узлы есть
    let corners = 0, others = 0;
    for (let i = 0; i < hc.nx; i++)
      for (let j = 0; j < hc.ny; j++) {
        const x = hc.x0 + i * hc.step, y = hc.y0 + j * hc.step;
        const near = Math.min(x, room.depth - x) <= 0.5 + 1e-9 && Math.min(y, room.width - y) <= 0.5 + 1e-9;
        if (hc.allowed[i * hc.ny + j]) { if (near) corners++; else others++; }
      }
    expect(others).toBe(0);
    expect(corners).toBeGreaterThanOrEqual(4);
    for (const b of hc.best) {
      expect(Math.min(b.pos.x, room.depth - b.pos.x)).toBeLessThanOrEqual(0.5 + 1e-9);
      expect(Math.min(b.pos.y, room.width - b.pos.y)).toBeLessThanOrEqual(0.5 + 1e-9);
    }
  });

  it('строится быстро (< 3 с даже в тестовой среде)', () => {
    expect(h.elapsedMs).toBeLessThan(3000);
  });
});
