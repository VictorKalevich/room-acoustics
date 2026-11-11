import { describe, expect, it } from 'vitest';
import {
  FURNITURE, contribution, coveringArea, furnishingOctaves, furnitureAbsorption, furnitureAtWall, listOctaves,
  newCurtain, newFurniture, newRug, newWallCarpet, rotateFurniture, scanFurnitureType,
} from '../../src/core/furniture';
import { FURNISHING } from '../../src/core/materials';
import { computeReverb } from '../../src/core/reverb';
import { modeDamping } from '../../src/core/response';
import { defaultRoom, newProject, rotateCovering, rotateRoom } from '../../src/state/project';
import { normalizeProject, parseProjectFile, serializeProject } from '../../src/state/storage';
import type { Covering, Room, Zone } from '../../src/core/types';

const room = (patch: Partial<Room> = {}): Room => ({ ...defaultRoom(), ...patch });
const sofa = (r: Room): Zone => ({ ...newFurniture(r, 'sofa', 'sofa', 'Диван'), x0: 3.9, x1: 4.8, y0: 1, y1: 3 });
const armchair = (r: Room): Zone => ({ ...newFurniture(r, 'armchair', 'chair', 'Кресло'), x0: 3.9, x1: 4.75, y0: 0.1, y1: 0.95 });
const rug: Covering = { id: 'rug', kind: 'carpet', grade: 'thick', surface: 'floor', u0: 1, u1: 4, v0: 1, v1: 3 };
const curtains: Covering = { id: 'cur', kind: 'curtain', grade: 'heavy', surface: 'left', u0: 1, u1: 3.5, v0: 0, v1: 2.5 };
/** Типовой набор жилой комнаты из критерия приёмки 019. */
const typicalSet = (r: Room): Room => ({ ...r, zones: [sofa(r), armchair(r)], coverings: [rug, curtains] });

describe('обстановка по списку (019)', () => {
  it('без списка — прежний общий уровень, ковры, шторы и мебель не учитываются', () => {
    const r = room();
    const withItems = { ...typicalSet(r), furnitureList: false };
    expect(furnishingOctaves(withItems)).toEqual(FURNISHING.typical);
    expect(computeReverb(withItems).used).toEqual(computeReverb(r).used);
  });

  it('со списком бас (63 и 125 Гц) — общий уровень, 250 Гц — переход, выше — список', () => {
    const r = { ...typicalSet(room({ furnishing: 'heavy' })), furnitureList: true };
    const v = furnishingOctaves(r);
    const list = listOctaves(r);
    expect(v[0]).toBe(FURNISHING.heavy[0]);
    expect(v[1]).toBe(FURNISHING.heavy[1]);
    expect(v[2]).toBeCloseTo((FURNISHING.heavy[2] + list[2]) / 2, 9);
    for (const k of [3, 4, 5, 6]) expect(v[k]).toBeCloseTo(list[k], 9);
    const base = computeReverb(room({ furnishing: 'heavy' }));
    const rev = computeReverb(r);
    expect(rev.used[0]).toBeCloseTo(base.used[0], 9);
    expect(rev.used[1]).toBeCloseTo(base.used[1], 9);
  });

  it('затухание мод на басу не меняется от списка', () => {
    const r = room();
    const listed = { ...typicalSet(r), furnitureList: true };
    for (const mode of [{ n: [1, 0, 0] as [number, number, number], f: 34.3 }, { n: [0, 1, 0] as [number, number, number], f: 42.9 }, { n: [0, 0, 1] as [number, number, number], f: 68.6 }]) {
      expect(modeDamping(mode, listed)).toBeCloseTo(modeDamping(mode, r), 9);
    }
  });

  it('типовой набор в комнате 5 × 4 × 2,5 м даёт RT60 жилой комнаты 0,4–0,6 с', () => {
    const rev = computeReverb({ ...typicalSet(room()), furnitureList: true });
    expect(rev.tMid).toBeGreaterThan(0.4);
    expect(rev.tMid).toBeLessThan(0.6);
  });

  it('пустой список — меньше поглощения, чем обычная меблировка, но не пустая комната', () => {
    const listed = computeReverb(room({ furnitureList: true })).tMid;
    expect(listed).toBeGreaterThan(computeReverb(room()).tMid);
    expect(listed).toBeLessThan(computeReverb(room({ furnishing: 'empty' })).tMid);
  });

  it('жёсткая мебель не влияет на расчёт звука', () => {
    const r = room({ furnitureList: true });
    for (const t of ['wardrobe', 'shelf', 'table', 'chair', 'chest', 'other'] as const) {
      const z = newFurniture(r, t, t, t);
      expect(furnitureAbsorption(z).every((a) => a === 0)).toBe(true);
      expect(computeReverb({ ...r, zones: [z] }).used).toEqual(computeReverb(r).used);
    }
  });

  it('мягкая мебель и стеллаж с книгами поглощают; разложенный диван — больше сложенного', () => {
    const r = room();
    const folded = furnitureAbsorption(newFurniture(r, 'sofa', 'a', ''));
    const open = furnitureAbsorption(newFurniture(r, 'sofa-open', 'b', ''));
    expect(open[4]).toBeGreaterThan(folded[4]);
    // кресло — порядка 1–1,5 м² на 1 кГц (эквивалентная площадь поглощения кресла на предмет)
    const chair = furnitureAbsorption(newFurniture(r, 'armchair', 'c', ''));
    expect(chair[4]).toBeGreaterThan(0.9);
    expect(chair[4]).toBeLessThan(1.6);
    expect(furnitureAbsorption(newFurniture(r, 'bookshelf', 'd', ''))[4]).toBeCloseTo(0.3 * 1.0 * 2.0, 6);
  });

  it('вклад словами зависит от доли в поглощении комнаты; шкаф — не учитывается', () => {
    const r = { ...typicalSet(room()), furnitureList: true };
    const total = computeReverb(r).absorptionArea;
    const rugA = listOctaves({ ...room(), coverings: [rug] }).map((v) => (v - 0.15) * 20) as never;
    expect(contribution(rugA, total)).toBe('strong');
    // в обставленной комнате кресло — малая доля, в почти пустой — заметная
    expect(contribution(furnitureAbsorption(armchair(r)), total)).toBe('small');
    const sparse = { ...room(), furnitureList: true, zones: [armchair(room())] };
    expect(contribution(furnitureAbsorption(armchair(r)), computeReverb(sparse).absorptionArea)).toBe('noticeable');
    expect(contribution(furnitureAbsorption(newFurniture(r, 'wardrobe', 'w', '')), total)).toBe('none');
  });

  it('площадь покрытия считается в пределах поверхности после уменьшения комнаты', () => {
    expect(coveringArea(room(), rug)).toBeCloseTo(6, 9);
    expect(coveringArea(room({ depth: 2 }), rug)).toBeCloseTo(2, 9);
  });
});

describe('заготовки и геометрия (019)', () => {
  it('шторы закрывают окно стены с запасом и вписаны в стену', () => {
    const r = room({ features: [{ id: 'w', kind: 'window', wall: 'left', a0: 1, a1: 2.3, bottom: 0.9, top: 2.3 }] });
    const c = newCurtain(r, 'left', 'c');
    expect([c.u0, c.u1, c.v0, c.v1].map((v) => Math.round(v * 100) / 100)).toEqual([0.85, 2.45, 0, 2.45]);
    const small = newCurtain(room({ width: 1.2, height: 1.5 }), 'front', 'c');
    expect(small.u0).toBeGreaterThanOrEqual(0);
    expect(small.u1).toBeLessThanOrEqual(1.2);
    expect(small.v1).toBeLessThanOrEqual(1.5);
  });

  it('заготовки мебели, ковров и ковра на стене вписаны в маленькую комнату', () => {
    const r = room({ depth: 1.5, width: 1.2, height: 1.4 });
    for (const t of Object.keys(FURNITURE) as (keyof typeof FURNITURE)[]) {
      const z = newFurniture(r, t, t, t);
      expect(z.x0).toBeGreaterThanOrEqual(0);
      expect(z.x1).toBeLessThanOrEqual(1.5);
      expect(z.y1).toBeLessThanOrEqual(1.2);
      expect(z.height!).toBeLessThanOrEqual(1.4);
    }
    const g = newRug(r, 'g');
    expect(g.u1).toBeLessThanOrEqual(1.5);
    expect(g.v1).toBeLessThanOrEqual(1.2);
    const wc = newWallCarpet(r, 'back', 'wc');
    expect(wc.u1).toBeLessThanOrEqual(1.2);
    expect(wc.v1).toBeLessThanOrEqual(1.4);
  });

  it('поворот предмета на 90° меняет размеры местами и оставляет его в комнате', () => {
    const r = room();
    const z = { ...newFurniture(r, 'sofa', 's', ''), x0: 4.1, x1: 5, y0: 1, y1: 3 };
    const t = rotateFurniture(r, z);
    expect(t.x1 - t.x0).toBeCloseTo(2, 9);
    expect(t.y1 - t.y0).toBeCloseTo(0.9, 9);
    expect(t.x1).toBeLessThanOrEqual(5);
  });

  it('мебель у стены попадает на развёртку этой стены', () => {
    const r = room({ zones: [sofa(room())] });
    expect(furnitureAtWall(r, 'back').map((x) => [x.a0, x.a1])).toEqual([[1, 3]]);
    expect(furnitureAtWall(r, 'front')).toEqual([]);
  });

  it('четыре поворота комнаты возвращают покрытия на место', () => {
    let r = room({ coverings: [rug, curtains, { ...curtains, id: 'f', surface: 'front', u0: 0.5, u1: 1.5 }] });
    for (let i = 0; i < 4; i++) r = rotateRoom(r);
    expect(r.coverings!.map((c) => [c.surface, +c.u0.toFixed(9), +c.u1.toFixed(9), +c.v0.toFixed(9), +c.v1.toFixed(9)]))
      .toEqual([rug, curtains, { ...curtains, surface: 'front', u0: 0.5, u1: 1.5 }].map((c) => [c.surface, c.u0, c.u1, c.v0, c.v1]));
    const once = rotateCovering(room(), curtains);
    expect(once.surface).not.toBe('left');
  });

  it('категории скана получают типы мебели', () => {
    expect(['sofa', 'couch', 'bed', 'armchair', 'chair', 'table', 'desk', 'storage', 'shelf', 'piano'].map(scanFurnitureType))
      .toEqual(['sofa', 'sofa', 'bed', 'armchair', 'chair', 'table', 'table', 'wardrobe', 'shelf', 'other']);
  });
});

describe('файл проекта (019)', () => {
  it('старый проект без новых полей открывается с выключенным списком и без покрытий', () => {
    const p = newProject();
    const old = JSON.parse(serializeProject(p));
    delete old.project.room.coverings;
    delete old.project.room.furnitureList;
    old.project.room.zones = [{ id: 'z', kind: 'furniture', x0: 1, x1: 2, y0: 1, y1: 2, canSit: true, name: 'Диван', fromScan: true }];
    const q = parseProjectFile(JSON.stringify(old));
    expect(q.room.furnitureList).toBe(false);
    expect(q.room.coverings).toEqual([]);
    expect(q.room.zones[0].furniture).toBeUndefined();
    expect(computeReverb(q.room).used).toEqual(computeReverb({ ...q.room, zones: [] }).used);
  });

  it('новые поля сохраняются, неверные отбрасываются', () => {
    const p = newProject();
    p.room = {
      ...typicalSet(p.room), furnitureList: true,
      coverings: [rug, curtains, { ...rug, id: 'bad', grade: 'heavy' }, { ...curtains, id: 'floor-curtain', surface: 'floor' }, { ...rug, id: 'nan', u1: Number.NaN }],
      zones: [...typicalSet(p.room).zones!, { ...sofa(p.room), id: 'bad', furniture: 'piano' as never, height: -1 }],
    };
    const q = normalizeProject(JSON.parse(serializeProject(p)).project);
    expect(q.room.furnitureList).toBe(true);
    expect(q.room.coverings!.map((c) => c.id)).toEqual(['rug', 'cur']);
    expect(q.room.zones.map((z) => z.furniture)).toEqual(['sofa', 'armchair', undefined]);
    expect(q.room.zones[2].height).toBeUndefined();
  });
});
