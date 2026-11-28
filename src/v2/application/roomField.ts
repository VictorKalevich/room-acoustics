// Экспертный уровень анализа баса (V2-051): карты поля на высоте ушей — уровень от источников, форма и фаза моды,
// разница конфигураций — и сравнение моделей расчёта с параметрами сетки волновой модели. Поле и отклик считает ядро
// (`computeField`, `evaluateSetup`); здесь срез, перевод в дБ, общая шкала и проверки сопоставимости.
import { waveFMax } from '../../core/acoustics';
import { buildGrid, defaultDuration, LAMBDA } from '../../core/fdtd';
import { bandFreqs, combineEnergy, sliceField, type FieldResult } from '../../core/field3d';
import type { AcousticModel, Room as CoreRoom } from '../../core/types';
import type { CoreInputs } from '../adapters/core';

/** Срез поля на плане: значения в узлах ix·ny + iy, NaN — вне воздуха. */
export interface FieldMap { x0: number; y0: number; sx: number; sy: number; nx: number; ny: number; values: Float32Array }

/** Третьоктавная полоса вокруг частоты: до 16 частот с шагом 1/24 октавы. */
export const thirdOctave = (f: number) => bandFreqs(f / 2 ** (1 / 6), f * 2 ** (1 / 6));

/** Средний по частотам уровень на высоте z, дБ относительно среднего по основной комнате. */
export function levelMap(res: FieldResult, z: number): FieldMap {
  const s = sliceField(res, combineEnergy(res, res.freqs.map((_, k) => k)), z);
  return { x0: s.x0, y0: s.y0, sx: s.sx, sy: s.sy, nx: s.nx, ny: s.ny, values: s.db };
}

/**
 * Форма моды прямоугольной комнаты со знаком: ψ = cos(nₓπx/L)·cos(n_yπy/W)·cos(n_zπz/H), от −1 до 1. Знак — фаза
 * стоячей волны (0° или 180°), ноль — узловая линия. Сетка — центры ячеек с шагом не крупнее `step`.
 */
export function modeShapeMap(dims: { depth: number; width: number; height: number }, n: readonly [number, number, number], z: number, step = 0.1): FieldMap {
  const nx = Math.max(2, Math.round(dims.depth / step)), ny = Math.max(2, Math.round(dims.width / step));
  const sx = dims.depth / nx, sy = dims.width / ny;
  const cz = Math.cos((n[2] * Math.PI * z) / dims.height);
  const values = new Float32Array(nx * ny);
  for (let i = 0; i < nx; i++) {
    const cx = Math.cos((n[0] * Math.PI * (sx / 2 + i * sx)) / dims.depth);
    for (let j = 0; j < ny; j++) values[i * ny + j] = cx * Math.cos((n[1] * Math.PI * (sy / 2 + j * sy)) / dims.width) * cz;
  }
  return { x0: sx / 2, y0: sy / 2, sx, sy, nx, ny, values };
}

/** Разница a − b по узлам; сетки должны совпадать (та же геометрия и модель), иначе null. */
export function diffMap(a: FieldMap, b: FieldMap): FieldMap | null {
  const same = a.nx === b.nx && a.ny === b.ny && Math.abs(a.x0 - b.x0) < 1e-6 && Math.abs(a.y0 - b.y0) < 1e-6 && Math.abs(a.sx - b.sx) < 1e-6 && Math.abs(a.sy - b.sy) < 1e-6;
  if (!same) return null;
  const values = new Float32Array(a.values.length);
  for (let k = 0; k < values.length; k++) values[k] = a.values[k] - b.values[k];
  return { ...a, values };
}

/** Симметричная шкала ±R: R — наибольшее |значение|, не меньше `floor` и не больше `cap`, с округлением до целого. */
export function symmetricRange(m: FieldMap, floor = 3, cap = 20): number {
  let r = 0;
  for (const v of m.values) if (Number.isFinite(v)) r = Math.max(r, Math.abs(v));
  return Math.min(cap, Math.max(floor, Math.ceil(r)));
}

/** Значение в узле, ближайшем к точке плана; null — вне сетки или вне воздуха. */
export function valueAt(m: FieldMap, p: { x: number; y: number }): number | null {
  const i = Math.round((p.x - m.x0) / m.sx), j = Math.round((p.y - m.y0) / m.sy);
  if (i < 0 || j < 0 || i >= m.nx || j >= m.ny) return null;
  const v = m.values[i * m.ny + j];
  return Number.isFinite(v) ? v : null;
}

/** Геометрия, от которой зависит сетка поля: разница конфигураций строится только при совпадении. */
export const fieldGeometry = (r: CoreRoom) => JSON.stringify({ d: r.depth, w: r.width, h: r.height, s: r.slope ?? null, e: r.extensions ?? [], m: r.model });

/** Входы расчёта с принудительно выбранной моделью баса. */
export const withModel = (i: CoreInputs, model: Exclude<AcousticModel, 'auto'>): CoreInputs => ({ ...i, room: { ...i.room, model } });

export interface GridInfo { fMax: number; h: number; dt: number; cells: [number, number, number]; nodes: number; courant: number; duration: number; steps: number; perWave: number }

/** Параметры сетки FDTD, которую ядро строит для отклика в полосе до fHi (сетка строится заново — по запросу). */
export function waveGridInfo(room: CoreRoom, fHi: number): GridInfo {
  const fMax = waveFMax(fHi);
  const g = buildGrid(room, fMax);
  const duration = defaultDuration(g);
  return { fMax: g.fMax, h: g.h, dt: g.dt, cells: [g.nx, g.ny, g.nz], nodes: g.N, courant: LAMBDA, duration, steps: Math.ceil(duration / g.dt), perWave: g.c / (fHi * g.h) };
}
