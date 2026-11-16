import { describe, expect, it } from 'vitest';
import { newProject, defaultSources } from '../../src/state/project';
import { dbaLayout, optimizePlacement } from '../../src/core/placement';
import { robustnessMap } from '../../src/core/field';
import { clampToRoom, evaluateSetup } from '../../src/core/system';
import type { Placement, Vec3 } from '../../src/core/types';

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
    const c = { ...p.constraints, dba: true };
    const r = optimizePlacement({ room: p.room, sources, constraints: c });
    const dba = r.best.find((b) => b.scheme === 'dba');
    expect(dba).toBeTruthy();
    // сабвуферы варианта стоят и настроены по раскладке DBA
    const layout = dbaLayout(p.room, sources, c);
    expect(dba!.subSettings).toEqual(layout.settings);
    for (const [id, pos] of Object.entries(layout.positions)) expect(dba!.sources.find((s) => s.id === id)!.pos).toEqual(pos);

    // устойчивость — среднее ухудшение оценки (дБ) при сдвиге слушателя на ±25 см и источников на ±10 см по осям,
    // каждое ухудшение не меньше нуля; половина веса — слушатель, половина — источники
    const worse = (b: Placement) => {
      const positions = Object.fromEntries(b.sources.map((s) => [s.id, s.pos]));
      const ev = (listener: Vec3, pos: Record<string, Vec3>) =>
        evaluateSetup(p.room, sources, c, { listener, positions: pos, subSettings: b.subSettings ?? {}, crossoverHz: null }, { ppo: 12 }).objScore;
      const base = ev(b.listener, positions);
      const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      const shift = (q: Vec3, d: number[], m: number, margin: number) => clampToRoom(p.room, { ...q, x: q.x + d[0] * m, y: q.y + d[1] * m }, margin);
      const lis = dirs.map((d) => Math.max(0, ev(shift(b.listener, d, 0.25, 0.1), positions) - base));
      const src = Object.keys(positions).flatMap((id) => dirs.map((d) => Math.max(0, ev(b.listener, { ...positions, [id]: shift(positions[id], d, 0.1, 0.05) }) - base)));
      const mean = (xs: number[]) => xs.reduce((a, x) => a + x, 0) / xs.length;
      return 0.5 * mean(lis) + 0.5 * mean(src);
    };
    for (const b of [dba!, r.baseline]) expect(b.robust).toBeCloseTo(worse(b), 2);
    expect([...r.best, r.baseline].some((b) => b.robust! > 0)).toBe(true);
  }, 60_000);

  it('карта устойчивости: ровное поле — ноль, ступенька — пик на границе', () => {
    const h = { kind: 'listener' as const, x0: 0, y0: 0, step: 0.1, nx: 5, ny: 5, scores: new Float32Array(25).map((_, i) => (Math.floor(i / 5) >= 3 ? 8 : 4)), allowed: new Uint8Array(25).fill(1), best: [], current: 0, min: 4, max: 8, elapsedMs: 0 };
    const r = robustnessMap(h);
    expect(r.scores[0]).toBe(0);
    expect(r.scores[2 * 5 + 2]).toBe(4);
  });
});
