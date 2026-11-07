import { describe, expect, it } from 'vitest';
import { bw2, lr4, sourceFilter, isCrossover } from '../../src/core/filters';
import { cabs, cadd, db20 } from '../../src/core/frequency';
import type { SourceSpec } from '../../src/core/types';

describe('фильтры', () => {
  it('Баттерворт 2-го порядка: −3,01 дБ на частоте среза', () => {
    expect(db20(cabs(bw2('hp', 80, 80)))).toBeCloseTo(-3.01, 2);
    expect(db20(cabs(bw2('lp', 80, 80)))).toBeCloseTo(-3.01, 2);
    expect(db20(cabs(bw2('hp', 80, 8000)))).toBeCloseTo(0, 3);
  });

  it('LR4: −6 дБ на срезе и |ФНЧ + ФВЧ| = 1 на всех частотах', () => {
    expect(db20(cabs(lr4('lp', 80, 80)))).toBeCloseTo(-6.02, 2);
    for (const f of [10, 30, 60, 80, 100, 200, 1000]) {
      expect(cabs(cadd(lr4('lp', 80, f), lr4('hp', 80, f)))).toBeCloseTo(1, 9);
    }
  });

  it('стык сабвуфера и колонок распознаётся как кроссовер', () => {
    const spk: SourceSpec = { id: 'spkL', kind: 'speaker', fLow: 80, fHigh: 20000, height: 1 };
    const sub: SourceSpec = { id: 'sub1', kind: 'sub', fLow: 20, fHigh: 80, height: 0.3 };
    expect(isCrossover([spk, sub])).toBe(true);
    expect(isCrossover([{ ...spk, fLow: 40 }, sub])).toBe(false);
    const sum = cadd(sourceFilter(spk, [spk, sub], 80), sourceFilter(sub, [spk, sub], 80));
    // ФНЧ колонки на 20 кГц и ФВЧ сабвуфера на 20 Гц слегка влияют на сумму на 80 Гц
    expect(Math.abs(cabs(sum) - 1)).toBeLessThan(0.03);
  });
});
