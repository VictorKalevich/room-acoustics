import { describe, expect, it } from 'vitest';
import { fitRoomObjects } from '../../src/core/fitRoom';
import { defaultRoom, emptyRoom, legacyRoomReady, newProject, clearedRoom } from '../../src/state/project';
import { normalizeProject, serializeProject } from '../../src/state/storage';
import type { Covering, Extension, Room, Zone } from '../../src/core/types';

const sofa: Zone = { id: 'sofa', kind: 'furniture', furniture: 'sofa', name: 'Диван', x0: 3.9, x1: 4.8, y0: 1, y1: 3, canSit: true };
const bed: Zone = { id: 'bed', kind: 'furniture', furniture: 'bed', name: 'Кровать', x0: 2, x1: 4, y0: 0.2, y1: 1.8, canSit: true };
const rug: Covering = { id: 'rug', kind: 'carpet', grade: 'thick', surface: 'floor', u0: 1, u1: 3, v0: 1, v1: 3 };
const curtain: Covering = { id: 'cur', kind: 'curtain', grade: 'heavy', surface: 'left', u0: 3.5, u1: 4.9, v0: 0, v1: 2.4 };
const room = (patch: Partial<Room> = {}): Room => ({
  ...defaultRoom(), zones: [sofa, bed], coverings: [rug, curtain],
  features: [{ id: 'win', kind: 'window', wall: 'back', a0: 1, a1: 2.3, bottom: 0.9, top: 2.3 }],
  ...patch,
});

describe('объекты внутри стен (021)', () => {
  it('без изменения размеров ничего не меняется', () => {
    const r = room();
    const f = fitRoomObjects(r);
    expect(f.removed).toEqual([]);
    expect(f.trimmed).toEqual([]);
    expect(f.room).toBe(r);
  });

  it('при уменьшении комнаты объекты за стенами удаляются, частично вышедшие — обрезаются', () => {
    const f = fitRoomObjects(room({ depth: 3.5, height: 2.2 }));
    expect(f.removed.map((x) => ('id' in x.item ? x.item.id : x.kind)).sort()).toEqual(['cur', 'sofa']);
    expect(f.trimmed.map((x) => ('id' in x.item ? x.item.id : x.kind)).sort()).toEqual(['bed', 'win']);
    expect(f.room.zones.find((z) => z.id === 'bed')).toMatchObject({ x0: 2, x1: 3.5 });
    // окно на задней стене: верх опустился до потолка
    expect(f.room.features![0]).toMatchObject({ bottom: 0.9, top: 2.2 });
    expect(f.room.coverings!.map((c) => c.id)).toEqual(['rug']);
  });

  it('проект с мебелью за стенами открывается (раньше заменялся новым), мебель вписана', () => {
    const p = newProject();
    p.room = room({ depth: 3 });
    const q = normalizeProject(JSON.parse(serializeProject(p)).project);
    expect(q.room.depth).toBe(3);
    expect(q.room.zones.map((z) => z.id)).toEqual(['bed']);
    expect(q.room.zones[0].x1).toBe(3);
  });

  it('скос и коридор приводятся к размерам комнаты; проект открывается', () => {
    const ext: Extension = { id: 'cor', name: 'Коридор', wall: 'left', a0: 3, a1: 5, depth: 1.2, height: 2.5, openStart: false, openEnd: false, openFar: false, arch: { a0: 3.2, a1: 4.6, height: 2.4 } };
    // скос шире комнаты, высота у стены выше нового потолка; арка коридора частично за новой стеной
    const r = room({ depth: 4, height: 2.2, slope: { wall: 'left', low: 2.3, run: 6 }, extensions: [ext] });
    const f = fitRoomObjects(r);
    expect(f.trimmed.map((x) => x.kind)).toEqual(expect.arrayContaining(['slope', 'extension']));
    expect(f.room.slope).toEqual({ wall: 'left', low: 2.1, run: 4 });
    expect(f.room.extensions[0]).toMatchObject({ a0: 3, a1: 5, arch: { a0: 3.2, a1: 4, height: 2.2 } });
    // коридор у отрезанного участка стены и скос уже 0,2 м — удаляются
    const g = fitRoomObjects(room({ depth: 2.5, slope: { wall: 'front', low: 1, run: 0.2 }, extensions: [ext] }));
    expect(g.removed.map((x) => x.kind)).toEqual(expect.arrayContaining(['slope', 'extension']));
    expect(g.room.slope).toBeNull();
    expect(g.room.extensions).toEqual([]);
    const p = newProject();
    p.room = r;
    expect(() => normalizeProject(JSON.parse(serializeProject(p)).project)).not.toThrow();
  });
});

describe('комната создана (021)', () => {
  it('новый проект и «Очистить» — комнаты ещё нет', () => {
    expect(newProject().roomReady).toBe(false);
    expect(clearedRoom({ ...newProject(), roomReady: true }).roomReady).toBe(false);
  });

  it('старые проекты: нетронутый — комнаты нет; скан, свои размеры, объекты или работа в других разделах — есть', () => {
    expect(legacyRoomReady(defaultRoom())).toBe(false);
    expect(legacyRoomReady(emptyRoom(), { result: null, setups: [] })).toBe(false);
    expect(legacyRoomReady({ ...defaultRoom(), depth: 6 })).toBe(true);
    expect(legacyRoomReady(defaultRoom(), { scanInfo: { fileName: 'a.obj' } })).toBe(true);
    expect(legacyRoomReady({ ...defaultRoom(), zones: [sofa] })).toBe(true);
    expect(legacyRoomReady({ ...emptyRoom(), materials: { ...emptyRoom().materials, floor: 'carpet-thick' } })).toBe(true);
    expect(legacyRoomReady(emptyRoom(), { voice: { mouthZ: 1.2 } })).toBe(true);
    expect(legacyRoomReady(defaultRoom(), { current: { measurement: { f: [1, 2], db: [0, 0] } } })).toBe(true);
    const old = JSON.parse(serializeProject({ ...newProject(), room: { ...defaultRoom(), width: 3.6 } }));
    delete old.project.roomReady;
    expect(normalizeProject(old.project).roomReady).toBe(true);
    const saved = JSON.parse(serializeProject({ ...newProject(), roomReady: true }));
    expect(normalizeProject(saved.project).roomReady).toBe(true);
  });
});
