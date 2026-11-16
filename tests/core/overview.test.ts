import { describe, expect, it } from 'vitest';
import { newProject } from '../../src/state/project';
import { audibleDecay, buildOverview, decayLimit, ebuLimit, ebuTm, modeDecays, rtBand } from '../../src/core/overview';
import { computeModes } from '../../src/core/modes';
import { computeReverb } from '../../src/core/reverb';
import { evaluateSetup } from '../../src/core/system';
import { modalAbsorptionAt } from '../../src/core/response';
import type { ModeKind } from '../../src/core/types';

describe('обзор комнаты', () => {
  const p = newProject();
  const rev = computeReverb(p.room);
  const modes = computeModes(p.room, 300);

  it('допуск EBU: Tm и подъём к низким частотам', () => {
    expect(ebuTm(100)).toBeCloseTo(0.3, 5);
    expect(ebuLimit(250, 100)).toBeCloseTo(0.35, 5);
    expect(ebuLimit(40, 100)).toBeCloseTo(0.6, 5);
    expect(ebuLimit(110, 100)).toBeLessThan(ebuLimit(70, 100));
  });

  it('допуск для мод: не строже порога заметности Q ≈ 16 (≈ 0,5 с на 63 Гц, ≈ 0,3 с на 125 Гц)', () => {
    expect(audibleDecay(63)).toBeCloseTo(0.56, 2);
    expect(audibleDecay(125)).toBeCloseTo(0.28, 2);
    // на 30–40 Гц слух прощает долгий звон: допуск больше, чем EBU
    expect(decayLimit(32, 50)).toBeCloseTo(audibleDecay(32), 6);
    expect(decayLimit(32, 50)).toBeGreaterThan(ebuLimit(32, 50));
    // выше ~80 Гц действует допуск EBU
    expect(decayLimit(150, 50)).toBeCloseTo(ebuLimit(150, 50), 6);
  });

  it('комфортная полоса RT60 для дома: от Tm до 0,45 с', () => {
    const [lo, hi] = rtBand(50);
    expect(lo).toBeCloseTo(ebuTm(50), 6);
    expect(hi).toBeCloseTo(0.45, 6);
    expect(rtBand(400)[1]).toBeCloseTo(ebuTm(400) + 0.2, 6);
  });

  it('время затухания мод положительно и короче для косых мод при равных условиях', () => {
    const d = modeDecays(p.room, modes, rev, 200);
    expect(d.length).toBeGreaterThan(10);
    expect(d.every((x) => x.t60 > 0 && Number.isFinite(x.t60))).toBe(true);
    // одна частота: δ ∝ εx·Bx + εy·By + εz·Bz, ε = 2 по оси с n > 0, иначе 1 — у косой моды поглощают все стены вдвое
    const at = (n: [number, number, number], kind: ModeKind) => ({ n, f: 60, kind, degenerate: false, clustered: false });
    const [ax, tg, ob] = modeDecays(p.room, [at([1, 0, 0], 'axial'), at([1, 1, 0], 'tangential'), at([1, 1, 1], 'oblique')], rev, 200).map((x) => x.t60);
    const a = modalAbsorptionAt(p.room, 60);
    const [bx, by, bz] = [a.front + a.back, a.left + a.right, a.floor + a.ceiling];
    expect(ax / ob).toBeCloseTo((2 * bx + 2 * by + 2 * bz) / (2 * bx + by + bz), 6);
    expect(tg / ob).toBeCloseTo((2 * bx + 2 * by + 2 * bz) / (2 * bx + 2 * by + bz), 6);
    expect(tg).toBeLessThan(ax);
  });

  it('оценка 0–100 и проблемы с действиями', () => {
    const ev = evaluateSetup(p.room, p.sources, p.constraints, p.current);
    const at = (e: typeof ev | null) => buildOverview(p.room, p.sources, p.current, e, modes, rev);
    const bass = (o: ReturnType<typeof at>) => o.subs.find((s) => s.id === 'bass')!.value;
    const o = at(ev);
    expect(o.score).toBe(Math.round(o.subs.reduce((a, s) => a + s.value * s.weight, 0)));
    // ровность баса: 2 дБ и лучше — 100, 10 дБ и хуже — 0, между ними линейно; без оценки — 50
    expect([1, 2, 6, 10, 12].map((score) => bass(at({ ...ev, score })))).toEqual([100, 100, 50, 0, 0]);
    expect(bass(at(null))).toBe(50);
    // вес ровности баса в общей оценке — 0,4
    expect(at({ ...ev, score: 2 }).score - at({ ...ev, score: 10 }).score).toBe(40);

    // пик в отклике — гул, который можно срезать эквалайзером; провал эквалайзером не поднять
    const f = ev.response.f;
    const db = ev.response.target.map((t, i) => t + (i === 10 ? 10 : i === 30 ? -15 : 0));
    const pr = at({ ...ev, response: { ...ev.response, db } }).problems;
    const peak = pr.find((x) => x.id === `peak-${f[10].toFixed(1)}`)!;
    const dip = pr.find((x) => x.id === `dip-${f[30].toFixed(1)}`)!;
    expect(peak).toMatchObject({ severity: 'high', f: f[10] });
    expect(peak.actions).toContain('tuning');
    expect(dip).toMatchObject({ severity: 'high', f: f[30] });
    expect(dip.actions).not.toContain('tuning');
    expect(dip.actions.length).toBeGreaterThan(0);
    // сначала серьёзные
    const rank = { high: 0, medium: 1, low: 2 };
    const ranks = pr.map((x) => rank[x.severity]);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  it('несимметричная расстановка даёт проблему', () => {
    const cur = { ...p.current, positions: { ...p.current.positions, spkL: { ...p.current.positions.spkL, y: p.current.positions.spkL.y + 0.5 } } };
    const o = buildOverview(p.room, p.sources, cur, null, modes, rev);
    expect(o.problems.some((x) => x.id === 'asym')).toBe(true);
  });
});
