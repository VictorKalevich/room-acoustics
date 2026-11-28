// «Мои данные» (V2-020, tools-advice-library §3): девять категорий поверх областей IndexedDB v2. Пресеты DSP и
// тестовые сигналы — одна область `presets` с полем `kind`; сохранённые расчёты инструментов и отчёты — область
// `reports` (R15): кэш `calculations` вытесняется и в резервную копию не входит.
import { req, type StoreName, type V2Db } from './db';

export const LIBRARY_CATEGORIES = ['measurements', 'equipment', 'measurement-devices', 'materials', 'constructions', 'presets', 'signals', 'calculations', 'reports'] as const;
export type LibraryCategory = (typeof LIBRARY_CATEGORIES)[number];

/** Общая часть записей библиотеки, достаточная для списка. */
export interface LibraryEntry {
  id: string;
  name: string;
  kind?: string;
  createdAt?: string;
  recordedAt?: string;
  roomId?: string | null;
  /** Версия профиля материала или оборудования (V2-047). */
  version?: number;
}

export const CATEGORY_INFO: Record<LibraryCategory, { title: string; text: string; store: StoreName; match?: (e: LibraryEntry) => boolean }> = {
  measurements: { title: 'Измерения', text: 'Записи инструментов и перенесённые замеры: оригиналы не изменяются', store: 'measurements' },
  equipment: { title: 'Аудиооборудование', text: 'Профили колонок, сабвуферов и усилителей с версиями', store: 'equipment' },
  'measurement-devices': { title: 'Измерительное оборудование', text: 'Микрофоны, интерфейсы и их калибровки', store: 'measurementDevices' },
  materials: { title: 'Акустические материалы', text: 'Пользовательские материалы с источником данных', store: 'materials' },
  constructions: { title: 'Конструкции', text: 'Панели, ловушки, диффузоры и резонаторы', store: 'constructions' },
  presets: { title: 'Пресеты DSP', text: 'Цепочки фильтров, кроссоверы и задержки', store: 'presets', match: (e) => e.kind !== 'signal' },
  signals: { title: 'Тестовые сигналы', text: 'Сохранённые настройки генератора', store: 'presets', match: (e) => e.kind === 'signal' },
  calculations: { title: 'Расчёты', text: 'Сохранённые результаты инструментов', store: 'reports', match: (e) => e.kind === 'calculation' },
  reports: { title: 'Отчёты', text: 'Отчёты комнат и экспорт', store: 'reports', match: (e) => e.kind !== 'calculation' },
};

const entryName = (e: Record<string, unknown>) => (typeof e.name === 'string' && e.name) || (typeof e.title === 'string' && e.title) || String(e.id);

export async function listCategory(db: V2Db, cat: LibraryCategory): Promise<LibraryEntry[]> {
  const info = CATEGORY_INFO[cat];
  const all = (await db.run(info.store, 'readonly', (tx) => req(tx.objectStore(info.store).getAll()))) as Record<string, unknown>[];
  return all
    .map((r) => ({ ...(r as unknown as LibraryEntry), name: entryName(r) }))
    .filter((e) => !info.match || info.match(e))
    .sort((a, b) => String(b.createdAt ?? b.recordedAt ?? '').localeCompare(String(a.createdAt ?? a.recordedAt ?? '')));
}

export async function countCategories(db: V2Db): Promise<Record<LibraryCategory, number>> {
  const out = {} as Record<LibraryCategory, number>;
  for (const c of LIBRARY_CATEGORIES) out[c] = (await listCategory(db, c)).length;
  return out;
}

export async function getEntry<T>(db: V2Db, cat: LibraryCategory, id: string): Promise<T | undefined> {
  const s = CATEGORY_INFO[cat].store;
  return (await db.run(s, 'readonly', (tx) => req(tx.objectStore(s).get(id)))) as T | undefined;
}

export async function putEntry<T extends { id: string }>(db: V2Db, cat: LibraryCategory, rec: T): Promise<void> {
  const s = CATEGORY_INFO[cat].store;
  await db.run(s, 'readwrite', (tx) => req(tx.objectStore(s).put(JSON.parse(JSON.stringify(rec)))));
}

/** Удалить запись; у измерения — и его данные. */
export async function deleteEntry(db: V2Db, cat: LibraryCategory, id: string): Promise<void> {
  const s = CATEGORY_INFO[cat].store;
  const stores: StoreName[] = s === 'measurements' ? ['measurements', 'measurementData'] : [s];
  await db.run(stores, 'readwrite', (tx) => {
    tx.objectStore(s).delete(id);
    if (s === 'measurements') tx.objectStore('measurementData').delete(id);
  });
}
