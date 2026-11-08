// Быстрый шаг FDTD (плотная сетка, отрезки внутренних узлов) и блочное ДПФ против исходной схемы.
import { describe, expect, it } from 'vitest';
import { buildGrid, layerOf, simulate, simulateField, type WaveGrid } from '../../src/core/fdtd';
import { newProject } from '../../src/state/project';
import type { Room, Vec3 } from '../../src/core/types';

const base = newProject().room;
const rooms: Record<string, Room> = {
  box: { ...base, depth: 4.2, width: 3.4, height: 2.5 },
  corridor: {
    ...base, depth: 4.5, width: 3.6, height: 2.7,
    extensions: [{ id: 'e', name: 'к', wall: 'right', a0: 0.5, a1: 4, depth: 1.2, height: 2.4, arch: { a0: 1, a1: 2.2, height: 2.1 }, openStart: false, openEnd: true, openFar: false }],
  },
  slope: { ...base, depth: 4, width: 3.5, height: 2.8, slope: { wall: 'front', low: 1.4, run: 1.6 } },
};
const SRC: Vec3 = { x: 0.4, y: 0.5, z: 0.3 };

/** Исходная схема: обход всех узлов по таблице соседей и коэффициентам ca/cb/cd. */
function reference(g: WaveGrid, steps: number, srcPos: Vec3, onStep: (p: Float32Array, step: number, sv: number) => void) {
  const N = g.N;
  let p0 = new Float32Array(N + 1), p1 = new Float32Array(N + 1), p2 = new Float32Array(N + 1);
  // источник и сигнал — как в simulate (ближайший узел, производная гауссова импульса)
  const s = nearest(g, srcPos);
  const sigma = 1 / (2 * Math.PI * (g.fMax / 2)), t0 = 5 * sigma;
  for (let step = 0; step < steps; step++) {
    for (let n = 0; n < N; n++) {
      const o = 6 * n;
      const sum = p1[g.nbr[o]] + p1[g.nbr[o + 1]] + p1[g.nbr[o + 2]] + p1[g.nbr[o + 3]] + p1[g.nbr[o + 4]] + p1[g.nbr[o + 5]];
      p2[n] = g.ca[n] * p1[n] + g.cb[n] * sum - g.cd[n] * p0[n];
    }
    const u = step * g.dt - t0;
    const sv = (-u / (sigma * sigma)) * Math.exp(-(u * u) / (2 * sigma * sigma)) * sigma;
    p2[s] += sv;
    const tmp = p0; p0 = p1; p1 = p2; p2 = tmp;
    onStep(p1, step, sv);
  }
}
function nearest(g: WaveGrid, p: Vec3): number {
  let best = -1, bd = Infinity;
  for (let n = 0; n < g.N; n++) {
    const c = g.nodeCell[n];
    const i = c % g.nx, j = Math.floor(c / g.nx) % g.ny, k = Math.floor(c / (g.nx * g.ny));
    const d = (g.x0 + i * g.h - p.x) ** 2 + (g.y0 + j * g.h - p.y) ** 2 + (g.z0 + k * g.h - p.z) ** 2;
    if (d < bd) { bd = d; best = n; }
  }
  return best;
}

describe('быстрый шаг FDTD', () => {
  for (const [name, room] of Object.entries(rooms)) {
    it(`${name}: временные ряды совпадают с исходной схемой бит в бит`, () => {
      const g = buildGrid(room, 100, undefined, { boundary: 'fi' });
      expect(g.fast.runs.length).toBeGreaterThan(0);
      const duration = 0.25;
      const sim = simulate(g, SRC, { layers: [layerOf(g, 1.1)], duration });
      const steps = Math.ceil(duration / g.dt);
      const decim = Math.round(sim.dtd / g.dt);
      const ref = new Float32Array(sim.series.length);
      let t = 0;
      reference(g, steps, SRC, (p, step) => {
        if (step % decim === 0 && t < sim.T) { for (let r = 0; r < sim.rec.length; r++) ref[r * sim.T + t] = p[sim.rec[r]]; t++; }
      });
      let maxAbs = 0, maxDiff = 0;
      for (let i = 0; i < ref.length; i++) { maxAbs = Math.max(maxAbs, Math.abs(ref[i])); maxDiff = Math.max(maxDiff, Math.abs(ref[i] - sim.series[i])); }
      expect(maxAbs).toBeGreaterThan(0);
      expect(maxDiff).toBe(0);
    });
  }

  it('поле на частотах (блочное ДПФ) совпадает с поотсчётным в пределах 1e-4 от максимума', () => {
    const g = buildGrid(rooms.corridor, 100, undefined, { boundary: 'fi' });
    const freqs = [31, 44.5, 57, 70, 83.3];
    const duration = 0.4;
    const fast = simulateField(g, SRC, freqs, { duration });
    const steps = Math.ceil(duration / g.dt);
    const decim = Math.max(1, Math.floor(1 / (g.dt * 4.3 * g.fMax)));
    const T = Math.floor(steps / decim), tail = Math.floor(T * 0.2), dtd = g.dt * decim;
    const nF = freqs.length;
    const aRe = new Float64Array(g.N * nF), aIm = new Float64Array(g.N * nF), sRe = new Float64Array(nF), sIm = new Float64Array(nF);
    let t = 0;
    reference(g, steps, SRC, (p, step, sv) => {
      if (step % decim !== 0 || t >= T) return;
      const win = t >= T - tail ? 0.5 * (1 + Math.cos((Math.PI * (t - (T - tail))) / tail)) : 1;
      for (let f = 0; f < nF; f++) {
        const w = 2 * Math.PI * freqs[f] * dtd * t;
        sRe[f] += sv * Math.cos(w); sIm[f] -= sv * Math.sin(w);
        for (let n = 0; n < g.N; n++) { aRe[n * nF + f] += p[n] * Math.cos(w) * win; aIm[n * nF + f] -= p[n] * Math.sin(w) * win; }
      }
      t++;
    });
    let maxMag = 0, maxDiff = 0;
    for (let f = 0; f < nF; f++) {
      const d = sRe[f] ** 2 + sIm[f] ** 2;
      for (let n = 0; n < g.N; n++) {
        const o = n * nF + f;
        const hr = (aRe[o] * sRe[f] + aIm[o] * sIm[f]) / d, hi = (aIm[o] * sRe[f] - aRe[o] * sIm[f]) / d;
        maxMag = Math.max(maxMag, Math.hypot(hr, hi));
        maxDiff = Math.max(maxDiff, Math.hypot(hr - fast.re[o], hi - fast.im[o]));
      }
    }
    expect(maxMag).toBeGreaterThan(0);
    expect(maxDiff / maxMag).toBeLessThan(1e-4);
  });
});
