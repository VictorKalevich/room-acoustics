// Замер инструмента в комнату (V2-036): запись измерения с исходными данными, конфигурацией и снимком значимой части
// конфигурации на момент записи. Запись не изменяется; снимок — в историю комнаты (причина «измерение»).
// Запись из файла (V2-049) сделана раньше и не здесь: снимок не создаётся, привязка — поздняя.
import type { MeasurementData, MeasurementKind, MeasurementPoint, MeasurementRecord, MeasurementTiming } from '../domain/measurement';
import type { Listener, Room, RoomConfiguration } from '../domain/model';
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
  /** Обработка файла записи: имя и формат файла. */
  file?: { fileName: string; format: string };
  timing?: MeasurementTiming;
}

/** Где и что измерялось (V2-049): задаётся при сохранении или позже. */
export interface Binding { point?: MeasurementPoint; sourceIds?: string[] }

/** Точка микрофона на месте слушателя. */
export const listenerPoint = (l: Listener): MeasurementPoint => ({ label: l.name, position: { ...l.position }, listenerId: l.id });

/** Точки для выбора: места слушателей конфигурации. */
export const pointOptions = (c: RoomConfiguration): MeasurementPoint[] => c.listening.listeners.map(listenerPoint);

export async function saveToRoom(db: V2Db, rooms: RoomsService, clock: Clock, room: Room, role: 'current' | 'experimental', m: ToolMeasurement, bind: Binding = {}): Promise<MeasurementRecord> {
  const config = role === 'experimental' ? room.experimental : room.current;
  if (!config) throw new Error('В комнате нет эксперимента.');
  const now = clock.now();
  const snapshotId = m.file ? null : (await rooms.save(takeSnapshot(room, clock.newId, now, 'measurement', config), room)).history[0].id;
  const id = clock.newId();
  const f = m.data.rt60 ? m.data.rt60.map((b) => b.band) : m.data.f;
  const rec: MeasurementRecord = {
    id, roomId: room.id, configId: config.id, kind: m.kind, name: m.name, recordedAt: now,
    source: m.file ? { kind: 'file', fileName: m.file.fileName, format: m.file.format } : { kind: 'app', device: m.device },
    provenance: { kind: 'measured', method: m.method, algorithmVersion: TOOL_ALGORITHM, configId: config.id, revision: config.revision, inputHash: '', createdAt: now, warnings: m.warnings, limitations: m.limitations },
    snapshotId, lateBinding: !!m.file, points: m.points,
    ...(bind.point ? { point: bind.point } : {}), ...(bind.sourceIds?.length ? { sourceIds: bind.sourceIds } : {}), ...(m.timing ? { timing: m.timing } : {}),
    summary: { fMin: f.length ? Math.min(...f) : 0, fMax: f.length ? Math.max(...f) : 0, count: f.length },
  };
  await addMeasurement(db, rec, { id, ...m.data });
  return rec;
}
