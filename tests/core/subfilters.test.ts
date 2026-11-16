import { describe, expect, it } from 'vitest';
import { newProject, defaultSources, defaultSetup } from '../../src/state/project';
import { optimizeSubFilters } from '../../src/core/subfilters';
import { allpassComplex, evaluateSetup, peqComplex, subAdjust } from '../../src/core/system';
import { peqGainDb } from '../../src/core/eq';

describe('фильтры сабвуферов', () => {
  it('all-pass не меняет модуль, PEQ совпадает с peqGainDb', () => {
    for (const f of [20, 40, 63, 100]) {
      const a = allpassComplex({ f: 50, q: 0.7 }, f);
      expect(Math.hypot(a.re, a.im)).toBeCloseTo(1, 9);
      // фаза all-pass второго порядка: −2·atan2(w/Q, 1 − w²), w = f/f0 — 0° далеко ниже f0, −180° на f0
      const w = f / 50;
      const phase = -2 * Math.atan2(w / 0.7, 1 - w * w);
      expect(a.re).toBeCloseTo(Math.cos(phase), 9);
      expect(a.im).toBeCloseTo(Math.sin(phase), 9);
      const p = peqComplex({ f: 50, gainDb: -6, q: 3 }, f);
      expect(20 * Math.log10(Math.hypot(p.re, p.im))).toBeCloseTo(peqGainDb({ f: 50, gainDb: -6, q: 3 }, f), 6);
    }
    const s = subAdjust({ delayMs: 0, phaseDeg: 0, gainDb: 0, peq: [{ f: 50, gainDb: -6, q: 3 }] }, 50);
    expect(20 * Math.log10(Math.hypot(s.re, s.im))).toBeCloseTo(-6, 3);
    const ap = allpassComplex({ f: 50, q: 0.7 }, 50);
    expect([ap.re, ap.im]).toEqual([expect.closeTo(-1, 9), expect.closeTo(0, 9)]);
    expect(allpassComplex({ f: 50, q: 0.7 }, 5).re).toBeGreaterThan(0.95);
  });

  it('подбор не ухудшает оценку и уважает число полос', () => {
    const p = newProject();
    const sources = defaultSources(2, 2).map((s) => (s.kind === 'sub' ? { ...s, peqBands: 2, allpass: true } : s));
    const setup = defaultSetup(p.room, sources, { ...p.constraints, seats: { count: 3, spacing: 0.6 } });
    const c = { ...p.constraints, seats: { count: 3, spacing: 0.6 } };
    const r = optimizeSubFilters(p.room, sources, c, setup);
    // фильтры подобраны обоим сабвуферам и заметно выравнивают бас
    expect(Object.keys(r.settings).sort()).toEqual(['sub1', 'sub2']);
    expect(Object.values(r.settings).some((s) => (s.peq ?? []).length > 0)).toBe(true);
    expect(r.after).toBeLessThan(r.before - 0.5);
    for (const s of Object.values(r.settings)) {
      expect((s.peq ?? []).length).toBeLessThanOrEqual(2);
      expect((s.allpass ?? []).length).toBeLessThanOrEqual(1);
    }
    // оценка «после» — это оценка расстановки с подобранными фильтрами
    expect(evaluateSetup(p.room, sources, c, { ...setup, subSettings: r.settings }, { ppo: 24 }).score).toBeCloseTo(r.after, 6);
  }, 60_000);
});
