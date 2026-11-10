import { describe, it, expect } from 'vitest';
import { normalizeSmoothing, smoothChart, smoothingOptions } from '../../src/ui/chartSmoothing';

const f = Array.from({ length: 97 }, (_, i) => 100 * 2 ** (i / 24));
const peak = f.map((_, i) => i === 48 ? 12 : 0);
describe('display-only smoothing', () => {
  it('returns the original values without mutating calculation results', () => {
    const original = peak.slice();
    const result = smoothChart(f, peak, { mode: 'octave', index: 0 }, 'voice');
    expect(result).toEqual(peak);
    expect(result).not.toBe(peak);
    smoothChart(f, peak, { mode: 'psycho', index: 2 }, 'voice');
    expect(peak).toEqual(original);
  });
  it('preserves constant levels and level offsets', () => {
    const setting = { mode: 'psycho' as const, index: 0 };
    const flat = smoothChart(f, f.map(() => -17), setting, 'voice');
    flat.forEach((v) => expect(v).toBeCloseTo(-17, 10));
    const a = smoothChart(f, peak, setting, 'voice');
    const b = smoothChart(f, peak.map(v => v + 40), setting, 'voice');
    a.forEach((v, i) => expect(b[i] - v).toBeCloseTo(40, 10));
  });
  it('softens narrow peaks more at wider settings', () => {
    const weak = smoothChart(f, peak, { mode: 'octave', index: 1 }, 'placement-manual');
    const strong = smoothChart(f, peak, { mode: 'octave', index: 4 }, 'placement-manual');
    expect(weak[48]).toBeLessThan(12);
    expect(strong[48]).toBeLessThan(weak[48]);
    expect(strong[45]).toBeGreaterThan(weak[45]);
  });
  it('psycho mode weights peaks more than power mean at the same bandwidth', () => {
    const highF = f.map(v => v * 20);
    const power = smoothChart(highF, peak, { mode: 'octave', index: 2 }, 'placement-manual');
    const psycho = smoothChart(highF, peak, { mode: 'psycho', index: 2 }, 'placement-manual');
    expect(psycho[48]).toBeGreaterThan(power[48]);
  });
  it('handles one sample and missing values without inventing new samples', () => {
    expect(smoothChart([100], [3], { mode: 'psycho', index: 0 }, 'voice')).toEqual([3]);
    const values = [0, NaN, 2];
    const result = smoothChart([100, 101, 102], values, { mode: 'octave', index: 2 }, 'voice');
    expect(result).toHaveLength(3);
    expect(result[1]).toBeNaN();
    expect(result[0]).toBeGreaterThan(0);
  });
  it('validates stored preferences against the options of each screen', () => {
    expect(smoothingOptions('voice').map(v => v.label)).toEqual(['1/6', '1/3', '1/2']);
    expect(smoothingOptions('placement-auto').map(v => v.label)).toEqual(['Без', '1/12', '1/6', '1/3', '1/2']);
    expect(normalizeSmoothing({ mode: 'other', index: 4 }, 'voice')).toEqual({ mode: 'octave', index: 0 });
    expect(normalizeSmoothing(null, 'placement-manual')).toEqual({ mode: 'octave', index: 1 });
  });
});
