// Звуковое поле в объёме комнаты на выбранных частотах: где уровень выше и ниже среднего по комнате.
import type { Room, Setup, SourceSpec } from './types';
import { prepareModes } from './response';
import { computeReverb } from './reverb';
import { filterSet } from './system';
import { isWave } from './geometry';
import { waveFMax, waveField } from './acoustics';

export type FieldKind = 'excited' | 'shape';

export interface FieldRequest {
  room: Room;
  sources: SourceSpec[];
  setup: Setup;
  /** Частоты, Гц (для «формы моды» в прямоугольной модели — частоты выбранных мод). */
  freqs: number[];
  kind: FieldKind;
  /** Индексы мод для «формы моды» в прямоугольной модели (по одной на частоту). */
  modes?: [number, number, number][];
}

export interface FieldResult {
  model: 'modal' | 'wave';
  kind: FieldKind;
  /** Регулярная сетка: центр ячейки (i, j, k) = (x0 + i·sx, y0 + j·sy, z0 + k·sz). */
  nx: number;
  ny: number;
  nz: number;
  x0: number;
  y0: number;
  z0: number;
  sx: number;
  sy: number;
  sz: number;
  /** 0 — вне воздуха, 1 — основная комната, 2 — смежное помещение. Индекс точки: (i·ny + j)·nz + k. */
  mask: Uint8Array;
  freqs: number[];
  /** Энергия, нормированная к среднему по основной комнате на каждой частоте: [f·nPts + p]. */
  energy: Float32Array;
  /** Частоты, которые выше предела волновой модели (не посчитаны). */
  skipped: number[];
}

const MAX_POINTS = 60_000;

/** Нормирует энергию каждой частоты к её среднему по основной комнате. */
function normalize(energy: Float32Array, mask: Uint8Array, nF: number) {
  const nP = mask.length;
  for (let f = 0; f < nF; f++) {
    let s = 0, c = 0;
    for (let p = 0; p < nP; p++) if (mask[p] === 1) { s += energy[f * nP + p]; c++; }
    const mean = c ? s / c : 1;
    const inv = mean > 0 ? 1 / mean : 0;
    for (let p = 0; p < nP; p++) energy[f * nP + p] = mask[p] ? energy[f * nP + p] * inv : 0;
  }
}

function modalGrid(room: Room) {
  const V = room.depth * room.width * room.height;
  const step = Math.max(0.06, Math.cbrt(V / MAX_POINTS));
  const nx = Math.max(2, Math.round(room.depth / step));
  const ny = Math.max(2, Math.round(room.width / step));
  const nz = Math.max(2, Math.round(room.height / step));
  const sx = room.depth / nx, sy = room.width / ny, sz = room.height / nz;
  return { nx, ny, nz, sx, sy, sz, x0: sx / 2, y0: sy / 2, z0: sz / 2 };
}

/** Прямоугольная модель: модальная сумма на сетке. */
function modalField(req: FieldRequest): FieldResult {
  const { room, sources, setup, kind } = req;
  const G = modalGrid(room);
  const { nx, ny, nz } = G;
  const nP = nx * ny * nz;
  const freqs = req.freqs;
  const nF = freqs.length;
  const energy = new Float32Array(nF * nP);
  const mask = new Uint8Array(nP).fill(1);
  const xs = Array.from({ length: nx }, (_, i) => G.x0 + i * G.sx);
  const ys = Array.from({ length: ny }, (_, j) => G.y0 + j * G.sy);
  const zs = Array.from({ length: nz }, (_, k) => G.z0 + k * G.sz);
  const L = [room.depth, room.width, room.height];

  if (kind === 'shape') {
    // ψ² выбранной моды
    freqs.forEach((_, f) => {
      const n = req.modes?.[f] ?? [0, 0, 0];
      const kx = (n[0] * Math.PI) / L[0], ky = (n[1] * Math.PI) / L[1], kz = (n[2] * Math.PI) / L[2];
      const cz = zs.map((z) => Math.cos(kz * z));
      for (let i = 0; i < nx; i++) {
        const cx = Math.cos(kx * xs[i]);
        for (let j = 0; j < ny; j++) {
          const cxy = cx * Math.cos(ky * ys[j]);
          const base = f * nP + (i * ny + j) * nz;
          for (let k = 0; k < nz; k++) { const v = cxy * cz[k]; energy[base + k] = v * v; }
        }
      }
    });
    normalize(energy, mask, nF);
    return { model: 'modal', kind, ...G, mask, freqs, energy, skipped: [] };
  }

  const rev = computeReverb(room);
  const fTop = Math.max(...freqs) * 1.5 + 30;
  const pm = prepareModes(room, fTop, rev);
  const M = pm.count;
  const active = sources.filter((s) => setup.positions[s.id]);
  const { filt } = filterSet(sources, freqs, setup.crossoverHz, setup.subSettings);
  // ψ_m в точках источников
  const psiS = active.map((s) => {
    const p = setup.positions[s.id];
    const out = new Float64Array(M);
    for (let m = 0; m < M; m++) out[m] = Math.cos(pm.kx[m] * p.x) * Math.cos(pm.ky[m] * p.y) * Math.cos(pm.kz[m] * p.z);
    return out;
  });
  // таблицы косинусов по осям
  const CX = new Float64Array(M * nx), CY = new Float64Array(M * ny), CZ = new Float64Array(M * nz);
  for (let m = 0; m < M; m++) {
    for (let i = 0; i < nx; i++) CX[m * nx + i] = Math.cos(pm.kx[m] * xs[i]);
    for (let j = 0; j < ny; j++) CY[m * ny + j] = Math.cos(pm.ky[m] * ys[j]);
    for (let k = 0; k < nz; k++) CZ[m * nz + k] = Math.cos(pm.kz[m] * zs[k]);
  }
  const aRe = new Float64Array(M), aIm = new Float64Array(M);
  const bRe = new Float64Array(M), bIm = new Float64Array(M);
  const idx = new Int32Array(M);
  const pRe = new Float64Array(nz), pIm = new Float64Array(nz);
  for (let f = 0; f < nF; f++) {
    const w = 2 * Math.PI * freqs[f];
    // коэффициенты мод от всех источников
    let cnt = 0;
    let amax = 0;
    for (let m = 0; m < M; m++) {
      let sr = 0, si = 0;
      active.forEach((s, q) => {
        const F = filt[s.id];
        sr += F.re[f] * psiS[q][m];
        si += F.im[f] * psiS[q][m];
      });
      const dr = pm.omega2[m] - w * w;
      const di = 2 * pm.delta[m] * w;
      const d = (dr * dr + di * di) / pm.invLambda[m];
      // (sr + j·si) / (dr + j·di)
      aRe[m] = (sr * dr + si * di) / d;
      aIm[m] = (si * dr - sr * di) / d;
      amax = Math.max(amax, Math.hypot(aRe[m], aIm[m]));
    }
    for (let m = 0; m < M; m++) if (Math.hypot(aRe[m], aIm[m]) > amax * 1e-5) idx[cnt++] = m;
    for (let i = 0; i < nx; i++)
      for (let j = 0; j < ny; j++) {
        for (let q = 0; q < cnt; q++) {
          const m = idx[q];
          const c = CX[m * nx + i] * CY[m * ny + j];
          bRe[q] = aRe[m] * c;
          bIm[q] = aIm[m] * c;
        }
        pRe.fill(0);
        pIm.fill(0);
        for (let q = 0; q < cnt; q++) {
          const m = idx[q], br = bRe[q], bi = bIm[q], o = m * nz;
          for (let k = 0; k < nz; k++) { const cz = CZ[o + k]; pRe[k] += br * cz; pIm[k] += bi * cz; }
        }
        const base = f * nP + (i * ny + j) * nz;
        for (let k = 0; k < nz; k++) energy[base + k] = pRe[k] * pRe[k] + pIm[k] * pIm[k];
      }
  }
  normalize(energy, mask, nF);
  return { model: 'modal', kind, ...G, mask, freqs, energy, skipped: [] };
}

/** Волновая модель (комната с коридором): FDTD с ДПФ во всех узлах. */
function waveFieldResult(req: FieldRequest, onProgress?: (v: number) => void): FieldResult {
  const { room, sources, setup, kind } = req;
  const rev = computeReverb(room);
  const limit = waveFMax(Math.min(300, Math.max(120, rev.schroeder)));
  // сетка под самую высокую выбранную частоту (≥ 10 узлов на длину волны), но не грубее ~23 см
  const fMax = Math.min(limit, Math.max(150, Math.max(...req.freqs) * 1.25));
  const freqs = req.freqs.filter((f) => f <= fMax);
  const skipped = req.freqs.filter((f) => f > fMax);
  const nF = freqs.length;
  const active = kind === 'shape'
    ? [{ id: '__corner', pos: { x: 0.05, y: 0.05, z: 0.05 } }]
    : sources.filter((s) => setup.positions[s.id]).map((s) => ({ id: s.id, pos: setup.positions[s.id] }));
  const filt = kind === 'shape' ? null : filterSet(sources, freqs.length ? freqs : [50], setup.crossoverHz, setup.subSettings).filt;
  let grid = null as ReturnType<typeof waveField>['grid'] | null;
  let sumRe: Float32Array | null = null, sumIm: Float32Array | null = null;
  active.forEach((a, q) => {
    const r = waveField(room, fMax, a.pos, freqs.length ? freqs : [50], onProgress && ((v) => onProgress((q + v) / active.length)));
    grid = r.grid;
    if (!sumRe) { sumRe = new Float32Array(r.re.length); sumIm = new Float32Array(r.im.length); }
    const F = filt?.[a.id];
    const nFF = freqs.length || 1;
    for (let o = 0; o < r.re.length; o++) {
      const f = o % nFF;
      const fr = F ? F.re[f] : 1, fi = F ? F.im[f] : 0;
      sumRe![o] += r.re[o] * fr - r.im[o] * fi;
      sumIm![o] += r.re[o] * fi + r.im[o] * fr;
    }
  });
  const g = grid!;
  const nP = g.nx * g.ny * g.nz;
  const mask = new Uint8Array(nP);
  const energy = new Float32Array(nF * nP);
  for (let n = 0; n < g.N; n++) {
    const cell = g.nodeCell[n];
    const i = cell % g.nx;
    const j = Math.floor(cell / g.nx) % g.ny;
    const k = Math.floor(cell / (g.nx * g.ny));
    const p = (i * g.ny + j) * g.nz + k;
    mask[p] = g.region[n] === 0 ? 1 : 2;
    if (!sumRe) continue;
    for (let f = 0; f < nF; f++) {
      const o = n * nF + f;
      energy[f * nP + p] = sumRe[o] * sumRe[o] + sumIm![o] * sumIm![o];
    }
  }
  normalize(energy, mask, nF);
  const coarse: FieldResult = {
    model: 'wave', kind, nx: g.nx, ny: g.ny, nz: g.nz, x0: g.x0, y0: g.y0, z0: g.z0, sx: g.h, sy: g.h, sz: g.h,
    mask, freqs, energy, skipped,
  };
  return upsample(coarse, Math.max(1, Math.min(3, Math.round(g.h / 0.1))));
}

/** Сгущение сетки в r раз по каждой оси: трилинейная интерполяция энергии по узлам с воздухом. */
function upsample(c: FieldResult, r: number): FieldResult {
  if (r <= 1) return c;
  const nx = c.nx * r, ny = c.ny * r, nz = c.nz * r;
  const sx = c.sx / r, sy = c.sy / r, sz = c.sz / r;
  // центр мелкой ячейки 0 — в начале крупной ячейки 0 + полшага
  const x0 = c.x0 - c.sx / 2 + sx / 2, y0 = c.y0 - c.sy / 2 + sy / 2, z0 = c.z0 - c.sz / 2 + sz / 2;
  const nP = nx * ny * nz, cP = c.mask.length, nF = c.freqs.length;
  const mask = new Uint8Array(nP);
  const energy = new Float32Array(nF * nP);
  const cIdx = (i: number, j: number, k: number) => (i * c.ny + j) * c.nz + k;
  const w = new Float64Array(8);
  const id = new Int32Array(8);
  for (let i = 0; i < nx; i++) {
    const u = (x0 + i * sx - c.x0) / c.sx;
    const i0 = Math.max(0, Math.min(c.nx - 1, Math.floor(u))), i1 = Math.min(c.nx - 1, i0 + 1), tu = Math.min(1, Math.max(0, u - i0));
    const ic = Math.max(0, Math.min(c.nx - 1, Math.round(u)));
    for (let j = 0; j < ny; j++) {
      const v = (y0 + j * sy - c.y0) / c.sy;
      const j0 = Math.max(0, Math.min(c.ny - 1, Math.floor(v))), j1 = Math.min(c.ny - 1, j0 + 1), tv = Math.min(1, Math.max(0, v - j0));
      const jc = Math.max(0, Math.min(c.ny - 1, Math.round(v)));
      for (let k = 0; k < nz; k++) {
        const ww = (z0 + k * sz - c.z0) / c.sz;
        const k0 = Math.max(0, Math.min(c.nz - 1, Math.floor(ww))), k1 = Math.min(c.nz - 1, k0 + 1), tw = Math.min(1, Math.max(0, ww - k0));
        const kc = Math.max(0, Math.min(c.nz - 1, Math.round(ww)));
        const p = (i * ny + j) * nz + k;
        const m = c.mask[cIdx(ic, jc, kc)];
        mask[p] = m;
        if (!m) continue;
        let q = 0;
        for (const [a, wa] of [[i0, 1 - tu], [i1, tu]] as const)
          for (const [b, wb] of [[j0, 1 - tv], [j1, tv]] as const)
            for (const [d, wd] of [[k0, 1 - tw], [k1, tw]] as const) {
              const ci = cIdx(a, b, d);
              const wt = wa * wb * wd;
              if (wt > 0 && c.mask[ci]) { id[q] = ci; w[q] = wt; q++; }
            }
        let sw = 0;
        for (let t = 0; t < q; t++) sw += w[t];
        if (sw <= 0) { id[0] = cIdx(ic, jc, kc); w[0] = 1; q = 1; sw = 1; }
        for (let f = 0; f < nF; f++) {
          let s = 0;
          for (let t = 0; t < q; t++) s += c.energy[f * cP + id[t]] * w[t];
          energy[f * nP + p] = s / sw;
        }
      }
    }
  }
  return { ...c, nx, ny, nz, sx, sy, sz, x0, y0, z0, mask, energy };
}

export function computeField(req: FieldRequest, onProgress?: (v: number) => void): FieldResult {
  if (!req.freqs.length) throw new Error('Не выбраны частоты');
  return isWave(req.room) ? waveFieldResult(req, onProgress) : modalField(req);
}

// ---------- Сведение частот и срез ----------

const EPS = 1e-6;
export const toDb = (e: number) => 10 * Math.log10(Math.max(e, EPS));

/** Средняя (нормированная) энергия по выбранным частотам в каждой точке. */
export function combineEnergy(res: FieldResult, freqIdx: number[]): Float32Array {
  const nP = res.mask.length;
  const out = new Float32Array(nP);
  const list = freqIdx.filter((f) => f >= 0 && f < res.freqs.length);
  if (!list.length) return out;
  for (const f of list) for (let p = 0; p < nP; p++) out[p] += res.energy[f * nP + p];
  const inv = 1 / list.length;
  for (let p = 0; p < nP; p++) out[p] *= inv;
  return out;
}

export interface FieldSlice {
  nx: number;
  ny: number;
  x0: number;
  y0: number;
  sx: number;
  sy: number;
  /** дБ относительно среднего по комнате; NaN — вне воздуха. Индекс i·ny + j. */
  db: Float32Array;
}

/**
 * Горизонтальный срез на высоте z (плоскость без толщины): энергия линейно интерполируется между двумя
 * соседними по высоте ярусами сетки (шаг 6–10 см — мельче половины длины волны и на 300 Гц). Вне воздуха — NaN.
 */
export function sliceField(res: FieldResult, energy: Float32Array, z: number): FieldSlice {
  const { nx, ny, nz } = res;
  const kk = Math.min(nz - 1, Math.max(0, (z - res.z0) / res.sz));
  const k0 = Math.floor(kk), k1 = Math.min(nz - 1, k0 + 1), t = kk - k0;
  const db = new Float32Array(nx * ny);
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < ny; j++) {
      const p0 = (i * ny + j) * nz + k0, p1 = (i * ny + j) * nz + k1;
      const m0 = res.mask[p0] ? 1 - t : 0, m1 = res.mask[p1] ? t : 0;
      // у пола или потолка смежного помещения один из ярусов может быть вне воздуха — берём другой
      const w = m0 + m1;
      db[i * ny + j] = w > 0 ? toDb((energy[p0] * m0 + energy[p1] * m1) / w) : NaN;
    }
  return { nx, ny, x0: res.x0, y0: res.y0, sx: res.sx, sy: res.sy, db };
}

/** Частоты полосы [f0, f1] с шагом 1/24 октавы (не более 16). */
export function bandFreqs(f0: number, f1: number): number[] {
  const lo = Math.max(10, Math.min(f0, f1)), hi = Math.max(f0, f1);
  if (hi - lo < 0.5) return [lo];
  let n = Math.ceil(Math.log2(hi / lo) * 24) + 1;
  n = Math.min(16, Math.max(2, n));
  return Array.from({ length: n }, (_, i) => lo * Math.pow(hi / lo, i / (n - 1)));
}
