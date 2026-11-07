// Типы расчётного ядра. Все величины в СИ: метры, секунды, герцы, градусы Цельсия.
// Система координат комнаты: x — глубина от передней стены (у которой колонки) к задней,
// y — от левой стены к правой, z — вверх от пола. Начало — передний левый нижний угол.

export type SurfaceId = 'floor' | 'ceiling' | 'front' | 'back' | 'left' | 'right';
export const SURFACES: SurfaceId[] = ['floor', 'ceiling', 'front', 'back', 'left', 'right'];

export type Furnishing = 'empty' | 'typical' | 'heavy';

/** Герметичность комнаты: влияет на нулевую моду (отклик ниже первой моды). */
export type Leakage = 'sealed' | 'typical' | 'door' | 'open';

export type ZoneKind = 'door' | 'window' | 'furniture' | 'other';

/** Прямоугольная зона на плане, где нельзя ставить источники (и, если !canSit, сидеть). */
export interface Zone {
  id: string;
  kind: ZoneKind;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  canSit: boolean;
}

export interface Calibration {
  /** Множитель затухания мод (подстройка по замеру). */
  dampingScale: number;
}

export interface Room {
  depth: number;
  width: number;
  height: number;
  temperatureC: number;
  materials: Record<SurfaceId, string>;
  furnishing: Furnishing;
  source: 'manual' | 'scan';
  zones: Zone[];
  leakage: Leakage;
  calibration: Calibration | null;
}

/** Коэффициенты поглощения по октавам 63, 125, 250, 500, 1000, 2000, 4000 Гц. */
export type OctaveValues = [number, number, number, number, number, number, number];

export interface Material {
  id: string;
  name: string;
  alpha: OctaveValues;
  extrapolated63: boolean;
  source: string;
}

export type ModeKind = 'axial' | 'tangential' | 'oblique';

export interface Mode {
  n: [number, number, number];
  f: number;
  kind: ModeKind;
  degenerate: boolean;
  clustered: boolean;
}

export interface ReverbResult {
  bands: number[];
  sabine: number[];
  eyring: number[];
  used: number[];
  formula: ('sabine' | 'eyring')[];
  meanAlpha: number[];
  /** Эквивалентная площадь поглощения по октавам, м² (включая мебель). */
  absorptionArea: number[];
  tMid: number;
  schroeder: number;
  volume: number;
  surfaceArea: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Complex {
  re: number;
  im: number;
}

export type SourceKind = 'speaker' | 'sub';

export type DelayMode = 'none' | 'adjustable';
export type PhaseMode = 'none' | 'polarity' | 'continuous' | 'full';

export interface SourceSpec {
  id: string;
  kind: SourceKind;
  fLow: number;
  fHigh: number;
  height: number;
  /** Только для сабвуферов: какие регулировки есть у устройства. */
  delayMode?: DelayMode;
  maxDelayMs?: number;
  phaseMode?: PhaseMode;
  levelAdjustable?: boolean;
}

/** Настройки сабвуфера: задержка, фаза, уровень. */
export interface SubSetting {
  delayMs: number;
  phaseDeg: number;
  gainDb: number;
}

export interface Seats {
  count: number;
  spacing: number;
}

export interface CrossoverSpec {
  adjustable: boolean;
  min: number;
  max: number;
}

export type SubZone = 'corners' | 'walls' | 'anywhere';

export interface Constraints {
  speakerMinFront: number;
  speakerMinSide: number;
  listenerMinX: number;
  listenerMaxX: number;
  earHeight: number;
  subZone: SubZone;
  subWallGap: number;
  seats: Seats;
  crossover: CrossoverSpec;
}

export interface Measurement {
  name: string;
  importedAt: string;
  f: number[];
  db: number[];
}

/** Вариант расстановки: положения, основное место слушателя, настройки сабвуферов. */
export interface Setup {
  id: string;
  name: string;
  listener: Vec3;
  positions: Record<string, Vec3>;
  subSettings: Record<string, SubSetting>;
  crossoverHz: number | null;
  measurement: Measurement | null;
}

export interface Penalty {
  name: string;
  value: number;
}

export interface Placement {
  listener: Vec3;
  /** Все места прослушивания (при одном месте — только основное). */
  seats: Vec3[];
  sources: { id: string; pos: Vec3 }[];
  score: number;
  scoreCenter: number;
  scoreSeats: number;
  penalties: Penalty[];
  angleDeg: number | null;
  response: { f: number[]; db: number[]; target: number[] };
}

export interface PlacementResult {
  best: Placement[];
  baseline: Placement;
  fLo: number;
  fHi: number;
  schroeder: number;
  evaluated: number;
  elapsedMs: number;
  notes: string[];
}

export class PlacementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlacementError';
  }
}
