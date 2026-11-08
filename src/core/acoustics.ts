// Провайдер откликов волновой модели с кэшем расчётов (используется в воркере).
// По взаимности H(A→B) = H(B→A): один расчёт из точки даёт отклики «из всех точек слоя в неё».
import type { Room, Vec3 } from './types';
import { SYS_MODES_FMAX } from './objective';
import { buildGrid, geometryKey, layerOf, nearestNode, pointSpectrum, simulate, simulateField, systemModes, type SimResult, type SystemMode, type WaveGrid } from './fdtd';

const GRID_LIMIT = 2;
const SIM_LIMIT = 8;
const grids = new Map<string, WaveGrid>();
const sims = new Map<string, SimResult>();
const specs = new WeakMap<SimResult, Map<string, Map<number, { re: Float64Array; im: Float64Array }>>>();

/** Верхняя частота волновой модели: полоса оценки (до частоты Шрёдера, 120–300 Гц) с небольшим запасом. */
export const waveFMax = (fHi: number) => Math.min(320, Math.max(130, fHi * 1.08));

export function getGrid(room: Room, fMax: number): WaveGrid {
  const key = geometryKey(room, fMax);
  let g = grids.get(key);
  if (!g) {
    g = buildGrid(room, fMax);
    if (grids.size >= GRID_LIMIT) { grids.clear(); sims.clear(); }
    grids.set(key, g);
  }
  return g;
}

const simKey = (g: WaveGrid, node: number) => `${g.key}|${node}`;

/** Есть ли в кэше расчёт из точки p с нужными слоями. */
export function hasSim(room: Room, fMax: number, p: Vec3, heights: number[]): boolean {
  const g = getGrid(room, fMax);
  const s = sims.get(simKey(g, nearestNode(g, p)));
  return !!s && heights.every((z) => s.layers.includes(layerOf(g, z)));
}

export function getSim(room: Room, fMax: number, p: Vec3, heights: number[], onProgress?: (v: number) => void): SimResult {
  const g = getGrid(room, fMax);
  const node = nearestNode(g, p);
  const key = simKey(g, node);
  const want = heights.map((z) => layerOf(g, z));
  let s = sims.get(key);
  if (!s || !want.every((k) => s!.layers.includes(k))) {
    const layers = [...new Set([...(s?.layers ?? []), ...want])];
    s = simulate(g, p, { layers, onProgress });
    if (sims.size >= SIM_LIMIT) sims.delete(sims.keys().next().value as string);
    sims.set(key, s);
  } else {
    // обновляем позицию в LRU
    sims.delete(key);
    sims.set(key, s);
  }
  return s;
}

/** Спектры отклика между точкой расчёта src и точками pts на частотах freqs. */
export function waveSpectra(room: Room, fMax: number, src: Vec3, pts: Vec3[], freqs: number[], onProgress?: (v: number) => void) {
  const sim = getSim(room, fMax, src, pts.map((p) => p.z), onProgress);
  let byFreq = specs.get(sim);
  if (!byFreq) { byFreq = new Map(); specs.set(sim, byFreq); }
  const fk = `${freqs.length}|${freqs[0]}|${freqs[freqs.length - 1]}`;
  let cache = byFreq.get(fk);
  if (!cache) { cache = new Map(); byFreq.set(fk, cache); }
  return pts.map((p) => pointSpectrum(sim, p, freqs, cache!));
}

const fields = new Map<string, { re: Float32Array; im: Float32Array }>();
const FIELD_LIMIT = 6;
const fieldGrids = new Map<string, WaveGrid>();

/** Поле во всех узлах от источника в p на частотах freqs (с кэшем; своя сетка, чтобы не вытеснять расчёты оценки). */
export function waveField(room: Room, fMax: number, p: Vec3, freqs: number[], onProgress?: (v: number) => void) {
  const gk = geometryKey(room, fMax);
  let g = fieldGrids.get(gk);
  if (!g) {
    g = buildGrid(room, fMax);
    if (fieldGrids.size >= 2) fieldGrids.clear();
    fieldGrids.set(gk, g);
  }
  const key = `${g.key}|${nearestNode(g, p)}|${freqs.map((f) => f.toFixed(3)).join(',')}`;
  let r = fields.get(key);
  if (!r) {
    r = simulateField(g, p, freqs, { onProgress });
    if (fields.size >= FIELD_LIMIT) fields.delete(fields.keys().next().value!);
    fields.set(key, r);
  } else {
    fields.delete(key);
    fields.set(key, r);
  }
  return { grid: g, ...r };
}

const sysModes = new Map<string, SystemMode[]>();

/**
 * Собственные частоты комнаты вместе со смежными помещениями (один расчёт из угла, ≈ 1–2 с) — с кэшем.
 * Нужны цели «без провалов на модах»: проём сдвигает моды основной комнаты на 1–3 полутона и добавляет свои.
 */
export function waveSystemModes(room: Room, fMax = SYS_MODES_FMAX, onProgress?: (v: number) => void): SystemMode[] {
  const key = geometryKey(room, fMax);
  let m = sysModes.get(key);
  if (!m) {
    m = systemModes(room, fMax, { onProgress }).modes;
    if (sysModes.size >= 4) sysModes.clear();
    sysModes.set(key, m);
  }
  return m;
}

export function clearWaveCache() {
  sysModes.clear();
  fields.clear();
  grids.clear();
  sims.clear();
}
