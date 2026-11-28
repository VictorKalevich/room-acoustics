// V2-052, пакет 11б-2: PRD и оценка рассеивания (Фраунгофер) — независимая проверка свойством сумм Гаусса: у QRD на
// расчётной частоте все дифракционные лепестки периодической решётки равны; раскрой плит и ведомость материалов.
import { describe, expect, it } from 'vitest';
import { speedOfSound } from '../../src/core/physics';
import { qrd } from '../../src/v2/application/tools';
import { diffusion, latticeFloor, normalizedDiffusion, prd, primitiveRoot, scattering } from '../../src/v2/application/diffusers';
import { cutMapSvg, cutPlan, panelBom, type PanelJob } from '../../src/v2/application/fabrication';

describe('PRD (V2-052)', () => {
  it('первообразный корень и последовательность: все вычеты 1…N−1 по одному разу', () => {
    expect([5, 7, 11, 13, 17, 19, 23].map(primitiveRoot)).toEqual([2, 3, 2, 2, 3, 2, 5]);
    const p = prd(7, 500, 0.05);
    expect(p.seq).toEqual([3, 2, 6, 4, 5, 1]);
    expect([...p.seq].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(p.depths[2]).toBeCloseTo((6 * speedOfSound(20)) / 500 / 14, 12);
    expect(p.period).toBeCloseTo(0.3, 12);
  });
});

describe('рассеивание (V2-052)', () => {
  it('QRD на расчётной частоте: лепестки решётки равны (суммы Гаусса), плоская панель — один зеркальный', () => {
    const N = 7, f0 = 1500, w = 0.1, c = speedOfSound(20);
    const q = qrd(N, f0, w);
    const lam = c / f0;
    const lobes = Array.from({ length: 2 * N + 1 }, (_, i) => i - N).filter((m) => Math.abs((m * lam) / (N * w)) < 0.95);
    const angles = lobes.map((m) => (Math.asin((m * lam) / (N * w)) * 180) / Math.PI);
    const e = scattering(q.depths[0], w, 8, f0, angles);
    // убрать множители ячейки и наклона — останется квадрат модуля суммы по периоду
    const k = (2 * Math.PI * f0) / c;
    const af = e.map((v, i) => {
      const t = (angles[i] * Math.PI) / 180, u = (k * w * Math.sin(t)) / 2;
      const sinc = Math.abs(u) < 1e-9 ? 1 : Math.sin(u) / u;
      return v / (w * sinc * (1 + Math.cos(t)) / 2) ** 2;
    });
    expect(lobes.length).toBe(5);
    for (const v of af) expect(v / af[0]).toBeCloseTo(1, 6);
    const flat = scattering(q.depths[0].map(() => 0), w, 8, f0, angles);
    expect(flat[lobes.indexOf(0)]).toBeGreaterThan(100 * Math.max(...flat.filter((_, i) => lobes[i] !== 0)));
  });

  it('коэффициент диффузии: равномерно — 1, в одну сторону — 0; QRD рассеивает лучше плоской панели в рабочей полосе', () => {
    expect(diffusion([1, 1, 1, 1])).toBeCloseTo(1, 12);
    expect(diffusion([0, 0, 5, 0])).toBeCloseTo(0, 12);
    const q = qrd(7, 500, 0.05);
    const mid = normalizedDiffusion(q.depths[0], 0.05, 4, 1000);
    expect(mid.d).toBeGreaterThan(mid.flat);
    expect(mid.norm).toBeGreaterThan(0.2);
    expect(normalizedDiffusion(q.depths[0].map(() => 0), 0.05, 4, 1000).norm).toBeCloseTo(0, 9);
    // ниже c/период — один зеркальный лепесток: рассеивание не лучше плоской панели
    const floor = latticeFloor(0.35);
    expect(normalizedDiffusion(q.depths[0], 0.05, 4, floor * 0.8).norm).toBeLessThan(0.1);
  });
});

describe('изготовление (V2-052)', () => {
  it('раскрой: поворот, отходы, нехватка размера', () => {
    expect(cutPlan(0.6, 0.6, 1.2, 0.6)).toMatchObject({ pieces: 2, waste: 0, rotated: false });
    expect(cutPlan(0.6, 1.2, 1.2, 0.6)).toMatchObject({ pieces: 1, rotated: true });
    expect(cutPlan(0.5, 0.5, 1.2, 0.6).waste).toBeCloseTo(1 - 0.5 / 0.72, 9);
    expect(cutPlan(1.5, 0.7, 1.2, 0.6).pieces).toBe(0);
  });

  it('ведомость: слои, плиты, упаковки, ткань, рамка; неизвестная цена — не ноль', () => {
    const job: PanelJob = {
      width: 0.6, height: 1.2, count: 4, core: 0.1,
      board: { width: 1.2, height: 0.6, thickness: 0.05, perPack: 8, density: 40, pricePack: 2000 },
      framePrice: 100, fabricMargin: 0.05, fabricPrice: null,
    };
    const b = panelBom(job);
    expect([b.layers, b.pieces, b.boards, b.packs]).toEqual([2, 8, 8, 1]);
    expect(b.frameLength).toBeCloseTo(14.4, 9);
    expect(b.fabricArea).toBeCloseTo((0.6 + 0.3) * (1.2 + 0.3) * 4, 9);
    expect(b.mass).toBeCloseTo(8 * 0.72 * 0.05 * 40, 9);
    expect([b.cost, b.missing]).toEqual([null, ['цена ткани']]);
    expect(panelBom({ ...job, fabricPrice: 300 }).cost).toBeCloseTo(2000 + 14.4 * 100 + b.fabricArea * 300, 6);
    const big = panelBom({ ...job, width: 1.5, height: 0.7 });
    expect(big.assembled).toBe(true);
    expect(big.boards).toBe(Math.ceil((8 * 1.5 * 0.7) / 0.72));
    expect(panelBom({ ...job, board: { ...job.board, density: null } }).mass).toBeNull();
    const svg = cutMapSvg(0.6, 0.6, 1.2, 0.6, cutPlan(0.6, 0.6, 1.2, 0.6), 'Панель <A>');
    expect(svg.match(/<rect /g)).toHaveLength(3);
    expect(svg).toContain('Панель &lt;A>');
  });
});
