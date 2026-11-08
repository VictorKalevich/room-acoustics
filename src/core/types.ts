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
  /** Подпись (например, «Диван») и признак, что зона взята из скана. */
  name?: string;
  fromScan?: boolean;
}

export type WallId = 'front' | 'back' | 'left' | 'right';

/** Проём в стене наружу или в большой объём (поглощает звук полностью). */
export interface Opening {
  id: string;
  wall: WallId;
  /** Участок вдоль стены, м: для передней/задней — от левой стены, для левой/правой — от передней. */
  a0: number;
  a1: number;
  height: number;
}

/** Окно или закрытая дверь: участок стены, который поглощает бас как мембрана (стекло, дверное полотно). */
export interface WallFeature {
  id: string;
  kind: 'window' | 'door';
  wall: WallId;
  a0: number;
  a1: number;
  /** Низ и верх над полом, м. */
  bottom: number;
  top: number;
}

/** Смежное помещение (например, коридор), примыкающее к стене комнаты, с аркой между ними. */
export interface Extension {
  id: string;
  name: string;
  wall: WallId;
  a0: number;
  a1: number;
  depth: number;
  height: number;
  arch: { a0: number; a1: number; height: number };
  /** Концы вдоль стены (в сторону меньшей / большей координаты) и дальняя сторона открыты. */
  openStart: boolean;
  openEnd: boolean;
  openFar: boolean;
}

export type AcousticModel = 'auto' | 'modal' | 'wave';

/** Элемент обработки: угловая басовая ловушка, панель на стене, облако под потолком. */
export interface Treatment {
  id: string;
  kind: 'corner' | 'panel' | 'cloud';
  /** Толщина поглотителя и воздушный зазор за ним, м. */
  thickness: number;
  gap?: number;
  /** Ширина и высота (для облака — размеры в плане), м. */
  width: number;
  height: number;
  corner?: 'front-left' | 'front-right' | 'back-left' | 'back-right';
  wall?: WallId;
  /** Центр панели вдоль стены и по высоте, м. */
  at?: number;
  z?: number;
  /** Центр облака в плане, м. */
  x?: number;
  y?: number;
  enabled?: boolean;
}

export interface Calibration {
  /** Множитель затухания мод (подстройка по замеру). */
  dampingScale: number;
  /** Версия модели затухания, для которой подобран множитель (при смене модели подстройка сбрасывается). */
  model?: number;
}

/** Текущая версия модели затухания: 2 — обстановка по замерам жилых комнат, окна и двери, участки по форме мод. */
export const DAMPING_MODEL = 2;

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
  openings: Opening[];
  extensions: Extension[];
  model: AcousticModel;
  /** Окна и закрытые двери: на плане и в расчёте затухания. */
  features: WallFeature[];
  /** Скос потолка у стены wall: у стены высота low, на расстоянии run от неё — полная высота. */
  slope?: { wall: WallId; low: number; run: number } | null;
  /** План обработки и признак «учитывать в расчёте». */
  treatments?: Treatment[];
  treatmentsOn?: boolean;
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
  /** Сколько полос параметрического эквалайзера есть у канала сабвуфера (0 — нет) и есть ли all-pass. */
  peqBands?: number;
  allpass?: boolean;
}

/** Настройки сабвуфера: задержка, фаза, уровень. */
export interface SubSetting {
  delayMs: number;
  phaseDeg: number;
  gainDb: number;
  /** Свои фильтры канала сабвуфера: пиковые (PEQ) и фазовые (all-pass 2-го порядка). */
  peq?: { f: number; gainDb: number; q: number }[];
  allpass?: { f: number; q: number }[];
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

/**
 * Цель подбора мест для баса:
 *  flat — ровный бас (отклонение от цели вверх и вниз одинаково, как раньше);
 *  dips — меньше провалов (пики срежет эквалайзер, провалы — нет);
 *  lowDips — меньше провалов внизу (чем ниже частота, тем важнее);
 *  wideLow — без широких провалов у нижней границы (сглаживание 1/3 октавы, две нижние октавы);
 *  modes — без провалов на выбранных модах.
 */
export type ObjectiveId = 'flat' | 'dips' | 'lowDips' | 'wideLow' | 'modes';
/** Какие моды важнее: первые осевые, осевые до 150 Гц, шесть самых низких, выбранные вручную. */
export type ModePreset = 'first' | 'axial' | 'lowest' | 'custom';

export interface BassObjective {
  id: ObjectiveId;
  modePreset?: ModePreset;
  /** Номера мод для выбора вручную. */
  modes?: [number, number, number][];
}

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
  /** Добавить к вариантам схему DBA (нужно ≥ 2 сабвуферов). */
  dba?: boolean;
  /** Цель подбора мест (авто и ручной режимы, карты). Нет — ровный бас. */
  objective?: BassObjective;
}

export interface Measurement {
  name: string;
  importedAt: string;
  f: number[];
  db: number[];
  /** Сколько точек усреднено (замер свипом в приложении); у импорта из REW — одна. */
  points?: number;
  /** Сеанс записи в приложении: повторное сохранение того же сеанса уточняет замер, а не создаёт новый. */
  session?: string;
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
  /** Прошлые замеры этой расстановки (свежие первыми) — для сравнения «до и после». */
  history?: Measurement[];
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
  /** Оценка по выбранной цели подбора (со штрафами); при цели «ровный бас» равна score. */
  objScore?: number;
  scoreCenter: number;
  scoreSeats: number;
  penalties: Penalty[];
  angleDeg: number | null;
  response: { f: number[]; db: number[]; target: number[] };
  /** Настройки сабвуферов варианта (например, для схемы DBA) и схема. */
  subSettings?: Record<string, SubSetting>;
  scheme?: 'dba';
  /** Устойчивость: на сколько дБ в среднем ухудшается оценка при сдвиге источников и слушателя на 10 см. */
  robust?: number;
  notes?: string[];
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
