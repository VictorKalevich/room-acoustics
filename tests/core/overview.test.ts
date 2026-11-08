import { describe, expect, it } from 'vitest';
import { newProject } from '../../src/state/project';
import { buildOverview, decayLimit, ebuTm, modeDecays } from '../../src/core/overview';
import { computeModes } from '../../src/core/modes';
import { computeReverb } from '../../src/core/reverb';
import { evaluateSetup } from '../../src/core/system';

describe('обзор комнаты', () => {
  const p = newProject();
  const rev = computeReverb(p.room);
  const modes = computeModes(p.room, 300);

  it('допуск EBU: Tm и подъём к низким частотам', () => {
    expect(ebuTm(100)).toBeCloseTo(0.3, 5);
    expect(decayLimit(250, 100)).toBeCloseTo(0.35, 5);
    expect(decayLimit(40, 100)).toBeCloseTo(0.6, 5);
    expect(decayLimit(110, 100)).toBeLessThan(decayLimit(70, 100));
  });

  it('время затухания мод положительно и короче для косых мод при равных условиях', () => {
    const d = modeDecays(p.room, modes, rev, 200);
    expect(d.length).toBeGreaterThan(10);
    expect(d.every((x) => x.t60 > 0 && Number.isFinite(x.t60))).toBe(true);
    const ax = d.find((x) => x.kind === 'axial')!;
    const ob = d.find((x) => x.kind === 'oblique')!;
    expect(ob.t60).toBeLessThan(ax.t60 * 1.01);
  });

  it('оценка 0–100 и проблемы с действиями', () => {
    const ev = evaluateSetup(p.room, p.sources, p.constraints, p.current);
    const o = buildOverview(p.room, p.sources, p.current, ev, modes, rev);
    expect(o.score).toBeGreaterThanOrEqual(0);
    expect(o.score).toBeLessThanOrEqual(100);
    expect(o.subs.reduce((a, s) => a + s.weight, 0)).toBeCloseTo(1, 5);
    for (const pr of o.problems) expect(pr.actions.length).toBeGreaterThan(0);
  });

  it('несимметричная расстановка даёт проблему', () => {
    const cur = { ...p.current, positions: { ...p.current.positions, spkL: { ...p.current.positions.spkL, y: p.current.positions.spkL.y + 0.5 } } };
    const o = buildOverview(p.room, p.sources, cur, null, modes, rev);
    expect(o.problems.some((x) => x.id === 'asym')).toBe(true);
  });
});
