// V2-021–V2-025: операции редактора — размеры, поверхности, проёмы, система, слушатели, интерьер, обработка,
// перемещение и блокировка, зеркало, проверка расстановки. Исходная конфигурация не меняется.
import { describe, expect, it } from 'vitest';
import { baselinePositions } from '../../src/core/placement';
import { buildRoom, DEFAULT_NEW_ROOM } from '../../src/v2/application/rooms';
import {
  addCovering, addFurniture, addListener, addSource, addTreatment, isLocked, lockRef, mirrorOf, mirrorSource, moveRef, moveSymmetric, newOpening, newTreatment,
  patchListener, patchSource, placementIssues, removeListener, removeRef, setDimensions, setLayout, setSurface, snap, upsertOpening,
} from '../../src/v2/application/editing';
import { coreInputs } from '../../src/v2/adapters/core';
import type { RoomConfiguration } from '../../src/v2/domain/model';

const NOW = '2026-11-28T00:00:00.000Z';
let n = 0;
const id = () => `id${++n}`;
const fresh = (layout: '2.0' | '2.1' | '2.2' | 'mono' = '2.1'): RoomConfiguration =>
  buildRoom({ ...DEFAULT_NEW_ROOM, depth: 4.5, width: 3.8, height: 2.7, layout }, id, NOW).current;
const frozen = <T>(v: T): T => { const s = JSON.stringify(v); return { check: () => expect(JSON.stringify(v)).toBe(s) } as unknown as T; };

describe('059 V2-021 · геометрия, поверхности, проёмы', () => {
  it('новые размеры до выбора мест — исходные места ядра для новой комнаты', () => {
    const c = fresh();
    const keep = frozen(c) as unknown as { check: () => void };
    const { config } = setDimensions(c, { depth: 6, width: 4.2, height: 2.8 });
    keep.check();
    const i = coreInputs(config);
    const b = baselinePositions(i.room, i.sources, i.constraints);
    for (const s of config.audio.sources) expect({ x: s.position.x, y: s.position.y }).toEqual({ x: b.positions[s.id].x, y: b.positions[s.id].y });
    expect(config.listening.listeners[0].position.x).toBe(b.listener.x);
    expect(config.simulation.placement.listenerMinX).toBe(1.8);
  });

  it('после выбора мест объекты за новыми стенами сдвигаются внутрь, проём не на стене — удаляется с пояснением', () => {
    let c = fresh();
    c = moveRef(c, { type: 'source', id: 'spkR' }, { x: 0.5, y: 3.5 });
    expect(c.placed).toBe(true);
    c = upsertOpening(c, { ...newOpening(c, 'door', 'right', 'door1'), a0: 3.9, a1: 4.4 });
    const { config, notes } = setDimensions(c, { depth: 3.5, width: 3, height: 2.5 });
    expect(config.audio.sources.find((s) => s.id === 'spkR')!.position.y).toBe(2.95);
    expect(config.openings).toHaveLength(0);
    expect(notes.join(' ')).toMatch(/не помещается/);
    expect(notes.join(' ')).toMatch(/сдвинуты внутрь/);
  });

  it('размеры вне пределов отклоняются; материал — только известный', () => {
    expect(() => setDimensions(fresh(), { depth: 0.5, width: 3, height: 2.5 })).toThrow(/Длина/);
    expect(setSurface(fresh(), 'floor', 'carpet-thick').surfaces.floor.material).toBe('carpet-thick');
    expect(() => setSurface(fresh(), 'floor', 'unobtainium')).toThrow(/Неизвестный материал/);
  });

  it('проём: по умолчанию по центру стены, закрытая дверь; выход за стену и нулевая ширина отклоняются', () => {
    const c = fresh();
    const d = newOpening(c, 'door', 'back', 'd1');
    expect(d).toMatchObject({ kind: 'door', state: 'closed', a0: 1.5, a1: 2.3, bottom: 0 });
    expect(newOpening(c, 'passage', 'left', 'p1').state).toBe('permanent');
    expect(() => upsertOpening(c, { ...d, a1: 9 })).toThrow(/на стене/);
    expect(() => upsertOpening(c, { ...d, a1: d.a0 })).toThrow(/Ширина/);
  });
});

describe('059 V2-022 · аудиосистема', () => {
  it('стандартные схемы сохраняют стоящие источники с их местами и настройками', () => {
    let c = moveRef(fresh('2.0'), { type: 'source', id: 'spkL' }, { x: 0.7, y: 1 });
    c = setLayout(c, '2.2');
    expect(c.audio.sources.map((s) => s.id)).toEqual(['spkL', 'spkR', 'sub1', 'sub2']);
    expect(c.audio.sources[0].position).toMatchObject({ x: 0.7, y: 1 });
    c = setLayout(c, '5.1');
    expect(c.audio.sources.map((s) => s.channel)).toEqual(['L', 'R', 'C', 'SL', 'SR', 'LFE']);
    c = setLayout(c, 'mono');
    expect(c.audio.sources.map((s) => s.id)).toEqual(['spkC']);
  });

  it('добавленный источник — произвольная схема, сабвуферов больше двух', () => {
    let c = fresh('2.2');
    c = addSource(addSource(c, 'sub'), 'sub');
    expect(c.audio.layout).toBe('custom');
    expect(c.audio.sources.filter((s) => s.kind === 'sub').map((s) => s.id)).toEqual(['sub1', 'sub2', 'sub3', 'sub4']);
    expect(addSource(c, 'speaker').audio.sources.at(-1)).toMatchObject({ id: 'spk1', name: 'Колонка 1', kind: 'speaker', fLow: 80 });
  });

  it('диапазон источника проверяется; зеркало пары L/R относительно середины', () => {
    const c = fresh('2.0');
    expect(() => patchSource(c, 'spkL', { fLow: 500, fHigh: 100 })).toThrow(/Нижняя граница/);
    const moved = patchSource(c, 'spkL', { position: { x: 0.6, y: 0.9, z: 1.05 }, rotationDeg: 20 });
    const m = mirrorSource(moved, 'spkL').audio.sources.find((s) => s.id === 'spkR')!;
    expect(m.position).toEqual({ x: 0.6, y: 2.9, z: 1.05 });
    expect(m.rotationDeg).toBe(-20);
    expect(mirrorOf(c, 'spkL')?.id).toBe('spkR');
  });
});

describe('059 V2-023 · слушатели, интерьер, обработка', () => {
  it('всегда одно основное место; последнее место не удаляется', () => {
    let c = addListener(fresh(), id);
    const second = c.listening.listeners[1];
    expect(second.primary).toBe(false);
    c = patchListener(c, second.id, { primary: true });
    expect(c.listening.listeners.filter((l) => l.primary).map((l) => l.id)).toEqual([second.id]);
    c = removeListener(c, second.id);
    expect(c.listening.listeners[0].primary).toBe(true);
    expect(() => removeListener(c, c.listening.listeners[0].id)).toThrow(/хотя бы одно/);
  });

  it('мебель, ковёр и шторы — заготовки ядра, вписанные в комнату', () => {
    let c = addFurniture(fresh(), 'sofa', 'sofa1');
    const z = c.interior.obstacles.at(-1)!;
    expect(z).toMatchObject({ kind: 'furniture', furniture: 'sofa', name: 'Диван', canSit: true });
    expect(z.y1 - z.y0).toBeCloseTo(2, 6);
    c = addCovering(addCovering(c, 'rug', 'rug1'), 'curtain', 'cur1', 'left');
    expect(c.interior.coverings.map((x) => x.kind)).toEqual(['carpet', 'curtain']);
  });

  it('элементы обработки пяти видов; на стене — внутри стены', () => {
    let c = fresh();
    for (const k of ['panel', 'corner', 'cloud', 'diffuser', 'resonator'] as const) c = addTreatment(c, newTreatment(c, k, `t-${k}`));
    expect(c.treatment.items.map((t) => t.kind)).toEqual(['panel', 'corner', 'cloud', 'diffuser', 'resonator']);
    const r = c.treatment.items.find((t) => t.kind === 'resonator')!;
    expect(r.kind === 'resonator' && r.tuningHz).toEqual({ missing: 'unknown' });
    c = moveRef(c, { type: 'treatment', id: 't-panel' }, { x: 9, z: 0 });
    const p = c.treatment.items.find((t) => t.id === 't-panel')!;
    expect(p.kind === 'panel' && [p.at, p.z]).toEqual([4.2, 0.6]);
  });
});

describe('059 V2-024/025 · план, блокировка, привязка, ограничения', () => {
  it('закреплённый объект не двигается; блокировка снимается', () => {
    let c = lockRef(fresh(), { type: 'source', id: 'spkL' }, true);
    expect(isLocked(c, { type: 'source', id: 'spkL' })).toBe(true);
    expect(moveRef(c, { type: 'source', id: 'spkL' }, { x: 1, y: 1 })).toBe(c);
    c = lockRef(addFurniture(c, 'table', 'tb'), { type: 'obstacle', id: 'tb' }, true);
    expect(moveRef(c, { type: 'obstacle', id: 'tb' }, { x: 1, y: 1 })).toBe(c);
    c = lockRef(c, { type: 'source', id: 'spkL' }, false);
    expect(moveRef(c, { type: 'source', id: 'spkL' }, { x: 1, y: 1 }).audio.sources[0].position).toMatchObject({ x: 1, y: 1 });
  });

  it('привязка к сетке и перемещение двери вдоль стены', () => {
    expect([snap(1.234, 0.05), snap(1.234, 0.25), snap(1.234, 0)]).toEqual([1.25, 1.25, 1.234]);
    let c = upsertOpening(fresh(), newOpening(fresh(), 'door', 'back', 'd1'));
    c = moveRef(c, { type: 'opening', id: 'd1' }, { x: 4.5, y: 3.7 });
    expect(c.openings[0]).toMatchObject({ a0: 3, a1: 3.8 });
    expect(removeRef(c, { type: 'opening', id: 'd1' }).openings).toEqual([]);
  });

  it('проверка: колонка у стены и в мебели, панель на двери, слушатель у источника', () => {
    let c = fresh('2.0');
    c = moveRef(c, { type: 'source', id: 'spkL' }, { x: 0.1, y: 1 });
    c = addFurniture(c, 'wardrobe', 'w1');
    const w = c.interior.obstacles.at(-1)!;
    c = moveRef(c, { type: 'source', id: 'spkR' }, { x: (w.x0 + w.x1) / 2, y: (w.y0 + w.y1) / 2 });
    c = upsertOpening(c, { ...newOpening(c, 'door', 'left', 'dl'), a0: 1, a1: 1.8 });
    c = addTreatment(c, { ...newTreatment(c, 'panel', 'pn'), wall: 'left', at: 1.4, z: 1.2 } as never);
    const msgs = placementIssues(c).map((i) => `${i.path} ${i.message}`);
    expect(msgs.some((m) => m.startsWith('source:spkL') && /до передней стены 10 см/.test(m))).toBe(true);
    expect(msgs.some((m) => m.startsWith('source:spkR') && /на месте предмета «Шкаф»/.test(m))).toBe(true);
    expect(msgs.some((m) => m.startsWith('treatment:pn') && /закрывает дверь/.test(m))).toBe(true);
    expect(placementIssues(fresh())).toEqual([]);
  });
});

describe('059 V2-022 · исходные места тыловых и дополнительных колонок (R18)', () => {
  it('тыловые 5.1 — у боковых стен позади слушателя, сабвуфер — в переднем углу, как в ядре', () => {
    const c = setLayout(fresh('2.0'), '5.1');
    const at = (sid: string) => c.audio.sources.find((s) => s.id === sid)!.position;
    const lx = c.listening.listeners[0].position.x;
    expect(at('spkSL')).toMatchObject({ x: Math.round((lx + 0.6) * 100) / 100, y: 0.3 });
    expect(at('spkSR')).toMatchObject({ y: 3.5 });
    expect(at('sub1')).toMatchObject({ x: 0.15, y: 0.15 });
    expect(addSource(c, 'speaker').audio.sources.at(-1)!.position).toMatchObject({ x: at('spkL').x, y: 1.9 });
  });
});

describe('059 V2-025 · симметричное перемещение пары', () => {
  it('L двигается — R повторяет зеркально; сабвуфер — без пары', () => {
    const c = moveSymmetric(fresh('2.1'), { type: 'source', id: 'spkL' }, { x: 0.8, y: 1.1 });
    expect(c.audio.sources.find((s) => s.id === 'spkR')!.position).toMatchObject({ x: 0.8, y: 2.7 });
    const sub = moveSymmetric(c, { type: 'source', id: 'sub1' }, { x: 1, y: 1 });
    expect(sub.audio.sources.find((s) => s.id === 'spkR')!.position).toMatchObject({ x: 0.8, y: 2.7 });
  });
});
