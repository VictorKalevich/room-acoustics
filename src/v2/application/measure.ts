// Замер инструмента в комнату (V2-036): запись измерения с исходными данными, конфигурацией и снимком значимой части
// конфигурации на момент записи. Запись не изменяется; снимок — в историю комнаты (причина «измерение»).
import type { MeasurementData, MeasurementKind, MeasurementRecord } from '../domain/measurement';
import type { Room } from '../domain/model';
import { addMeasurement } from '../storage/history';
import type { V2Db } from '../storage/db';
import { takeSnapshot } from './experiment';
import type { Clock, RoomsService } from './rooms';

export const TOOL_ALGORITHM = 'v2-tools-1';

export interface ToolMeasurement {
  kind: MeasurementKind;
  name: string;
  /** Метод для происхождения: «логарифмический свип, деконволюция» и т. п. */
  method: string;
  device: string;
  data: Omit<MeasurementData, 'id'>;
  warnings: string[];
  limitations: string[];
  points?: number;
}

export async function saveToRoom(db: V2Db, rooms: RoomsService, clock: Clock, room: Room, role: 'current' | 'experimental', m: ToolMeasurement): Promise<MeasurementRecord> {
  const config = role === 'experimental' ? room.experimental : room.current;
  if (!config) throw new Error('В комнате нет эксперимента.');
  const now = clock.now();
  const saved = await rooms.save(takeSnapshot(room, clock.newId, now, 'measurement', config), room);
  const id = clock.newId();
  const f = m.data.rt60 ? m.data.rt60.map((b) => b.band) : m.data.f;
  const rec: MeasurementRecord = {
    id, roomId: room.id, configId: config.id, kind: m.kind, name: m.name, recordedAt: now,
    source: { kind: 'app', device: m.device },
    provenance: { kind: 'measured', method: m.method, algorithmVersion: TOOL_ALGORITHM, configId: config.id, revision: config.revision, inputHash: '', createdAt: now, warnings: m.warnings, limitations: m.limitations },
    snapshotId: saved.history[0].id, lateBinding: false, points: m.points,
    summary: { fMin: f.length ? Math.min(...f) : 0, fMax: f.length ? Math.max(...f) : 0, count: f.length },
  };
  await addMeasurement(db, rec, { id, ...m.data });
  return rec;
}
