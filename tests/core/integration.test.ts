import { describe, expect, it } from 'vitest';
import { optimizeSubs, optionsFor } from '../../src/core/integration';
import { defaultConstraints, defaultRoom, defaultSetup, defaultSources } from '../../src/state/project';

const room = defaultRoom();
const c = defaultConstraints(room);

describe('возможности сабвуфера', () => {
  it('варианты регулировок по режимам', () => {
    const base = defaultSources(2, 1)[2];
    expect(optionsFor({ ...base, delayMode: 'none', phaseMode: 'none', levelAdjustable: false })).toEqual({ delays: [0], phases: [0], gains: [0] });
    expect(optionsFor({ ...base, phaseMode: 'polarity' }).phases).toEqual([0, 180]);
    expect(optionsFor({ ...base, phaseMode: 'continuous' }).phases.at(-1)).toBe(180);
    expect(optionsFor({ ...base, phaseMode: 'full' }).phases.at(-1)).toBe(345);
    expect(optionsFor({ ...base, delayMode: 'adjustable', maxDelayMs: 10 }).delays.at(-1)).toBe(10);
  });
});

describe('optimizeSubs', () => {
  it('без задержки и с переключателем 0/180 — только 0°/180° и τ = 0; после ≤ до', () => {
    const sources = defaultSources(2, 1).map((s) => (s.kind === 'sub' ? { ...s, delayMode: 'none' as const, phaseMode: 'polarity' as const } : s));
    const setup = defaultSetup(room, sources, c);
    const r = optimizeSubs(room, sources, c, setup);
    expect(r.settings.sub1.delayMs).toBe(0);
    expect([0, 180]).toContain(r.settings.sub1.phaseDeg);
    expect(r.after).toBeLessThanOrEqual(r.before + 1e-9);
    expect(r.crossoverHz).toBeNull();
  });

  it('без регулировок — настройки нулевые и есть пояснение', () => {
    const sources = defaultSources(2, 1).map((s) => (s.kind === 'sub' ? { ...s, delayMode: 'none' as const, phaseMode: 'none' as const, levelAdjustable: false } : s));
    const r = optimizeSubs(room, sources, c, defaultSetup(room, sources, c));
    expect(r.settings.sub1).toEqual({ delayMs: 0, phaseDeg: 0, gainDb: 0 });
    expect(r.notes.join(' ')).toMatch(/нет регулировок/);
  });

  it('полный набор регулировок и два сабвуфера: улучшение, значения в пределах', () => {
    const sources = defaultSources(2, 2).map((s) => (s.kind === 'sub' ? { ...s, delayMode: 'adjustable' as const, maxDelayMs: 10, phaseMode: 'full' as const } : s));
    const cx = { ...c, crossover: { adjustable: true, min: 60, max: 120 } };
    const r = optimizeSubs(room, sources, cx, defaultSetup(room, sources, cx));
    for (const id of ['sub1', 'sub2']) {
      expect(r.settings[id].delayMs).toBeGreaterThanOrEqual(0);
      expect(r.settings[id].delayMs).toBeLessThanOrEqual(10);
      expect(Math.abs(r.settings[id].gainDb)).toBeLessThanOrEqual(6);
    }
    expect(r.crossoverHz).toBeGreaterThanOrEqual(60);
    expect(r.crossoverHz).toBeLessThanOrEqual(120);
    expect(r.after).toBeLessThan(r.before);
    expect(r.elapsedMs).toBeLessThan(4000);
  });
});
