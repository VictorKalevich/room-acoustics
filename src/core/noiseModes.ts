import { isWave } from './geometry';
import type { Mode, ModeKind, Room } from './types';

/**
 * Расчётные моды комнаты на спектре шумомера (057). Частоты мод не считаются здесь: снимок берёт готовый список
 * computeModes (src/core/modes.ts) — тот же, что на экране «Моды». Пики ищутся в сохранённой или живой PSD шумомера
 * без пересчёта и без интерполяции; соответствие пика и моды — только совпадение частот в пределах допуска.
 */
export const ROOM_SNAPSHOT_VERSION = 1;

export interface NoiseMode { f: number; n: [number, number, number]; kind: ModeKind }

/** Комната на момент начала измерения: размеры, температура и готовый список мод. Только сведения, проект не меняется. */
export interface NoiseRoomSnapshot {
  version: typeof ROOM_SNAPSHOT_VERSION;
  /** Модель списка: прямоугольная комната с жёсткими стенами. */
  model: 'rect-rigid';
  depth: number;
  width: number;
  height: number;
  temperatureC: number;
  /** У комнаты есть пристройки, скос или проёмы волновой модели: прямоугольная модель для неё — приближение. */
  approximate: boolean;
  /** Частота Шрёдера проекта, Гц: выше неё моды перекрываются, пики с модами не сопоставляются. */
  schroederHz: number;
  /** Верхняя частота списка, Гц. */
  fMax: number;
  modes: NoiseMode[];
}

export function roomSnapshot(room: Room, modes: readonly Mode[], fMax: number, schroederHz: number): NoiseRoomSnapshot {
  return {
    version: ROOM_SNAPSHOT_VERSION, model: 'rect-rigid', depth: room.depth, width: room.width, height: room.height,
    temperatureC: room.temperatureC, approximate: isWave(room) || (room.extensions ?? []).length > 0 || !!room.slope,
    schroederHz, fMax, modes: modes.map(m => ({ f: m.f, n: [m.n[0], m.n[1], m.n[2]], kind: m.kind })),
  };
}

/** Те же размеры, температура и признак приближения: список мод тогда тот же. */
export const sameRoom = (a: NoiseRoomSnapshot, b: NoiseRoomSnapshot) => a.depth === b.depth && a.width === b.width &&
  a.height === b.height && a.temperatureC === b.temperatureC && a.approximate === b.approximate;

const KINDS: readonly ModeKind[] = ['axial', 'tangential', 'oblique'];
const positive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;
/** Форма снимка из записи или файла. Числа мод не пересчитываются: снимок хранит то, что было показано. */
export function checkRoomSnapshot(s: NoiseRoomSnapshot): NoiseRoomSnapshot {
  const bad = (what: string): never => { throw new Error('неверный снимок комнаты: ' + what); };
  if (!s || s.version !== ROOM_SNAPSHOT_VERSION || s.model !== 'rect-rigid' || typeof s.approximate !== 'boolean') bad('версия');
  if (![s.depth, s.width, s.height, s.schroederHz, s.fMax].every(positive) || !Number.isFinite(s.temperatureC)) bad('размеры');
  if (!Array.isArray(s.modes) || s.modes.length > 20000) bad('список мод');
  let previous = 0;
  for (const m of s.modes) {
    const n = m?.n;
    if (!positive(m?.f) || m.f < previous || m.f > s.fMax || !Array.isArray(n) || n.length !== 3 ||
        !n.every(v => Number.isSafeInteger(v) && v >= 0) || !KINDS.includes(m.kind) ||
        KINDS[n.filter(v => v > 0).length - 1] !== m.kind) bad('мода');
    previous = m.f;
  }
  return s;
}

/** Какие типы показывать первыми, когда маркеров больше предела: осевые сильнее всего. */
export const MAX_MARKERS = 24;
export function modeMarkers(modes: readonly NoiseMode[], o: { lo: number; hi: number; kinds: readonly ModeKind[]; max?: number }) {
  const inRange = modes.filter(m => m.f >= o.lo && m.f <= o.hi && o.kinds.includes(m.kind));
  const max = o.max ?? MAX_MARKERS;
  const shown = inRange.length <= max ? inRange
    : [...inRange].sort((a, b) => KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind) || a.f - b.f).slice(0, max).sort((a, b) => a.f - b.f);
  return { shown, total: inRange.length };
}

/** Другая мода списка ближе 0,5 % — то же правило, что «совпадение» на экране «Моды». */
export const coincident = (modes: readonly NoiseMode[], m: NoiseMode) =>
  modes.some(o => o !== m && Math.abs(o.f - m.f) / m.f < 0.005);

/**
 * Поиск выраженных пиков. Оценка PSD одного кадра — экспоненциальное распределение: отдельные бины на 6 дБ выше среднего
 * встречаются в каждом спектре, поэтому нужен средний спектр. Кадры 32768 с шагом 16384 (окно Ханна, перекрытие 50 %:
 * коэффициент перекрытия 1/6): 24 кадра — около 23 независимых усреднений, разброс бина около ±1 дБ.
 */
export const PEAK_MIN_FRAMES = 24;
export const PEAK_PROMINENCE_DB = 6;
/** Главный лепесток окна Ханна — ±2 бина; пик должен быть наибольшим в ±3 бинах. */
export const PEAK_LOCAL_BINS = 3;
/**
 * Фон — медиана симметричного окна вокруг пика без самого пика: 1/3 октавы, но не меньше ±12 бинов. Симметрия нужна,
 * чтобы наклон спектра не сдвигал медиану; у нижнего края окно сужается, но остаётся не меньше ±8 бинов, поэтому поиск
 * начинается чуть выше 20 Гц (около 22 Гц при 48 кГц).
 */
export const PEAK_BACKGROUND_BINS = 12;
const MIN_SPAN = PEAK_LOCAL_BINS + 5;
export const MAX_PEAKS = 8;
/** Ниже 10 Гц бины искажены вычитанием среднего и утечкой окна; в фон они не входят. */
const FLOOR_HZ = 10;

export interface SpectralPeak {
  /** Частота бина, Гц: разрешение — шаг спектра, без интерполяции. */
  f: number;
  bin: number;
  /** Средняя PSD в бине, dBFS/Гц. */
  levelDb: number;
  /** Насколько бин выше медианы соседних, дБ. */
  prominenceDb: number;
}
export type PeakSearch =
  | { ok: true; peaks: SpectralPeak[]; lo: number; hi: number }
  | { ok: false; reason: 'frames'; frames: number } | { ok: false; reason: 'range' };

export function spectralPeaks(density: Float64Array, binHz: number, o: { lo: number; hi: number; frames: number }): PeakSearch {
  if (o.frames < PEAK_MIN_FRAMES) return { ok: false, reason: 'frames', frames: o.frames };
  const floor = Math.ceil(FLOOR_HZ / binHz);
  const first = Math.max(floor + MIN_SPAN, Math.ceil(o.lo / binHz));
  const last = Math.min(density.length - 1 - MIN_SPAN, Math.floor(o.hi / binHz));
  if (last < first) return { ok: false, reason: 'range' };
  const around: number[] = [], peaks: SpectralPeak[] = [];
  for (let k = first; k <= last; k++) {
    const v = density[k];
    if (!(v > 0)) continue;
    let top = true;
    for (let j = 1; j <= PEAK_LOCAL_BINS && top; j++) top = density[k - j] < v && density[k + j] <= v;
    if (!top) continue;
    const span = Math.min(Math.max(PEAK_BACKGROUND_BINS, Math.round(k * (2 ** (1 / 6) - 1))), k - floor, density.length - 1 - k);
    around.length = 0;
    for (let j = PEAK_LOCAL_BINS + 1; j <= span; j++) around.push(density[k - j], density[k + j]);
    around.sort((a, b) => a - b);
    const median = (around[(around.length >> 1) - 1] + around[around.length >> 1]) / 2;
    const prominenceDb = 10 * Math.log10(v / Math.max(median, Number.MIN_VALUE));
    if (prominenceDb >= PEAK_PROMINENCE_DB) peaks.push({ f: k * binHz, bin: k, levelDb: 10 * Math.log10(v), prominenceDb });
  }
  peaks.sort((a, b) => b.prominenceDb - a.prominenceDb);
  return { ok: true, peaks: peaks.slice(0, MAX_PEAKS).sort((a, b) => a.f - b.f), lo: first * binHz, hi: last * binHz };
}

/**
 * Допуск совпадения: 3 % частоты моды (размеры, температура и податливость стен известны неточно; это инженерное
 * допущение, а не оценка погрешности) плюс шаг спектра (частота пика известна с точностью до бина).
 */
export const MODE_TOLERANCE = 0.03;
export const matchTolerance = (f: number, binHz: number) => MODE_TOLERANCE * f + binHz;

export interface PeakMatch { peak: SpectralPeak; tolerance: number; candidates: { mode: NoiseMode; df: number }[] }
/** Все расчётные моды (любого типа) в пределах допуска от каждого пика, ближайшие первыми. Соответствие — только возможное. */
export function matchPeaks(peaks: readonly SpectralPeak[], modes: readonly NoiseMode[], binHz: number): PeakMatch[] {
  return peaks.map(peak => {
    const tolerance = matchTolerance(peak.f, binHz);
    const candidates = modes.filter(m => Math.abs(m.f - peak.f) <= tolerance).map(mode => ({ mode, df: mode.f - peak.f }))
      .sort((a, b) => Math.abs(a.df) - Math.abs(b.df));
    return { peak, tolerance, candidates };
  });
}

/** Верхняя граница сопоставления: видимый диапазон, частота Шрёдера и конец списка мод. */
export const matchUpper = (snapshot: NoiseRoomSnapshot, visibleHz: number) => Math.min(visibleHz, snapshot.schroederHz, snapshot.fMax);
