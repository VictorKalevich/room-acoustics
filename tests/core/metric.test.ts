import { describe, expect, it } from 'vitest';
import { flatnessScore } from '../../src/core/metric';

describe('flatnessScore', () => {
  it('плоское отклонение (даже со сдвигом уровня) → 0', () => {
    const t = Array.from({ length: 50 }, (_, i) => -i * 0.1);
    expect(flatnessScore(t.map((v) => v + 7), t)).toBeCloseTo(0, 9);
  });

  it('синусоидальная неровность ±A дБ → A/√2', () => {
    const n = 2000;
    const target = new Array(n).fill(0);
    const room = Array.from({ length: n }, (_, i) => 6 * Math.sin((2 * Math.PI * 5 * i) / n));
    expect(flatnessScore(room, target)).toBeCloseTo(6 / Math.SQRT2, 2);
  });
});
