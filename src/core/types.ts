// Типы расчётного ядра. Все величины в СИ: метры, секунды, герцы, градусы Цельсия.
// Система координат комнаты: x — глубина от передней стены (у которой колонки) к задней,
// y — от левой стены к правой, z — вверх от пола. Начало — передний левый нижний угол.

export type SurfaceId = 'floor' | 'ceiling' | 'front' | 'back' | 'left' | 'right';
export const SURFACES: SurfaceId[] = ['floor', 'ceiling', 'front', 'back', 'left', 'right'];

export type Furnishing = 'empty' | 'typical' | 'heavy';

export interface Room {
  depth: number;
  width: number;
  height: number;
  temperatureC: number;
  materials: Record<SurfaceId, string>;
  furnishing: Furnishing;
  source: 'manual' | 'scan';
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

export interface SourceSpec {
  id: string;
  kind: SourceKind;
  fLow: number;
  fHigh: number;
  height: number;
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
}

export interface Penalty {
  name: string;
  value: number;
}

export interface Placement {
  listener: Vec3;
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
