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
    expect(() => parseProjectFile('{"format":"room-acoustics-project","version":2}')).toThrow(/новой версией/);
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

  it('валидация размеров: 1–50 м, высота ≤ 20 м', () => {
    const p = newProject();
    expect(validateRoom(p.room)).toEqual([]);
    expect(validateRoom({ ...p.room, depth: 0.5 })[0].field).toBe('depth');
    expect(validateRoom({ ...p.room, height: 25 })[0].field).toBe('height');
  });
});
