// История комнаты (V2-030): измерения и прогоны подбора, привязанные к комнате. Только чтение; записи не меняются.
import type { MeasurementRecord, OptimizationRun } from '../domain/measurement';
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
