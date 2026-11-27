// Записи измерений и результатов поиска v2 (data-model): исходные данные неизменяемы и хранятся отдельно от описания;
// снимок модели на момент записи есть только у записей, сделанных с ним, — при переносе он не выдумывается.
import type { PlacementResult, Vec3 } from '../../core/types';
import type { DbRef, Hertz } from './units';
import type { Provenance } from './provenance';

export type MeasurementKind = 'frequency-response' | 'impulse-response' | 'rt60' | 'noise' | 'spl';

export type MeasurementSource =
  | { kind: 'legacy-project'; projectId: string; setupId: string; setupName: string; slot: 'current' | 'history' }
  | { kind: 'file'; fileName: string; format: string }
  | { kind: 'app'; device: string; session?: string }
  /** Расчёт из других замеров (среднее по точкам, V2-049). */
  | { kind: 'derived'; from: string[]; method: string };

/** Где стоял микрофон (V2-049): подпись, положение (null — не указано) и место слушателя, если это оно. */
export interface MeasurementPoint { label: string; position: Vec3 | null; listenerId?: string }

/** Время прихода звука (V2-049): по петле — время пролёта от колонки, по файлу — от начала записи. */
export interface MeasurementTiming { arrivalMs: number; ref: 'loopback' | 'file-start'; distance: number | null }

export interface MeasurementRecord {
  id: string;
  roomId: string;
  /** Конфигурация, к которой относится измерение; null — неизвестно. */
  configId: string | null;
  kind: MeasurementKind;
  name: string;
  recordedAt: string;
  source: MeasurementSource;
  provenance: Provenance;
  /** Снимок значимой части конфигурации на момент записи; null — снимка нет (не выдумывается). */
  snapshotId: string | null;
  /** Привязка к комнате сделана позже записи (перенос, импорт файла). */
  lateBinding: boolean;
  /** Сколько точек усреднено. */
  points?: number;
  session?: string;
  /** Вариант архива, с которым сделано измерение. */
  archiveId?: string;
  /** Точка микрофона, звучавшие источники и время прихода (V2-049); нет — не указано. */
  point?: MeasurementPoint;
  sourceIds?: string[];
  timing?: MeasurementTiming;
  /** Когда привязка изменена после записи. */
  boundAt?: string;
  summary: { fMin: Hertz; fMax: Hertz; count: number };
}

/** Исходные данные измерения: ключ совпадает с `MeasurementRecord.id`. */
export interface MeasurementData {
  id: string;
  f: Hertz[];
  db: number[];
  ref: DbRef;
  /** Время реверберации по октавам (вид rt60, V2-036); f и db тогда пустые. approx — оценка по T10. */
  rt60?: { band: Hertz; t60: number | null; approx?: boolean }[];
}

/** Результат поиска мест (временный или перенесённый) — не третья конфигурация. */
export interface OptimizationRun {
  id: string;
  roomId: string;
  configId: string | null;
  createdAt: string | null;
  result: PlacementResult;
  /** Входы с тех пор могли измениться: результат показывается как устаревший, пока его не пересчитают. */
  stale: boolean;
  provenance: Provenance;
}
