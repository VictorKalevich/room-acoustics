// V2-031–V2-034: показатели разделов анализа поверх ядра — геометрия колонок, SBIR, первые отражения, моды,
// поглощение поверхностей и элементов, порхающее эхо; ступени шкалы карты.
import { describe, expect, it } from 'vitest';
import { computeReverb } from '../../src/core/reverb';
import { speedOfSound } from '../../src/core/physics';
import { computeModes } from '../../src/core/modes';
import { coreInputs } from '../../src/v2/adapters/core';
import { buildRoom, DEFAULT_NEW_ROOM } from '../../src/v2/application/rooms';
import { addCovering, addTreatment, moveRef, newTreatment, patchSource } from '../../src/v2/application/editing';
import {
  absorptionShares, flutterRisk, modeRows, reflectionPaths, sbirNotches, speakerGeometry, stereoPair, surfaceDistances, treatmentEffects,
} from '../../src/v2/application/analysis';
import { heatLevel } from '../../src/v2/design-system/overlays';
import type { RoomConfiguration } from '../../src/v2/domain/model';

const NOW = '2026-11-28T10:00:00.000Z';
let n = 0;
const id = () => `id${++n}`;
const config = (): RoomConfiguration => buildRoom({ ...DEFAULT_NEW_ROOM, name: 'Тест', depth: 5, width: 4, height: 2.5, layout: '2.0' }, id, NOW).current;
const C = speedOfSound(20);

describe('059 V2-032 · колонки', () => {
  it('расстояния до шести поверхностей и стереопара симметричной расстановки', () => {
    const c = config();
    const L = c.audio.sources.find((s) => s.channel === 'L')!;
    const d = surfaceDistances(c, L.position);
    expect(d.front + d.back).toBeCloseTo(5, 9);
    expect(d.left + d.right).toBeCloseTo(4, 9);
    expect(d.floor + d.ceiling).toBeCloseTo(2.5, 9);
    const pair = stereoPair(c)!;
    expect(pair.sideOffset).toBeCloseTo(0, 6);
    expect(pair.pathDiff).toBeCloseTo(0, 6);
    const l = c.listening.listeners[0].position;
    const half = Math.atan2(Math.abs(L.position.y - l.y), l.x - L.position.x) * (180 / Math.PI);
    expect(pair.angleDeg).toBeCloseTo(2 * half, 6);
  });

  it('направление: колонка, повёрнутая на слушателя, смотрит на него; иначе — ошибка в градусах', () => {
    let c = config();
    const g = speakerGeometry(c).find((s) => s.channel === 'L')!;
    c = patchSource(c, 'spkL', { rotationDeg: g.aimDeg });
    expect(speakerGeometry(c).find((s) => s.channel === 'L')!.aimErrorDeg).toBeCloseTo(0, 9);
    c = patchSource(c, 'spkL', { rotationDeg: g.aimDeg + 15 });
    expect(speakerGeometry(c).find((s) => s.channel === 'L')!.aimErrorDeg).toBeCloseTo(15, 9);
  });

  it('SBIR: первый провал на четверти длины волны до поверхности, только в полосе 20–500 Гц', () => {
    const c = moveRef(config(), { type: 'source', id: 'spkL' }, { x: 0.5, y: 1.2 });
    const L = c.audio.sources.find((s) => s.id === 'spkL')!;
    const front = sbirNotches(c, [L]).find((x) => x.surface === 'front')!;
    expect(front.distance).toBeCloseTo(0.5, 9);
    expect(front.f).toBeCloseTo(C / 2, 6);
    for (const x of sbirNotches(c)) expect(x.f >= 20 && x.f <= 500).toBe(true);
  });
});

describe('059 V2-033 · первые отражения', () => {
  it('задержка — разность путей на скорость звука; зеркальные пути симметричной пары совпадают', () => {
    const c = config();
    const paths = reflectionPaths(c);
    expect(paths.length).toBeGreaterThan(0);
    for (const r of paths) {
      expect(r.delayMs).toBeCloseTo(((r.path - r.direct) / C) * 1000, 6);
      expect(r.path).toBeGreaterThan(r.direct);
      expect(r.levelDb).toBeLessThan(0);
      expect(r.incidenceDeg).toBeGreaterThanOrEqual(0);
      expect(r.incidenceDeg).toBeLessThanOrEqual(90);
    }
    const ll = paths.find((r) => r.sourceId === 'spkL' && r.surface === 'left')!;
    const rr = paths.find((r) => r.sourceId === 'spkR' && r.surface === 'right')!;
    expect(ll.delayMs).toBeCloseTo(rr.delayMs, 6);
  });

  it('панель в точке отражения делает её обработанной, если обработка учитывается', () => {
    let c = config();
    const p = reflectionPaths(c).find((r) => r.sourceId === 'spkL' && r.surface === 'left')!;
    expect(p.treated).toBe(false);
    c = addTreatment(c, { ...newTreatment(c, 'panel', 'p1'), wall: 'left', at: p.point.x, z: p.point.z } as never);
    expect(reflectionPaths(c).find((r) => r.sourceId === 'spkL' && r.surface === 'left')!.treated).toBe(false);
    c = { ...c, treatment: { ...c.treatment, enabled: true } };
    expect(reflectionPaths(c).find((r) => r.sourceId === 'spkL' && r.surface === 'left')!.treated).toBe(true);
    c = { ...c, treatment: { ...c.treatment, enabled: false } };
    expect(reflectionPaths(c).find((r) => r.sourceId === 'spkL' && r.surface === 'left')!.treated).toBe(false);
  });
});

describe('059 V2-031 · моды', () => {
  it('длина волны, добротность и полоса — из частоты и затухания ядра', () => {
    const c = config();
    const room = coreInputs(c).room;
    const modes = computeModes(room, 120);
    const decays = modes.slice(0, 3).map((m) => ({ f: m.f, n: m.n, kind: m.kind, t60: 0.8, limit: 0.5 }));
    const rows = modeRows(c, modes, decays);
    const r = rows[0];
    expect(r.lambda).toBeCloseTo(C / r.f, 9);
    expect(r.q!).toBeCloseTo((Math.PI * r.f * 0.8) / 6.91, 9);
    expect(r.bandwidth!).toBeCloseTo(r.f / r.q!, 9);
    expect(rows[5].t60).toBeNull();
  });
});

describe('059 V2-033/034 · поглощение и эхо', () => {
  it('вклад поверхностей на 500 Гц в сумме — эквивалентная площадь поглощения ядра', () => {
    const c = config();
    const sum = absorptionShares(c, 500).reduce((s, x) => s + x.area, 0);
    const rev = computeReverb(coreInputs(c).room);
    expect(sum).toBeCloseTo(rev.absorptionArea[rev.bands.indexOf(500)], 6);
  });

  it('элементы обработки: α по октавам и нижняя граница пористого слоя; диффузор не входит в расчёт', () => {
    let c = config();
    c = addTreatment(c, { ...newTreatment(c, 'panel', 'p1'), thickness: 0.1, gap: 0 } as never);
    c = addTreatment(c, newTreatment(c, 'diffuser', 'd1'));
    const [panel, diff] = treatmentEffects(c);
    expect(panel.alpha).toHaveLength(7);
    expect(panel.lowLimit).toBeCloseTo(C / 0.4, 6);
    expect(diff.alpha).toBeNull();
    expect(diff.lowLimit).toBeNull();
  });

  it('порхающее эхо: штора на боковой стене убирает пару боковых стен', () => {
    let c = config();
    c = { ...c, surfaces: { ...c.surfaces, left: { ...c.surfaces.left, material: 'plaster' }, right: { ...c.surfaces.right, material: 'plaster' } } };
    const before = flutterRisk(c);
    expect(before.some((f) => f.a === 'left' && f.b === 'right')).toBe(true);
    const lr = before.find((f) => f.a === 'left')!;
    expect(lr.repeatMs).toBeCloseTo(((2 * 4) / C) * 1000, 6);
    c = addCovering(c, 'curtain', 'cur', 'left');
    expect(flutterRisk(c).some((f) => f.a === 'left')).toBe(false);
  });
});

describe('059 V2-031 · шкала карты', () => {
  it('пять ступеней; меньше — лучше по умолчанию, при обратном направлении — наоборот', () => {
    expect(heatLevel(0, 0, 10)).toBe(0);
    expect(heatLevel(10, 0, 10)).toBe(4);
    expect(heatLevel(5, 0, 10)).toBe(2);
    expect(heatLevel(0, 0, 10, false)).toBe(4);
    expect(heatLevel(3, 3, 3)).toBe(0);
  });
});
