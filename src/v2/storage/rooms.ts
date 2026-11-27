// Комнаты и служебные значения в IndexedDB v2 (V2-008). Повреждённая запись не отбрасывается молча: список
// возвращает её отдельно, чтобы интерфейс мог сообщить о ней и предложить резервную копию.
import { ROOM_SCHEMA, type Room } from '../domain/model';
import { ROOM_OWNED, req, storageError, type V2Db } from './db';

export interface RoomSummary {
  id: string;
  name: string;
  updatedAt: string;
  hasExperiment: boolean;
  dims: { depth: number; width: number; height: number } | null;
}

export interface DamagedRecord { id: string; reason: string }

/** Проверка формы записи комнаты: достаточно, чтобы интерфейс не упал при открытии. */
export function roomProblem(v: unknown): string | null {
  if (!v || typeof v !== 'object') return 'не объект';
  const r = v as Partial<Room>;
  if (typeof r.id !== 'string' || !r.id) return 'нет идентификатора';
  if (r.schema !== ROOM_SCHEMA) return `неизвестная версия схемы ${String(r.schema)}`;
  if (typeof r.name !== 'string') return 'нет названия';
  if (!r.current || typeof r.current !== 'object' || !r.current.geometry || !r.current.audio || !r.current.listening) return 'нет текущей конфигурации';
  if (r.experimental !== null && (typeof r.experimental !== 'object' || !r.experimental?.geometry)) return 'повреждена экспериментальная конфигурация';
  if (!Array.isArray(r.archive) || !Array.isArray(r.history)) return 'повреждены архив или история';
  return null;
}

export function summarize(r: Room): RoomSummary {
  const g = r.current.geometry;
  return {
    id: r.id, name: r.name, updatedAt: r.updatedAt, hasExperiment: !!r.experimental,
    dims: g.kind === 'rect' ? { depth: g.depth, width: g.width, height: g.height } : null,
  };
}

export async function listRooms(db: V2Db): Promise<{ rooms: Room[]; damaged: DamagedRecord[] }> {
  const all = await db.run('rooms', 'readonly', (tx) => req(tx.objectStore('rooms').getAll()));
  const rooms: Room[] = [];
  const damaged: DamagedRecord[] = [];
  for (const v of all as unknown[]) {
    const problem = roomProblem(v);
    if (problem) damaged.push({ id: String((v as { id?: unknown })?.id ?? '?'), reason: problem });
    else rooms.push(v as Room);
  }
  rooms.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return { rooms, damaged };
}

export async function getRoom(db: V2Db, id: string): Promise<Room | undefined> {
  const v = await db.run('rooms', 'readonly', (tx) => req(tx.objectStore('rooms').get(id)));
  if (v === undefined) return undefined;
  const problem = roomProblem(v);
  if (problem) throw storageError('corrupt', undefined, `Комната повреждена в хранилище (${problem}).`);
  return v as Room;
}

/**
 * Сохранить комнату. `expectedUpdatedAt` — время записи, от которой сделано изменение: если запись в базе с тех пор
 * изменилась (другая вкладка), сохранение отклоняется конфликтом, а не перезаписывает чужое изменение.
 */
export async function saveRoom(db: V2Db, room: Room, expectedUpdatedAt?: string | null): Promise<void> {
  const copy = JSON.parse(JSON.stringify(room)) as Room;
  await db.run('rooms', 'readwrite', async (tx) => {
    const st = tx.objectStore('rooms');
    if (expectedUpdatedAt !== undefined) {
      const existing = (await req(st.get(room.id))) as Room | undefined;
      const stored = existing?.updatedAt ?? null;
      if (stored !== expectedUpdatedAt) throw storageError('conflict');
    }
    await req(st.put(copy));
  });
}

/** Удалить комнату со всеми её записями (измерения и их данные, снимки, расчёты, планы, отчёты) — одной транзакцией. */
export async function deleteRoom(db: V2Db, id: string): Promise<void> {
  await db.run(['rooms', 'measurementData', ...ROOM_OWNED], 'readwrite', async (tx) => {
    for (const store of ROOM_OWNED) {
      const keys = await req(tx.objectStore(store).index('roomId').getAllKeys(id));
      for (const key of keys) {
        tx.objectStore(store).delete(key);
        if (store === 'measurements') tx.objectStore('measurementData').delete(key);
      }
    }
    tx.objectStore('rooms').delete(id);
  });
}

export type MetaKey = 'activeRoomId' | 'complexity' | 'settings' | 'onboarded' | 'favorites' | 'recentTools' | 'migration' | 'lastBackupAt';

export async function getMeta<T>(db: V2Db, key: MetaKey): Promise<T | undefined> {
  const v = (await db.run('meta', 'readonly', (tx) => req(tx.objectStore('meta').get(key)))) as { id: string; value: T } | undefined;
  return v?.value;
}

export async function setMeta<T>(db: V2Db, key: MetaKey, value: T): Promise<void> {
  await db.run('meta', 'readwrite', (tx) => req(tx.objectStore('meta').put({ id: key, value: JSON.parse(JSON.stringify(value)) })));
}

export async function deleteMeta(db: V2Db, key: MetaKey): Promise<void> {
  await db.run('meta', 'readwrite', (tx) => req(tx.objectStore('meta').delete(key)));
}
