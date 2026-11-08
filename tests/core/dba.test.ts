import { describe, expect, it } from 'vitest';
import { newProject, defaultSources } from '../../src/state/project';
import { dbaLayout, optimizePlacement } from '../../src/core/placement';
import { robustnessMap } from '../../src/core/field';

describe('DBA и устойчивость', () => {
  const p = newProject();
  const sources = defaultSources(2, 2).map((s) => (s.kind === 'sub' ? { ...s, delayMode: 'adjustable' as const, maxDelayMs: 30, phaseMode: 'polarity' as const } : s));

  it('раскладка DBA: два у передней, два у задней, задние с задержкой и 180°', () => {
    const four = defaultSources(2, 4).map((s) => (s.kind === 'sub' ? { ...s, delayMode: 'adjustable' as const, maxDelayMs: 30, phaseMode: 'polarity' as const } : s));
    const d = dbaLayout(p.room, four, p.constraints);
    const subs = four.filter((s) => s.kind === 'sub');
    const xs = subs.map((s) => d.positions[s.id].x);
    expect(xs.filter((x) => x < 1).length).toBe(2);
    expect(xs.filter((x) => x > p.room.depth - 1).length).toBe(2);
    const rear = subs.filter((s) => d.positions[s.id].x > 1);
    for (const s of rear) {
      expect(d.settings[s.id].phaseDeg).toBe(180);
      expect(d.settings[s.id].delayMs).toBeGreaterThan(10);
    }
    expect(d.notes.length).toBe(0);
  });

  it('вариант DBA появляется и у вариантов есть устойчивость', () => {
    const r = optimizePlacement({ room: p.room, sources, constraints: { ...p.constraints, dba: true } });
    const dba = r.best.find((b) => b.scheme === 'dba');
    expect(dba).toBeTruthy();
    expect(dba!.subSettings).toBeTruthy();
    for (const b of [...r.best, r.baseline]) expect(b.robust).toBeGreaterThanOrEqual(0);
  }, 60_000);

  it('карта устойчивости: ровное поле — ноль, ступенька — пик на границе', () => {
    const h = { kind: 'listener' as const, x0: 0, y0: 0, step: 0.1, nx: 5, ny: 5, scores: new Float32Array(25).map((_, i) => (Math.floor(i / 5) >= 3 ? 8 : 4)), allowed: new Uint8Array(25).fill(1), best: [], current: 0, min: 4, max: 8, elapsedMs: 0 };
    const r = robustnessMap(h);
    expect(r.scores[0]).toBe(0);
    expect(r.scores[2 * 5 + 2]).toBe(4);
  });
});
