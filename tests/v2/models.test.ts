// V2-048: расширенные модели — Фицрой и Арау-Пучадес, ясность по Баррону, мнимые источники до 3-го порядка.
// Эталоны независимы от проверяемого кода: равномерное поглощение (все модели совпадают с Эйрингом), ручной расчёт
// по формулам на числах ядра, первые отражения ядра (treatment.ts), аналитический путь отражения от пола.
import { describe, expect, it } from 'vitest';
import { alphaAt, getMaterial } from '../../src/core/materials';
import { computeReverb, surfaceAbsorptionAt, surfaceAreas } from '../../src/core/reverb';
import { reflectionPoints } from '../../src/core/treatment';
import { treatmentAlpha } from '../../src/core/treatments';
import { SURFACES } from '../../src/core/types';
import { coreInputs } from '../../src/v2/adapters/core';
import { soundSpeed } from '../../src/v2/application/analysis';
import { clarity, directivityGain, imageSources, reverbModels } from '../../src/v2/application/models';
import { buildRoom, DEFAULT_NEW_ROOM } from '../../src/v2/application/rooms';
import type { RoomConfiguration, Source } from '../../src/v2/domain/model';

const NOW = '2026-11-28T10:00:00.000Z';
let n = 0;
const id = () => `id${++n}`;
function config(material?: string): RoomConfiguration {
  const c = buildRoom({ ...DEFAULT_NEW_ROOM, name: 'Тест', depth: 5, width: 4, height: 2.5, layout: '2.0' }, id, NOW).current;
  c.openings = [];
  c.treatment.items = [];
  if (material) for (const s of SURFACES) c.surfaces[s] = { material };
  return c;
}
const speakers = (c: RoomConfiguration) => c.audio.sources.filter((s) => s.kind === 'speaker');
const listener = (c: RoomConfiguration) => (c.listening.listeners.find((l) => l.primary) ?? c.listening.listeners[0]).position;
const d3 = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

describe('реверберация: Фицрой и Арау-Пучадес (V2-048)', () => {
  it('равномерное поглощение: обе модели совпадают с Эйрингом ядра', () => {
    const m = reverbModels(config('plaster'));
    m.bands.forEach((_, i) => {
      expect(m.fitzroy[i]).toBeCloseTo(m.eyring[i], 6);
      expect(m.arau[i]).toBeCloseTo(m.eyring[i], 6);
    });
  });

  it('поглощение только на полу и потолке: ручной расчёт по формулам; Фицрой длиннее Эйринга', () => {
    const c = config('plaster');
    c.surfaces.ceiling = { material: 'acoustic-ceiling' };
    c.surfaces.floor = { material: 'carpet-thick' };
    const m = reverbModels(c);
    const room = coreInputs(c).room, rev = computeReverb(room), S = surfaceAreas(room);
    const i = 3; // 500 Гц
    const A = surfaceAbsorptionAt(room, 500), V = rev.volume, St = rev.surfaceArea;
    const air = (0.161 * V) / rev.sabine[i] - rev.absorptionArea[i];
    const pair = (a: 'front' | 'left' | 'floor', b: 'back' | 'right' | 'ceiling') => {
      const area = S[a] + S[b];
      return { share: area / St, t: (0.161 * V) / (-St * Math.log(1 - (A[a] + A[b]) / area) + air) };
    };
    const p = [pair('front', 'back'), pair('left', 'right'), pair('floor', 'ceiling')];
    expect(m.fitzroy[i]).toBeCloseTo(p.reduce((s, x) => s + x.share * x.t, 0), 9);
    expect(m.arau[i]).toBeCloseTo(p.reduce((s, x) => s * x.t ** x.share, 1), 9);
    expect(m.fitzroy[i]).toBeGreaterThan(m.eyring[i] * 1.2);
    expect(m.spread[i]).toBeGreaterThan(1.2);
  });
});

describe('направленность (V2-048)', () => {
  const axis = { x: 1, y: 0, z: 0 };
  it('всенаправленный — 1; параметрический: Q на оси, −6 дБ на краю диаграммы, ниже частоты сужения — 1', () => {
    const d = { kind: 'parametric' as const, aboveHz: 1000, beamDeg: 90 };
    expect(directivityGain({ kind: 'omni' }, axis, { x: 0, y: 1, z: 0 }, 2000)).toBe(1);
    expect(directivityGain(d, axis, axis, 2000)).toBeCloseTo(41253 / 8100, 6);
    expect(directivityGain(d, axis, { x: 1, y: 1, z: 0 }, 2000)).toBeCloseTo((41253 / 8100) * 10 ** -0.6, 6);
    expect(directivityGain(d, axis, { x: -1, y: 0, z: 0 }, 2000)).toBeCloseTo((41253 / 8100) * 10 ** -2.5, 6);
    expect(directivityGain(d, axis, { x: 0, y: 1, z: 0 }, 500)).toBe(1);
  });
});

describe('ясность по Баррону (V2-048)', () => {
  it('совпадает с ручным расчётом; ниже частоты Шрёдера не считается; далеко C80 стремится к диффузному пределу', () => {
    const c = config();
    const m = reverbModels(c);
    const s = speakers(c)[0];
    const r = d3(s.position, listener(c));
    const cl = clarity(c, m, s.id);
    const i = 4; // 1 кГц
    const t = m.used[i], V = m.volume, v = soundSpeed(c);
    const d = 100 / r ** 2, R = ((31200 * t) / V) * Math.exp((-13.82 * r) / (v * t));
    const e80 = R * (1 - Math.exp((-13.82 * 0.08) / t)), l80 = R * Math.exp((-13.82 * 0.08) / t);
    const b = cl.bands[i];
    expect(b.c80).toBeCloseTo(10 * Math.log10((d + e80) / l80), 9);
    expect(b.drr).toBeCloseTo(10 * Math.log10(d / R), 9);
    expect(b.d50!).toBeGreaterThan(0);
    expect(b.d50!).toBeLessThan(1);
    expect(b.critical).toBeCloseTo(0.0566 * Math.sqrt(V / t), 2);
    expect(cl.bands.filter((x) => x.f < m.schroeder).every((x) => x.below && x.c80 === null)).toBe(true);
    // далеко от колонки прямой звук пренебрежимо мал: C80 → 10·lg(e^(1,1056/T) − 1)
    const far: Source = { ...s, position: { x: 0.01, y: 0.01, z: 0.01 } };
    c.audio.sources = [far];
    c.listening.listeners[0].position = { x: 4.99, y: 3.99, z: 2.49 };
    const big = clarity({ ...c, geometry: { kind: 'rect', depth: 5, width: 4, height: 2.5, slope: null } }, m, far.id).bands[i];
    expect(big.c80!).toBeGreaterThan(10 * Math.log10(Math.exp((13.82 * 0.08) / t) - 1));
    expect(big.c80! - 10 * Math.log10(Math.exp((13.82 * 0.08) / t) - 1)).toBeLessThan(2);
  });
});

describe('мнимые источники (V2-048)', () => {
  it('первый порядок совпадает с первыми отражениями ядра; пол — аналитически; число путей до 3-го порядка — 62 на колонку', () => {
    const c = config();
    const res = imageSources(c, 1000);
    if (!res.ok) throw new Error(res.reason);
    const l = listener(c), v = soundSpeed(c);
    for (const s of speakers(c)) {
      const mine = res.arrivals.filter((a) => a.sourceId === s.id);
      expect(mine).toHaveLength(62);
      expect([1, 2, 3].map((k) => mine.filter((a) => a.order === k).length)).toEqual([6, 18, 38]);
      const core = reflectionPoints(coreInputs(c).room, [{ id: s.id, pos: s.position }], l);
      for (const r of core) {
        const a = mine.find((x) => x.order === 1 && x.surfaces[0] === r.surface)!;
        expect(a.points[0].x).toBeCloseTo(r.point.x, 9);
        expect(a.points[0].y).toBeCloseTo(r.point.y, 9);
        expect(a.points[0].z).toBeCloseTo(r.point.z, 9);
      }
      const floor = mine.find((x) => x.order === 1 && x.surfaces[0] === 'floor')!;
      const path = Math.hypot(s.position.x - l.x, s.position.y - l.y, s.position.z + l.z);
      const direct = d3(s.position, l);
      expect(floor.path).toBeCloseTo(path, 9);
      expect(floor.delayMs).toBeCloseTo(((path - direct) / v) * 1000, 9);
      const af = alphaAt(getMaterial(c.surfaces.floor.material).alpha, 1000);
      expect(floor.levelDb).toBeCloseTo(20 * Math.log10(direct / path) + 10 * Math.log10(1 - af), 9);
      expect(floor.elevationDeg).toBeLessThan(0);
      // второй порядок передняя — задняя: поглощение двух стен
      const fb = mine.find((x) => x.order === 2 && x.surfaces.join() === 'front,back')!;
      const aw = alphaAt(getMaterial(c.surfaces.front.material).alpha, 1000);
      expect(fb.levelDb).toBeCloseTo(20 * Math.log10(direct / fb.path) + 2 * 10 * Math.log10(1 - aw), 9);
      expect(fb.points[0].x).toBeCloseTo(0, 9);
      expect(fb.points[1].x).toBeCloseTo(5, 9);
    }
  });

  it('панель в точке отражения — α панели; открытый проём — пути нет; скос потолка — отказ с причиной', () => {
    const c = config();
    const s = speakers(c)[0];
    const res = imageSources(c);
    if (!res.ok) throw new Error(res.reason);
    const side = res.arrivals.find((a) => a.sourceId === s.id && a.order === 1 && (a.surfaces[0] === 'left' || a.surfaces[0] === 'right'))!;
    const pt = side.points[0], wall = side.surfaces[0] as 'left' | 'right';
    const panel = { id: 'p', kind: 'panel' as const, wall, at: pt.x, z: pt.z, width: 0.6, height: 1.2, thickness: 0.1 };
    const treated = imageSources({ ...c, treatment: { enabled: true, items: [panel] } });
    if (!treated.ok) throw new Error(treated.reason);
    const t = treated.arrivals.find((a) => a.id === side.id)!;
    const aw = alphaAt(getMaterial(c.surfaces[wall].material).alpha, 1000), ap = Math.min(0.999, alphaAt(treatmentAlpha(panel), 1000));
    expect(t.absorbed).toBe(1);
    expect(t.levelDb - side.levelDb).toBeCloseTo(10 * Math.log10((1 - ap) / (1 - aw)), 9);
    const open = imageSources({ ...c, openings: [{ id: 'o', kind: 'passage', wall, a0: pt.x - 0.5, a1: pt.x + 0.5, bottom: 0, top: 2.1, state: 'permanent' }] });
    if (!open.ok) throw new Error(open.reason);
    expect(open.arrivals.find((a) => a.id === side.id)).toBeUndefined();
    const sloped = imageSources({ ...c, geometry: { kind: 'rect', depth: 5, width: 4, height: 2.5, slope: { wall: 'back', low: 1.8, run: 1.5 } } });
    expect(sloped).toEqual({ ok: false, reason: expect.stringMatching(/Скос потолка/) });
  });

  it('направленная колонка: отражение за осью ослаблено относительно всенаправленной', () => {
    const c = config();
    const omni = imageSources(c, 2000);
    const s = speakers(c)[0];
    const dir = { ...c, audio: { ...c.audio, sources: c.audio.sources.map((x) => (x.id === s.id ? { ...x, directivity: { kind: 'parametric' as const, aboveHz: 1000, beamDeg: 90 } } : x)) } };
    const beam = imageSources(dir, 2000);
    if (!omni.ok || !beam.ok) throw new Error('нет расчёта');
    const front = (r: typeof omni) => r.ok && r.arrivals.find((a) => a.sourceId === s.id && a.order === 1 && a.surfaces[0] === 'front')!;
    expect((front(beam) as { levelDb: number }).levelDb).toBeLessThan((front(omni) as { levelDb: number }).levelDb - 10);
  });
});
