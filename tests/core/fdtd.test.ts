import { describe, expect, it } from 'vitest';
import { alphaToBeta, buildGrid, nearestNode, simulate, nodeSpectrum, systemModes } from '../../src/core/fdtd';
import { computeModes } from '../../src/core/modes';
import { defaultRoom } from '../../src/state/project';
import type { Extension, Room } from '../../src/core/types';

const hard = (): Room => ({
  ...defaultRoom(),
  furnishing: 'empty',
  materials: { floor: 'concrete-painted', ceiling: 'concrete-painted', front: 'concrete-painted', back: 'concrete-painted', left: 'concrete-painted', right: 'concrete-painted' },
});

const corridor = (over: Partial<Extension> = {}): Extension => ({
  id: 'e', name: 'Коридор', wall: 'right', a0: 0, a1: 5, depth: 1.2, height: 2.5,
  arch: { a0: 1, a1: 2.4, height: 2.1 }, openStart: false, openEnd: false, openFar: false, ...over,
});

describe('сетка', () => {
  it('β: α = 0 → 0, α → 1 → 1', () => {
    expect(alphaToBeta(0)).toBe(0);
    expect(alphaToBeta(0.999)).toBeGreaterThan(0.9);
  });

  it('шаг ≈ c/(10·fMax), объём комнаты воспроизводится с точностью до ячейки', () => {
    const g = buildGrid(hard(), 200);
    expect(g.h).toBeLessThanOrEqual(343.2 / 2000 + 1e-9);
    expect(g.h).toBeGreaterThan(0.9 * 343.2 / 2000 - 1e-9);
    const vol = g.N * g.h ** 3;
    expect(Math.abs(vol - 50) / 50).toBeLessThan(0.12);
  });

  it('коридор соединён с комнатой только через арку', () => {
    const room = { ...hard(), extensions: [corridor()] };
    const g = buildGrid(room, 200);
    let links = 0;
    for (let n = 0; n < g.N; n++) {
      if (g.region[n] !== 0) continue;
      for (let d = 0; d < 6; d++) {
        const m = g.nbr[6 * n + d];
        if (m < g.N && g.region[m] !== 0) links++;
      }
    }
    // площадь арки 1,4 × 2,1 м ≈ число граней × h²
    expect(links * g.h * g.h).toBeGreaterThan(1.4 * 2.1 * 0.6);
    expect(links * g.h * g.h).toBeLessThan(1.4 * 2.1 * 1.5);
  });
});

describe('симуляция', () => {
  it('резонансы прямоугольной комнаты совпадают с аналитическими модами (≤ 2 %)', () => {
    const room = hard();
    const { modes } = systemModes(room, 120, { duration: 2.5 });
    const analytic = computeModes(room, 80).filter((m) => m.kind === 'axial').slice(0, 3);
    for (const a of analytic) {
      const near = modes.reduce((best, m) => (Math.abs(m.f - a.f) < Math.abs(best.f - a.f) ? m : best), modes[0]);
      expect(Math.abs(near.f - a.f) / a.f).toBeLessThan(0.02);
    }
  });

  it('коридор добавляет собственные моды, часть энергии которых в коридоре', () => {
    const plain = systemModes(hard(), 120, { duration: 2 }).modes.filter((m) => m.f < 100);
    const withExt = systemModes({ ...hard(), extensions: [corridor()] }, 120, { duration: 2 }).modes.filter((m) => m.f < 100);
    expect(withExt.length).toBeGreaterThan(plain.length);
    expect(withExt.some((m) => m.roomShare < 0.5)).toBe(true);
  });

  it('передаточная функция симметрична (взаимность) с точностью до сетки', () => {
    const g = buildGrid(hard(), 150);
    const a = { x: 0.6, y: 0.8, z: 0.4 };
    const b = { x: 3.4, y: 2.7, z: 1.1 };
    const na = nearestNode(g, a), nb = nearestNode(g, b);
    const f = [30, 45, 60, 90];
    const s1 = nodeSpectrum(simulate(g, a, { extra: [nb], duration: 0.8 }), nb, f);
    const s2 = nodeSpectrum(simulate(g, b, { extra: [na], duration: 0.8 }), na, f);
    f.forEach((_, i) => {
      const m1 = Math.hypot(s1.re[i], s1.im[i]);
      const m2 = Math.hypot(s2.re[i], s2.im[i]);
      expect(Math.abs(20 * Math.log10(m1 / m2))).toBeLessThan(0.5);
    });
  });
});
