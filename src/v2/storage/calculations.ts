// Сохранённые результаты тяжёлых расчётов (V2-010): ключ — метод и хеш входа; запись принадлежит комнате и удаляется
// вместе с ней. На комнату хранится не больше `PER_ROOM` записей — старые вытесняются.
import type { Provenance } from '../domain/provenance';
import { req, type V2Db } from './db';

export const PER_ROOM = 24;

export interface StoredCalculation<T = unknown> {
  id: string;
  roomId: string;
  provenance: Provenance;
  value: T;
}

export const calcKey = (p: Pick<Provenance, 'method' | 'algorithmVersion' | 'inputHash'>) => `${p.method}|${p.algorithmVersion}|${p.inputHash}`;

export async function loadCalculation<T>(db: V2Db, key: string): Promise<StoredCalculation<T> | undefined> {
  return (await db.run('calculations', 'readonly', (tx) => req(tx.objectStore('calculations').get(key)))) as StoredCalculation<T> | undefined;
}

export async function saveCalculation<T>(db: V2Db, roomId: string, provenance: Provenance, value: T): Promise<string> {
  const id = calcKey(provenance);
  await db.run('calculations', 'readwrite', async (tx) => {
    const st = tx.objectStore('calculations');
    st.put(JSON.parse(JSON.stringify({ id, roomId, provenance, value })));
    const all = (await req(st.index('roomId').getAll(roomId))) as StoredCalculation[];
    const extra = all.sort((a, b) => b.provenance.createdAt.localeCompare(a.provenance.createdAt)).slice(PER_ROOM);
    for (const r of extra) st.delete(r.id);
  });
  return id;
}
