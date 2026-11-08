import { describe, expect, it } from 'vitest';
import { newProject, defaultSources, defaultSetup } from '../../src/state/project';
import { optimizeSubFilters } from '../../src/core/subfilters';
import { allpassComplex, peqComplex, subAdjust } from '../../src/core/system';
import { peqGainDb } from '../../src/core/eq';

describe('фильтры сабвуферов', () => {
  it('all-pass не меняет модуль, PEQ совпадает с peqGainDb', () => {
    for (const f of [20, 40, 63, 100]) {
      const a = allpassComplex({ f: 50, q: 0.7 }, f);
      expect(Math.hypot(a.re, a.im)).toBeCloseTo(1, 9);
      const p = peqComplex({ f: 50, gainDb: -6, q: 3 }, f);
      expect(20 * Math.log10(Math.hypot(p.re, p.im))).toBeCloseTo(peqGainDb({ f: 50, gainDb: -6, q: 3 }, f), 6);
    }
    const s = subAdjust({ delayMs: 0, phaseDeg: 0, gainDb: 0, peq: [{ f: 50, gainDb: -6, q: 3 }] }, 50);
    expect(20 * Math.log10(Math.hypot(s.re, s.im))).toBeCloseTo(-6, 3);
  });

  it('подбор не ухудшает оценку и уважает число полос', () => {
    const p = newProject();
    const sources = defaultSources(2, 2).map((s) => (s.kind === 'sub' ? { ...s, peqBands: 2, allpass: true } : s));
    const setup = defaultSetup(p.room, sources, { ...p.constraints, seats: { count: 3, spacing: 0.6 } });
    const c = { ...p.constraints, seats: { count: 3, spacing: 0.6 } };
    const r = optimizeSubFilters(p.room, sources, c, setup);
    expect(r.after).toBeLessThanOrEqual(r.before + 1e-6);
    for (const [id, s] of Object.entries(r.settings)) {
      if (!id.startsWith('sub')) continue;
      expect((s.peq ?? []).length).toBeLessThanOrEqual(2);
      expect((s.allpass ?? []).length).toBeLessThanOrEqual(1);
    }
  }, 60_000);
});
