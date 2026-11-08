// Частотно-зависимые границы волновой модели: подбор β(f) и затухание мод по частоте.
import { describe, expect, it } from 'vitest';
import { admittanceAt, alphaStatC, branchCoeffs, fitAdmittance, nnls } from '../../src/core/admittance';
import { alphaStat, betaFromAlpha, buildGrid, nearestNode, simulate, type BoundaryModel } from '../../src/core/fdtd';
import { MATERIALS, alphaAt } from '../../src/core/materials';
import { computeModes } from '../../src/core/modes';
import { modeDamping } from '../../src/core/response';
import { newProject } from '../../src/state/project';
import type { Room } from '../../src/core/types';

describe('проводимость границы', () => {
  it('интеграл Пари для действительной β совпадает с формулой', () => {
    // при очень малой β закрытая формула теряет точность на вычитании — сравниваем относительно
    for (const b of [0.002, 0.03, 0.2, 0.64, 2]) expect(Math.abs(alphaStatC(b, 0) / alphaStat(b) - 1)).toBeLessThan(2e-4);
    // мнимая часть снижает поглощение
    expect(alphaStatC(0.1, 0.1)).toBeLessThan(alphaStatC(0.1, 0));
  });

  it('NNLS: точное решение с ограничением x ≥ 0', () => {
    const A = [[1, 0], [0, 1], [1, 1]];
    expect(nnls(A, [1, 2, 3]).map((v) => +v.toFixed(9))).toEqual([1, 2]);
    expect(nnls(A, [-1, 2, 1]).map((v) => +v.toFixed(9))).toEqual([0, 1.5]);
  });

  it('α модели совпадает с табличным в полосе 20–260 Гц; у плоских материалов ветвей нет', () => {
    for (const id of ['concrete-painted', 'plaster', 'gypsum', 'acoustic-panel', 'carpet-thick', 'wood-floor', 'stretch-ceiling', 'acoustic-ceiling']) {
      const a = MATERIALS.find((m) => m.id === id)!.alpha;
      const fit = fitAdmittance((f) => alphaAt(a, f), betaFromAlpha, 20, 260);
      for (const f of [25, 40, 63, 100, 125, 160, 200, 250]) {
        const [re, im] = admittanceAt(fit, f);
        const t = alphaAt(a, f);
        // у излома таблицы на 63 Гц (ниже — постоянное значение) гладкая модель отклоняется сильнее всего
        expect(Math.abs(alphaStatC(re, im) - t), `${id} @ ${f}`).toBeLessThan(0.008 + 0.08 * t);
      }
      if (id === 'concrete-painted' || id === 'plaster') expect(fit.branches.length).toBe(0);
    }
  });

  it('дискретная ветвь пассивна при любых параметрах', () => {
    for (const k of [1e-5, 3e-4, 1e-3]) for (const g of [1e-4, 0.01, 1]) for (const f0 of [16, 128, 362]) {
      const c = branchCoeffs({ g, f0, q: 1.6 }, k);
      expect(c.a).toBeGreaterThan(0);
      expect(Math.abs(c.b)).toBeLessThan(c.a); // |b/a| < 1 — собственное затухание ветви
    }
  });
});

describe('затухание мод по частоте', () => {
  // Пара стен — акустические панели (α растёт с 0,08 на 63 Гц до 0,75 на 250 Гц), остальное — бетон.
  // Осевые моды по глубине «видят» поглощение панелей на своей частоте.
  const room: Room = {
    ...newProject().room, depth: 5.3, width: 3.1, height: 2.45, furnishing: 'empty',
    materials: { front: 'acoustic-panel', back: 'acoustic-panel', left: 'concrete-painted', right: 'concrete-painted', floor: 'concrete-painted', ceiling: 'concrete-painted' },
  };
  function t60(model: BoundaryModel, fs: number[]): number[] {
    // сетка до 200 Гц: верхняя мода (162 Гц) должна быть заметно ниже предела сетки, иначе её затухание искажено
    const g = buildGrid(room, 200, 300_000, { boundary: model });
    // источник и приёмник — на средних плоскостях: нечётные моды по ширине и высоте не возбуждаются
    const rcv = nearestNode(g, { x: room.depth - 0.2, y: room.width / 2, z: room.height / 2 });
    const sim = simulate(g, { x: 0.2, y: room.width / 2, z: room.height / 2 }, { extra: [rcv], duration: 2.6 });
    const x = sim.series.subarray(sim.recIndex[rcv] * sim.T, (sim.recIndex[rcv] + 1) * sim.T);
    return fs.map((f) => decay(x, sim.dtd, f));
  }
  function decay(x: Float32Array, dtd: number, f: number): number {
    const L = Math.round(0.35 / dtd), hop = Math.round(0.01 / dtd);
    const lv: number[] = [], ts: number[] = [];
    for (let s = 0; s + L < x.length; s += hop) {
      let re = 0, im = 0;
      for (let i = 0; i < L; i++) {
        const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (L - 1)), ph = 2 * Math.PI * f * (s + i) * dtd;
        re += x[s + i] * w * Math.cos(ph); im -= x[s + i] * w * Math.sin(ph);
      }
      lv.push(10 * Math.log10(re * re + im * im + 1e-300)); ts.push((s + L / 2) * dtd);
    }
    let i0 = lv.findIndex((_, i) => ts[i] > 0.15);
    for (let i = i0; i < lv.length; i++) if (lv[i] > lv[i0]) i0 = i;
    const pts: [number, number][] = [];
    for (let i = i0; i < lv.length && lv[i] > lv[i0] - 35; i++) if (lv[i] < lv[i0] - 3) pts.push([ts[i], lv[i]]);
    const n = pts.length, mx = pts.reduce((s, p) => s + p[0], 0) / n, my = pts.reduce((s, p) => s + p[1], 0) / n;
    const slope = pts.reduce((s, p) => s + (p[0] - mx) * (p[1] - my), 0) / pts.reduce((s, p) => s + (p[0] - mx) ** 2, 0);
    return -60 / slope;
  }

  it('частотно-зависимая граница повторяет ход затухания модальной модели; постоянная β — нет', () => {
    const axial = computeModes(room, 180).filter((m) => m.n[1] === 0 && m.n[2] === 0 && m.f > 20);
    const lo = axial[0], hi = axial.find((m) => m.f > 150)!;
    const modal = [lo, hi].map((m) => 6.91 / modeDamping(m, room));
    const fd = t60('fd', [lo.f, hi.f]);
    const fi = t60('fi', [lo.f, hi.f]);
    const trend = (t: number[]) => t[0] / t[1];
    // модальная модель: на 32 Гц мода звучит в ~6,5 раза дольше, чем на 160 Гц
    expect(trend(modal)).toBeGreaterThan(4.5);
    expect(Math.abs(Math.log(trend(fd) / trend(modal)))).toBeLessThan(Math.log(1.25));
    // с постоянной β затухание почти одинаковое на всех частотах
    expect(trend(fi)).toBeLessThan(1.3);
    // и абсолютные значения: обе модели считают затухание через β по формуле Пари (модель затухания 3) —
    // FD в пределах 20 % от модальной на обеих частотах (до этого волновая затухала на 15–30 % быстрее)
    fd.forEach((t, i) => expect(Math.abs(Math.log(t / modal[i]))).toBeLessThan(Math.log(1.2)));
  });
});
