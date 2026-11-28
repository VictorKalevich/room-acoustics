// Правила изменения комнаты (059): каждое изменение возвращает новую комнату, ревизия конфигурации растёт,
// эксперимент — независимая копия, подтверждение сохраняет прежнее фактическое состояние снимком.
import type { Vec3 } from '../../core/types';
import type { ArchivedVariant, ConfigRole, Listener, Room, RoomConfiguration, Source } from './model';

export type IdFactory = () => string;

const clone = <T>(v: T): T => structuredClone(v);

export function config(room: Room, role: ConfigRole): RoomConfiguration | null {
  return role === 'current' ? room.current : room.experimental;
}

/** Изменить конфигурацию: `edit` получает копию; ревизия +1. Без эксперимента изменение экспериментальной — ошибка. */
export function updateConfig(room: Room, role: ConfigRole, edit: (c: RoomConfiguration) => RoomConfiguration | void, now: string): Room {
  const base = config(room, role);
  if (!base) throw new Error('Экспериментальной конфигурации нет: сначала создайте эксперимент.');
  const draft = clone(base);
  const next = edit(draft) ?? draft;
  const updated: RoomConfiguration = { ...next, id: base.id, role, revision: base.revision + 1 };
  return role === 'current' ? { ...room, current: updated, updatedAt: now } : { ...room, experimental: updated, updatedAt: now };
}

export const renameRoom = (room: Room, name: string, now: string): Room => ({ ...room, name: name.trim() || room.name, updatedAt: now });

/** Эксперимент — полная копия текущей конфигурации с новым идентификатором; общих изменяемых объектов нет. */
export function createExperiment(room: Room, newId: IdFactory, now: string): Room {
  if (room.experimental) return room;
  const copy = clone(room.current);
  const experimental: RoomConfiguration = {
    ...copy, id: newId(), role: 'experimental', revision: 1, basedOn: { configId: room.current.id, revision: room.current.revision },
  };
  return { ...room, experimental, updatedAt: now };
}

export const discardExperiment = (room: Room, now: string): Room => (room.experimental ? { ...room, experimental: null, updatedAt: now } : room);

/**
 * Эксперимент становится фактическим только этим действием: прежняя текущая конфигурация уходит в историю снимком,
 * эксперимент получает роль текущей (идентификатор эксперимента сохраняется, ревизия продолжается).
 */
export function confirmExperiment(room: Room, newId: IdFactory, now: string): Room {
  if (!room.experimental) throw new Error('Нечего подтверждать: эксперимента нет.');
  const snapshot = { id: newId(), takenAt: now, reason: 'experiment-confirmed' as const, config: clone(room.current) };
  const current: RoomConfiguration = { ...clone(room.experimental), role: 'current', revision: room.experimental.revision + 1 };
  delete current.basedOn;
  return { ...room, current, experimental: null, history: [snapshot, ...room.history], updatedAt: now };
}

/** Восстановить вариант из архива в эксперимент: создаёт эксперимент при необходимости, архив не меняется. */
export function restoreArchived(room: Room, archiveId: string, newId: IdFactory, now: string): Room {
  const v = room.archive.find((a) => a.id === archiveId);
  if (!v) throw new Error('Вариант не найден в архиве.');
  const withExp = createExperiment(room, newId, now);
  return updateConfig(withExp, 'experimental', (c) => applyLayout(c, v.layout), now);
}

/** Места источников и слушателя из варианта; источники, которых в варианте нет, остаются на месте. */
export function applyLayout(c: RoomConfiguration, layout: ArchivedVariant['layout']): RoomConfiguration {
  const sources = c.audio.sources.map((s) => {
    const p = layout.positions[s.id];
    return p ? { ...s, position: { ...p }, settings: layout.subSettings[s.id] ?? s.settings } : s;
  });
  const listeners = c.listening.listeners.map((l) => (l.primary ? { ...l, position: { ...layout.listener } } : l));
  return { ...c, audio: { ...c.audio, sources, crossoverHz: layout.crossoverHz }, listening: { ...c.listening, listeners }, placed: true };
}

export function primaryListener(c: RoomConfiguration): Listener {
  const l = c.listening.listeners.find((x) => x.primary) ?? c.listening.listeners[0];
  if (!l) throw new Error('В конфигурации нет слушателя.');
  return l;
}

export type ObjectRef = { type: 'source'; id: string } | { type: 'listener'; id: string } | { type: 'obstacle'; id: string } | { type: 'treatment'; id: string } | { type: 'opening'; id: string };

/** Переместить объект на плане. Заблокированный объект не двигается: возвращается та же конфигурация. */
export function moveObject(c: RoomConfiguration, ref: ObjectRef, to: { x: number; y: number; z?: number }): RoomConfiguration {
  const p = (old: Vec3): Vec3 => ({ x: to.x, y: to.y, z: to.z ?? old.z });
  switch (ref.type) {
    case 'source': {
      const s = c.audio.sources.find((x) => x.id === ref.id);
      if (!s || s.locked) return c;
      return { ...c, audio: { ...c.audio, sources: c.audio.sources.map((x) => (x.id === ref.id ? { ...x, position: p(x.position) } : x)) } };
    }
    case 'listener': {
      const l = c.listening.listeners.find((x) => x.id === ref.id);
      if (!l || l.locked) return c;
      return { ...c, listening: { ...c.listening, listeners: c.listening.listeners.map((x) => (x.id === ref.id ? { ...x, position: p(x.position) } : x)) } };
    }
    case 'obstacle':
      return {
        ...c,
        interior: {
          ...c.interior,
          obstacles: c.interior.obstacles.map((z) => {
            if (z.id !== ref.id) return z;
            const dx = to.x - (z.x0 + z.x1) / 2, dy = to.y - (z.y0 + z.y1) / 2;
            return { ...z, x0: z.x0 + dx, x1: z.x1 + dx, y0: z.y0 + dy, y1: z.y1 + dy };
          }),
        },
      };
    case 'treatment':
      return {
        ...c,
        treatment: {
          ...c.treatment,
          items: c.treatment.items.map((t) => (t.id !== ref.id ? t : t.kind === 'cloud' ? { ...t, x: to.x, y: to.y } : t)),
        },
      };
    case 'opening':
      return c;
  }
}

export function updateSource(c: RoomConfiguration, id: string, patch: Partial<Source>): RoomConfiguration {
  return { ...c, audio: { ...c.audio, sources: c.audio.sources.map((s) => (s.id === id ? { ...s, ...patch, id } : s)) } };
}

export function addSource(c: RoomConfiguration, s: Source): RoomConfiguration {
  if (c.audio.sources.some((x) => x.id === s.id)) throw new Error(`Источник ${s.id} уже есть.`);
  return { ...c, audio: { ...c.audio, sources: [...c.audio.sources, s], layout: 'custom' } };
}

export function removeSource(c: RoomConfiguration, id: string): RoomConfiguration {
  return { ...c, audio: { ...c.audio, sources: c.audio.sources.filter((s) => s.id !== id), layout: 'custom' } };
}

export function setLocked(c: RoomConfiguration, ref: ObjectRef, locked: boolean): RoomConfiguration {
  if (ref.type === 'source') return updateSource(c, ref.id, { locked });
  if (ref.type === 'listener') {
    return { ...c, listening: { ...c.listening, listeners: c.listening.listeners.map((l) => (l.id === ref.id ? { ...l, locked } : l)) } };
  }
  return c;
}
