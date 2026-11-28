// Профили оборудования и материалов (V2-047): переиспользуемые записи «Моих данных» с версиями. Экземпляр в комнате
// копирует данные версии и хранит ссылку на неё; новая версия профиля комнату не меняет без явного обновления.
import type { Passport } from '../../core/types';
import type { Directivity, SourceCapabilities, SourceKind } from './model';

/** Условия измерения АЧХ оборудования. Комнатная АЧХ — не свободнополевая характеристика громкоговорителя. */
export type ResponseField = 'anechoic' | 'quasi-anechoic' | 'near-field' | 'room' | 'unknown';

export interface MeasuredResponse {
  f: number[];
  db: number[];
  field: ResponseField;
  /** Расстояние микрофона, м; null — неизвестно. */
  distance: number | null;
  /** Опора уровня и временная привязка, как их указал источник данных. */
  reference: string;
  source: string;
  fileName: string;
  importedAt: string;
}

export interface EquipmentData {
  kind: SourceKind;
  maker: string;
  model: string;
  fLow: number;
  fHigh: number;
  passport: Passport | null;
  capabilities: SourceCapabilities;
  box: { w: number; h: number; d: number } | null;
  directivity: Directivity;
  response: MeasuredResponse | null;
  /** Откуда данные: паспорт производителя, свой замер, оценка. */
  source: string;
}

export interface MaterialData {
  /** α по октавам 63…4000 Гц (как в справочнике ядра). */
  alpha: number[];
  /** ± к каждому α; null — неизвестна. */
  uncertainty: number | null;
  source: string;
  /** Справочный материал, с которого начат профиль. */
  basedOn: string | null;
}

export interface ProfileVersion<T> { version: number; at: string; note: string; data: T }

export interface Profile<T> {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  /** Последняя версия. */
  version: number;
  versions: ProfileVersion<T>[];
}

export type EquipmentProfile = Profile<EquipmentData>;
export type MaterialProfile = Profile<MaterialData>;
