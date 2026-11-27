// История комнаты (V2-030, V2-035): измерения и прогоны подбора, привязанные к комнате, и исходные данные измерения.
// Только чтение; записи не меняются.
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

/** Исходные данные измерения (неизменяемые); null — данных нет. */
export async function measurementData(db: V2Db, id: string): Promise<MeasurementData | null> {
  return db.run('measurementData', 'readonly', async (tx) => ((await req(tx.objectStore('measurementData').get(id))) as MeasurementData | undefined) ?? null);
}
