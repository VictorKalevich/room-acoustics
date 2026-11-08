import { describe, expect, it } from 'vitest';
import { makeScorer, normalizeObjective, objectiveModes, shiftModesToSystem } from '../../src/core/objective';
import { flatnessScore } from '../../src/core/metric';
import { logFreqs } from '../../src/core/frequency';
import { computeModes } from '../../src/core/modes';
import { optimizePlacement } from '../../src/core/placement';
import { evaluateSetup } from '../../src/core/system';
import { listenerHeatmap } from '../../src/core/field';
import { defaultConstraints, defaultRoom, defaultSources } from '../../src/state/project';
import type { BassObjective, Placement } from '../../src/core/types';

const room = defaultRoom();
const freqs = logFreqs(20, 200, 24);
const zero = freqs.map(() => 0);
/** Отклик с колоколом (центр f0, высота дБ, ширина σ в октавах). */
const bump = (f0: number, a: number, w: number) => freqs.map((f) => a * Math.exp(-0.5 * (Math.log2(f / f0) / w) ** 2));
const sum = (...xs: number[][]) => freqs.map((_, i) => xs.reduce((s, x) => s + x[i], 0));
const sc = (o: BassObjective) => makeScorer(freqs, o, room);

describe('цели подбора', () => {
  it('«ровный бас» — прежняя оценка', () => {
    const r = sum(bump(40, 8, 0.1), bump(90, -12, 0.05));
    expect(sc({ id: 'flat' })(r, zero)).toBe(flatnessScore(r, zero));
  });

  it('«меньше провалов»: пик не штрафуется, такой же провал — штрафуется', () => {
    const peak = bump(60, 10, 0.08), dip = bump(60, -10, 0.08);
    expect(sc({ id: 'dips' })(peak, zero)).toBeLessThan(0.05);
    expect(sc({ id: 'dips' })(dip, zero)).toBeGreaterThan(1.5);
    // «ровный бас» их не различает
    expect(Math.abs(flatnessScore(peak, zero) - flatnessScore(dip, zero))).toBeLessThan(0.3);
  });

  it('уровень громкости не важен (опора — медиана)', () => {
    const r = bump(50, -9, 0.1);
    const s = sc({ id: 'dips' });
    expect(s(r.map((v) => v + 17), zero)).toBeCloseTo(s(r, zero), 9);
  });

  it('«меньше провалов внизу»: провал на 25 Гц хуже такого же на 150 Гц', () => {
    const s = sc({ id: 'lowDips' });
    expect(s(bump(25, -10, 0.08), zero)).toBeGreaterThan(2 * s(bump(150, -10, 0.08), zero));
  });

  it('«без широких провалов у нижней границы»: широкий внизу — плохо, узкий или высоко — почти не важно', () => {
    const s = sc({ id: 'wideLow' });
    const wideLow = s(bump(28, -8, 0.25), zero);
    const narrowLow = s(bump(28, -8, 0.03), zero);
    const wideHigh = s(bump(160, -8, 0.25), zero);
    expect(wideLow).toBeGreaterThan(3);
    // узкие и высокие провалы учитываются только малой «фоновой» долей (различать места при равенстве)
    expect(narrowLow).toBeLessThan(wideLow / 2.5);
    expect(wideHigh).toBeLessThan(wideLow / 3);
  });

  it('«без провалов на модах»: провал на первой осевой моде штрафуется сильнее, чем рядом с ней', () => {
    const f100 = computeModes(room, 200).find((m) => m.n[0] === 1 && m.n[1] === 0 && m.n[2] === 0)!.f;
    const s = sc({ id: 'modes', modePreset: 'first' });
    const onMode = s(bump(f100, -12, 0.05), zero);
    const between = s(bump(f100 * Math.SQRT2, -12, 0.05), zero);
    expect(onMode).toBeGreaterThan(2 * between);
  });

  it('наборы мод: первые осевые, осевые до 150 Гц, шесть самых низких, свои', () => {
    const first = objectiveModes(room, { id: 'modes', modePreset: 'first' }, 20, 200);
    expect(first.map((m) => m.n.join(''))).toEqual(expect.arrayContaining(['100', '010', '001']));
    expect(first).toHaveLength(3);
    const axial = objectiveModes(room, { id: 'modes', modePreset: 'axial' }, 20, 200);
    expect(axial.every((m) => m.f <= 150 && m.n.filter((v) => v > 0).length === 1)).toBe(true);
    expect(axial.find((m) => m.n.join('') === '100')!.w).toBeGreaterThan(axial.find((m) => m.n.join('') === '200')!.w);
    const lowest = objectiveModes(room, { id: 'modes', modePreset: 'lowest' }, 20, 200);
    expect(lowest).toHaveLength(6);
    const custom = objectiveModes(room, { id: 'modes', modePreset: 'custom', modes: [[1, 1, 0], [9, 9, 9]] }, 20, 200);
    expect(custom.map((m) => [m.n.join(''), m.w])).toEqual([['110', 0.5]]);
  });

  it('комната с проёмом: мода берётся у моды системы с похожей формой, а не у ближайшей по частоте', () => {
    const f100 = computeModes(room, 200).find((m) => m.n.join('') === '100')!.f; // 34,3 Гц
    const f010 = computeModes(room, 200).find((m) => m.n.join('') === '010')!.f; // 42,9 Гц
    const sys = [
      { f: 22, roomShare: 0.35, like: [] }, // мода коридора: не берётся
      { f: f100 * 1.14, roomShare: 0.92, like: [{ n: [1, 0, 0], mac: 0.85 }] }, // глубина ушла вверх на 2,3 полутона
      { f: f010 * 1.01, roomShare: 0.99, like: [{ n: [0, 1, 0], mac: 0.9 }] },
      { f: 200, roomShare: 1, like: [] },
    ];
    const first = objectiveModes(room, { id: 'modes', modePreset: 'first' }, 20, 200, sys);
    // по частоте 39,1 Гц ближе к ширине (42,9), но по форме это глубина
    expect(first.find((m) => m.n.join('') === '100')!.f).toBeCloseTo(f100 * 1.14, 6);
    expect(first.find((m) => m.n.join('') === '010')!.f).toBeCloseTo(f010 * 1.01, 6);
    // похожей моды системы нет — частота по основной комнате
    const f001 = computeModes(room, 200).find((m) => m.n.join('') === '001')!.f;
    expect(first.find((m) => m.n.join('') === '001')!.f).toBeCloseTo(f001, 6);
    // мода, ушедшая в коридор почти наполовину (коридор вдоль стены: 49 % в комнате), но похожая по форме, — берётся
    expect(shiftModesToSystem([{ n: [0, 1, 0], f: 42.9 }], [{ f: 38.8, roomShare: 0.49, like: [{ n: [0, 1, 0], mac: 0.64 }] }])).toEqual([38.8]);
    expect(shiftModesToSystem([{ n: [0, 1, 0], f: 42.9 }], [{ f: 40, roomShare: 0.49, like: [] }])).toEqual([42.9]);
    // без сведений о форме — ближайшая в пределах 3 полутонов
    expect(shiftModesToSystem([{ n: [1, 0, 0], f: 40 }], [{ f: 44, roomShare: 1 }, { f: 47, roomShare: 1 }])).toEqual([44]);
    expect(shiftModesToSystem([{ n: [1, 0, 0], f: 40 }], [{ f: 49, roomShare: 1 }])).toEqual([40]);
    // провал на настоящей частоте моды штрафуется, на коробочной (уже не моде) — меньше
    const s = makeScorer(freqs, { id: 'modes', modePreset: 'first' }, room, sys);
    expect(s(bump(f100 * 1.14, -12, 0.03), zero)).toBeGreaterThan(1.5 * s(bump(f100, -12, 0.03), zero));
  });

  it('нет выбранных мод в полосе — ищем меньше провалов внизу', () => {
    const r = bump(30, -10, 0.1);
    expect(sc({ id: 'modes', modePreset: 'custom', modes: [] })(r, zero)).toBeCloseTo(sc({ id: 'lowDips' })(r, zero), 9);
  });

  it('файл проекта: неизвестная цель отбрасывается, мусор в модах — тоже', () => {
    expect(normalizeObjective({ id: 'wat' })).toBeUndefined();
    expect(normalizeObjective(null)).toBeUndefined();
    expect(normalizeObjective({ id: 'modes', modePreset: 'zzz', modes: [[1, 0, 0], [1, 2], 'x', [1.5, 0, 0]] })).toEqual({ id: 'modes', modes: [[1, 0, 0]] });
  });
});

describe('цель в подборе и на картах', () => {
  const sources = defaultSources(2, 1);
  const base = defaultConstraints(room);
  const flatC = { ...base, objective: { id: 'flat' as const } };
  const lowC = { ...base, objective: { id: 'lowDips' as const } };
  const evalWith = (p: Placement, c: typeof base) => {
    const positions = Object.fromEntries(p.sources.map((s) => [s.id, s.pos]));
    return evaluateSetup(room, sources, c, { listener: p.listener, positions, subSettings: {}, crossoverHz: null });
  };

  it('подбор по цели находит вариант не хуже по этой цели, чем подбор по ровности, и наоборот', () => {
    const byFlat = optimizePlacement({ room, sources, constraints: flatC }).best[0];
    const byLow = optimizePlacement({ room, sources, constraints: lowC }).best[0];
    expect(evalWith(byLow, lowC).objScore).toBeLessThanOrEqual(evalWith(byFlat, lowC).objScore + 1e-6);
    expect(evalWith(byFlat, flatC).score).toBeLessThanOrEqual(evalWith(byLow, flatC).score + 1e-6);
    // оценка варианта по цели записана в нём
    expect(byLow.objScore).toBeCloseTo(evalWith(byLow, lowC).objScore, 6);
  });

  it('при «ровном басе» оценка по цели совпадает с неровностью', () => {
    const p = optimizePlacement({ room, sources, constraints: base }).best[0];
    expect(p.objScore).toBe(p.score);
  });

  it('карта слушателя строится по цели', () => {
    const setup = { listener: { x: 2, y: room.width / 2, z: 1.1 }, positions: { spkL: { x: 0.5, y: 1, z: 1 }, spkR: { x: 0.5, y: room.width - 1, z: 1 }, sub1: { x: 0.2, y: 0.2, z: 0.3 } }, subSettings: {}, crossoverHz: null };
    const a = listenerHeatmap(room, sources, flatC, setup);
    const b = listenerHeatmap(room, sources, { ...base, objective: { id: 'wideLow' } }, setup);
    expect(a.scores.length).toBe(b.scores.length);
    let differ = 0;
    for (let i = 0; i < a.scores.length; i++) if (Number.isFinite(a.scores[i]) && Math.abs(a.scores[i] - b.scores[i]) > 0.1) differ++;
    expect(differ).toBeGreaterThan(a.scores.length / 4);
    // лучшие места карты — с наименьшей оценкой по цели
    const min = Math.min(...Array.from(b.scores).filter((v, i) => Number.isFinite(v) && b.allowed[i]));
    expect(b.best[0].score).toBeCloseTo(min, 5);
  });
});
