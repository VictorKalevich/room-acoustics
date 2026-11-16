import { describe, expect, it } from 'vitest';
import { parseProjectFile, serializeProject } from '../../src/state/storage';
import { newProject, rotateRoom, validateRoom } from '../../src/state/project';

describe('файл проекта', () => {
  it('экспорт → импорт сохраняет все параметры', () => {
    const p = newProject('Гостиная');
    p.room.depth = 6.2;
    p.room.materials.floor = 'carpet-thick';
    p.sources[0].fLow = 70;
    const back = parseProjectFile(serializeProject(p));
    expect(back).toEqual(p);
  });

  it('чужой формат и новая версия отклоняются', () => {
    expect(() => parseProjectFile('{"format":"x","version":1}')).toThrow(/не файл проекта/);
    expect(() => parseProjectFile('{"format":"room-acoustics-project","version":6}')).toThrow(/новой версией/);
    expect(() => parseProjectFile('not json')).toThrow();
  });

  it('недостающие поля заполняются умолчаниями, неверные значения отклоняются', () => {
    const p = parseProjectFile(JSON.stringify({
      format: 'room-acoustics-project', version: 1,
      project: { room: { depth: 4 }, sources: [{ id: 'spkC', kind: 'speaker', fLow: 60, fHigh: 20000, height: 1 }] },
    }));
    expect(p.room.depth).toBe(4);
    expect(p.room.width).toBe(4);
    expect(p.constraints.earHeight).toBe(1.1);
    expect(() => parseProjectFile(JSON.stringify({
      format: 'room-acoustics-project', version: 1, project: { room: { depth: 80 } },
    }))).toThrow(/Глубина/);
  });
});

describe('043: подъём низа в файле проекта', () => {
  it('3, 6 и 9 дБ сохраняются; без поля и неизвестное значение — ровная цель', () => {
    for (const rise of [3, 6, 9] as const) {
      const p = newProject();
      p.constraints.houseCurve = rise;
      expect(parseProjectFile(serializeProject(p)).constraints.houseCurve).toBe(rise);
    }
    const flat = newProject();
    expect(JSON.parse(serializeProject(flat)).project.constraints).not.toHaveProperty('houseCurve');
    expect(parseProjectFile(serializeProject(flat)).constraints.houseCurve).toBeUndefined();
    for (const bad of [0, 5, '6', -3]) {
      const raw = JSON.parse(serializeProject(newProject()));
      raw.project.constraints.houseCurve = bad;
      expect(parseProjectFile(JSON.stringify(raw)).constraints.houseCurve).toBeUndefined();
    }
  });
});

describe('миграция версии 1', () => {
  it('файл версии 1 получает текущую расстановку, места, зоны и возможности сабвуфера', () => {
    const v1 = {
      format: 'room-acoustics-project', version: 1,
      project: {
        name: 'Старый', room: { depth: 5, width: 4, height: 2.5 },
        sources: [
          { id: 'spkL', kind: 'speaker', fLow: 80, fHigh: 20000, height: 1 },
          { id: 'spkR', kind: 'speaker', fLow: 80, fHigh: 20000, height: 1 },
          { id: 'sub1', kind: 'sub', fLow: 20, fHigh: 80, height: 0.3 },
        ],
        constraints: { speakerMinFront: 0.2, speakerMinSide: 0.3, listenerMinX: 1.5, listenerMaxX: 4.4, earHeight: 1.1, subZone: 'walls', subWallGap: 0.15 },
      },
    };
    const p = parseProjectFile(JSON.stringify(v1));
    expect(p.room.zones).toEqual([]);
    expect(p.room.leakage).toBe('typical');
    expect(p.constraints.seats.count).toBe(1);
    expect(p.sources.find((s) => s.id === 'sub1')!.phaseMode).toBe('polarity');
    expect(Object.keys(p.current.positions).sort()).toEqual(['spkL', 'spkR', 'sub1']);
    expect(p.setups).toEqual([]);
  });
});

describe('модель проекта', () => {
  it('поворот комнаты меняет глубину и ширину и переносит материалы стен', () => {
    const p = newProject();
    p.room.materials.left = 'glass';
    const r = rotateRoom(p.room);
    expect(r.depth).toBe(p.room.width);
    expect(r.width).toBe(p.room.depth);
    expect(r.materials.front).toBe('glass');
    expect(rotateRoom(rotateRoom(rotateRoom(rotateRoom(p.room))))).toEqual(p.room);
  });

  it('проёмы и коридоры поворачиваются вместе с комнатой (4 поворота = исходное)', () => {
    const p = newProject();
    p.room.openings = [{ id: 'o', wall: 'left', a0: 1, a1: 2, height: 2 }];
    p.room.extensions = [{ id: 'e', name: 'Коридор', wall: 'right', a0: 0, a1: 5, depth: 1.2, height: 2.5, arch: { a0: 1, a1: 2.4, height: 2.1 }, openStart: true, openEnd: false, openFar: false }];
    const r1 = rotateRoom(p.room);
    expect(r1.openings[0]).toMatchObject({ wall: 'front', a0: 3, a1: 4 });
    expect(r1.extensions[0]).toMatchObject({ wall: 'back', a0: 0, a1: 5, openStart: false, openEnd: true });
    expect(r1.extensions[0].arch).toMatchObject({ a0: 2.6, a1: 4 });
    const back = rotateRoom(rotateRoom(rotateRoom(r1)));
    expect(back.openings).toEqual(p.room.openings);
    expect(back.extensions[0].arch.a0).toBeCloseTo(1, 9);
    expect(back.extensions[0].openStart).toBe(true);
  });

  it('зоны поворачиваются вместе с комнатой', () => {
    const p = newProject();
    p.room.zones = [{ id: 'z', kind: 'door', x0: 4, x1: 5, y0: 0, y1: 1, canSit: false }];
    const r = rotateRoom(p.room);
    expect(r.zones[0]).toMatchObject({ x0: 0, x1: 1, y0: 0, y1: 1 });
    const back = rotateRoom(rotateRoom(rotateRoom(r)));
    expect(back.zones[0]).toMatchObject({ x0: 4, x1: 5, y0: 0, y1: 1 });
  });

  it('валидация размеров: 1–50 м, высота ≤ 20 м', () => {
    const p = newProject();
    expect(validateRoom(p.room)).toEqual([]);
    expect(validateRoom({ ...p.room, depth: 0.5 })[0].field).toBe('depth');
    expect(validateRoom({ ...p.room, height: 25 })[0].field).toBe('height');
  });
});

describe('окна и двери на плане', () => {
  it('поворачиваются вместе с комнатой и переживают сохранение', () => {
    const p = newProject();
    p.room.features = [{ id: 'w', kind: 'window', wall: 'left', a0: 1, a1: 2, bottom: 0.9, top: 2.2 }];
    const r = rotateRoom(p.room);
    // комната 5 × 4 м: левая стена (вдоль глубины) становится передней шириной 5 м, отсчёт — от другого торца
    expect(r.features[0]).toEqual({ ...p.room.features[0], wall: 'front', a0: 3, a1: 4 });
    expect(rotateRoom(rotateRoom(rotateRoom(r)))).toEqual(p.room);
    const back = parseProjectFile(serializeProject(p));
    expect(back.room.features).toEqual(p.room.features);
  });
});

import { DAMPING_MODEL, type Room } from '../../src/core/types';
describe('подстройка модели при обновлении', () => {
  it('множитель затухания, подобранный для прежней модели, сбрасывается; для текущей — сохраняется', () => {
    const p = newProject();
    const old = parseProjectFile(serializeProject({ ...p, room: { ...p.room, calibration: { dampingScale: 2.5 } } }));
    expect(old.room.calibration).toBeNull();
    const cur = parseProjectFile(serializeProject({ ...p, room: { ...p.room, calibration: { dampingScale: 1.3, model: DAMPING_MODEL } } }));
    expect(cur.room.calibration?.dampingScale).toBe(1.3);
  });

  it('041: подстройка модели 3 сбрасывается только у комнаты с открытой стороной смежного помещения', () => {
    const p = newProject();
    const ext = { id: 'e', name: 'Коридор', wall: 'right' as const, a0: 0, a1: 4, depth: 1.2, height: 2.4, arch: { a0: 1, a1: 2.2, height: 2.1 }, openStart: false, openEnd: false, openFar: false };
    // «наглухо» — чтобы перенос 042 (утечка в волновой модели) подстройку не сбрасывал
    const open = (extensions: (typeof ext)[], model: number) =>
      parseProjectFile(serializeProject({ ...p, room: { ...p.room, leakage: 'sealed', extensions, calibration: { dampingScale: 1.3, model, source: 'rew.txt' } } })).room.calibration;
    expect(open([], 3)).toEqual({ dampingScale: 1.3, model: DAMPING_MODEL, source: 'rew.txt' });
    expect(open([ext], 3)).toEqual({ dampingScale: 1.3, model: DAMPING_MODEL, source: 'rew.txt' });
    for (const side of ['openStart', 'openEnd', 'openFar'] as const) expect(open([ext, { ...ext, id: 'f', [side]: true }], 3), side).toBeNull();
    // подобранная уже для модели 4 — сохраняется и с открытой стороной; модель 2 — сбрасывается всегда
    expect(open([{ ...ext, openEnd: true }], DAMPING_MODEL)?.dampingScale).toBe(1.3);
    expect(open([], 2)).toBeNull();
  });

  it('042: подстройка модели 4 сбрасывается только у волновой модели с утечкой', () => {
    const p = newProject();
    const ext = { id: 'e', name: 'Коридор', wall: 'right' as const, a0: 0, a1: 4, depth: 1.2, height: 2.4, arch: { a0: 1, a1: 2.2, height: 2.1 }, openStart: false, openEnd: false, openFar: false };
    const cal = (over: Partial<Room>, model = 4) =>
      parseProjectFile(serializeProject({ ...p, room: { ...p.room, ...over, calibration: { dampingScale: 1.3, model, source: 'rew.txt', leakageBefore: 'typical' } } })).room.calibration;
    const kept = { dampingScale: 1.3, model: DAMPING_MODEL, source: 'rew.txt', leakageBefore: 'typical' };
    // прямоугольная модель — при любой герметичности
    for (const leakage of ['sealed', 'typical', 'door', 'open'] as const) expect(cal({ leakage }), leakage).toEqual(kept);
    expect(cal({ leakage: 'open', model: 'modal', extensions: [ext] })).toEqual(kept);
    // волновая: смежное помещение, скос или выбрана явно — только «наглухо»
    expect(cal({ leakage: 'sealed', extensions: [ext] })).toEqual(kept);
    expect(cal({ leakage: 'sealed', model: 'wave' })).toEqual(kept);
    for (const leakage of ['typical', 'door', 'open'] as const) {
      expect(cal({ leakage, extensions: [ext] }), leakage).toBeNull();
      expect(cal({ leakage, model: 'wave' }), leakage).toBeNull();
      expect(cal({ leakage, slope: { wall: 'front', low: 1.5, run: 1.5 } }), leakage).toBeNull();
    }
    // модель 3 проходит перенос 041, затем 042
    expect(cal({ leakage: 'typical' }, 3)).toEqual(kept);
    expect(cal({ leakage: 'typical', extensions: [ext] }, 3)).toBeNull();
    expect(cal({ leakage: 'sealed', extensions: [{ ...ext, openEnd: true }] }, 3)).toBeNull();
    expect(cal({ leakage: 'typical', model: 'wave' }, DAMPING_MODEL)?.dampingScale).toBe(1.3);
  });
});
