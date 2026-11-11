import { describe, expect, it } from 'vitest';
import { defaultSetup, newProject, syncSetup } from '../../src/state/project';
import { normalizeProject, serializeProject } from '../../src/state/storage';
import { clampToRoom } from '../../src/core/system';
import type { Project } from '../../src/state/project';
import { DAMPING_MODEL } from '../../src/core/types';

// 022: «места выбраны» у текущей расстановки; вывод для проектов до 022
const reload = (p: unknown) => {
  const raw = JSON.parse(serializeProject(p as never));
  delete raw.project.current.placed;
  return normalizeProject(raw.project);
};

describe('места выбраны (022)', () => {
  it('новый проект — места не выбраны; признак сохраняется в файле', () => {
    const p = newProject();
    expect(p.current.placed).toBe(false);
    const saved = normalizeProject(JSON.parse(serializeProject({ ...p, current: { ...p.current, placed: true } })).project);
    expect(saved.current.placed).toBe(true);
  });

  it('старый проект: места по умолчанию (и сдвинутые внутрь новой комнаты) — не выбраны; свои места или замер — выбраны', () => {
    const p = newProject();
    const room = { ...p.room, depth: 6, width: 3.5 };
    // так места по умолчанию оставались до 022 после смены размеров: сдвинуты внутрь стен
    const synced = syncSetup(p.current, room, p.sources, p.constraints);
    const stretched = { ...synced, listener: clampToRoom(room, synced.listener, 0.1), positions: Object.fromEntries(Object.entries(synced.positions).map(([k, v]) => [k, clampToRoom(room, v)])) };
    expect(reload({ ...p, room, current: stretched }).current.placed).toBe(false);
    expect(reload({ ...p, room, current: defaultSetup(room, p.sources, p.constraints) }).current.placed).toBe(false);
    const own = { ...stretched, listener: { ...stretched.listener, x: stretched.listener.x + 0.4 } };
    expect(reload({ ...p, room, current: own }).current.placed).toBe(true);
    const measured = { ...stretched, measurement: { name: 'rew.txt', f: [20, 40, 80], db: [0, 1, 2], importedAt: '2026-11-11T10:00:00Z' } };
    expect(reload({ ...p, room, current: measured }).current.placed).toBe(true);
  });

  it('подстройка по замеру хранит прежнюю герметичность; неверное значение отбрасывается', () => {
    const p = newProject();
    const room = { ...p.room, leakage: 'door' as const, calibration: { dampingScale: 1.3, model: DAMPING_MODEL, source: 'rew.txt', leakageBefore: 'typical' as const } };
    const q = normalizeProject(JSON.parse(serializeProject({ ...p, room } as Project)).project);
    expect(q.room.calibration?.leakageBefore).toBe('typical');
    const bad = normalizeProject(JSON.parse(serializeProject({ ...p, room: { ...room, calibration: { ...room.calibration, leakageBefore: 'x' } } } as never)).project);
    expect(bad.room.calibration).not.toHaveProperty('leakageBefore');
  });
});
