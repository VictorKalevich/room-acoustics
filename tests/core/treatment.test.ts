import { describe, expect, it } from 'vitest';
import { bassAdvice, porousLowLimit, reflectionPoints } from '../../src/core/treatment';
import { computeModes } from '../../src/core/modes';
import { defaultRoom } from '../../src/state/project';

const room = defaultRoom();

describe('точки первых отражений', () => {
  const L = { x: 2.5, y: 2, z: 1.1 };
  const r = reflectionPoints(room, [{ id: 'spkL', pos: { x: 0.5, y: 1, z: 1 } }, { id: 'spkR', pos: { x: 0.5, y: 3, z: 1 } }], L);

  it('симметричная пара даёт зеркальные точки на левой и правой стенах', () => {
    const lL = r.find((p) => p.speakerId === 'spkL' && p.surface === 'left')!.point;
    const rR = r.find((p) => p.speakerId === 'spkR' && p.surface === 'right')!.point;
    expect(lL.x).toBeCloseTo(rR.x, 9);
    expect(lL.y).toBe(0);
    expect(rR.y).toBe(room.width);
  });

  it('совпадает с методом мнимого источника: равенство углов падения и отражения', () => {
    const p = r.find((q) => q.speakerId === 'spkL' && q.surface === 'left')!.point;
    // x = xs + (xl - xs) * ys / (ys + yl) = 0.5 + 2 * 1/3
    expect(p.x).toBeCloseTo(0.5 + 2 / 3, 9);
    const c = r.find((q) => q.speakerId === 'spkL' && q.surface === 'ceiling')!.point;
    expect(c.z).toBe(room.height);
  });

  it('передняя и задняя стены: точки есть у каждой колонки, углы падения и отражения равны', () => {
    expect(r.filter((q) => q.speakerId === 'spkL').map((q) => q.surface).sort()).toEqual(['back', 'ceiling', 'front', 'left', 'right']);
    const s = { x: 0.5, y: 1, z: 1 };
    const f = r.find((q) => q.speakerId === 'spkL' && q.surface === 'front')!.point;
    const b = r.find((q) => q.speakerId === 'spkL' && q.surface === 'back')!.point;
    expect(f.x).toBe(0);
    expect(b.x).toBe(room.depth);
    // угол к нормали стены: tg = смещение вдоль стены / расстояние до стены — одинаковый для падающего и отражённого лучей
    const tan = (p: { y: number; z: number }, from: { x: number; y: number; z: number }, dist: number) => Math.hypot(p.y - from.y, p.z - from.z) / dist;
    expect(tan(f, s, s.x)).toBeCloseTo(tan(f, L, L.x), 9);
    expect(tan(b, s, room.depth - s.x)).toBeCloseTo(tan(b, L, room.depth - L.x), 9);
  });

  it('точка на окне отмечается, но помечается «на окне»; в предложенный план панель на окно не ставится', async () => {
    const { suggestTreatments } = await import('../../src/core/treatments');
    const b0 = r.find((q) => q.speakerId === 'spkL' && q.surface === 'back')!.point;
    const withWin = { ...room, features: [{ id: 'w', kind: 'window' as const, wall: 'back' as const, a0: b0.y - 0.5, a1: b0.y + 0.5, bottom: 0.5, top: 2 }] };
    const rw = reflectionPoints(withWin, [{ id: 'spkL', pos: { x: 0.5, y: 1, z: 1 } }], L);
    expect(rw.find((q) => q.surface === 'back')!.on).toBe('window');
    expect(rw.find((q) => q.surface === 'left')!.on).toBeNull();
    let n = 0;
    const plan = suggestTreatments(withWin, rw, () => `t${n++}`);
    const panels = plan.filter((t) => t.kind === 'panel');
    expect(panels.map((t) => t.wall).sort()).toEqual(['front', 'left', 'right']);
    // на передней стене панель стоит по ширине (координата y), а не по глубине
    expect(panels.find((t) => t.wall === 'front')!.at).toBeCloseTo(rw.find((q) => q.surface === 'front')!.point.y, 9);
  });
});

describe('басовые ловушки', () => {
  it('пик на частоте осевой моды по глубине → рекомендация у передней и задней стен', () => {
    const modes = computeModes(room, 200);
    const f0 = modes[0].f; // 34,3 Гц, (1,0,0)
    const f = Array.from({ length: 60 }, (_, i) => 20 * Math.pow(2, i / 24));
    const db = f.map((x) => 9 * Math.exp(-((Math.log2(x / f0) / 0.05) ** 2)));
    const adv = bassAdvice({ f, db, target: f.map(() => 0) }, modes);
    expect(adv[0].modes[0].n).toEqual([1, 0, 0]);
    expect(adv[0].where).toMatch(/передней и задней/);
  });

  it('пористая панель 10 см с зазором 10 см работает от ≈ 430 Гц', () => {
    expect(porousLowLimit(0.1, 0.1)).toBeCloseTo(428.75, 1);
  });
});
