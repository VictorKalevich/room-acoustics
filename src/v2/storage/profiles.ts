// Профили оборудования и материалов (V2-047) в областях `equipment` и `materials`: одна запись — профиль со всеми версиями.
import type { EquipmentProfile, MaterialProfile, Profile } from '../domain/profiles';
import { req, type V2Db } from './db';

type ProfileStore = 'equipment' | 'materials';

async function all<T>(db: V2Db, store: ProfileStore): Promise<Profile<T>[]> {
  const rows = (await db.run(store, 'readonly', (tx) => req(tx.objectStore(store).getAll()))) as Partial<Profile<T>>[];
  return rows.filter((r): r is Profile<T> => typeof r.id === 'string' && Array.isArray(r.versions) && r.versions.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
}

export const listEquipment = (db: V2Db) => all<EquipmentProfile['versions'][number]['data']>(db, 'equipment') as Promise<EquipmentProfile[]>;
export const listMaterials = (db: V2Db) => all<MaterialProfile['versions'][number]['data']>(db, 'materials') as Promise<MaterialProfile[]>;

export async function putProfile(db: V2Db, store: ProfileStore, p: EquipmentProfile | MaterialProfile): Promise<void> {
  await db.run(store, 'readwrite', (tx) => req(tx.objectStore(store).put(JSON.parse(JSON.stringify(p)))));
}
