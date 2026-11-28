// V2-052: многослойные конструкции (TMM). Независимые проверки: диффузное поглощение — формула Пари ядра (paris.ts);
// один пористый слой на стене — замкнутая формула −j·Zc·ctg(kd); резонанс мембраны и перфорированного листа над
// воздушной полостью — классические формулы инструментов (application/tools); согласие моделей пористого слоя.
import { describe, expect, it } from 'vitest';
import { alphaStat } from '../../src/core/paris';
import { cdiv } from '../../src/core/frequency';
import { membrane, perforated } from '../../src/v2/application/tools';
import { absorption, air, alphaAt, construction, csqrt, diffuseAlpha, octaveMean, outOfRange, peak, perforation, porous, surfaceImpedance, type Layer } from '../../src/v2/application/layers';

const a = air(20);
const wool = (thickness: number, model: 'delany-bazley' | 'miki' | 'jca' = 'delany-bazley', sigma = 10_000): Layer => ({
  kind: 'porous', thickness, sigma, model, jca: { porosity: 0.98, tortuosity: 1.02, viscousUm: 90, thermalUm: 180 },
});
/** Частота, где мнимая часть импеданса меняет знак (резонанс), — деление пополам. */
function resonance(layers: Layer[], lo: number, hi: number): number {
  const im = (f: number) => surfaceImpedance(layers, f, 0, a).im;
  for (let i = 0; i < 60; i++) { const m = Math.sqrt(lo * hi); if (Math.sign(im(m)) === Math.sign(im(lo))) lo = m; else hi = m; }
  return Math.sqrt(lo * hi);
}

describe('диффузное поле (V2-052)', () => {
  it('интеграл Пари для постоянного импеданса совпадает с формулой ядра; максимум 0,951 при ζ ≈ 1,567', () => {
    for (const z of [0.5, 1, 1.567, 3, 10]) {
      expect(diffuseAlpha((t) => alphaAt({ re: z * a.z0, im: 0 }, t, a.z0), Math.PI / 2, 200)).toBeCloseTo(alphaStat(1 / z), 3);
    }
    expect(alphaStat(1 / 1.567)).toBeCloseTo(0.951, 3);
    expect(alphaAt({ re: a.z0, im: 0 }, 0, a.z0)).toBeCloseTo(1, 9);
  });
});

describe('матрицы переноса (V2-052)', () => {
  it('один пористый слой на стене: Zs = −j·Zc·ctg(kd)', () => {
    for (const model of ['delany-bazley', 'miki', 'jca'] as const) {
      const l = wool(0.05, model);
      for (const f of [100, 500, 2000]) {
        const { zc, k } = porous(l as Extract<Layer, { kind: 'porous' }>, f, a);
        const kd = { re: k.re * 0.05, im: k.im * 0.05 };
        const cos = { re: Math.cos(kd.re) * Math.cosh(kd.im), im: -Math.sin(kd.re) * Math.sinh(kd.im) };
        const sin = { re: Math.sin(kd.re) * Math.cosh(kd.im), im: Math.cos(kd.re) * Math.sinh(kd.im) };
        const cot = cdiv(cos, sin);
        const want = { re: zc.re * cot.im + zc.im * cot.re, im: -(zc.re * cot.re - zc.im * cot.im) };
        const got = surfaceImpedance([l], f, 0, a);
        expect(got.re).toBeCloseTo(want.re, 6);
        expect(got.im).toBeCloseTo(want.im, 6);
        expect(k.im).toBeLessThan(0);
      }
    }
  });

  it('резонанс мембраны над полостью — 60/√(m·d); перфорированного листа — c/2π·√(p/(D·t′)), в пределах концевых поправок', () => {
    for (const [m, d] of [[8, 0.1], [4, 0.2], [15, 0.05]]) {
      const f = resonance([{ kind: 'membrane', surfaceMass: m }, { kind: 'air', thickness: d }], 20, 400);
      expect(Math.abs(f / membrane(m, d) - 1)).toBeLessThan(0.04);
    }
    const plate = { kind: 'perforated' as const, thickness: 0.012, holeDiameter: 0.008, pitch: 0.03 };
    // классическая формула — сосредоточенная (k·D ≪ 1): сверка на мелкой полости; на глубокой TMM ниже на 5–7 %
    const f = resonance([plate, { kind: 'air', thickness: 0.03 }], 40, 3000);
    expect(Math.abs(f / perforated(0.004, 0.03, 0.012, 0.03).f0 - 1)).toBeLessThan(0.05);
    expect(resonance([plate, { kind: 'air', thickness: 0.1 }], 40, 3000)).toBeLessThan(perforated(0.004, 0.03, 0.012, 0.1).f0);
    expect(perforation(plate)).toBeCloseTo(Math.PI * 0.004 ** 2 / 0.03 ** 2, 12);
  });

  it('модели пористого слоя согласуются в общей области; толще — больше поглощение на низах; зазор работает', () => {
    const freqs = [250, 500, 1000, 2000];
    const db = absorption([wool(0.05)], freqs), mk = absorption([wool(0.05, 'miki')], freqs), jc = absorption([wool(0.05, 'jca')], freqs);
    for (let k = 0; k < freqs.length; k++) {
      expect(Math.abs(db.normal[k] - mk.normal[k])).toBeLessThan(0.06);
      expect(Math.abs(db.normal[k] - jc.normal[k])).toBeLessThan(0.12);
    }
    const lo = (ls: Layer[]) => absorption(ls, [125]).diffuse[0];
    expect(lo([wool(0.1)])).toBeGreaterThan(lo([wool(0.05)]));
    expect(lo([wool(0.05), { kind: 'air', thickness: 0.1 }])).toBeGreaterThan(lo([wool(0.05)]));
    const r = absorption([wool(0.1)], [1000]);
    expect(r.normal[0]).toBeGreaterThan(0.9);
    expect(r.diffuse[0]).toBeGreaterThan(0.8);
  });
});

describe('сведения о конструкции (V2-052)', () => {
  it('глубина, масса, применимость, октавы, пик', () => {
    expect(construction([{ ...wool(0.05), density: 40 } as Layer, { kind: 'air', thickness: 0.05 }, { kind: 'membrane', surfaceMass: 3 }])).toEqual({ depth: 0.1, mass: 5 });
    expect(construction([wool(0.05), { kind: 'air', thickness: 0.05 }]).mass).toBeNull();
    expect(outOfRange(wool(0.05, 'delany-bazley', 40_000), [50, 100, 200, 400])).toEqual({ lo: 50, hi: 200 });
    expect(outOfRange(wool(0.05, 'miki', 40_000), [50, 100])).toBeNull();
    expect(octaveMean([90, 100, 120, 200], [1, 2, 3, 4], 125)).toBeCloseTo(2, 9);
    expect(octaveMean([90], [1], 4000)).toBeNull();
    expect(peak([50, 63, 80, 100, 125], [0.1, 0.5, 0.9, 0.6, 0.2])).toEqual({ f: 80, value: 0.9, lo: 63, hi: 100 });
    expect(csqrt({ re: -4, im: 0 })).toEqual({ re: 0, im: 2 });
  });
});
