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
    expect(r.features[0].wall).toBe('front');
    expect(r.features[0].a1 - r.features[0].a0).toBeCloseTo(1);
    expect(rotateRoom(rotateRoom(rotateRoom(r)))).toEqual(p.room);
    const back = parseProjectFile(serializeProject(p));
    expect(back.room.features).toEqual(p.room.features);
  });
});

import { DAMPING_MODEL } from '../../src/core/types';
describe('подстройка модели при обновлении', () => {
  it('множитель затухания, подобранный для прежней модели, сбрасывается; для текущей — сохраняется', () => {
    const p = newProject();
    const old = parseProjectFile(serializeProject({ ...p, room: { ...p.room, calibration: { dampingScale: 2.5 } } }));
    expect(old.room.calibration).toBeNull();
    const cur = parseProjectFile(serializeProject({ ...p, room: { ...p.room, calibration: { dampingScale: 1.3, model: DAMPING_MODEL } } }));
    expect(cur.room.calibration?.dampingScale).toBe(1.3);
  });
});
