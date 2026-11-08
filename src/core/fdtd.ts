// Волновая модель (research R21): FDTD на кубической сетке для комнаты со смежными помещениями.
// Схема SLF с частотно-независимыми локально реагирующими границами (Kowalczyk & van Walstijn, 2008).
import type { Room, Vec3, WallId } from './types';
import { extensionBox, roomBox, type Box } from './geometry';
import { speedOfSound } from './physics';
import { FURNISHING, alphaAt, getMaterial } from './materials';
import { surfaceAreas } from './reverb';

export const LAMBDA = 0.577; // число Куранта, чуть меньше 1/√3
const PPW = 10; // узлов на длину волны верхней частоты

export interface WaveGrid {
  key: string;
  h: number;
  dt: number;
  c: number;
  fMax: number;
  nx: number;
  ny: number;
  nz: number;
  /** центр ячейки (0,0,0) */
  x0: number;
  y0: number;
  z0: number;
  N: number;
  cellNode: Int32Array;
  nodeCell: Int32Array;
  nbr: Int32Array;
  ca: Float32Array;
  cb: Float32Array;
  cd: Float32Array;
  /** 0 — комната, 1… — смежное помещение (индекс + 1) */
  region: Uint8Array;
  volumes: number[];
}

/** Средний коэффициент поглощения материала в полосе 63–250 Гц. */
function lfAlpha(id: string): number {
  const a = getMaterial(id).alpha;
  return (alphaAt(a, 63) + alphaAt(a, 125) + alphaAt(a, 250)) / 3;
}

/** β = (1 − √(1−α)) / (1 + √(1−α)) — нормированная проводимость при нормальном падении. */
export function alphaToBeta(alpha: number): number {
  const r = Math.sqrt(Math.max(0, 1 - Math.min(alpha, 0.999)));
  return (1 - r) / (1 + r);
}

/** Ключ геометрии/материалов для кэша. */
export function geometryKey(room: Room, fMax: number): string {
  return JSON.stringify([
    room.depth, room.width, room.height, room.temperatureC, room.materials, room.furnishing,
    room.openings, room.extensions, room.calibration, Math.round(fMax),
  ]);
}

/** Шаг сетки ≤ h0, при котором размеры основной комнаты ложатся на сетку с наименьшей относительной ошибкой. */
function chooseStep(room: Room, h0: number): number {
  let best = h0;
  let bestErr = Infinity;
  for (let i = 0; i <= 50; i++) {
    const h = h0 * (0.75 + 0.25 * (i / 50));
    const err = Math.max(...[room.depth, room.width, room.height].map((L) => Math.abs(L - Math.max(1, Math.round(L / h)) * h) / L));
    // небольшое предпочтение крупному шагу (быстрее расчёт)
    const score = err + 0.002 * (h0 / h - 1);
    if (score < bestErr - 1e-12) { bestErr = score; best = h; }
  }
  return best;
}

const inside = (b: Box, x: number, y: number, z: number) => x > b.x0 && x < b.x1 && y > b.y0 && y < b.y1 && z > b.z0 && z < b.z1;

// направления: 0 −x, 1 +x, 2 −y, 3 +y, 4 −z, 5 +z
const ROOM_FACE: (WallId | 'floor' | 'ceiling')[] = ['front', 'back', 'left', 'right', 'floor', 'ceiling'];

export function buildGrid(room: Room, fMaxWanted: number, maxNodes = 300_000): WaveGrid {
  const c = speedOfSound(room.temperatureC);
  let fMax = fMaxWanted;
  const exts = room.extensions ?? [];
  const boxes = [roomBox(room), ...exts.map((e) => extensionBox(room, e))];
  const minX = Math.min(...boxes.map((b) => b.x0));
  const maxX = Math.max(...boxes.map((b) => b.x1));
  const minY = Math.min(...boxes.map((b) => b.y0));
  const maxY = Math.max(...boxes.map((b) => b.y1));
  const maxZ = Math.max(...boxes.map((b) => b.z1));
  const volume = boxes.reduce((s, b) => s + (b.x1 - b.x0) * (b.y1 - b.y0) * (b.z1 - b.z0), 0);
  // ограничение размера сетки
  let h = chooseStep(room, c / (PPW * fMax));
  if (volume / h ** 3 > maxNodes) {
    h = Math.cbrt(volume / maxNodes) * 1.02;
    fMax = c / (PPW * h);
  }
  const X0 = -Math.ceil(-minX / h - 1e-9) * h;
  const Y0 = -Math.ceil(-minY / h - 1e-9) * h;
  const nx = Math.ceil((maxX - X0) / h - 1e-9);
  const ny = Math.ceil((maxY - Y0) / h - 1e-9);
  const nz = Math.ceil(maxZ / h - 1e-9);
  const total = nx * ny * nz;
  const cellNode = new Int32Array(total).fill(-1);
  const regionCell = new Int8Array(total).fill(-1);
  let N = 0;
  const cx = (i: number) => X0 + (i + 0.5) * h;
  const cy = (j: number) => Y0 + (j + 0.5) * h;
  const cz = (k: number) => (k + 0.5) * h;
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const x = cx(i), y = cy(j), z = cz(k);
        for (let b = 0; b < boxes.length; b++) {
          if (inside(boxes[b], x, y, z)) {
            const cell = i + nx * (j + ny * k);
            cellNode[cell] = N++;
            regionCell[cell] = b;
            break;
          }
        }
      }
  if (N === 0) throw new Error('Пустая сетка волновой модели');
  const nodeCell = new Int32Array(N);
  const region = new Uint8Array(N);
  for (let cell = 0; cell < total; cell++) {
    const n = cellNode[cell];
    if (n >= 0) { nodeCell[n] = cell; region[n] = regionCell[cell]; }
  }

  // поглощение поверхностей (полоса 63–250 Гц) + мебель + подстройка
  const S = surfaceAreas(room);
  const sTotal = Object.values(S).reduce((a, b) => a + b, 0);
  const furnA = (alphaAt(FURNISHING[room.furnishing], 63) + alphaAt(FURNISHING[room.furnishing], 125)) / 2 * S.floor;
  const furnAlpha = furnA / sTotal;
  const scale = room.calibration?.dampingScale ?? 1;
  const roomAlpha = (surf: WallId | 'floor' | 'ceiling') => Math.min(0.999, (lfAlpha(room.materials[surf]) + furnAlpha) * scale);
  const plasterAlpha = Math.min(0.999, lfAlpha('plaster') * scale);
  const betaRoom: Record<string, number> = {};
  for (const sf of ROOM_FACE) betaRoom[sf] = alphaToBeta(roomAlpha(sf));
  const betaOpen = alphaToBeta(0.999);

  const along = (wall: WallId, x: number, y: number) => (wall === 'front' || wall === 'back' ? y : x);
  const inOpening = (wall: WallId, x: number, y: number, z: number) =>
    (room.openings ?? []).some((o) => o.wall === wall && along(wall, x, y) >= o.a0 && along(wall, x, y) <= o.a1 && z <= o.height);

  const nbr = new Int32Array(6 * N).fill(N);
  const ca = new Float32Array(N);
  const cb = new Float32Array(N);
  const cd = new Float32Array(N);
  const l2 = LAMBDA * LAMBDA;
  const di = [-1, 1, 0, 0, 0, 0];
  const dj = [0, 0, -1, 1, 0, 0];
  const dk = [0, 0, 0, 0, -1, 1];
  for (let n = 0; n < N; n++) {
    const cell = nodeCell[n];
    const i = cell % nx;
    const j = Math.floor(cell / nx) % ny;
    const k = Math.floor(cell / (nx * ny));
    const x = cx(i), y = cy(j), z = cz(k);
    const r = region[n];
    let K = 0;
    let betaSum = 0;
    let blocked = 0;
    for (let d = 0; d < 6; d++) {
      const ii = i + di[d], jj = j + dj[d], kk = k + dk[d];
      let m = -1;
      if (ii >= 0 && jj >= 0 && kk >= 0 && ii < nx && jj < ny && kk < nz) m = cellNode[ii + nx * (jj + ny * kk)];
      let ok = m >= 0;
      if (ok && region[m] !== r) {
        // переход комната ↔ коридор возможен только через арку
        const extIdx = (r === 0 ? region[m] : r) - 1;
        const e = exts[extIdx];
        const ok2 = (r === 0 || region[m] === 0) && !!e;
        if (ok2) {
          const mx = (x + cx(ii)) / 2, my = (y + cy(jj)) / 2;
          const a = along(e.wall, mx, my);
          ok = a >= e.arch.a0 && a <= e.arch.a1 && z <= e.arch.height;
        } else ok = false;
      }
      if (ok) {
        nbr[6 * n + d] = m;
        K++;
        continue;
      }
      // заблокированная грань: определяем её поглощение
      blocked++;
      let beta: number;
      if (r === 0) {
        const sf = ROOM_FACE[d];
        beta = sf !== 'floor' && sf !== 'ceiling' && inOpening(sf, x, y, z) ? betaOpen : betaRoom[sf];
      } else {
        const e = exts[r - 1];
        // направление к стене комнаты, от неё, вдоль стены
        const toRoom = { right: 2, left: 3, front: 1, back: 0 }[e.wall];
        const far = { right: 3, left: 2, front: 0, back: 1 }[e.wall];
        const startDir = e.wall === 'front' || e.wall === 'back' ? 2 : 0;
        const endDir = startDir + 1;
        if (d === 4) beta = betaRoom.floor;
        else if (d === 5) beta = betaRoom.ceiling;
        else if (d === toRoom) beta = betaRoom[e.wall];
        else if (d === far) beta = e.openFar ? betaOpen : alphaToBeta(plasterAlpha);
        else if (d === startDir) beta = e.openStart ? betaOpen : alphaToBeta(plasterAlpha);
        else if (d === endDir) beta = e.openEnd ? betaOpen : alphaToBeta(plasterAlpha);
        else beta = alphaToBeta(plasterAlpha);
      }
      betaSum += beta;
    }
    const beta = blocked ? betaSum / blocked : 0;
    const cc = (LAMBDA * beta * (6 - K)) / 2;
    ca[n] = (2 - K * l2) / (1 + cc);
    cb[n] = l2 / (1 + cc);
    cd[n] = (1 - cc) / (1 + cc);
  }

  return {
    key: geometryKey(room, fMaxWanted),
    h, dt: (LAMBDA * h) / c, c, fMax, nx, ny, nz, x0: cx(0), y0: cy(0), z0: cz(0), N,
    cellNode, nodeCell, nbr, ca, cb, cd, region,
    volumes: boxes.map((b) => (b.x1 - b.x0) * (b.y1 - b.y0) * (b.z1 - b.z0)),
  };
}

/** Ближайший воздушный узел к точке. */
export function nearestNode(g: WaveGrid, p: Vec3): number {
  const fi = (p.x - g.x0) / g.h, fj = (p.y - g.y0) / g.h, fk = (p.z - g.z0) / g.h;
  const i0 = Math.round(fi), j0 = Math.round(fj), k0 = Math.round(fk);
  let best = -1, bestD = Infinity;
  for (let r = 0; r <= 3 && best < 0; r++)
    for (let dk = -r; dk <= r; dk++)
      for (let dj = -r; dj <= r; dj++)
        for (let di = -r; di <= r; di++) {
          const i = i0 + di, j = j0 + dj, k = k0 + dk;
          if (i < 0 || j < 0 || k < 0 || i >= g.nx || j >= g.ny || k >= g.nz) continue;
          const n = g.cellNode[i + g.nx * (j + g.ny * k)];
          if (n < 0) continue;
          const d = (i - fi) ** 2 + (j - fj) ** 2 + (k - fk) ** 2;
          if (d < bestD) { bestD = d; best = n; }
        }
  if (best < 0) throw new Error('Точка вне сетки волновой модели');
  return best;
}

export function layerOf(g: WaveGrid, z: number): number {
  return Math.min(g.nz - 1, Math.max(0, Math.round((z - g.z0) / g.h)));
}

export interface SimResult {
  grid: WaveGrid;
  rec: Int32Array;
  /** индекс в rec по номеру узла или −1 */
  recIndex: Int32Array;
  layers: number[];
  T: number;
  dtd: number;
  series: Float32Array;
  src: Float32Array;
}

/** Сигнал источника: первая производная гауссова импульса (объёмное ускорение). */
function sourceSignal(t: number, fMax: number): number {
  const sigma = 1 / (2 * Math.PI * (fMax / 2));
  const t0 = 5 * sigma;
  const u = t - t0;
  return (-u / (sigma * sigma)) * Math.exp(-(u * u) / (2 * sigma * sigma)) * sigma;
}

/**
 * Расчёт отклика от точечного источника. Записываются узлы указанных горизонтальных слоёв
 * (и дополнительные узлы extra) с прореживанием по времени.
 */
export function simulate(g: WaveGrid, srcPos: Vec3, opts: { layers?: number[]; extra?: number[]; duration?: number; onProgress?: (p: number) => void } = {}): SimResult {
  const duration = opts.duration ?? 1.2;
  const steps = Math.ceil(duration / g.dt);
  const decim = Math.max(1, Math.floor(1 / (g.dt * 4.3 * g.fMax)));
  const layers = [...new Set(opts.layers ?? [])].sort((a, b) => a - b);
  const recList: number[] = [];
  const recIndex = new Int32Array(g.N).fill(-1);
  const layerSet = new Set(layers);
  for (let n = 0; n < g.N; n++) {
    const k = Math.floor(g.nodeCell[n] / (g.nx * g.ny));
    if (layerSet.has(k)) { recIndex[n] = recList.length; recList.push(n); }
  }
  for (const n of opts.extra ?? []) if (recIndex[n] < 0) { recIndex[n] = recList.length; recList.push(n); }
  const rec = Int32Array.from(recList);
  const T = Math.floor(steps / decim);
  const series = new Float32Array(rec.length * T);
  const src = new Float32Array(T);
  const s = nearestNode(g, srcPos);
  const N = g.N;
  let p0 = new Float32Array(N + 1);
  let p1 = new Float32Array(N + 1);
  let p2 = new Float32Array(N + 1);
  const { nbr, ca, cb, cd } = g;
  const R = rec.length;
  let t = 0;
  for (let step = 0; step < steps; step++) {
    for (let n = 0; n < N; n++) {
      const o = 6 * n;
      const sum = p1[nbr[o]] + p1[nbr[o + 1]] + p1[nbr[o + 2]] + p1[nbr[o + 3]] + p1[nbr[o + 4]] + p1[nbr[o + 5]];
      p2[n] = ca[n] * p1[n] + cb[n] * sum - cd[n] * p0[n];
    }
    const sv = sourceSignal(step * g.dt, g.fMax);
    p2[s] += sv;
    const tmp = p0; p0 = p1; p1 = p2; p2 = tmp;
    if (step % decim === 0 && t < T) {
      src[t] = sv;
      for (let r = 0; r < R; r++) series[r * T + t] = p1[rec[r]];
      t++;
    }
    if (opts.onProgress && step % 500 === 0) opts.onProgress(step / steps);
  }
  return { grid: g, rec, recIndex, layers, T, dtd: g.dt * decim, series, src };
}

/**
 * Поле во всех узлах на заданных частотах: ДПФ накапливается во время счёта (на прореженных шагах,
 * с полуокном Ханна на последних 20 %), без хранения временных рядов. Результат — H = P/S, [узел·nF + f].
 */
export function simulateField(
  g: WaveGrid,
  srcPos: Vec3,
  freqs: number[],
  opts: { duration?: number; onProgress?: (p: number) => void } = {},
): { re: Float32Array; im: Float32Array } {
  const duration = opts.duration ?? 1.2;
  const steps = Math.ceil(duration / g.dt);
  const decim = Math.max(1, Math.floor(1 / (g.dt * 4.3 * g.fMax)));
  const T = Math.floor(steps / decim);
  const nF = freqs.length;
  const N = g.N;
  const tail = Math.floor(T * 0.2);
  const dtd = g.dt * decim;
  const cosT = new Float32Array(nF);
  const sinT = new Float32Array(nF);
  const aRe = new Float32Array(N * nF);
  const aIm = new Float32Array(N * nF);
  const sRe = new Float64Array(nF);
  const sIm = new Float64Array(nF);
  const s = nearestNode(g, srcPos);
  let p0 = new Float32Array(N + 1);
  let p1 = new Float32Array(N + 1);
  let p2 = new Float32Array(N + 1);
  const { nbr, ca, cb, cd } = g;
  let t = 0;
  for (let step = 0; step < steps; step++) {
    for (let n = 0; n < N; n++) {
      const o = 6 * n;
      const sum = p1[nbr[o]] + p1[nbr[o + 1]] + p1[nbr[o + 2]] + p1[nbr[o + 3]] + p1[nbr[o + 4]] + p1[nbr[o + 5]];
      p2[n] = ca[n] * p1[n] + cb[n] * sum - cd[n] * p0[n];
    }
    const sv = sourceSignal(step * g.dt, g.fMax);
    p2[s] += sv;
    const tmp = p0; p0 = p1; p1 = p2; p2 = tmp;
    if (step % decim === 0 && t < T) {
      const win = t >= T - tail ? 0.5 * (1 + Math.cos((Math.PI * (t - (T - tail))) / tail)) : 1;
      for (let f = 0; f < nF; f++) {
        const w = 2 * Math.PI * freqs[f] * dtd * t;
        cosT[f] = Math.cos(w) * win;
        sinT[f] = -Math.sin(w) * win;
        sRe[f] += sv * Math.cos(w);
        sIm[f] -= sv * Math.sin(w);
      }
      for (let n = 0; n < N; n++) {
        const v = p1[n];
        if (v === 0) continue;
        const o = n * nF;
        for (let f = 0; f < nF; f++) {
          aRe[o + f] += v * cosT[f];
          aIm[o + f] += v * sinT[f];
        }
      }
      t++;
    }
    if (opts.onProgress && step % 500 === 0) opts.onProgress(step / steps);
  }
  // H = A / S
  for (let f = 0; f < nF; f++) {
    const d = sRe[f] * sRe[f] + sIm[f] * sIm[f] || 1e-30;
    for (let n = 0; n < N; n++) {
      const o = n * nF + f;
      const xr = aRe[o], xi = aIm[o];
      aRe[o] = (xr * sRe[f] + xi * sIm[f]) / d;
      aIm[o] = (xi * sRe[f] - xr * sIm[f]) / d;
    }
  }
  return { re: aRe, im: aIm };
}

// ---------- Спектры ----------

const twiddleCache = new Map<string, { cos: Float32Array; sin: Float32Array; win: Float32Array; sRe: Float64Array; sIm: Float64Array }>();

function twiddles(sim: SimResult, freqs: number[]) {
  const key = `${sim.T}|${sim.dtd}|${freqs.length}|${freqs[0]}|${freqs[freqs.length - 1]}|${sim.grid.fMax}`;
  let tw = twiddleCache.get(key);
  if (!tw) {
    const T = sim.T;
    const nF = freqs.length;
    const cos = new Float32Array(nF * T);
    const sin = new Float32Array(nF * T);
    for (let f = 0; f < nF; f++) {
      const w = 2 * Math.PI * freqs[f] * sim.dtd;
      for (let t = 0; t < T; t++) { cos[f * T + t] = Math.cos(w * t); sin[f * T + t] = -Math.sin(w * t); }
    }
    // полуокно Ханна на последних 20 %
    const win = new Float32Array(T).fill(1);
    const tail = Math.floor(T * 0.2);
    for (let t = 0; t < tail; t++) win[T - tail + t] = 0.5 * (1 + Math.cos((Math.PI * t) / tail));
    const sRe = new Float64Array(nF);
    const sIm = new Float64Array(nF);
    for (let f = 0; f < nF; f++) {
      let re = 0, im = 0;
      for (let t = 0; t < T; t++) { re += sim.src[t] * cos[f * T + t]; im += sim.src[t] * sin[f * T + t]; }
      sRe[f] = re; sIm[f] = im;
    }
    tw = { cos, sin, win, sRe, sIm };
    if (twiddleCache.size > 8) twiddleCache.clear();
    twiddleCache.set(key, tw);
  }
  return tw;
}

/** Передаточная функция H = P/S в записанном узле на частотах freqs. */
export function nodeSpectrum(sim: SimResult, node: number, freqs: number[]): { re: Float64Array; im: Float64Array } {
  const r = sim.recIndex[node];
  if (r < 0) throw new Error('Узел не записан');
  const tw = twiddles(sim, freqs);
  const T = sim.T;
  const nF = freqs.length;
  const re = new Float64Array(nF);
  const im = new Float64Array(nF);
  const base = r * T;
  for (let f = 0; f < nF; f++) {
    let xr = 0, xi = 0;
    const o = f * T;
    for (let t = 0; t < T; t++) {
      const v = sim.series[base + t] * tw.win[t];
      xr += v * tw.cos[o + t];
      xi += v * tw.sin[o + t];
    }
    const d = tw.sRe[f] * tw.sRe[f] + tw.sIm[f] * tw.sIm[f];
    re[f] = (xr * tw.sRe[f] + xi * tw.sIm[f]) / d;
    im[f] = (xi * tw.sRe[f] - xr * tw.sIm[f]) / d;
  }
  return { re, im };
}

/**
 * Спектр в произвольной точке слоя: билинейная интерполяция по четырём ближайшим записанным узлам слоя.
 * cache — кэш спектров узлов для данного набора частот.
 */
export function pointSpectrum(sim: SimResult, p: Vec3, freqs: number[], cache: Map<number, { re: Float64Array; im: Float64Array }>): { re: Float64Array; im: Float64Array } {
  const g = sim.grid;
  const k = nearestLayer(sim, p.z);
  const fi = (p.x - g.x0) / g.h, fj = (p.y - g.y0) / g.h;
  const i0 = Math.floor(fi), j0 = Math.floor(fj);
  const ti = fi - i0, tj = fj - j0;
  const pts: [number, number, number][] = [
    [i0, j0, (1 - ti) * (1 - tj)], [i0 + 1, j0, ti * (1 - tj)], [i0, j0 + 1, (1 - ti) * tj], [i0 + 1, j0 + 1, ti * tj],
  ];
  const nF = freqs.length;
  const re = new Float64Array(nF);
  const im = new Float64Array(nF);
  let wsum = 0;
  const get = (n: number) => {
    let s = cache.get(n);
    if (!s) { s = nodeSpectrum(sim, n, freqs); cache.set(n, s); }
    return s;
  };
  for (const [i, j, w] of pts) {
    if (w <= 0 || i < 0 || j < 0 || i >= g.nx || j >= g.ny) continue;
    const n = g.cellNode[i + g.nx * (j + g.ny * k)];
    if (n < 0 || sim.recIndex[n] < 0) continue;
    const s = get(n);
    for (let f = 0; f < nF; f++) { re[f] += w * s.re[f]; im[f] += w * s.im[f]; }
    wsum += w;
  }
  if (wsum < 1e-6) {
    const n = nearestNode(g, { ...p, z: g.z0 + k * g.h });
    return sim.recIndex[n] >= 0 ? get(n) : nodeSpectrum(sim, n, freqs);
  }
  for (let f = 0; f < nF; f++) { re[f] /= wsum; im[f] /= wsum; }
  return { re, im };
}

function nearestLayer(sim: SimResult, z: number): number {
  const want = layerOf(sim.grid, z);
  let best = sim.layers[0] ?? want;
  for (const k of sim.layers) if (Math.abs(k - want) < Math.abs(best - want)) best = k;
  return best;
}

// ---------- Моды системы ----------

export interface SystemMode {
  f: number;
  roomShare: number;
  levelDb: number;
}

/**
 * Собственные частоты системы «комната + смежные помещения» (research R22): расчёт из угла комнаты,
 * средний спектр мощности в узлах комнаты и смежных помещений, пики с выступом > 3 дБ.
 */
export function systemModes(room: Room, fMax = 200, opts: { duration?: number; onProgress?: (p: number) => void } = {}): { modes: SystemMode[]; grid: WaveGrid } {
  const g = buildGrid(room, fMax);
  const roomNodes: number[] = [];
  const extNodes: number[] = [];
  for (let n = 0; n < g.N; n++) (g.region[n] === 0 ? roomNodes : extNodes).push(n);
  const pick = (list: number[], count: number) => {
    const out: number[] = [];
    if (!list.length) return out;
    const step = Math.max(1, Math.floor(list.length / count));
    for (let i = Math.floor(step / 3); i < list.length && out.length < count; i += step) out.push(list[i]);
    return out;
  };
  const corners: number[] = [];
  for (const x of [0.1, room.depth - 0.1]) for (const y of [0.1, room.width - 0.1]) for (const z of [0.1, room.height - 0.1]) corners.push(nearestNode(g, { x, y, z }));
  const rN = [...new Set([...corners, ...pick(roomNodes, 32)])];
  const eN = pick(extNodes, 20);
  const sim = simulate(g, { x: 0.12, y: 0.12, z: 0.12 }, { extra: [...rN, ...eN], duration: opts.duration ?? 2.5, onProgress: opts.onProgress });
  const df = 0.25;
  const freqs: number[] = [];
  for (let f = 15; f <= g.fMax; f += df) freqs.push(f);
  const nF = freqs.length;
  const pRoom = new Float64Array(nF);
  const pExt = new Float64Array(nF);
  const acc = (list: number[], out: Float64Array) => {
    for (const n of list) {
      const s = nodeSpectrum(sim, n, freqs);
      for (let f = 0; f < nF; f++) out[f] += (s.re[f] ** 2 + s.im[f] ** 2) / list.length;
    }
  };
  acc(rN, pRoom);
  if (eN.length) acc(eN, pExt);
  const vRoom = g.volumes[0];
  const vExt = g.volumes.slice(1).reduce((a, b) => a + b, 0);
  const E = Array.from(pRoom, (v, i) => vRoom * v + vExt * pExt[i]);
  const db = E.map((v) => 10 * Math.log10(Math.max(v, 1e-30)));
  const modes: SystemMode[] = [];
  // топографическая выраженность пика: спуск до ближайшей более высокой точки (в пределах ±6 Гц)
  const win = Math.round(6 / df);
  for (let i = 1; i < nF - 1; i++) {
    if (!(db[i] >= db[i - 1] && db[i] > db[i + 1])) continue;
    let lmin = db[i], rmin = db[i];
    for (let k = i - 1; k >= Math.max(0, i - win) && db[k] <= db[i]; k--) lmin = Math.min(lmin, db[k]);
    for (let k = i + 1; k <= Math.min(nF - 1, i + win) && db[k] <= db[i]; k++) rmin = Math.min(rmin, db[k]);
    if (db[i] - Math.max(lmin, rmin) < 1.5) continue;
    // уточнение параболой
    const a = db[i - 1], b = db[i], c2 = db[i + 1];
    const off = (a - c2) / (2 * (a - 2 * b + c2));
    const f = freqs[i] + (Number.isFinite(off) ? off * df : 0);
    modes.push({ f, roomShare: (vRoom * pRoom[i]) / Math.max(E[i], 1e-30), levelDb: b });
  }
  return { modes, grid: g };
}
