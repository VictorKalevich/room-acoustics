// Замеры REW (research R16): импорт, сравнение с моделью, подстройка модели.
import type { Constraints, Leakage, Measurement, Room, Setup, SourceSpec } from './types';
import { logFreqs } from './frequency';
import { evaluateSetup } from './system';
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
}

/** Сравнение замера с моделью в основной точке прослушивания (оба выровнены по среднему). */
export function compareMeasurement(room: Room, sources: SourceSpec[], c: Constraints, setup: SetupLike, m: Measurement): Comparison {
  const single = { ...c, seats: { ...c.seats, count: 1 } };
  const e = evaluateSetup(room, sources, single, setup, { ppo: 24 });
  const meas = measurementAt(m, e.response.f);
  const idx = meas.map((v, i) => (v == null ? -1 : i)).filter((i) => i >= 0);
  if (idx.length < 8) throw new MeasureError('Замер не перекрывает расчётную полосу частот — нужен замер от 20 Гц до частоты Шрёдера.');
  const f = idx.map((i) => e.response.f[i]);
  const model = idx.map((i) => e.response.db[i]);
  const measured = idx.map((i) => meas[i] as number);
  const mm = model.reduce((a, b) => a + b, 0) / model.length;
  const ms = measured.reduce((a, b) => a + b, 0) / measured.length;
  const mN = model.map((v) => v - mm);
  const sN = measured.map((v) => v - ms);
  const rms = Math.sqrt(mN.reduce((a, v, i) => a + (v - sN[i]) ** 2, 0) / mN.length);
  return { f, model: mN, measured: sN, rms };
}

export const DAMPING_SCALES = [0.5, 0.75, 1, 1.5, 2, 3, 4];
export const LEAKAGES: Leakage[] = ['sealed', 'typical', 'door', 'open'];

export interface CalibrationResult {
  dampingScale: number;
  leakage: Leakage;
  rmsBefore: number;
  rmsAfter: number;
}

/** Подстройка модели под замер: перебор множителя затухания мод и герметичности. */
export function calibrate(room: Room, sources: SourceSpec[], c: Constraints, setup: SetupLike, m: Measurement): CalibrationResult {
  const rmsBefore = compareMeasurement(room, sources, c, setup, m).rms;
  let best = { dampingScale: room.calibration?.dampingScale ?? 1, leakage: room.leakage, rms: rmsBefore };
  // в волновой модели утечки заданы проёмами и коридорами явно — подбирается только затухание
  const leaks = isWave(room) ? [room.leakage] : LEAKAGES;
  for (const k of DAMPING_SCALES)
    for (const leakage of leaks) {
      const r = { ...room, leakage, calibration: { dampingScale: k } };
      const rms = compareMeasurement(r, sources, c, setup, m).rms;
      if (rms < best.rms - 1e-9) best = { dampingScale: k, leakage, rms };
    }
  return { dampingScale: best.dampingScale, leakage: best.leakage, rmsBefore, rmsAfter: best.rms };
}
