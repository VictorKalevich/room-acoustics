// V2-026–V2-030: эксперимент — независимая копия, предложения только в эксперимент, подтверждение со снимком,
// снимки и восстановление, отставание эксперимента от текущей, перечень различий.
import { describe, expect, it } from 'vitest';
import { buildRoom, DEFAULT_NEW_ROOM } from '../../src/v2/application/rooms';
import { addFurniture, addTreatment, moveRef, newOpening, newTreatment, setDimensions, setLayout, setSurface, upsertOpening } from '../../src/v2/application/editing';
import { applyProposal, diffConfigs, experimentBehind, restartExperiment, snapshotToExperiment, takeSnapshot } from '../../src/v2/application/experiment';
import { confirmExperiment, createExperiment, updateConfig } from '../../src/v2/domain/operations';
import type { Room } from '../../src/v2/domain/model';

const NOW = '2026-11-28T10:00:00.000Z';
let n = 0;
const id = () => `id${++n}`;
const room = (): Room => buildRoom({ ...DEFAULT_NEW_ROOM, name: 'Тест', depth: 4.5, width: 3.8, height: 2.7, layout: '2.1' }, id, NOW);
const json = (v: unknown) => JSON.stringify(v);

describe('059 V2-026/027 · эксперимент — независимая копия', () => {
  it('правка эксперимента не меняет текущую и наоборот; общих объектов нет', () => {
    let r = createExperiment(room(), id, NOW);
    const cur = json(r.current);
    r = updateConfig(r, 'experimental', (c) => moveRef(c, { type: 'source', id: 'spkL' }, { x: 1, y: 1 }), NOW);
    expect(json(r.current)).toBe(cur);
    expect(r.experimental!.audio.sources[0].position).toMatchObject({ x: 1, y: 1 });
    const exp = json(r.experimental);
    r = updateConfig(r, 'current', (c) => setSurface(c, 'floor', 'tile'), NOW);
    expect(json(r.experimental)).toBe(exp);
    expect(r.experimental!.audio.sources[0]).not.toBe(r.current.audio.sources[0]);
  });

  it('отставание: текущая изменилась после создания эксперимента', () => {
    let r = createExperiment(room(), id, NOW);
    expect(experimentBehind(r)).toBe(false);
    r = updateConfig(r, 'current', (c) => setSurface(c, 'floor', 'tile'), NOW);
    expect(experimentBehind(r)).toBe(true);
    expect(experimentBehind(restartExperiment(r, id, NOW))).toBe(false);
  });
});

describe('059 V2-029 · предложения и подтверждение', () => {
  it('предложение применяется только к эксперименту; без эксперимента он создаётся', () => {
    const r0 = room();
    const r = applyProposal(r0, (c) => moveRef(c, { type: 'source', id: 'sub1' }, { x: 2, y: 2 }), id, NOW);
    expect(json(r.current)).toBe(json(r0.current));
    expect(r.experimental!.audio.sources.find((s) => s.id === 'sub1')!.position).toMatchObject({ x: 2, y: 2 });
    const again = applyProposal(r, (c) => setSurface(c, 'ceiling', 'acoustic-ceiling'), id, NOW);
    expect(again.experimental!.id).toBe(r.experimental!.id);
    expect(again.experimental!.surfaces.ceiling.material).toBe('acoustic-ceiling');
    expect(again.experimental!.audio.sources.find((s) => s.id === 'sub1')!.position).toMatchObject({ x: 2, y: 2 });
  });

  it('подтверждение: эксперимент становится текущей, прежняя текущая — снимок в истории', () => {
    let r = applyProposal(room(), (c) => setSurface(c, 'floor', 'tile'), id, NOW);
    const before = json(r.current);
    r = confirmExperiment(r, id, NOW);
    expect(r.experimental).toBeNull();
    expect(r.current.surfaces.floor.material).toBe('tile');
    expect(r.history[0].reason).toBe('experiment-confirmed');
    expect(json(r.history[0].config)).toBe(before);
  });
});

describe('059 V2-030 · снимки и история', () => {
  it('снимок вручную неизменяем; восстановление снимка — в эксперимент, текущая и снимок не меняются', () => {
    let r = takeSnapshot(room(), id, NOW);
    const snap = r.history[0];
    expect(snap.reason).toBe('manual');
    r = updateConfig(r, 'current', (c) => setDimensions(c, { depth: 6, width: 4, height: 2.8 }).config, NOW);
    expect(snap.config.geometry).toMatchObject({ depth: 4.5 });
    const cur = json(r.current);
    r = snapshotToExperiment(r, snap.id, id, NOW);
    expect(r.experimental!.geometry).toMatchObject({ depth: 4.5 });
    expect(r.experimental!.role).toBe('experimental');
    expect(r.experimental!.id).not.toBe(snap.config.id);
    expect(json(r.current)).toBe(cur);
    expect(json(r.history[0])).toBe(json(snap));
    expect(() => snapshotToExperiment(r, 'нет', id, NOW)).toThrow(/не найден/);
  });
});

describe('059 V2-028 · перечень различий', () => {
  it('нет различий у копии; размеры, материал, проём, схема, перемещение, мебель, обработка, расчёт', () => {
    const r = createExperiment(room(), id, NOW);
    expect(diffConfigs(r.current, r.experimental!)).toEqual([]);
    let b = r.experimental!;
    b = setDimensions(b, { depth: 5, width: 3.8, height: 2.7 }).config;
    b = setSurface(b, 'floor', 'carpet-thick');
    b = upsertOpening(b, newOpening(b, 'door', 'left', 'd1'));
    b = setLayout(b, '2.2');
    b = moveRef(b, { type: 'source', id: 'spkL' }, { x: 0.9, y: 1.2 });
    b = addFurniture(b, 'sofa', 'sofa1');
    b = addTreatment(b, newTreatment(b, 'panel', 'p1'));
    b = { ...b, simulation: { ...b.simulation, temperatureC: 24 } };
    const text = diffConfigs(r.current, b).map((d) => `${d.area}: ${d.text}`);
    expect(text).toContain('geometry: Размеры: 4,5 × 3,8 × 2,7 → 5 × 3,8 × 2,7 м');
    expect(text).toContain('surfaces: Пол: Паркет/ламинат на бетоне → Ковёр толстый на подложке');
    expect(text).toContain('openings: Добавлено: дверь (левая стена)');
    expect(text).toContain('audio: Схема: 2.1 → 2.2');
    expect(text).toContain('audio: Добавлен источник: Сабвуфер 2');
    expect(text.some((t) => /^audio: Левая колонка: перемещение на \d+ см$/.test(t))).toBe(true);
    expect(text).toContain('interior: Добавлено: Диван');
    expect(text).toContain('treatment: Добавлено: панель');
    expect(text).toContain('simulation: Температура: 20 → 24 °C');
    const back = diffConfigs(b, r.current).map((d) => d.text);
    expect(back).toContain('Убран источник: Сабвуфер 2');
    expect(back).toContain('Убрано: дверь (левая стена)');
  });
});
