// Предметная модель v2 (059, data-model): комната с текущей и необязательной экспериментальной конфигурацией.
// Только типы и константы, без Preact, IndexedDB, DOM и Web Audio. Формы, общие с ядром, берутся из его типов.
import type {
  AcousticModel, BassObjective, Calibration, Covering, CrossoverSpec, DelayMode, Extension, Furnishing, HouseRise,
  Leakage, Passport, PhaseMode, Seats, SubSetting, SubZone, SurfaceId, Treatment, Vec3, WallId, Zone,
} from '../../core/types';
import type { Precision } from '../../core/precision';
import type { VoiceSettings } from '../../core/voice';
import type { Celsius, Degrees, Hertz, Maybe, Meters } from './units';

export const ROOM_SCHEMA = 1;

export type Complexity = 'simple' | 'advanced' | 'expert';
export const COMPLEXITIES: readonly Complexity[] = ['simple', 'advanced', 'expert'];

export type ConfigRole = 'current' | 'experimental';

/**
 * Геометрия. Система координат (R01) совпадает с ядром: x — от передней стены (у колонок) к задней, y — от левой стены
 * к правой, z — вверх от пола, начало — передний левый угол у пола. Скос потолка — как в ядре.
 */
export interface RectGeometry {
  kind: 'rect';
  depth: Meters;
  width: Meters;
  height: Meters;
  slope: { wall: WallId; low: Meters; run: Meters } | null;
}

/** Произвольный контур в плане (продвинутый режим, V2-046). Точки — по часовой стрелке от начала координат. */
export interface PolygonGeometry {
  kind: 'polygon';
  outline: { x: Meters; y: Meters }[];
  height: Meters;
}

export type Geometry = RectGeometry | PolygonGeometry;

/** Форма из конструктора (V2-046): какие смежные зоны — части комнаты, а не коридоры; контур — для повторной правки. */
export type ShapeKind = 'rect' | 'l' | 't' | 'u' | 'niche' | 'contour';
export interface RoomShape {
  kind: Exclude<ShapeKind, 'rect'>;
  zoneIds: string[];
  outline?: { x: Meters; y: Meters }[];
}

/** Материал поверхности — ссылка на профиль: встроенный материал ядра или версия профиля библиотеки. */
/**
 * Свой материал поверхности (V2-047): копия версии профиля библиотеки. Ядро знает только справочник: в его расчёт идёт
 * ближайший справочный материал `material`, о чём сообщает адаптер; расчёты v2 берут α профиля.
 */
export interface SurfaceProfile { id: string; version: number; name: string; alpha: number[]; uncertainty: number | null; source: string }
export interface SurfaceMaterial { material: string; profileVersion?: number; profile?: SurfaceProfile }
export type Surfaces = Record<SurfaceId, SurfaceMaterial>;

/**
 * Состояние проёма: закрытая дверь или окно — мембрана в стене; открытая дверь и постоянный проём — выход в большой
 * объём; проём к неизвестному пространству — то же с предупреждением, что соседнее помещение не описано.
 */
export type OpeningState = 'closed' | 'open' | 'permanent' | 'unknown-neighbour';
export type OpeningKind = 'door' | 'window' | 'passage';

export interface Opening {
  id: string;
  kind: OpeningKind;
  wall: WallId;
  /** Участок вдоль стены: для передней и задней — от левой стены, для левой и правой — от передней. */
  a0: Meters;
  a1: Meters;
  bottom: Meters;
  top: Meters;
  state: OpeningState;
  fromScan?: boolean;
}

/** Смежное пространство за аркой (коридор и т. п.) — форма ядра. */
export type AcousticZone = Extension;

export type SourceKind = 'speaker' | 'sub';

export interface SourceCapabilities {
  delayMode?: DelayMode;
  maxDelayMs?: number;
  phaseMode?: PhaseMode;
  levelAdjustable?: boolean;
  peqBands?: number;
  allpass?: boolean;
}

/** Ссылка экземпляра на версию профиля оборудования (V2-047). */
export interface ProfileRef { id: string; version: number }

/**
 * Направленность источника (V2-047): всенаправленная или параметрическая — выше `aboveHz` ширина диаграммы `beamDeg`
 * по уровню −6 дБ. Ядро считает источники всенаправленными; параметрическую учитывают расчёты отражений v2.
 */
export type Directivity = { kind: 'omni' } | { kind: 'parametric'; aboveHz: number; beamDeg: number };

export interface Source {
  id: string;
  kind: SourceKind;
  name: string;
  /** Канал аудиосистемы: L, R, C, SL, SR, LFE… */
  channel?: string;
  /** Акустический центр: x, y на плане и z — высота центра над полом. */
  position: Vec3;
  /** Поворот в плане: 0 — излучает к задней стене (вдоль +x), положительный — к правой стене. */
  rotationDeg: Degrees;
  fLow: Hertz;
  fHigh: Hertz;
  capabilities: SourceCapabilities;
  passport?: Passport;
  /** Настройки канала: задержка, фаза, уровень, PEQ и all-pass (у сабвуферов — как в ядре). */
  settings?: SubSetting;
  /** Размеры корпуса (ширина, высота, глубина), если известны. */
  box?: Maybe<{ w: Meters; h: Meters; d: Meters }>;
  profile?: ProfileRef;
  directivity?: Directivity;
  locked?: boolean;
}

export type SystemLayout = 'mono' | '2.0' | '2.1' | '2.2' | '5.1' | 'custom';

export interface AudioSystem {
  layout: SystemLayout;
  sources: Source[];
  /** Частота раздела колонок и сабвуферов (null — без раздела) и возможности кроссовера. */
  crossoverHz: Hertz | null;
  crossover: CrossoverSpec;
}

export interface Listener {
  id: string;
  name: string;
  /** Положение головы; z — высота ушей. */
  position: Vec3;
  /** Вес в оценке нескольких мест. */
  weight: number;
  primary: boolean;
  locked?: boolean;
}

export interface Listening {
  listeners: Listener[];
  /** Ряд мест вокруг основного слушателя — как в ядре (count, spacing). */
  seats: Seats;
}

/** Закреплённый объект не двигается на плане и при подборе (V2-025, V2-043). */
export interface Lockable { locked?: boolean }
export type InteriorZone = Zone & Lockable;

export interface Interior {
  /** Мебель и области, где нельзя ставить источники (и, если canSit = false, сидеть) — форма ядра. */
  obstacles: InteriorZone[];
  coverings: Covering[];
  /** Обстановка на средних и высоких частотах — по списку мебели и покрытий; бас — по `furnishing`. */
  furnitureList: boolean;
  furnishing: Furnishing;
}

/** Акустическая обработка. Пористые элементы — форма ядра; диффузоры и резонаторы — элементы v2 (V2-034, V2-052). */
export interface DiffuserItem {
  id: string;
  kind: 'diffuser';
  design: 'qrd-1d' | 'qrd-2d' | 'skyline' | 'prd' | 'cylinder' | 'relief';
  wall: WallId;
  at: Meters;
  z: Meters;
  width: Meters;
  height: Meters;
  depth: Meters;
  enabled?: boolean;
}

export interface ResonatorItem {
  id: string;
  kind: 'resonator';
  design: 'helmholtz' | 'membrane' | 'perforated' | 'slot';
  wall: WallId;
  at: Meters;
  z: Meters;
  width: Meters;
  height: Meters;
  depth: Meters;
  tuningHz: Maybe<Hertz>;
  enabled?: boolean;
}

export type TreatmentItem = (Treatment & Lockable) | (DiffuserItem & Lockable) | (ResonatorItem & Lockable);

export interface TreatmentPlan {
  items: TreatmentItem[];
  /** Учитывать обработку в расчёте. */
  enabled: boolean;
}

export interface PlacementRules {
  speakerMinFront: Meters;
  speakerMinSide: Meters;
  listenerMinX: Meters;
  listenerMaxX: Meters;
  subZone: SubZone;
  subWallGap: Meters;
  dba?: boolean;
}

export interface SimulationSettings {
  model: AcousticModel;
  precision?: Precision;
  temperatureC: Celsius;
  leakage: Leakage;
  calibration: Calibration | null;
  objective?: BassObjective;
  houseCurve?: HouseRise;
  placement: PlacementRules;
}

export interface RoomConfiguration {
  id: string;
  role: ConfigRole;
  /** Растёт при каждом изменении; результат расчёта хранит ревизию, по которой получен. */
  revision: number;
  /** Для эксперимента — с какой ревизии текущей конфигурации он скопирован. */
  basedOn?: { configId: string; revision: number };
  geometrySource: 'manual' | 'scan';
  geometry: Geometry;
  /** Сложная форма: части комнаты среди смежных зон. Нет — прямоугольник и зоны пользователя. */
  shape?: RoomShape;
  surfaces: Surfaces;
  openings: Opening[];
  zones: AcousticZone[];
  audio: AudioSystem;
  listening: Listening;
  interior: Interior;
  treatment: TreatmentPlan;
  simulation: SimulationSettings;
  /** Места выбраны (подбором, вручную или подтверждением): до этого расчёты, зависящие от мест, закрыты. */
  placed: boolean;
  /** Место для записи голоса (сценарий анализа мест, 013/016). */
  voice: VoiceSettings | null;
  /** Сведения о применённом скане — как их хранит ядро скана; v2 их не толкует. */
  scan: unknown;
}

/** Неизменяемый исторический вариант (сохранённая расстановка legacy или результат поиска). */
export interface ArchivedVariant {
  id: string;
  name: string;
  /** null — время сохранения неизвестно (legacy его не хранил). */
  savedAt: string | null;
  origin: 'legacy-setup' | 'optimization' | 'manual';
  layout: {
    listener: Vec3;
    positions: Record<string, Vec3>;
    subSettings: Record<string, SubSetting>;
    crossoverHz: Hertz | null;
  };
  /** Ссылки на измерения, сделанные с этим вариантом. */
  measurementIds: string[];
}

/** Снимок прежней фактической конфигурации при подтверждении эксперимента. */
export interface ConfigSnapshot {
  id: string;
  takenAt: string;
  reason: 'experiment-confirmed' | 'measurement' | 'manual';
  config: RoomConfiguration;
}

export type GoalId = 'balanced' | 'bass-uniformity' | 'bass-depth' | 'stereo' | 'speech' | 'reverb' | 'custom';

export interface Goals {
  primary: GoalId;
  use: 'music' | 'cinema' | 'speech' | 'recording' | 'mixed';
  /** Бюджет в валюте пользователя; неизвестный — не ноль. */
  budget: Maybe<number>;
  constraints: {
    noDrilling: boolean;
    maxDepthM: Maybe<Meters>;
    canMoveFurniture: boolean;
    canMoveEquipment: boolean;
    /** Мягкие ограничения (V2-042): сохранить полезную площадь пола, важен внешний вид. Нет — не важно. */
    keepArea?: boolean;
    looks?: boolean;
  };
}

export interface Room {
  schema: typeof ROOM_SCHEMA;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  current: RoomConfiguration;
  experimental: RoomConfiguration | null;
  goals: Goals;
  archive: ArchivedVariant[];
  history: ConfigSnapshot[];
  origin: { kind: 'created' } | { kind: 'migrated'; legacyProjectId: string; migratedAt: string; legacyUpdatedAt: string };
}

export const DEFAULT_GOALS: Goals = {
  primary: 'balanced',
  use: 'music',
  budget: { missing: 'unset' },
  constraints: { noDrilling: false, maxDepthM: { missing: 'unset' }, canMoveFurniture: true, canMoveEquipment: true },
};
