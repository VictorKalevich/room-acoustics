import { describe, it, expect } from 'vitest';
import { normalizeSmoothing, pickSmoothing, smoothChart, smoothingOptions, smoothingPosition } from '../../src/ui/chartSmoothing';

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

describe('узкое сглаживание при подробных данных (026)', () => {
  const labels = (screen: Parameters<typeof smoothingOptions>[0], ppo?: number) => smoothingOptions(screen, ppo).map((o) => o.label);
  it('1/24 и 1/48 появляются только при достаточной подробности данных', () => {
    expect(labels('placement-manual', 24)).toEqual(['Без', '1/12', '1/6', '1/3', '1/2']);
    expect(labels('placement-manual', 48)).toEqual(['Без', '1/24', '1/12', '1/6', '1/3', '1/2']);
    expect(labels('placement-auto', 96)).toEqual(['Без', '1/48', '1/24', '1/12', '1/6', '1/3', '1/2']);
    expect(labels('voice', 6)).toEqual(['1/6', '1/3', '1/2']);
    expect(labels('voice', 24)).toEqual(['1/24', '1/12', '1/6', '1/3', '1/2']);
    expect(labels('voice', 48)).toEqual(['1/48', '1/24', '1/12', '1/6', '1/3', '1/2']);
  });
  it('выбор узкой точки запоминается поверх базовой и не действует на стандартных данных', () => {
    const fine = smoothingOptions('placement-manual', 96);
    const picked = pickSmoothing({ mode: 'octave', index: 2 }, fine[1]);
    expect(picked).toEqual({ mode: 'octave', index: 2, fine: '1/48' });
    expect(smoothingPosition(picked, fine)).toBe(1);
    // данные стали стандартными — действует прежняя базовая точка (1/6)
    const base = smoothingOptions('placement-manual', 24);
    expect(base[smoothingPosition(picked, base)].label).toBe('1/6');
    // при 48 точках на октаву 1/48 недоступно — тоже базовая
    const mid = smoothingOptions('placement-manual', 48);
    expect(mid[smoothingPosition(picked, mid)].label).toBe('1/6');
    // базовая точка сбрасывает узкую
    expect(pickSmoothing(picked, fine[3])).toEqual({ mode: 'octave', index: 1 });
    expect(normalizeSmoothing({ mode: 'octave', index: 1, fine: '1/24' }, 'placement-auto')).toEqual({ mode: 'octave', index: 1, fine: '1/24' });
    expect(normalizeSmoothing({ mode: 'octave', index: 1, fine: 'x' }, 'placement-auto')).toEqual({ mode: 'octave', index: 1 });
  });
  it('1/48 сглаживает слабее 1/24 на данных 96 точек на октаву, а голос 1/6 на узких полосах — сглаживание', () => {
    const f96 = Array.from({ length: 385 }, (_, i) => 20 * 2 ** (i / 96));
    const spike = f96.map((_, i) => (i === 192 ? 12 : 0));
    const at = (fineLabel: string) => smoothChart(f96, spike, { mode: 'octave', index: 1, fine: fineLabel }, 'placement-manual', 96)[192];
    expect(at('1/48')).toBeLessThan(12);
    expect(at('1/24')).toBeLessThan(at('1/48'));
    const raw = smoothChart(f96, spike, { mode: 'octave', index: 0, fine: '1/48' }, 'voice', 48);
    expect(raw).toEqual(spike);
    const sixth = smoothChart(f96, spike, { mode: 'octave', index: 0, fine: undefined }, 'voice', 6);
    expect(sixth).toEqual(spike);
    const voiceFine = smoothingOptions('voice', 48);
    const pos = smoothingPosition({ mode: 'octave', index: 0 }, voiceFine);
    expect(voiceFine[pos]).toMatchObject({ label: '1/6', width: 1 / 6 });
  });
});
