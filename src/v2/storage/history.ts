// История комнаты (V2-030, V2-035): измерения и прогоны подбора, привязанные к комнате, и исходные данные измерения.
// Исходные данные не меняются: новое измерение инструмента добавляется вместе с ними (V2-036); описание меняет только
// поздняя привязка (V2-049).
import type { MeasurementData, MeasurementRecord, OptimizationRun } from '../domain/measurement';
import { req, type V2Db } from './db';

export interface RoomRecords { measurements: MeasurementRecord[]; optimizations: OptimizationRun[] }

export async function roomRecords(db: V2Db, roomId: string): Promise<RoomRecords> {
  return db.run(['measurements', 'optimizationRuns'], 'readonly', async (tx) => {
    const measurements = (await req(tx.objectStore('measurements').index('roomId').getAll(roomId))) as MeasurementRecord[];
    const optimizations = (await req(tx.objectStore('optimizationRuns').index('roomId').getAll(roomId))) as OptimizationRun[];
    const newest = (a: string | null, b: string | null) => (b ?? '').localeCompare(a ?? '');
    return {
      measurements: measurements.sort((a, b) => newest(a.recordedAt, b.recordedAt)),
      optimizations: optimizations.sort((a, b) => newest(a.createdAt, b.createdAt)),
    };
  });
}

/** Новое измерение и его исходные данные — в одной транзакции. */
export async function addMeasurement(db: V2Db, rec: MeasurementRecord, data: MeasurementData): Promise<void> {
  if (rec.id !== data.id) throw new Error('Идентификаторы записи и данных измерения различаются.');
  await db.run(['measurements', 'measurementData'], 'readwrite', (tx) => {
    tx.objectStore('measurements').add(rec);
    tx.objectStore('measurementData').add(data);
  });
}

/** Описание измерения после поздней привязки (V2-049): исходные данные не трогаются. */
export async function updateMeasurement(db: V2Db, rec: MeasurementRecord): Promise<void> {
  await db.run('measurements', 'readwrite', async (tx) => {
    const store = tx.objectStore('measurements');
    if (!(await req(store.get(rec.id)))) throw new Error('Замер не найден.');
    await req(store.put(JSON.parse(JSON.stringify(rec))));
  });
}

/** Исходные данные измерения (неизменяемые); null — данных нет. */
export async function measurementData(db: V2Db, id: string): Promise<MeasurementData | null> {
  return db.run('measurementData', 'readonly', async (tx) => ((await req(tx.objectStore('measurementData').get(id))) as MeasurementData | undefined) ?? null);
}

/** Сохранить результат поиска как отчёт прогона (не третья конфигурация). */
export async function addOptimizationRun(db: V2Db, run: OptimizationRun): Promise<void> {
  await db.run('optimizationRuns', 'readwrite', (tx) => req(tx.objectStore('optimizationRuns').put(JSON.parse(JSON.stringify(run)))));
}
