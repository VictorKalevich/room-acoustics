// Замеры REW (research R16): импорт, сравнение с моделью, подстройка модели.
import type { Constraints, Leakage, Measurement, Room, Setup, SourceSpec } from './types';
import { logFreqs } from './frequency';
import { clampToRoom, filterSet, makeCtx, rawResponses, sumDb } from './system';
import { isWave } from './geometry';

export class MeasureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MeasureError';
  }
}

/** Разбор текстового экспорта REW (File → Export → Measurement as text). */
export function parseRew(text: string, name = 'Замер'): Measurement {
  const pts: [number, number][] = [];
  for (const line0 of text.split(/\r?\n/)) {
    const line = line0.trim();
    if (!line || line.startsWith('*') || line.startsWith('#')) continue;
    let tokens = line.split(/[\s;]+/).filter(Boolean);
    if (tokens.length < 2) tokens = line.split(',');
    const nums = tokens.map((t) => Number(t.replace(',', '.')));
    if (nums.length < 2 || !Number.isFinite(nums[0]) || !Number.isFinite(nums[1])) continue;
    pts.push([nums[0], nums[1]]);
  }
  const usable = pts.filter(([f]) => f >= 10 && f <= 1000).sort((a, b) => a[0] - b[0]);
  if (usable.filter(([f]) => f >= 15 && f <= 500).length < 10) {
    throw new MeasureError(
      'В файле нет данных АЧХ в диапазоне 15–500 Гц. Экспортируйте замер из REW: File → Export → Export measurement as text.',
    );
  }
  const fMin = Math.max(15, usable[0][0]);
  const fMax = Math.min(500, usable[usable.length - 1][0]);
  const grid = logFreqs(fMin, fMax, 48);
  // Сглаживание не добавляем: его выбирают при экспорте в REW (рекомендуется 1/24 или 1/12 октавы)
  const db = grid.map((f) => interpLog(usable, f));
  return { name, importedAt: new Date().toISOString(), f: grid, db };
}

function interpLog(pts: [number, number][], f: number): number {
  let lo = 0, hi = pts.length - 1;
  if (f <= pts[0][0]) return pts[0][1];
  if (f >= pts[hi][0]) return pts[hi][1];
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (pts[mid][0] <= f) lo = mid; else hi = mid;
  }
  const t = Math.log(f / pts[lo][0]) / Math.log(pts[hi][0] / pts[lo][0]);
  return pts[lo][1] * (1 - t) + pts[hi][1] * t;
}

/** Значения замера на заданных частотах (только в пределах замера). */
export function measurementAt(m: Measurement, freqs: number[]): (number | null)[] {
  const pts = m.f.map((f, i) => [f, m.db[i]] as [number, number]);
  return freqs.map((f) => (f < m.f[0] || f > m.f[m.f.length - 1] ? null : interpLog(pts, f)));
}

type SetupLike = Pick<Setup, 'listener' | 'positions' | 'subSettings' | 'crossoverHz'>;

export interface Comparison {
  f: number[];
  model: number[];
  measured: number[];
  rms: number;
  /** Модель усреднена по точкам вокруг места (как замер из нескольких точек). */
  averaged: boolean;
}

/** Сглаживание кривых перед сравнением (доля октавы, усреднение мощности). */
const COMPARE_SMOOTH = 1 / 12;
/** Отклонения больше этого (дБ) — обычно узкие провалы, чувствительные к сантиметрам, — не перевешивают остальное. */
const COMPARE_CLIP = 10;
/** Точки вокруг места, по которым усредняется модель для замера из нескольких точек (как в подсказке: 30–50 см). */
const CLOUD = [[0, 0], [0.3, 0], [-0.3, 0], [0, 0.3], [0, -0.3]];

/** Медиана (без NaN). */
const medianOf = (v: number[]) => {
  const s = v.filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return 0;
  const k = s.length >> 1;
  return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2;
};

/** Сглаживание в долях октавы с усреднением мощности (сетка — логарифмическая). */
function smoothPow(freqs: number[], db: number[], frac: number): number[] {
  const k = Math.pow(2, frac / 2);
  return freqs.map((f) => {
    let s = 0, n = 0;
    for (let j = 0; j < freqs.length; j++) if (freqs[j] >= f / k && freqs[j] <= f * k) { s += Math.pow(10, db[j] / 10); n++; }
    return 10 * Math.log10(s / n);
  });
}

/** Число точек замера; у старых замеров свипом — из названия «… точек: N». */
export function measuredPoints(m: Measurement): number {
  if (m.points) return m.points;
  const k = /точек:\s*(\d+)/.exec(m.name);
  return k ? Number(k[1]) : 1;
}

/**
 * Модель в той же форме, что замер: в точке слушателя или, если замер — среднее по нескольким точкам,
 * среднее по мощности в 5 точках вокруг места (±30 см). Сетка 48 точек на октаву.
 */
export function modelForMeasurement(room: Room, sources: SourceSpec[], setup: SetupLike, m: Measurement, freqsIn?: number[]): { f: number[]; db: number[]; averaged: boolean } {
  const ctx = makeCtx(room, sources);
  const f = freqsIn ?? logFreqs(ctx.fLo, ctx.fHi, 48);
  const averaged = measuredPoints(m) > 1;
  const L = setup.listener;
  const pts = averaged
    ? CLOUD.map(([dx, dy]) => clampToRoom(room, { x: L.x + dx, y: L.y + dy, z: L.z }, 0.15))
    : [L];
  const { filt } = filterSet(sources, f, setup.crossoverHz, setup.subSettings);
  const raw = rawResponses(ctx, pts, f, setup.positions);
  const ids = sources.map((s) => s.id).filter((id) => setup.positions[id]);
  const pow = new Float64Array(f.length);
  pts.forEach((_, r) => {
    const d = sumDb(raw, filt, r, f.length, ids);
    for (let j = 0; j < f.length; j++) pow[j] += Math.pow(10, d[j] / 10) / pts.length;
  });
  return { f, db: Array.from(pow, (p) => 10 * Math.log10(Math.max(p, 1e-30))), averaged };
}

/**
 * Сравнение замера с моделью: модель берётся в той же форме, что замер (одна точка или среднее по точкам),
 * обе кривые одинаково сглажены (1/12 октавы) и выровнены по медиане разницы — узкий глубокий провал
 * не сдвигает всю кривую (по среднему провал −20 дБ на 10 % полосы смещал бы её на 2 дБ); расхождение — СКО,
 * отклонения ограничены ±10 дБ.
 */
export function compareMeasurement(room: Room, sources: SourceSpec[], _c: Constraints, setup: SetupLike, m: Measurement): Comparison {
  const mod = modelForMeasurement(room, sources, setup, m);
  const meas = measurementAt(m, mod.f);
  const idx = meas.map((v, i) => (v == null ? -1 : i)).filter((i) => i >= 0);
  if (idx.length < 16) throw new MeasureError('Замер не перекрывает расчётную полосу частот — нужен замер от 20 Гц до частоты Шрёдера.');
  const f = idx.map((i) => mod.f[i]);
  const model = smoothPow(f, idx.map((i) => mod.db[i]), COMPARE_SMOOTH);
  const measured = smoothPow(f, idx.map((i) => meas[i] as number), COMPARE_SMOOTH);
  const mm = medianOf(model);
  const shift = medianOf(measured.map((v, i) => v - model[i]));
  const mN = model.map((v) => v - mm);
  const sN = measured.map((v) => v - shift - mm);
  const rms = Math.sqrt(mN.reduce((a, v, i) => a + Math.min(COMPARE_CLIP, Math.abs(v - sN[i])) ** 2, 0) / mN.length);
  return { f, model: mN, measured: sN, rms, averaged: mod.averaged };
}

export const LEAKAGES: Leakage[] = ['sealed', 'typical', 'door', 'open'];

export interface CalibrationResult {
  dampingScale: number;
  leakage: Leakage;
  rmsBefore: number;
  rmsAfter: number;
}

/**
 * Подстройка модели под замер: множитель затухания мод (0,4…2,5, по логарифмической сетке с уточнением
 * до шага ≈ 12 %) и, в прямоугольной модели, герметичность.
 */
export function calibrate(room: Room, sources: SourceSpec[], c: Constraints, setup: SetupLike, m: Measurement): CalibrationResult {
  const rmsBefore = compareMeasurement(room, sources, c, setup, m).rms;
  // в волновой модели утечки заданы проёмами и коридорами явно — подбирается только затухание
  const leaks = isWave(room) ? [room.leakage] : LEAKAGES;
  const seen = new Map<number, { leakage: Leakage; rms: number }>();
  const tryScale = (k: number) => {
    const key = Math.round(k * 1000) / 1000;
    let r = seen.get(key);
    if (!r) {
      r = { leakage: room.leakage, rms: Infinity };
      for (const leakage of leaks) {
        const rms = compareMeasurement({ ...room, leakage, calibration: { dampingScale: key } }, sources, c, setup, m).rms;
        if (rms < r.rms - 1e-9) r = { leakage, rms };
      }
      seen.set(key, r);
    }
    return r;
  };
  const coarse = [0.4, 0.63, 1, 1.6, 2.5];
  let bestK = 1;
  for (const k of coarse) if (tryScale(k).rms < tryScale(bestK).rms) bestK = k;
  for (const step of [1.26, 1.12]) {
    const center = bestK;
    for (const k of [center / step, center * step]) if (k >= 0.3 && k <= 3.2 && tryScale(k).rms < tryScale(bestK).rms - 1e-9) bestK = k;
  }
  const best = tryScale(bestK);
  if (best.rms >= rmsBefore - 1e-9) {
    return { dampingScale: room.calibration?.dampingScale ?? 1, leakage: room.leakage, rmsBefore, rmsAfter: rmsBefore };
  }
  return { dampingScale: Math.round(bestK * 1000) / 1000, leakage: best.leakage, rmsBefore, rmsAfter: best.rms };
}

// ---------- До и после: сравнение двух замеров ----------

export interface TakeStats {
  /** Неровность: СКО отклонения от цели после выравнивания уровня, дБ. */
  rms: number;
  /** Самый сильный пик над целью. */
  peak: { f: number; db: number };
  /** Самый глубокий провал под целью. */
  dip: { f: number; db: number };
}

export interface TakesComparison {
  f: number[];
  /** Сглаженные 1/12 октавы кривые, выровненные по среднему уровню в полосе (0 дБ — средний уровень). */
  before: number[];
  after: number[];
  statsBefore: TakeStats;
  statsAfter: TakeStats;
  fLo: number;
  fHi: number;
}

function takeStats(f: number[], dev: number[]): TakeStats {
  let pk = 0, dp = 0;
  for (let i = 1; i < dev.length; i++) {
    if (dev[i] > dev[pk]) pk = i;
    if (dev[i] < dev[dp]) dp = i;
  }
  return { rms: flatness(dev), peak: { f: f[pk], db: dev[pk] }, dip: { f: f[dp], db: dev[dp] } };
}

function flatness(dev: number[]): number {
  const n = dev.length;
  if (!n) return 0;
  const mean = dev.reduce((a, b) => a + b, 0) / n;
  return Math.sqrt(dev.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
}

function smooth12(f: number[], db: number[]): number[] {
  const half = Math.pow(2, 1 / 24);
  return f.map((fc) => {
    let s = 0, c = 0;
    for (let i = 0; i < f.length; i++) if (f[i] >= fc / half && f[i] <= fc * half) { s += Math.pow(10, db[i] / 10); c++; }
    return 10 * Math.log10(s / c);
  });
}


/**
 * Сравнение двух замеров одной точки «до» и «после» (переставили колонки, поставили ловушки, включили EQ).
 * Уровни выравниваются по медиане в полосе: громкость и усиление микрофона между замерами могли отличаться,
 * а медиану не сдвигают сами пики и провалы, которые исправляли (по среднему убранный пик +10 дБ «опускал»
 * бы всю остальную кривую «до» примерно на 1 дБ). Цель — плоская или заданная (например, «домашняя» кривая модели).
 */
export function compareTakes(before: Measurement, after: Measurement, o: { fLo?: number; fHi?: number; target?: (f: number) => number } = {}): TakesComparison {
  const fLo = Math.max(o.fLo ?? 20, before.f[0], after.f[0]);
  const fHi = Math.min(o.fHi ?? 200, before.f[before.f.length - 1], after.f[after.f.length - 1]);
  if (!(fHi > fLo * 1.5)) throw new MeasureError('У замеров слишком мало общих частот для сравнения.');
  const f = logFreqs(fLo, fHi, 48);
  const tgt = f.map((x) => o.target?.(x) ?? 0);
  const tRef = medianOf(tgt);
  const prep = (m: Measurement) => {
    const raw = measurementAt(m, f).map((v) => v ?? NaN);
    const s = smooth12(f, raw);
    const ref = medianOf(s);
    return s.map((v) => v - ref);
  };
  const b = prep(before), a = prep(after);
  const dev = (c: number[]) => c.map((v, i) => Math.max(-25, Math.min(25, v - (tgt[i] - tRef))));
  return { f, before: b, after: a, statsBefore: takeStats(f, dev(b)), statsAfter: takeStats(f, dev(a)), fLo, fHi };
}
