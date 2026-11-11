// Волновая модель (research R21): FDTD на кубической сетке для комнаты со смежными помещениями.
// Схема SLF с частотно-независимыми локально реагирующими границами (Kowalczyk & van Walstijn, 2008).
import type { OctaveValues, Room, SurfaceId, Vec3, WallId } from './types';
import { ceilingAt, extensionBox, roomBox, type Box } from './geometry';
import { speedOfSound } from './physics';
import { alphaAt, getMaterial } from './materials';
import { furnishingOctaves } from './furniture';
import { surfaceAreas } from './reverb';
import { treatmentKey } from './treatments';
import { cornerLegs, patchContains, roomPatches, type Patch } from './patches';
import { branchCoeffs, fitAdmittance, type AdmittanceFit, type Branch } from './admittance';
import { BETA_OPEN, alphaStat, apertureBeta, betaFromAlpha } from './paris';

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
  /** Быстрый счёт на плотной сетке ячеек: внутренние узлы — отрезками с постоянными смещениями. */
  fast: FastKernel;
  volumes: number[];
  /** Оценка самого долгого затухания (осевые моды основной комнаты), с — для длительности расчёта. */
  t60: number;
}

/**
 * Раскладка для быстрого шага. Давление хранится по ячейкам (плотно, nx·ny·nz + 1; последняя — всегда ноль).
 * Внутренние узлы (все шесть соседей — воздух и связаны) имеют одинаковые коэффициенты, а соседи у них —
 * на постоянных смещениях ±1, ±nx, ±nx·ny: их считаем отрезками подряд, без таблиц соседей и коэффициентов.
 * Граничные узлы — списком со своими соседями (или нулевой ячейкой) и коэффициентами.
 * Результат совпадает с исходной схемой бит в бит (те же float32-коэффициенты и порядок сложения).
 */
export interface FastKernel {
  size: number;
  sx: number;
  sxy: number;
  /** пары [начальная ячейка, длина] отрезков внутренних узлов */
  runs: Int32Array;
  A: number;
  L: number;
  bCell: Int32Array;
  bNbr: Int32Array;
  bca: Float32Array;
  bcb: Float32Array;
  bcd: Float32Array;
  /** Частотно-зависимые границы: ветви проводимости граничных узлов (нет — граница с постоянной β). */
  fd?: FdBranches;
}

/** Ветви граничных узлов: для узла b — индексы off[b]…off[b+1]. */
export interface FdBranches {
  k: number;
  off: Int32Array;
  /** для каждой ветви: номер граничного узла и его ячейка */
  node: Int32Array;
  cell: Int32Array;
  ia: Float64Array;
  b: Float64Array;
  iC: Float64Array;
  cw: Float64Array;
  cpsi: Float64Array;
}

/**
 * Модель границ волновой схемы:
 *  'fi' — постоянная β на грань по α, усреднённому в полосе 40–160 Гц (как раньше);
 *  'fd' — проводимость β(f) из ветвей RLC, подобранная по α(f) материала на каждой частоте.
 */
export type BoundaryModel = 'fi' | 'fd';
export const BOUNDARY_DEFAULT: BoundaryModel = 'fd';

/**
 * Для модели границ 'fi' (постоянная β) α берётся средним по полосе, где у комнаты моды и
 * где оценивается бас: 40, 63, 100 и 160 Гц (ниже 63 Гц таблица продолжается значением на 63 Гц).
 * Та же величина задаёт оценку длительности расчёта и в модели 'fd'.
 */
export function lfAlpha(values: readonly number[]): number {
  return (alphaAt(values, 40) + alphaAt(values, 63) + alphaAt(values, 100) + alphaAt(values, 160)) / 4;
}

export { alphaStat, betaFromAlpha } from './paris';

/**
 * Поглощение грани для частотно-зависимой границы: α отделки по октавам (без обстановки) и есть ли на ней
 * обстановка; aperture — площадь проёма в стене (тогда β(f) — проводимость проёма, apertureBeta).
 */
interface FaceAbs {
  v: number[];
  furn: boolean;
  aperture?: number;
}

/** Ключ геометрии/материалов для кэша. */
export function geometryKey(room: Room, fMax: number, boundary: BoundaryModel = BOUNDARY_DEFAULT): string {
  return JSON.stringify([boundary,
    room.depth, room.width, room.height, room.temperatureC, room.materials, room.furnishing, room.furnitureList ? furnishingOctaves(room) : null,
    room.openings, room.extensions, room.calibration, Math.round(fMax), treatmentKey(room), room.slope ?? null,
    (room.features ?? []).map((f) => [f.kind, f.wall, f.a0, f.a1, f.bottom, f.top]),
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

export function buildGrid(room: Room, fMaxWanted: number, maxNodes = 300_000, opts: { boundary?: BoundaryModel } = {}): WaveGrid {
  const boundary = opts.boundary ?? BOUNDARY_DEFAULT;
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
            if (b === 0 && room.slope && z > ceilingAt(room, x, y)) break; // под скосом — не воздух
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

  // Поглощение поверхностей (полоса 40–160 Гц), обстановка и подстройка по замеру — как в прямоугольной модели
  // (modeDamping): стены, окна, двери и обработка — локально реагирующие поверхности, β по табличному α
  // (обращение формулы Пари). Обстановка — не стена: её поглощение подобрано по замерам T60 жилых комнат
  // через формулу Сэбина, поэтому добавляется к β линейно (α/8), долями по площадям поверхностей основной
  // комнаты (в смежных помещениях обстановки нет). Подстройка по замеру умножает β (затухание мод ∝ β), кроме проёмов.
  const S = surfaceAreas(room);
  const sTotal = Object.values(S).reduce((a, b) => a + b, 0);
  const furnBeta = (lfAlpha(furnishingOctaves(room)) * S.floor) / sTotal / 8;
  const scale = room.calibration?.dampingScale ?? 1;
  const matAlpha = (surf: SurfaceId) => lfAlpha(getMaterial(room.materials[surf]).alpha);
  const wallBeta = (alpha: number, furn: boolean) => (betaFromAlpha(Math.max(0, alpha)) + (furn ? furnBeta : 0)) * scale;
  const betaRoom: Record<string, number> = {};
  const betaBare: Record<string, number> = {};
  for (const sf of ROOM_FACE) { betaRoom[sf] = wallBeta(matAlpha(sf), true); betaBare[sf] = wallBeta(matAlpha(sf), false); }
  // стены коридора — штукатурка без обстановки
  const plasterBeta = wallBeta(lfAlpha(getMaterial('plaster').alpha), false);
  const along = (wall: WallId, x: number, y: number) => (wall === 'front' || wall === 'back' ? y : x);
  // окна, двери, обработка — на своих гранях; угловая ловушка — катетами на двух стенах; проёмы — β проёма
  const patches: Patch[] = roomPatches(room, { withArches: false }).flatMap((p) => (p.diag ? cornerLegs(room, p) : [p]));
  // для участков — α в полосе; для проёмов — их проводимость в полосе (масса воздуха в проёме, apertureBeta)
  const patchBand = new Map<Patch, number>();
  for (const p of patches) patchBand.set(p, p.alpha ? lfAlpha(p.alpha as OctaveValues) : [40, 63, 100, 160].reduce((s, f) => s + apertureBeta(p.area, f, c), 0) / 4);
  const faceBeta = (sf: SurfaceId, u: number, v: number): number => {
    const base = matAlpha(sf);
    let alpha = base;
    let replaced = false;
    for (const p of patches) {
      if (!patchContains(p, sf, u, v)) continue;
      if (!p.alpha) return patchBand.get(p)!;
      const ap = patchBand.get(p)!;
      if (p.overlay) alpha += Math.max(0, ap - base);
      else if (!replaced) { alpha += ap - base; replaced = true; }
    }
    return wallBeta(alpha, true);
  };
  // координаты точки на поверхности: для стен — вдоль стены и высота, для потолка/пола — x и y
  const surfUV = (sf: SurfaceId, x: number, y: number, z: number): [number, number] =>
    sf === 'front' || sf === 'back' ? [y, z] : sf === 'left' || sf === 'right' ? [x, z] : [x, y];
  // частотно-зависимые границы: α по октавам на каждой грани (та же логика, что faceBeta, но по полосам)
  const fd = boundary === 'fd';
  const dt = (LAMBDA * h) / c;
  const furnVec = furnishingOctaves(room).map((v) => (v * S.floor) / sTotal);
  const matVec = (sf: SurfaceId) => [...getMaterial(room.materials[sf]).alpha] as number[];
  const roomFace: Record<string, FaceAbs> = {};
  const bareFace: Record<string, FaceAbs> = {};
  for (const sf of ROOM_FACE) { roomFace[sf] = { v: matVec(sf), furn: true }; bareFace[sf] = { v: matVec(sf), furn: false }; }
  const plasterFace: FaceAbs = { v: [...getMaterial('plaster').alpha], furn: false };
  const faceVec = (sf: SurfaceId, u: number, v: number): FaceAbs => {
    const base = matVec(sf);
    let alpha = base.slice();
    let replaced = false;
    for (const p of patches) {
      if (!patchContains(p, sf, u, v)) continue;
      if (!p.alpha) return apertureFace(p.area);
      const ap = p.alpha as readonly number[];
      if (p.overlay) alpha = alpha.map((x, i) => x + Math.max(0, ap[i] - base[i]));
      else if (!replaced) { alpha = alpha.map((x, i) => x + ap[i] - base[i]); replaced = true; }
    }
    return { v: alpha, furn: true };
  };
  const apertures = new Map<number, FaceAbs>();
  const apertureFace = (area: number): FaceAbs => {
    let f = apertures.get(area);
    if (!f) { f = { v: [], furn: false, aperture: area }; apertures.set(area, f); }
    return f;
  };
  const fits = new Map<string, AdmittanceFit>();
  const warp = (f: number) => Math.tan(2 * Math.PI * f * dt) / (2 * Math.PI * dt);
  const fitOf = (face: FaceAbs): AdmittanceFit => {
    const key = face.aperture !== undefined ? `A${face.aperture.toFixed(4)}` : face.v.map((v) => v.toFixed(5)).join(',') + (face.furn ? '|F' : '');
    let fit = fits.get(key);
    if (!fit) {
      // целевая β(f) = (β(α(f)) + обстановка/8)·подстройка, у проёма — его проводимость; подбор ведётся по α — отдаём α этой β
      const betaAt = (f: number) => face.aperture !== undefined
        ? apertureBeta(face.aperture, f, c)
        : (betaFromAlpha(Math.max(0, alphaAt(face.v, f))) + (face.furn ? alphaAt(furnVec, f) / 8 : 0)) * scale;
      fit = fitAdmittance((f) => alphaStat(betaAt(f)), betaFromAlpha, 20, Math.min(300, 1.3 * fMax), warp);
      fits.set(key, fit);
    }
    return fit;
  };
  const faces: (FaceAbs | null)[] = [];
  const fdB = { bca: [] as number[], bcb: [] as number[], bcd: [] as number[], off: [0], ia: [] as number[], b: [] as number[], iC: [] as number[], cw: [] as number[], cpsi: [] as number[] };

  // Σ β·dS по поверхностям основной комнаты — для оценки затухания осевых мод
  const betaArea: Record<string, number> = { front: 0, back: 0, left: 0, right: 0, floor: 0, ceiling: 0 };

  const nbr = new Int32Array(6 * N).fill(N);
  const interior = new Uint8Array(N);
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
    faces.length = 0;
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
        const nxp = cx(ii), nyp = cy(jj), nzp = cz(kk);
        const underSlope = !!room.slope && inside(boxes[0], nxp, nyp, nzp);
        const sf: SurfaceId = underSlope ? 'ceiling' : ROOM_FACE[d];
        // центр грани — посередине между узлом и соседней (заблокированной) ячейкой
        const [u, v] = surfUV(sf, (x + nxp) / 2, (y + nyp) / 2, (z + nzp) / 2);
        beta = underSlope ? betaRoom.ceiling : faceBeta(sf, u, v);
        betaArea[sf] += beta * h * h;
        if (fd) faces.push(underSlope ? roomFace.ceiling : faceVec(sf, u, v));
      } else {
        const e = exts[r - 1];
        // направление к стене комнаты, от неё, вдоль стены
        const toRoom = { right: 2, left: 3, front: 1, back: 0 }[e.wall];
        const far = { right: 3, left: 2, front: 0, back: 1 }[e.wall];
        const startDir = e.wall === 'front' || e.wall === 'back' ? 2 : 0;
        const endDir = startDir + 1;
        // пол, потолок и стена в сторону комнаты — материал комнаты, но без обстановки
        if (d === 4) beta = betaBare.floor;
        else if (d === 5) beta = betaBare.ceiling;
        else if (d === toRoom) beta = betaBare[e.wall];
        else if (d === far) beta = e.openFar ? BETA_OPEN : plasterBeta;
        else if (d === startDir) beta = e.openStart ? BETA_OPEN : plasterBeta;
        else if (d === endDir) beta = e.openEnd ? BETA_OPEN : plasterBeta;
        else beta = plasterBeta;
        if (fd) {
          const open = (d === far && e.openFar) || (d === startDir && e.openStart) || (d === endDir && e.openEnd);
          faces.push(d === 4 ? bareFace.floor : d === 5 ? bareFace.ceiling : d === toRoom ? bareFace[e.wall] : open ? null : plasterFace);
        }
      }
      betaSum += beta;
    }
    const beta = blocked ? betaSum / blocked : 0;
    if (K === 6) interior[n] = 1;
    const cc = (LAMBDA * beta * (6 - K)) / 2;
    ca[n] = (2 - K * l2) / (1 + cc);
    cb[n] = l2 / (1 + cc);
    cd[n] = (1 - cc) / (1 + cc);
    if (fd && K < 6) {
      // одинаковые грани узла — одна ветвь с проводимостью × число граней
      let sInf = 0;
      const groups = new Map<FaceAbs, number>();
      for (const v of faces) {
        if (!v) { sInf += BETA_OPEN; continue; }
        groups.set(v, (groups.get(v) ?? 0) + 1);
      }
      // у всех подборов одни и те же центры и добротность: ветви с одним центром на разных гранях
      // складываются в одну (параллельные RLC с общим резонансом = один RLC с суммой проводимостей)
      const byCenter = new Map<number, Branch>();
      for (const [v, cnt] of groups) {
        const fit = fitOf(v);
        sInf += fit.binf * cnt;
        for (const br of fit.branches) {
          const prev = byCenter.get(br.f0);
          byCenter.set(br.f0, prev ? { ...prev, g: prev.g + br.g * cnt } : { ...br, g: br.g * cnt });
        }
      }
      const brs = [...byCenter.values()].map((br) => branchCoeffs(br, dt));
      let s4a = 0;
      for (const q of brs) s4a += 1 / (4 * q.a);
      const D = 1 + (LAMBDA * sInf) / 2 + LAMBDA * s4a;
      fdB.bca.push((2 - K * l2) / D);
      fdB.bcb.push(l2 / D);
      fdB.bcd.push((1 - (LAMBDA * sInf) / 2 + LAMBDA * s4a) / D);
      for (const q of brs) {
        fdB.ia.push(1 / q.a); fdB.b.push(q.b); fdB.iC.push(q.iC);
        fdB.cw.push((LAMBDA * (q.b / (2 * q.a) + 0.5)) / D);
        fdB.cpsi.push((LAMBDA * q.iC) / (2 * q.a) / D);
      }
      fdB.off.push(fdB.ia.length);
    }
  }

  // затухание осевых мод основной комнаты: δ = (c/2V)·(2·ΣβS⊥ + ΣβS∥) — самое долгое задаёт длительность расчёта
  const V0 = (boxes[0].x1 - boxes[0].x0) * (boxes[0].y1 - boxes[0].y0) * (boxes[0].z1 - boxes[0].z0);
  const B = betaArea;
  const all = B.front + B.back + B.left + B.right + B.floor + B.ceiling;
  const axial = [B.front + B.back, B.left + B.right, B.floor + B.ceiling].map((par) => (c / (2 * V0)) * (all + par));
  const t60 = 6.91 / Math.max(1e-3, Math.min(...axial));

  const fast = buildFast(N, total, nx, ny, nodeCell, nbr, interior, ca, cb, cd, l2);
  if (fd) {
    fast.bca = Float32Array.from(fdB.bca);
    fast.bcb = Float32Array.from(fdB.bcb);
    fast.bcd = Float32Array.from(fdB.bcd);
    const off = Int32Array.from(fdB.off);
    const node = new Int32Array(fdB.ia.length), brCell = new Int32Array(fdB.ia.length);
    for (let b = 0; b < fast.bCell.length; b++) for (let m = off[b]; m < off[b + 1]; m++) { node[m] = b; brCell[m] = fast.bCell[b]; }
    fast.fd = {
      k: dt, off, node, cell: brCell, ia: Float64Array.from(fdB.ia), b: Float64Array.from(fdB.b),
      iC: Float64Array.from(fdB.iC), cw: Float64Array.from(fdB.cw), cpsi: Float64Array.from(fdB.cpsi),
    };
  }

  return {
    key: geometryKey(room, fMaxWanted, boundary),
    h, dt, c, fMax, nx, ny, nz, x0: cx(0), y0: cy(0), z0: cz(0), N,
    cellNode, nodeCell, nbr, ca, cb, cd, region, fast,
    volumes: boxes.map((b) => (b.x1 - b.x0) * (b.y1 - b.y0) * (b.z1 - b.z0)),
    t60,
  };
}

function buildFast(N: number, total: number, nx: number, ny: number, nodeCell: Int32Array, nbr: Int32Array, interior: Uint8Array, ca: Float32Array, cb: Float32Array, cd: Float32Array, l2: number): FastKernel {
  const runs: number[] = [];
  let nb = 0;
  let last = -2;
  for (let n = 0; n < N; n++) {
    if (!interior[n]) { nb++; continue; }
    const c = nodeCell[n];
    if (c === last + 1 && runs.length) runs[runs.length - 1]++;
    else runs.push(c, 1);
    last = c;
  }
  const ZERO = total;
  const bCell = new Int32Array(nb);
  const bNbr = new Int32Array(6 * nb);
  const bca = new Float32Array(nb), bcb = new Float32Array(nb), bcd = new Float32Array(nb);
  let b = 0;
  for (let n = 0; n < N; n++) {
    if (interior[n]) continue;
    bCell[b] = nodeCell[n];
    for (let d = 0; d < 6; d++) {
      const m = nbr[6 * n + d];
      bNbr[6 * b + d] = m === N ? ZERO : nodeCell[m];
    }
    bca[b] = ca[n]; bcb[b] = cb[n]; bcd[b] = cd[n];
    b++;
  }
  // те же выражения, что для узла с K = 6 и β = 0 (cc = 0), округлённые до float32 как в массивах ca/cb
  return { size: total + 1, sx: nx, sxy: nx * ny, runs: Int32Array.from(runs), A: Math.fround((2 - 6 * l2) / (1 + 0)), L: Math.fround(l2 / (1 + 0)), bCell, bNbr, bca, bcb, bcd };
}

/**
 * Состояние ветвей границ на время одного расчёта. Ветвь обновляется «через шаг» (w⁺ из w⁻), поэтому
 * чётные и нечётные шаги живут в разных массивах и обновляются на месте — без перекладывания.
 */
export interface FdState { w: [Float64Array, Float64Array]; psi: [Float64Array, Float64Array]; parity: number; acc: Float64Array }

function fdState(k: FastKernel): FdState | undefined {
  if (!k.fd) return undefined;
  const n = k.fd.ia.length;
  return { w: [new Float64Array(n), new Float64Array(n)], psi: [new Float64Array(n), new Float64Array(n)], parity: 0, acc: new Float64Array(k.bCell.length) };
}

/** Один шаг схемы на плотной сетке: p2 ← f(p1, p0). */
function stepFast(k: FastKernel, p0: Float32Array, p1: Float32Array, p2: Float32Array, st?: FdState) {
  const { runs, sx, sxy, A, L, bCell, bNbr, bca, bcb, bcd } = k;
  if (k.fd && st) { stepFd(k, k.fd, st, p0, p1, p2); return; }
  for (let r = 0; r < runs.length; r += 2) {
    const end = runs[r] + runs[r + 1];
    for (let c = runs[r]; c < end; c++) {
      const sum = p1[c - 1] + p1[c + 1] + p1[c - sx] + p1[c + sx] + p1[c - sxy] + p1[c + sxy];
      p2[c] = A * p1[c] + L * sum - p0[c];
    }
  }
  for (let b = 0; b < bCell.length; b++) {
    const c = bCell[b];
    const o = 6 * b;
    const sum = p1[bNbr[o]] + p1[bNbr[o + 1]] + p1[bNbr[o + 2]] + p1[bNbr[o + 3]] + p1[bNbr[o + 4]] + p1[bNbr[o + 5]];
    p2[c] = bca[b] * p1[c] + bcb[b] * sum - bcd[b] * p0[c];
  }
}

/** Шаг с частотно-зависимыми границами: внутренние узлы — как обычно, граничные — с ветвями проводимости. */
function stepFd(k: FastKernel, fd: FdBranches, st: FdState, p0: Float32Array, p1: Float32Array, p2: Float32Array) {
  const { runs, sx, sxy, A, L, bCell, bNbr, bca, bcb, bcd } = k;
  for (let r = 0; r < runs.length; r += 2) {
    const end = runs[r] + runs[r + 1];
    for (let c = runs[r]; c < end; c++) {
      const sum = p1[c - 1] + p1[c + 1] + p1[c - sx] + p1[c + sx] + p1[c - sxy] + p1[c + sxy];
      p2[c] = A * p1[c] + L * sum - p0[c];
    }
  }
  const { ia, b: bb, iC, cw, cpsi, node, cell } = fd;
  const kk = fd.k;
  const nBr = ia.length;
  // w⁻, ψ⁻ (шаг n−1) лежат в массивах той же чётности, что и новые w⁺, ψ⁺ (шаг n+1)
  const w = st.w[st.parity], ps = st.psi[st.parity];
  st.parity ^= 1;
  // длинные плоские циклы по ветвям быстрее коротких вложенных по узлам
  const acc = st.acc;
  acc.fill(0);
  for (let m = 0; m < nBr; m++) acc[node[m]] += cw[m] * w[m] + cpsi[m] * ps[m];
  for (let b = 0; b < bCell.length; b++) {
    const c = bCell[b];
    const o = 6 * b;
    const sum = p1[bNbr[o]] + p1[bNbr[o + 1]] + p1[bNbr[o + 2]] + p1[bNbr[o + 3]] + p1[bNbr[o + 4]] + p1[bNbr[o + 5]];
    p2[c] = bca[b] * p1[c] + bcb[b] * sum - bcd[b] * p0[c] + acc[b];
  }
  for (let m = 0; m < nBr; m++) {
    const c = cell[m];
    const half = (p2[c] + p0[c]) / 2;
    const wm = w[m];
    const wn = (half - bb[m] * wm - iC[m] * ps[m]) * ia[m];
    ps[m] += kk * (wn + wm);
    w[m] = wn;
  }
}

/**
 * Длительность расчёта по умолчанию: не короче 1,2 с и так, чтобы самые долгие моды успели затухнуть
 * хотя бы на ~45 дБ (иначе их пики в спектре размываются). Не дольше 3 с.
 */
export function defaultDuration(g: WaveGrid): number {
  return Math.min(3, Math.max(1.2, 0.75 * g.t60));
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
  const duration = opts.duration ?? defaultDuration(g);
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
  const k = g.fast;
  const s = g.nodeCell[nearestNode(g, srcPos)];
  let p0 = new Float32Array(k.size);
  let p1 = new Float32Array(k.size);
  let p2 = new Float32Array(k.size);
  const R = rec.length;
  const recCell = rec.map((n) => g.nodeCell[n]);
  const st = fdState(k);
  let t = 0;
  for (let step = 0; step < steps; step++) {
    stepFast(k, p0, p1, p2, st);
    const sv = sourceSignal(step * g.dt, g.fMax);
    p2[s] += sv;
    const tmp = p0; p0 = p1; p1 = p2; p2 = tmp;
    if (step % decim === 0 && t < T) {
      src[t] = sv;
      for (let r = 0; r < R; r++) series[r * T + t] = p1[recCell[r]];
      t++;
    }
    if (opts.onProgress && step % 500 === 0) opts.onProgress(step / steps);
  }
  return { grid: g, rec, recIndex, layers, T, dtd: g.dt * decim, series, src };
}

/** Сколько прореженных отсчётов копится перед добавлением в ДПФ (одно обновление сумм вместо восьми). */
const DFT_BLOCK = 8;

/**
 * Поле во всех узлах на заданных частотах: ДПФ накапливается во время счёта (на прореженных шагах,
 * с полуокном Ханна на последних 20 %), без хранения временных рядов. Результат — H = P/S, [узел·nF + f].
 * Отсчёты копятся блоками по 8: суммы по блоку считаются в double и добавляются к накопителям разом —
 * вдвое меньше обращений к памяти и точнее, чем прибавлять каждый отсчёт к float32.
 */
export function simulateField(
  g: WaveGrid,
  srcPos: Vec3,
  freqs: number[],
  opts: { duration?: number; onProgress?: (p: number) => void } = {},
): { re: Float32Array; im: Float32Array } {
  const duration = opts.duration ?? defaultDuration(g);
  const steps = Math.ceil(duration / g.dt);
  const decim = Math.max(1, Math.floor(1 / (g.dt * 4.3 * g.fMax)));
  const T = Math.floor(steps / decim);
  const nF = freqs.length;
  const N = g.N;
  const tail = Math.floor(T * 0.2);
  const dtd = g.dt * decim;
  const B = DFT_BLOCK;
  const cB = new Float64Array(nF * B);
  const sB = new Float64Array(nF * B);
  const buf = new Float32Array(N * B);
  const aRe = new Float32Array(N * nF);
  const aIm = new Float32Array(N * nF);
  const sRe = new Float64Array(nF);
  const sIm = new Float64Array(nF);
  const k = g.fast;
  const cell = g.nodeCell;
  const s = cell[nearestNode(g, srcPos)];
  let p0 = new Float32Array(k.size);
  let p1 = new Float32Array(k.size);
  let p2 = new Float32Array(k.size);
  // добавляет накопленные J отсчётов блока к суммам ДПФ
  const flush = (J: number) => {
    for (let n = 0; n < N; n++) {
      const o = n * B;
      const a = n * nF;
      if (J === B) {
        const v0 = buf[o], v1 = buf[o + 1], v2 = buf[o + 2], v3 = buf[o + 3], v4 = buf[o + 4], v5 = buf[o + 5], v6 = buf[o + 6], v7 = buf[o + 7];
        if (v0 === 0 && v1 === 0 && v2 === 0 && v3 === 0 && v4 === 0 && v5 === 0 && v6 === 0 && v7 === 0) continue;
        for (let f = 0; f < nF; f++) {
          const q = f * B;
          aRe[a + f] += v0 * cB[q] + v1 * cB[q + 1] + v2 * cB[q + 2] + v3 * cB[q + 3] + v4 * cB[q + 4] + v5 * cB[q + 5] + v6 * cB[q + 6] + v7 * cB[q + 7];
          aIm[a + f] += v0 * sB[q] + v1 * sB[q + 1] + v2 * sB[q + 2] + v3 * sB[q + 3] + v4 * sB[q + 4] + v5 * sB[q + 5] + v6 * sB[q + 6] + v7 * sB[q + 7];
        }
      } else {
        for (let f = 0; f < nF; f++) {
          const q = f * B;
          let re = 0, im = 0;
          for (let j = 0; j < J; j++) { re += buf[o + j] * cB[q + j]; im += buf[o + j] * sB[q + j]; }
          aRe[a + f] += re;
          aIm[a + f] += im;
        }
      }
    }
  };
  const st = fdState(k);
  let t = 0;
  let j = 0;
  for (let step = 0; step < steps; step++) {
    stepFast(k, p0, p1, p2, st);
    const sv = sourceSignal(step * g.dt, g.fMax);
    p2[s] += sv;
    const tmp = p0; p0 = p1; p1 = p2; p2 = tmp;
    if (step % decim === 0 && t < T) {
      const win = t >= T - tail ? 0.5 * (1 + Math.cos((Math.PI * (t - (T - tail))) / tail)) : 1;
      for (let f = 0; f < nF; f++) {
        const w = 2 * Math.PI * freqs[f] * dtd * t;
        const cw = Math.cos(w), sw = Math.sin(w);
        cB[f * B + j] = cw * win;
        sB[f * B + j] = -sw * win;
        sRe[f] += sv * cw;
        sIm[f] -= sv * sw;
      }
      for (let n = 0; n < N; n++) buf[n * B + j] = p1[cell[n]];
      j++;
      t++;
      if (j === B) { flush(B); j = 0; }
    }
    if (opts.onProgress && step % 500 === 0) opts.onProgress(step / steps);
  }
  if (j > 0) flush(j);
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

const twiddleCache = new Map<string, { cos: Float32Array; sin: Float32Array; win: Float32Array }>();
// спектр сигнала источника — свой у каждого расчёта (в поиске мод системы запись умножается на окно)
const srcSpecCache = new WeakMap<SimResult, Map<string, { sRe: Float64Array; sIm: Float64Array }>>();

function twiddles(sim: SimResult, freqs: number[]) {
  // ключ — по всем частотам (контрольная сумма): разные наборы с теми же краями и числом точек не путаются
  let sum = 0;
  for (let i = 0; i < freqs.length; i++) sum += freqs[i] * (i + 1.618);
  const key = `${sim.T}|${sim.dtd}|${freqs.length}|${freqs[0]}|${freqs[freqs.length - 1]}|${sum}`;
  let tw = twiddleCache.get(key);
  const T = sim.T;
  const nF = freqs.length;
  if (!tw) {
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
    tw = { cos, sin, win };
    if (twiddleCache.size > 8) twiddleCache.clear();
    twiddleCache.set(key, tw);
  }
  let bySim = srcSpecCache.get(sim);
  if (!bySim) { bySim = new Map(); srcSpecCache.set(sim, bySim); }
  let sp = bySim.get(key);
  if (!sp) {
    const sRe = new Float64Array(nF);
    const sIm = new Float64Array(nF);
    for (let f = 0; f < nF; f++) {
      let re = 0, im = 0;
      for (let t = 0; t < T; t++) { re += sim.src[t] * tw.cos[f * T + t]; im += sim.src[t] * tw.sin[f * T + t]; }
      sRe[f] = re; sIm[f] = im;
    }
    sp = { sRe, sIm };
    bySim.set(key, sp);
  }
  return { ...tw, ...sp };
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
  /**
   * На какие моды основной комнаты похожа форма поля в комнате (MAC ≥ 0,2, по убыванию; до трёх).
   * Две слившиеся моды дают у одного пика две записи примерно по 0,5.
   */
  like?: { n: [number, number, number]; mac: number }[];
}

/** Квазислучайная последовательность Халтона по основанию b. */
function halton(i: number, b: number): number {
  let f = 1, r = 0;
  while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); }
  return r;
}

/** Окно сравнения форм по частоте: мода основной комнаты ищется среди мод системы в ±4 полутонах. */
const LIKE_WINDOW = Math.pow(2, 7 / 12);
const LIKE_MIN = 0.2;

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
  // точки для сравнения формы поля с модами основной комнаты: квазислучайно по её объёму
  const probes: number[] = [];
  for (let i = 1; probes.length < 48 && i < 400; i++) {
    const n = nearestNode(g, {
      x: 0.05 + halton(i, 2) * (room.depth - 0.1),
      y: 0.05 + halton(i, 3) * (room.width - 0.1),
      z: 0.05 + halton(i, 5) * (room.height - 0.1),
    });
    if (n >= 0 && g.region[n] === 0 && !probes.includes(n)) probes.push(n);
  }
  const duration = opts.duration ?? Math.max(2.5, defaultDuration(g));
  const sim = simulate(g, { x: 0.12, y: 0.12, z: 0.12 }, { extra: [...new Set([...rN, ...eN, ...probes])], duration, onProgress: opts.onProgress });
  // в гулкой комнате звук не успевает затухнуть за время расчёта: обрыв даёт ложные пики-«лепестки».
  // Экспоненциальное окно добавляет всем модам одинаковое затухание так, чтобы к концу записи было −60 дБ;
  // частоты пиков от этого не меняются
  const dW = Math.max(0, 6.91 / duration - 6.91 / g.t60);
  if (dW > 0) {
    for (let t = 0; t < sim.T; t++) {
      const w = Math.exp(-dW * t * sim.dtd);
      sim.src[t] *= w;
      for (let r = 0; r < sim.rec.length; r++) sim.series[r * sim.T + t] *= w;
    }
  }
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
  matchBoxModes(room, g, sim, probes, modes);
  return { modes, grid: g };
}

/**
 * Сравнение формы поля на частоте каждой моды системы с модами основной комнаты (как с коробкой):
 * MAC = |Σ p·ψ|² / (Σ|p|²·Σψ²) по точкам probes, ψ = cos(πn₁x/L₁)·cos(πn₂y/L₂)·cos(πn₃z/L₃).
 * Так видно, какая мода комнаты куда сдвинулась из-за проёма — по форме, а не по ближайшей частоте.
 */
function matchBoxModes(room: Room, g: WaveGrid, sim: SimResult, probes: number[], modes: SystemMode[]): void {
  if (!modes.length || probes.length < 8) return;
  const fs = modes.map((m) => m.f);
  const pts = probes.map((n) => {
    const cell = g.nodeCell[n];
    const i = cell % g.nx, j = Math.floor(cell / g.nx) % g.ny, k = Math.floor(cell / (g.nx * g.ny));
    return { x: g.x0 + i * g.h, y: g.y0 + j * g.h, z: g.z0 + k * g.h };
  });
  const spec = probes.map((n) => nodeSpectrum(sim, n, fs));
  const c = speedOfSound(room.temperatureC);
  const L = [room.depth, room.width, room.height];
  const fTop = Math.max(...fs) * LIKE_WINDOW;
  const nMax = L.map((l) => Math.floor((2 * fTop * l) / c));
  const box: { n: [number, number, number]; f: number }[] = [];
  for (let a = 0; a <= nMax[0]; a++)
    for (let b = 0; b <= nMax[1]; b++)
      for (let d = 0; d <= nMax[2]; d++) {
        if (a + b + d === 0) continue;
        const f = (c / 2) * Math.hypot(a / L[0], b / L[1], d / L[2]);
        if (f <= fTop) box.push({ n: [a, b, d], f });
      }
  const psi = box.map((m) => pts.map((p) => Math.cos((Math.PI * m.n[0] * p.x) / L[0]) * Math.cos((Math.PI * m.n[1] * p.y) / L[1]) * Math.cos((Math.PI * m.n[2] * p.z) / L[2])));
  modes.forEach((m, mi) => {
    let pp = 0;
    for (const s of spec) pp += s.re[mi] ** 2 + s.im[mi] ** 2;
    const like: { n: [number, number, number]; mac: number }[] = [];
    box.forEach((b, bi) => {
      if (Math.abs(Math.log(b.f / m.f)) > Math.log(LIKE_WINDOW)) return;
      let re = 0, im = 0, qq = 0;
      psi[bi].forEach((v, k) => { re += spec[k].re[mi] * v; im += spec[k].im[mi] * v; qq += v * v; });
      const mac = (re * re + im * im) / Math.max(pp * qq, 1e-30);
      if (mac >= LIKE_MIN) like.push({ n: b.n, mac });
    });
    like.sort((a, b) => b.mac - a.mac);
    m.like = like.slice(0, 3);
  });
}
