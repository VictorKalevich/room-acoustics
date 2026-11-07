import { describe, expect, it } from 'vitest';
import { detectRoom } from '../../src/scan/detect';
import { analyzeLayout } from '../../src/scan/layout';
import { makeRoomScan } from '../fixtures/synthetic';

describe('разбор планировки', () => {
  const tri = makeRoomScan({ depth: 5, width: 4, height: 2.5, noise: 0.01, furniture: true, corridor: true, rotationDeg: 20 });
  const det = detectRoom(tri);

  it('основная комната распознаётся без коридора (стена с аркой, а не дальняя стена коридора)', () => {
    expect(Math.abs(det.depth - 5)).toBeLessThan(0.06);
    expect(Math.abs(det.width - 4)).toBeLessThan(0.06);
  });

  it('арка найдена на стене, коридор — за ней (±10 см)', () => {
    const lay = analyzeLayout(tri, det.transform, det);
    expect(lay.extension).not.toBeNull();
    const e = lay.extension!;
    // в координатах распознавания коридор может оказаться за левой или правой стеной
    expect(['left', 'right']).toContain(e.wall);
    expect(Math.abs(e.depth - 1.2)).toBeLessThan(0.1);
    expect(Math.abs(e.arch.a1 - e.arch.a0 - 1.4)).toBeLessThan(0.25);
    expect(Math.abs(e.arch.height - 2.1)).toBeLessThan(0.15);
    expect(Math.abs(e.a1 - e.a0 - 5)).toBeLessThan(0.15);
    // один из торцов открыт, другой закрыт
    expect(e.openStart !== e.openEnd).toBe(true);
    expect(lay.outline.length).toBeGreaterThan(100);
  });

  it('окно (не до пола) не считается проёмом', () => {
    const t2 = makeRoomScan({ depth: 5, width: 4, height: 2.5, noise: 0.005, openings: true });
    const d2 = detectRoom(t2);
    const lay = analyzeLayout(t2, d2.transform, d2);
    // окно 1,0–2,5 м на высоте 0,9–2,1 — не проём; дверь 0,5–1,4 м до 2,0 м — проём
    expect(lay.openings.length).toBe(1);
    expect(lay.openings[0].a1 - lay.openings[0].a0).toBeGreaterThan(0.6);
  });
});
