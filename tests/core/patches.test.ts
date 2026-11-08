import { describe, expect, it } from 'vitest';
import { defaultRoom, makeId } from '../../src/state/project';
import { computeReverb } from '../../src/core/reverb';
import { modeDamping } from '../../src/core/response';
import { computeModes } from '../../src/core/modes';
import { cos2Int, patchModeIntegral, roomPatches } from '../../src/core/patches';
import { buildGrid, nearestNode, simulate } from '../../src/core/fdtd';
import type { Room, Treatment } from '../../src/core/types';

const room = defaultRoom(); // 5 × 4 × 2,5, обычная меблировка

describe('участки поверхностей и затухание мод', () => {
  it('∫cos² по отрезку: аналитика совпадает с численным интегралом', () => {
    const k = 2.3, a = 0.4, b = 1.9;
    let s = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) s += Math.cos(k * (a + ((i + 0.5) * (b - a)) / n)) ** 2;
    expect(cos2Int(k, a, b)).toBeCloseTo((s * (b - a)) / n, 6);
    expect(cos2Int(0, a, b)).toBeCloseTo(b - a, 12);
  });

  it('участок на всю стену даёт то же затухание, что материал этой стены', () => {
    // «окно» во всю переднюю стену = передняя стена из стекла
    const glassWall: Room = { ...room, materials: { ...room.materials, front: 'glass' } };
    const asPatch: Room = { ...room, features: [{ id: 'w', kind: 'window', wall: 'front', a0: 0, a1: room.width, bottom: 0, top: room.height }] };
    const r1 = computeReverb(glassWall), r2 = computeReverb(asPatch);
    for (const m of computeModes(room, 120).slice(0, 12)) {
      expect(modeDamping(m, asPatch, r2)).toBeCloseTo(modeDamping(m, glassWall, r1), 6);
    }
    r1.absorptionArea.forEach((a, i) => expect(r2.absorptionArea[i]).toBeCloseTo(a, 6));
  });

  it('панель посреди боковой стены не гасит моду, у которой там узел; угловая ловушка гасит все моды', () => {
    const panel: Treatment = { id: makeId(), kind: 'panel', wall: 'left', at: room.depth / 2, z: room.height / 2, thickness: 0.2, width: 0.6, height: 1.2, enabled: true };
    const corner: Treatment = { id: makeId(), kind: 'corner', corner: 'front-left', thickness: 0.2, width: 0.6, height: 1.2, enabled: true };
    const base = computeReverb(room);
    const with1 = (t: Treatment): Room => ({ ...room, treatments: [t], treatmentsOn: true });
    // мода (1,0,0): узел посередине глубины — панель на x = D/2 почти бесполезна
    const m100 = { n: [1, 0, 0] as [number, number, number], f: 34.3 };
    const d0 = modeDamping(m100, room, base);
    const dPanel = modeDamping(m100, with1(panel), computeReverb(with1(panel)));
    const dCorner = modeDamping(m100, with1(corner), computeReverb(with1(corner)));
    expect(dPanel - d0).toBeLessThan(0.05 * (dCorner - d0));
    expect(dCorner).toBeGreaterThan(d0 * 1.02);
    // мода (2,0,0): посередине пучность — там панель работает
    const m200 = { n: [2, 0, 0] as [number, number, number], f: 68.6 };
    expect(modeDamping(m200, with1(panel), computeReverb(with1(panel)))).toBeGreaterThan(modeDamping(m200, room, base) * 1.01);
  });

  it('угловая ловушка: грань по диагонали угла, площадь = ширина × высота', () => {
    const t: Treatment = { id: makeId(), kind: 'corner', corner: 'back-right', thickness: 0.3, width: 0.6, height: 2, enabled: true };
    const [p] = roomPatches({ ...room, treatments: [t], treatmentsOn: true });
    expect(p.area).toBeCloseTo(1.2, 6);
    expect(p.diag!.ax).toBeCloseTo(room.depth - 0.6 / Math.SQRT2, 6);
    expect(p.diag!.by).toBeCloseTo(room.width - 0.6 / Math.SQRT2, 6);
    // для моды (0,0,0) интеграл ψ² — просто площадь грани
    expect(patchModeIntegral(p, 0, 0, 0)).toBeCloseTo(1.2, 6);
  });

  it('окна и двери из скана добавляют поглощение на низах', () => {
    const r0 = computeReverb(room);
    const r1 = computeReverb({ ...room, features: [{ id: 'w', kind: 'window', wall: 'back', a0: 1, a1: 2.5, bottom: 0.9, top: 2.3 }] });
    expect(r1.absorptionArea[0]).toBeGreaterThan(r0.absorptionArea[0] + 0.4);
    expect(r1.used[0]).toBeLessThan(r0.used[0]);
  });
});

describe('реалистичное время реверберации жилой комнаты', () => {
  // ориентир: меблированные комнаты до 50 м³ — ≈ 0,5 с на средних частотах и ≈ 0,9 с на 50 Гц,
  // пустые — ≈ 2,3–2,5 с (Mašović, Öğüç, Telfor Journal, 2013)
  const feats = [
    { id: 'w', kind: 'window' as const, wall: 'back' as const, a0: 0.8, a1: 2.2, bottom: 0.9, top: 2.33 },
    { id: 'd', kind: 'door' as const, wall: 'left' as const, a0: 3.0, a1: 3.8, bottom: 0, top: 2.0 },
  ];
  const small: Room = { ...room, depth: 4, width: 3.2, height: 2.6, features: feats };

  it('меблированная: 0,45–0,6 с на 500–1000 Гц, 0,7–1,0 с на 63 Гц', () => {
    const r = computeReverb(small);
    expect(r.tMid).toBeGreaterThan(0.45);
    expect(r.tMid).toBeLessThan(0.6);
    expect(r.used[0]).toBeGreaterThan(0.7);
    expect(r.used[0]).toBeLessThan(1.0);
  });

  it('пустая: 2–3,2 с на средних частотах', () => {
    const r = computeReverb({ ...small, furnishing: 'empty' });
    expect(r.tMid).toBeGreaterThan(2);
    expect(r.tMid).toBeLessThan(3.2);
  });

  it('много мягкой мебели: короче обычной', () => {
    expect(computeReverb({ ...small, furnishing: 'heavy' }).tMid).toBeLessThan(computeReverb(small).tMid * 0.8);
  });
});

describe('волновая модель и прямоугольная — одно и то же затухание', () => {
  it('затухание первых мод коробки в FDTD совпадает с δ модальной модели (±10 %)', () => {
    const box: Room = {
      ...defaultRoom(), depth: 3.1, width: 2.4, height: 2.2, furnishing: 'empty',
      materials: { floor: 'brick', ceiling: 'brick', front: 'brick', back: 'brick', left: 'brick', right: 'brick' },
    };
    const g = buildGrid(box, 140);
    const node = nearestNode(g, { x: box.depth - 0.1, y: box.width - 0.1, z: box.height - 0.1 });
    const sim = simulate(g, { x: 0.1, y: 0.1, z: 0.1 }, { extra: [node], duration: 3 });
    const T = sim.T, dt = sim.dtd;
    const x = sim.series.subarray(sim.recIndex[node] * T, sim.recIndex[node] * T + T);
    const rev = computeReverb(box);
    for (const n of [[1, 0, 0], [0, 1, 0]] as [number, number, number][]) {
      const mode = computeModes(box, 120).find((m) => m.n.join() === n.join())!;
      // частота пика на сетке
      let f0 = mode.f, best = 0;
      for (let f = mode.f * 0.96; f <= mode.f * 1.04; f += 0.05) {
        let re = 0, im = 0;
        for (let t = 0; t < T; t += 2) { re += x[t] * Math.cos(2 * Math.PI * f * t * dt); im -= x[t] * Math.sin(2 * Math.PI * f * t * dt); }
        if (Math.hypot(re, im) > best) { best = Math.hypot(re, im); f0 = f; }
      }
      // огибающая на частоте моды окнами Ханна по 0,25 с, наклон логарифма на 0,4…2,4 с
      const win = Math.round(0.25 / dt);
      const pts: [number, number][] = [];
      for (let s = 0; s + win < T; s += Math.round(win / 4)) {
        let re = 0, im = 0;
        for (let t = s; t < s + win; t++) {
          const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * (t - s)) / win);
          re += w * x[t] * Math.cos(2 * Math.PI * f0 * t * dt);
          im -= w * x[t] * Math.sin(2 * Math.PI * f0 * t * dt);
        }
        const tc = (s + win / 2) * dt;
        if (tc > 0.4 && tc < 2.4) pts.push([tc, Math.log(Math.hypot(re, im))]);
      }
      const m = pts.length;
      const sx = pts.reduce((a, p) => a + p[0], 0), sy = pts.reduce((a, p) => a + p[1], 0);
      const sxx = pts.reduce((a, p) => a + p[0] ** 2, 0), sxy = pts.reduce((a, p) => a + p[0] * p[1], 0);
      const delta = -(m * sxy - sx * sy) / (m * sxx - sx * sx);
      const modal = modeDamping(mode, box, rev);
      expect(Math.abs(delta / modal - 1)).toBeLessThan(0.1);
    }
  });
});
