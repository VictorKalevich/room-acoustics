import { describe, expect, it } from 'vitest';
import { newProject } from '../../src/state/project';
import { bandFreqs, combineEnergy, computeField, sliceField, toDb } from '../../src/core/field3d';
import { prepareModes, transfer } from '../../src/core/response';
import { computeReverb } from '../../src/core/reverb';
import { filterSet } from '../../src/core/system';
import { buildGrid, simulate, simulateField, nodeSpectrum, layerOf, nearestNode } from '../../src/core/fdtd';

const p = newProject();
p.room = { ...p.room, depth: 5, width: 4, height: 2.5 };

describe('поле в прямоугольной модели', () => {
  it('форма осевой моды (1,0,0): пучности у передней и задней стены, узел посередине', () => {
    const r = computeField({ room: p.room, sources: p.sources, setup: p.current, freqs: [34.3], kind: 'shape', modes: [[1, 0, 0]] });
    const e = combineEnergy(r, [0]);
    const at = (x: number) => {
      const i = Math.min(r.nx - 1, Math.round((x - r.x0) / r.sx));
      return e[(i * r.ny + 3) * r.nz + 3];
    };
    expect(toDb(at(0.05))).toBeGreaterThan(2.5); // ≈ +3 дБ: ψ² = 1 при среднем ½
    expect(toDb(at(2.5))).toBeLessThan(-15);
    // среднее по комнате = 1
    let s = 0;
    for (let q = 0; q < e.length; q++) s += e[q];
    expect(s / e.length).toBeCloseTo(1, 5);
  });

  it('совпадает с передаточной функцией в точке (модальная сумма)', () => {
    const freqs = [42, 57];
    const r = computeField({ room: p.room, sources: p.sources, setup: p.current, freqs, kind: 'excited' });
    const i = 10, j = 7, k = 5;
    const pt = { x: r.x0 + i * r.sx, y: r.y0 + j * r.sy, z: r.z0 + k * r.sz };
    const pm = prepareModes(p.room, Math.max(...freqs) * 1.5 + 30, computeReverb(p.room));
    const { filt } = filterSet(p.sources, freqs, p.current.crossoverHz, p.current.subSettings);
    // отношение энергий в двух точках должно совпасть
    const pt2 = { x: r.x0 + 3 * r.sx, y: r.y0 + 12 * r.sy, z: r.z0 + 9 * r.sz };
    const eAt = (q: { x: number; y: number; z: number }, f: number) => {
      let re = 0, im = 0;
      for (const s of p.sources) {
        const pos = p.current.positions[s.id];
        if (!pos) continue;
        const h = transfer(pm, pos, q, [freqs[f]])[0];
        re += h.re * filt[s.id].re[f] - h.im * filt[s.id].im[f];
        im += h.re * filt[s.id].im[f] + h.im * filt[s.id].re[f];
      }
      return re * re + im * im;
    };
    const nP = r.mask.length;
    for (let f = 0; f < freqs.length; f++) {
      const a = r.energy[f * nP + (i * r.ny + j) * r.nz + k];
      const b = r.energy[f * nP + (3 * r.ny + 12) * r.nz + 9];
      expect(toDb(a / b)).toBeCloseTo(toDb(eAt(pt, f) / eAt(pt2, f)), 1);
    }
  });

  it('срез: средняя энергия по слою и интерполяция тонкого среза', () => {
    const r = computeField({ room: p.room, sources: p.sources, setup: p.current, freqs: [68.6], kind: 'shape', modes: [[0, 0, 1]] });
    const e = combineEnergy(r, [0]);
    // вертикальная мода (0,0,1): у пола и потолка пучность, на середине высоты узел
    const floor = sliceField(r, e, 0.05, 0.05);
    const mid = sliceField(r, e, 1.25, 1.25);
    expect(floor.db[0]).toBeGreaterThan(2);
    expect(mid.db[0]).toBeLessThan(-15);
    // толстый слой по всей высоте — среднее = 0 дБ
    const all = sliceField(r, e, 0, 2.5);
    expect(all.db[5]).toBeCloseTo(0, 0);
  });

  it('частоты полосы', () => {
    const b = bandFreqs(40, 60);
    expect(b[0]).toBe(40);
    expect(b[b.length - 1]).toBeCloseTo(60);
    expect(b.length).toBeLessThanOrEqual(16);
  });
});

describe('ДПФ в FDTD', () => {
  it('поле во всех узлах совпадает со спектром записанного узла', () => {
    const g = buildGrid({ ...p.room, depth: 3, width: 2.5, height: 2.2, extensions: [], openings: [] } as any, 150);
    const src = { x: 0.6, y: 0.5, z: 0.4 };
    const rcv = { x: 2.1, y: 1.7, z: 1.2 };
    const freqs = [45, 80];
    const sim = simulate(g, src, { layers: [layerOf(g, rcv.z)] });
    const ref = nodeSpectrum(sim, nearestNode(g, rcv), freqs);
    const fld = simulateField(g, src, freqs);
    const n = nearestNode(g, rcv);
    for (let f = 0; f < freqs.length; f++) {
      const a = Math.hypot(fld.re[n * 2 + f], fld.im[n * 2 + f]);
      const b = Math.hypot(ref.re[f], ref.im[f]);
      expect(Math.abs(toDb(a * a) - toDb(b * b))).toBeLessThan(0.5);
    }
  });
});
