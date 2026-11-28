// V2-046: форма комнаты (шаблоны и контур → основной прямоугольник и части у стен — смежные зоны ядра), отказ для
// наклонных стен и частей не у одной стены, сохранение зон пользователя; скан в конфигурацию v2.
import { describe, expect, it } from 'vitest';
import { effectiveModel } from '../../src/core/geometry';
import { analyzeLayout } from '../../src/scan/layout';
import { detectRoom } from '../../src/scan/detect';
import { toCore } from '../../src/v2/adapters/core';
import { calcSetup } from '../../src/v2/adapters/calculations';
import { newZone, upsertOpening, upsertZone, newOpening } from '../../src/v2/application/editing';
import { buildRoom, DEFAULT_NEW_ROOM } from '../../src/v2/application/rooms';
import { applyScan, scanChoice, scanDims, scanDimsProblem, scanInfo, wallItems } from '../../src/v2/application/scan';
import { applyShape, decomposeContour, parseOutline, shapeSize, templateShape, type TemplateParams } from '../../src/v2/application/shapes';
import { planAnnexes } from '../../src/v2/features/model/planItems';
import type { RoomConfiguration } from '../../src/v2/domain/model';
import { makeRoomScan } from '../fixtures/synthetic';

const NOW = '2026-11-28T10:00:00.000Z';
let n = 0;
const id = () => `id${++n}`;
const config = (): RoomConfiguration => buildRoom({ ...DEFAULT_NEW_ROOM, name: 'Тест', depth: 5, width: 4, height: 2.5, layout: '2.0' }, id, NOW).current;
const tpl = (p: Partial<TemplateParams>): TemplateParams => ({ kind: 'l', depth: 5, width: 4, height: 2.5, wall: 'back', side: 'end', along: 2, out: 1.5, offset: 0.5, nicheHeight: 2, ...p });

describe('форма комнаты (V2-046)', () => {
  it('шаблоны: Г — часть у угла, Т — по центру стены, П — две части, ниша — своей высоты', () => {
    const l = templateShape(tpl({}));
    expect(l.ok && l.draft.wings).toEqual([{ wall: 'back', a0: 2, a1: 4, depth: 1.5 }]);
    const lStart = templateShape(tpl({ side: 'start', wall: 'right', along: 3 }));
    expect(lStart.ok && lStart.draft.wings).toEqual([{ wall: 'right', a0: 0, a1: 3, depth: 1.5 }]);
    const t = templateShape(tpl({ kind: 't', along: 2 }));
    expect(t.ok && t.draft.wings).toEqual([{ wall: 'back', a0: 1, a1: 3, depth: 1.5 }]);
    const u = templateShape(tpl({ kind: 'u', along: 1.2 }));
    expect(u.ok && u.draft.wings.map((w) => [w.a0, w.a1])).toEqual([[0, 1.2], [2.8, 4]]);
    const niche = templateShape(tpl({ kind: 'niche', along: 1, out: 0.6, offset: 1.5, nicheHeight: 2.1 }));
    expect(niche.ok && niche.draft.wings).toEqual([{ wall: 'back', a0: 1.5, a1: 2.5, depth: 0.6, height: 2.1 }]);
    expect(templateShape(tpl({ kind: 'u', along: 2 })).ok).toBe(false);
    expect(templateShape(tpl({ along: 4 })).ok).toBe(false);
    expect(templateShape(tpl({ kind: 'niche', offset: 3.5, along: 1 })).ok).toBe(false);
  });

  it('контур Г-образной комнаты: наибольший прямоугольник и часть у его стены, начало в его переднем левом углу', () => {
    // 6 × 4 м и выступ 2 × 1,5 м за задней стеной у правой стены; контур сдвинут на (1; 1)
    const pts = parseOutline('1; 1\n7; 1\n7; 3\n8,5; 3\n8,5; 5\n1; 5').points;
    const r = decomposeContour(pts, 2.6);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect([r.draft.depth, r.draft.width, r.draft.height]).toEqual([6, 4, 2.6]);
    expect(r.draft.wings).toEqual([{ wall: 'back', a0: 2, a1: 4, depth: 1.5 }]);
    expect(shapeSize(r.draft)).toEqual({ area: 27, volume: 27 * 2.6 });
  });

  it('контур «плюс»: части у противоположных стен; прямоугольник — без частей', () => {
    const plus = decomposeContour([{ x: 0, y: 2 }, { x: 2, y: 2 }, { x: 2, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 2 }, { x: 8, y: 2 }, { x: 8, y: 4 }, { x: 6, y: 4 }, { x: 6, y: 6 }, { x: 2, y: 6 }, { x: 2, y: 4 }, { x: 0, y: 4 }], 2.5);
    expect(plus.ok && plus.draft.wings.map((w) => w.wall).sort()).toEqual(['back', 'front']);
    const rect = decomposeContour([{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 4 }, { x: 0, y: 4 }, { x: 0, y: 0 }], 2.5);
    expect(rect.ok && rect.draft).toEqual({ depth: 5, width: 4, height: 2.5, wings: [] });
  });

  it('отказы с причиной: наклонная стена, самопересечение, ступенчатая часть, часть не у одной стены', () => {
    const slanted = decomposeContour([{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 4 }, { x: 0, y: 3 }], 2.5);
    expect(!slanted.ok && slanted.reason).toMatch(/наклонный/);
    const bow = decomposeContour([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 2, y: 4 }, { x: 2, y: -1 }, { x: 0, y: -1 }], 2.5);
    expect(bow.ok).toBe(false);
    const stepped = decomposeContour([{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 1 }, { x: 7, y: 1 }, { x: 7, y: 2 }, { x: 8, y: 2 }, { x: 8, y: 4 }, { x: 0, y: 4 }], 2.5);
    expect(!stepped.ok && stepped.reason).toMatch(/ступенчатая/);
    const zShape = decomposeContour([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }, { x: 7, y: 3 }, { x: 7, y: 6 }, { x: 3, y: 6 }, { x: 3, y: 4 }, { x: 0, y: 4 }], 2.5);
    expect(zShape.ok).toBe(false);
    expect(decomposeContour([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }], 2.5).ok).toBe(false);
    expect(parseOutline('1; 2\nабв').error).toMatch(/Строка 2/);
  });

  it('применение: части — смежные зоны ядра, считаются волновой моделью; зоны пользователя остаются, проём на проходе удалён', () => {
    let c = config();
    c = upsertZone(c, { ...newZone(c, 'front', 'corr', 'Коридор'), a0: 0, a1: 1, arch: { a0: 0, a1: 1, height: 2 } });
    c = upsertOpening(c, { ...newOpening(c, 'door', 'back', 'door1'), a0: 2.5, a1: 3.3 });
    const d = templateShape(tpl({}));
    if (!d.ok) throw new Error(d.reason);
    const r = applyShape(c, 'l', d.draft, id);
    expect(r.config.shape?.kind).toBe('l');
    expect(r.config.zones.map((z) => z.name)).toEqual(['Коридор', 'Часть комнаты 1']);
    const wing = r.config.zones[1];
    expect(wing.arch).toEqual({ a0: 2, a1: 4, height: 2.5 });
    expect(r.config.openings.some((o) => o.id === 'door1')).toBe(false);
    expect(r.notes.join(' ')).toMatch(/Проёмов на открытых участках стен удалено: 1/);
    const core = toCore(r.config);
    expect(core.ok && effectiveModel(core.inputs.room)).toBe('wave');
    expect(core.ok && core.limitations.join(' ')).toMatch(/Сложная форма/);
    expect(planAnnexes(r.config).map((a) => [a.label, a.part, a.x0, a.x1, a.y0, a.y1])).toEqual([['Коридор', false, -1.5, 0, 0, 1], ['Часть комнаты 1', true, 5, 6.5, 2, 4]]);
    // повторное применение заменяет части формы, а не добавляет; прямоугольник убирает форму
    const again = applyShape(r.config, 'l', d.draft, id);
    expect(again.config.zones.filter((z) => z.name.startsWith('Часть')).length).toBe(1);
    const back = applyShape(again.config, 'rect', { depth: 5, width: 4, height: 2.5, wings: [] }, id);
    expect(back.config.shape).toBeUndefined();
    expect(back.config.zones.map((z) => z.name)).toEqual(['Коридор']);
  });

  it('расчёт ядра принимает комнату Г-образной формы', () => {
    const d = templateShape(tpl({ out: 1 }));
    if (!d.ok) throw new Error(d.reason);
    const c = applyShape(config(), 'l', d.draft, id).config;
    const ev = calcSetup({ ...c, simulation: { ...c.simulation, model: 'wave' } }, NOW);
    expect(ev.ok).toBe(true);
  }, 60_000);
});

describe('скан в v2 (V2-046)', () => {
  const tri = makeRoomScan({ depth: 5, width: 4, height: 2.5, openings: true, furniture: true });
  const det = detectRoom(tri);
  const layout = analyzeLayout(tri, det.transform, det);

  it('распознанные размеры, двери, окна и мебель — в конфигурацию; ручное остаётся, найденное помечено', () => {
    let c = config();
    c = upsertOpening(c, { ...newOpening(c, 'window', 'front', 'manual-win'), a0: 1, a1: 2 });
    const items = wallItems(layout);
    expect(items.length).toBeGreaterThan(0);
    const choice = scanChoice(det, layout, items.map((i) => i.guess), layout.furniture.map(() => ({ on: true, sit: true })), true);
    const info = { fileName: 'room.obj', format: 'obj', units: det.units, unitsGuessed: det.unitsGuessed, confidence: det.confidence, depth: det.depth, width: det.width, height: det.height, warnings: det.warnings };
    const r = applyScan(c, choice, info, id, NOW);
    const g = r.config.geometry;
    expect(g.kind === 'rect' && [g.depth, g.width, g.height].map((v) => Math.round(v * 10) / 10)).toEqual([5, 4, 2.5]);
    expect(r.config.geometrySource).toBe('scan');
    expect(r.config.openings.find((o) => o.id === 'manual-win')).toBeTruthy();
    expect(r.config.openings.filter((o) => o.fromScan).length).toBe(items.length);
    expect(r.config.interior.obstacles.filter((z) => z.fromScan).length).toBe(layout.furniture.length);
    expect(scanInfo(r.config)?.fileName).toBe('room.obj');
    // повторное применение заменяет найденное, а не дублирует
    const again = applyScan(r.config, choice, info, id, NOW);
    expect(again.config.openings.filter((o) => o.fromScan).length).toBe(items.length);
    expect(toCore(again.config).ok).toBe(true);
  });

  it('новая комната по скану (D61): размеры, проёмы и мебель из скана сразу при создании', () => {
    const items = wallItems(layout);
    const choice = scanChoice(det, layout, items.map((i) => i.guess), layout.furniture.map(() => ({ on: true, sit: true })), false);
    const info = { fileName: 'room.glb', format: 'glb', units: det.units, unitsGuessed: det.unitsGuessed, confidence: det.confidence, depth: det.depth, width: det.width, height: det.height, warnings: det.warnings };
    const room = buildRoom({ ...DEFAULT_NEW_ROOM, name: 'По скану', ...scanDims(choice) }, id, NOW, { choice, info });
    const c = room.current;
    expect(c.geometry.kind === 'rect' && [c.geometry.depth, c.geometry.width, c.geometry.height]).toEqual(Object.values(scanDims(choice)));
    expect(c.geometrySource).toBe('scan');
    expect(c.openings.filter((o) => o.fromScan).length).toBe(items.length);
    expect(c.interior.obstacles.filter((z) => z.fromScan).length).toBe(layout.furniture.length);
    expect(scanInfo(c)).toMatchObject({ fileName: 'room.glb', appliedAt: NOW });
    expect(toCore(c).ok).toBe(true);
  });

  it('неверные единицы — отказ без изменения комнаты', () => {
    expect(scanDimsProblem({ depth: 500, width: 400, height: 250 })).toMatch(/единицы/);
    const choice = scanChoice({ ...det, depth: 500, width: 400, height: 250 }, layout, [], [], false);
    expect(() => applyScan(config(), choice, { fileName: 'x', format: 'obj', units: 'm', unitsGuessed: true, confidence: 1, depth: 500, width: 400, height: 250, warnings: [] }, id, NOW)).toThrow(/единицы/);
  });
});
