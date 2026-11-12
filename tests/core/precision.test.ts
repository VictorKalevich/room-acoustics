import { describe, it, expect } from 'vitest';
import { PRECISION, evalPpo, gridPpo, normalizePrecision, pointsPerOctave } from '../../src/core/precision';
import { optimizePlacement } from '../../src/core/placement';
import { objectivePpo } from '../../src/core/objective';
import { optimizeSubs } from '../../src/core/integration';
import { listenerHeatmap } from '../../src/core/field';
import { evaluateSetup, seatAllowed, sourceAllowed } from '../../src/core/system';
import { evaluateVoice, spotAllowed, voiceBands, voiceContext, voiceMap, voiceMapStep, VOICE_DEFAULTS } from '../../src/core/voice';
import { normalizeProject } from '../../src/state/storage';
import { defaultSources } from '../../src/state/project';

const project = (room = { depth: 4, width: 3, height: 2.7 }) => normalizeProject({ room, sources: defaultSources(2, 1) });

describe('точность расчёта (026)', () => {
  it('неизвестное значение — стандартная; стандартная повторяет прежние сетки', () => {
    expect(normalizePrecision(undefined)).toBe('standard');
    expect(normalizePrecision('ultra')).toBe('standard');
    expect(normalizePrecision('max')).toBe('max');
    expect(evalPpo(undefined)).toBe(24);
    expect(evalPpo('standard', 48)).toBe(48);
    expect(evalPpo('max', 48)).toBe(96);
    for (const o of [undefined, { id: 'flat' as const }, { id: 'dips' as const }, { id: 'modes' as const }]) {
      expect(gridPpo('standard', o)).toBe(objectivePpo(o, 12));
    }
    expect(gridPpo('high', undefined)).toBe(24);
    expect(gridPpo('high', { id: 'dips' })).toBe(48);
    expect(PRECISION.standard.voiceBands).toBe(6);
  });

  it('подбор при стандартной точности не изменился, при повышенной — график подробнее', () => {
    const p = project();
    const input = { room: p.room, sources: p.sources, constraints: p.constraints };
    const std = optimizePlacement(input);
    const legacy = optimizePlacement(input, undefined, { ppo: 12, finalPpo: 24 });
    expect(std.best.map((b) => b.score)).toEqual(legacy.best.map((b) => b.score));
    expect(Math.round(pointsPerOctave(std.best[0].response.f))).toBe(24);
    const high = optimizePlacement({ ...input, precision: 'high' });
    expect(Math.round(pointsPerOctave(high.best[0].response.f))).toBe(48);
    // варианты упорядочены по оценке на сетке графика
    const scores = high.best.map((b) => b.objScore ?? b.score);
    expect([...scores].sort((a, b) => a - b)).toEqual(scores);
    // оценка лучшего варианта совпадает с отдельной оценкой той же расстановки на той же сетке
    const b = high.best[0];
    const again = evaluateSetup(p.room, p.sources, p.constraints, {
      listener: b.listener, positions: Object.fromEntries(b.sources.map((s) => [s.id, s.pos])), subSettings: {}, crossoverHz: null,
    }, { ppo: 48 });
    expect(again.score).toBeCloseTo(b.score, 9);
  });

  it('настройка сабвуфера и карта принимают сетку точности', () => {
    const p = project();
    const r24 = optimizeSubs(p.room, p.sources, p.constraints, p.current);
    const r96 = optimizeSubs(p.room, p.sources, p.constraints, p.current, { ppo: 96 });
    expect(Math.round(pointsPerOctave(r24.responseAfter.f))).toBe(24);
    expect(Math.round(pointsPerOctave(r96.responseAfter.f))).toBe(96);
    expect(r96.after).toBeLessThanOrEqual(r96.before + 1e-9);
    expect(Math.abs(r96.before - r24.before)).toBeLessThan(0.5);
    const m12 = listenerHeatmap(p.room, p.sources, p.constraints, p.current);
    const m24 = listenerHeatmap(p.room, p.sources, p.constraints, p.current, { ppo: 24 });
    expect(m24.scores.length).toBe(m12.scores.length);
    // карта на сетке графика даёт у текущего места то же число, что и оценка расстановки
    const ev = evaluateSetup(p.room, p.sources, p.constraints, p.current, { ppo: 24 });
    expect(m24.current).toBeCloseTo(ev.objScore, 6);
  });

  it('голос: узкие полосы делят полосы 1/6 октавы, оценка остаётся оценкой по 1/6 октавы', () => {
    const b6 = voiceBands(80, 12000), b24 = voiceBands(80, 12000, 24);
    expect(b24.fc.length).toBe(4 * b6.fc.length);
    b6.f1.forEach((f, k) => expect(b24.f1[4 * k]).toBeCloseTo(f, 9));
    const room = project({ depth: 5, width: 4, height: 2.5 }).room;
    const spot = { x: 1.6, y: 1.1, facing: 0 };
    const std = evaluateVoice(voiceContext(room, VOICE_DEFAULTS), spot);
    const same = evaluateVoice(voiceContext(room, VOICE_DEFAULTS, 6), spot);
    expect(same.score).toBe(std.score);
    for (const bands of [24, 48]) {
      const fine = evaluateVoice(voiceContext(room, VOICE_DEFAULTS, bands), spot);
      expect(fine.f.length).toBe((bands / 6) * std.f.length);
      expect(Math.abs(fine.score - std.score)).toBeLessThan(0.1);
      expect(Math.abs(fine.roomDb - std.roomDb)).toBeLessThan(0.5);
    }
  });

  it('голос: шаг карты при стандартной точности прежний, при повышенной — мельче', () => {
    const room = project({ depth: 5, width: 4, height: 2.5 }).room;
    expect(voiceMapStep(room)).toBe(0.25);
    expect(voiceMapStep(room, 'high')).toBeLessThan(0.25);
    expect(voiceMapStep(room, 'max')).toBeGreaterThanOrEqual(0.1);
    const std = voiceMap(room, VOICE_DEFAULTS);
    expect(voiceMap(room, VOICE_DEFAULTS, undefined, 'flatness', 'standard')).toEqual(std);
    const high = voiceMap(room, VOICE_DEFAULTS, undefined, 'flatness', 'high');
    expect(high.nx * high.ny).toBeGreaterThan(std.nx * std.ny);
  });
});

describe('скос потолка: точки над скосом', () => {
  const sloped = (low: number, run: number) => normalizeProject({ room: { depth: 5, width: 4, height: 2.5, slope: { wall: 'front', low, run } }, sources: defaultSources(2, 1) });

  it('источник и слушатель не ставятся туда, где их высота выше скоса', () => {
    const { room } = sloped(0.9, 2);
    expect(sourceAllowed(room, { x: 0.1, y: 2, z: 1 })).toBe(false);
    expect(sourceAllowed(room, { x: 0.2, y: 2, z: 0.3 })).toBe(true);
    expect(seatAllowed(room, { x: 0.3, y: 2, z: 1.1 })).toBe(false);
    expect(seatAllowed(room, { x: 3, y: 2, z: 1.1 })).toBe(true);
    // без высоты — как раньше
    expect(sourceAllowed(room, { x: 0.2, y: 2 })).toBe(true);
  });

  it('карта слушателя и оценка считаются, а не падают', () => {
    const p = sloped(0.9, 2);
    const hm = listenerHeatmap(p.room, p.sources, p.constraints, p.current, { step: 0.25 });
    expect(Number.isFinite(hm.min)).toBe(true);
    // под низким скосом сидеть нельзя
    expect(hm.allowed[0]).toBe(0);
    const ev = evaluateSetup(p.room, p.sources, p.constraints, p.current);
    expect(Number.isFinite(ev.score)).toBe(true);
  }, 120000);

  it('место для записи не предлагается там, где голова выше скоса', () => {
    const { room } = sloped(0.8, 2.5);
    expect(spotAllowed(room, 1.1, 2, 0, VOICE_DEFAULTS)).toBe(false);
    expect(spotAllowed(room, 3.5, 2, 0, VOICE_DEFAULTS)).toBe(true);
  });
});
