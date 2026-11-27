// Сценарии работы с комнатами (V2-008): создание, открытие, сохранение без потери чужих изменений, удаление, копия,
// активная комната. Новая комната строится из значений по умолчанию legacy — те же материалы, система и места.
import { defaultConstraints, defaultRoom, defaultSetup, defaultSources, makeId } from '../../state/project';
import { fromCore } from '../adapters/core';
import { DEFAULT_GOALS, ROOM_SCHEMA, type Room } from '../domain/model';
import { validateDimensions, type Issue } from '../domain/validation';
import type { IdFactory } from '../domain/operations';
import type { V2Db } from '../storage/db';
import { deleteMeta, deleteRoom, getMeta, getRoom, listRooms, saveRoom, setMeta, type DamagedRecord } from '../storage/rooms';

export type StarterLayout = 'mono' | '2.0' | '2.1' | '2.2';
export const STARTER_LAYOUTS: readonly StarterLayout[] = ['mono', '2.0', '2.1', '2.2'];
const LAYOUT_COUNTS: Record<StarterLayout, [speakers: number, subs: number]> = { mono: [1, 0], '2.0': [2, 0], '2.1': [2, 1], '2.2': [2, 2] };

export interface NewRoomInput {
  name: string;
  depth: number;
  width: number;
  height: number;
  layout: StarterLayout;
}

export const DEFAULT_NEW_ROOM: NewRoomInput = { name: 'Моя комната', depth: 5, width: 4, height: 2.5, layout: '2.1' };

export function newRoomIssues(input: NewRoomInput): Issue[] {
  const out = validateDimensions(input);
  if (!input.name.trim()) out.push({ severity: 'error', path: 'name', message: 'Введите название комнаты.' });
  return out;
}

/** Комната по умолчанию: материалы, система, ограничения и исходные места — как у нового проекта legacy. */
export function buildRoom(input: NewRoomInput, newId: IdFactory, now: string): Room {
  const issues = newRoomIssues(input);
  if (issues.length) throw new Error(issues.map((i) => i.message).join(' '));
  const room = { ...defaultRoom(), depth: input.depth, width: input.width, height: input.height };
  const [speakers, subs] = LAYOUT_COUNTS[input.layout];
  const sources = defaultSources(speakers, subs);
  const constraints = defaultConstraints(room);
  const setup = defaultSetup(room, sources, constraints);
  const current = fromCore({ room, sources, constraints, setup }, { id: newId(), role: 'current', revision: 1 });
  return {
    schema: ROOM_SCHEMA, id: newId(), name: input.name.trim(), createdAt: now, updatedAt: now,
    current, experimental: null, goals: structuredClone(DEFAULT_GOALS), archive: [], history: [], origin: { kind: 'created' },
  };
}

export interface Clock { now: () => string; newId: IdFactory }
export const systemClock: Clock = { now: () => new Date().toISOString(), newId: makeId };

export interface RoomsService {
  list(): Promise<{ rooms: Room[]; damaged: DamagedRecord[] }>;
  create(input: NewRoomInput): Promise<Room>;
  open(id: string): Promise<Room | undefined>;
  /** Сохранить изменённую комнату; `base` — версия, от которой сделано изменение (для проверки конфликта). */
  save(next: Room, base: Room): Promise<Room>;
  duplicate(id: string, name?: string): Promise<Room>;
  remove(id: string): Promise<void>;
  active(): Promise<Room | undefined>;
  setActive(id: string | null): Promise<void>;
}

export function roomsService(db: V2Db, clock: Clock = systemClock): RoomsService {
  const svc: RoomsService = {
    list: () => listRooms(db),
    async create(input) {
      const room = buildRoom(input, clock.newId, clock.now());
      await saveRoom(db, room, null);
      await setMeta(db, 'activeRoomId', room.id);
      return room;
    },
    open: (id) => getRoom(db, id),
    async save(next, base) {
      if (next.id !== base.id) throw new Error('Сохранение другой комнаты поверх этой.');
      // время записи всегда растёт: две правки в одну миллисекунду не должны совпасть для проверки конфликта
      const t = clock.now();
      const updatedAt = t > base.updatedAt ? t : new Date(Date.parse(base.updatedAt) + 1).toISOString();
      const stored = { ...next, updatedAt };
      await saveRoom(db, stored, base.updatedAt);
      return stored;
    },
    async duplicate(id, name) {
      const src = await getRoom(db, id);
      if (!src) throw new Error('Комната не найдена.');
      const now = clock.now();
      const copy: Room = {
        ...structuredClone(src), id: clock.newId(), name: name?.trim() || `${src.name} (копия)`, createdAt: now, updatedAt: now,
        current: { ...structuredClone(src.current), id: clock.newId() },
        experimental: src.experimental ? { ...structuredClone(src.experimental), id: clock.newId() } : null,
        origin: { kind: 'created' },
      };
      if (copy.experimental?.basedOn) copy.experimental.basedOn = { ...copy.experimental.basedOn, configId: copy.current.id };
      await saveRoom(db, copy, null);
      return copy;
    },
    async remove(id) {
      await deleteRoom(db, id);
      if ((await getMeta<string>(db, 'activeRoomId')) === id) await deleteMeta(db, 'activeRoomId');
    },
    async active() {
      const id = await getMeta<string>(db, 'activeRoomId');
      return id ? getRoom(db, id) : undefined;
    },
    setActive: (id) => (id ? setMeta(db, 'activeRoomId', id) : deleteMeta(db, 'activeRoomId')),
  };
  return svc;
}
