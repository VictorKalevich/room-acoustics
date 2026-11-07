// Разбор планировки скана (research R24): контур стен, проёмы до пола, коридор за проёмом.
// Работает в координатах комнаты (матрица из detectRoom). Чистый модуль.
import type { Extension, WallId } from '../core/types';

export interface LayoutOpening {
  wall: WallId;
  a0: number;
  a1: number;
  height: number;
}

export interface LayoutResult {
  /** Точки контура стен (x, y попарно) в координатах комнаты. */
  outline: Float32Array;
  bounds: { x0: number; x1: number; y0: number; y1: number };
  openings: LayoutOpening[];
  extension: Omit<Extension, 'id' | 'name'> | null;
}

interface Dims { depth: number; width: number; height: number }

const WALLS: { wall: WallId; axis: 0 | 1; pos: (d: Dims) => number; outward: number }[] = [
  { wall: 'front', axis: 0, pos: () => 0, outward: -1 },
  { wall: 'back', axis: 0, pos: (d) => d.depth, outward: 1 },
  { wall: 'left', axis: 1, pos: () => 0, outward: -1 },
  { wall: 'right', axis: 1, pos: (d) => d.width, outward: 1 },
];

/** Треугольники в координатах комнаты: центры, нормали, площади. */
function transformTris(raw: Float32Array, m: number[]) {
  const n = Math.floor(raw.length / 9);
  const c = new Float32Array(n * 3);
  const nr = new Float32Array(n * 3);
  const a = new Float32Array(n);
  const v = new Float64Array(9);
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 3; k++) {
      const x = raw[i * 9 + k * 3], y = raw[i * 9 + k * 3 + 1], z = raw[i * 9 + k * 3 + 2];
      v[k * 3] = m[0] * x + m[4] * y + m[8] * z + m[12];
      v[k * 3 + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
      v[k * 3 + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
    }
    const ux = v[3] - v[0], uy = v[4] - v[1], uz = v[5] - v[2];
    const wx = v[6] - v[0], wy = v[7] - v[1], wz = v[8] - v[2];
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    const l = Math.hypot(nx, ny, nz);
    a[i] = l / 2;
    if (l > 0) { nr[i * 3] = nx / l; nr[i * 3 + 1] = ny / l; nr[i * 3 + 2] = nz / l; }
    c[i * 3] = (v[0] + v[3] + v[6]) / 3;
    c[i * 3 + 1] = (v[1] + v[4] + v[7]) / 3;
    c[i * 3 + 2] = (v[2] + v[5] + v[8]) / 3;
  }
  return { c, nr, a, n };
}

export function analyzeLayout(raw: Float32Array, transform: number[], d: Dims): LayoutResult {
  const T = transformTris(raw, transform);
  // контур стен
  const outlinePts: number[] = [];
  let bx0 = Infinity, bx1 = -Infinity, by0 = Infinity, by1 = -Infinity;
  const vertical: number[] = [];
  for (let i = 0; i < T.n; i++) {
    if (Math.abs(T.nr[i * 3 + 2]) > 0.3) continue;
    vertical.push(i);
    const z = T.c[i * 3 + 2];
    if (z < 0.3 || z > d.height - 0.1) continue;
    outlinePts.push(T.c[i * 3], T.c[i * 3 + 1]);
  }
  const stride = Math.max(1, Math.ceil(outlinePts.length / 2 / 15000));
  const outline: number[] = [];
  for (let i = 0; i < outlinePts.length; i += 2 * stride) {
    const x = outlinePts[i], y = outlinePts[i + 1];
    outline.push(x, y);
    bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x); by0 = Math.min(by0, y); by1 = Math.max(by1, y);
  }

  const openings = findOpenings(T, vertical, d);
  let extension: LayoutResult['extension'] = null;
  // коридор ищем за самым широким проёмом
  for (const o of [...openings].sort((p, q) => q.a1 - q.a0 - (p.a1 - p.a0))) {
    const e = findExtension(T, vertical, d, o);
    if (e) { extension = e; break; }
  }
  return {
    outline: Float32Array.from(outline),
    bounds: { x0: bx0, x1: bx1, y0: by0, y1: by1 },
    openings: openings.filter((o) => !extension || o.wall !== extension.wall || Math.abs(o.a0 - extension.arch.a0) > 0.05),
    extension,
  };
}

type Tris = ReturnType<typeof transformTris>;

/** Проёмы до пола: участки стены с покрытием < 25 % по высоте 0,1–1,9 м шириной ≥ 0,6 м. */
export function findOpenings(T: Tris, vertical: number[], d: Dims): LayoutOpening[] {
  const out: LayoutOpening[] = [];
  const bin = 0.2;
  for (const w of WALLS) {
    const along = w.axis === 0 ? 1 : 0; // координата вдоль стены
    const L = w.axis === 0 ? d.width : d.depth;
    const nb = Math.max(1, Math.ceil(L / bin));
    const low = new Float64Array(nb); // площадь в полосе 0,1–1,9 м
    const zBins = Math.ceil(d.height / 0.1);
    const byZ = Array.from({ length: nb }, () => new Float64Array(zBins));
    const plane = w.pos(d);
    for (const i of vertical) {
      if (Math.abs(T.nr[i * 3 + w.axis]) < 0.8) continue;
      if (Math.abs(T.c[i * 3 + w.axis] - plane) > 0.12) continue;
      const a = T.c[i * 3 + along];
      const z = T.c[i * 3 + 2];
      const b = Math.floor(a / bin);
      if (b < 0 || b >= nb) continue;
      if (z >= 0.1 && z <= 1.9) low[b] += T.a[i];
      const zb = Math.min(zBins - 1, Math.max(0, Math.floor(z / 0.1)));
      byZ[b][zb] += T.a[i];
    }
    // сглаживание по соседним бинам
    const cov = Array.from(low, (_, b) => {
      let s = 0, k = 0;
      for (let j = b - 1; j <= b + 1; j++) if (j >= 0 && j < nb) { s += low[j]; k++; }
      return s / k / (bin * 1.8);
    });
    let start = -1;
    for (let b = 0; b <= nb; b++) {
      const gap = b < nb && cov[b] < 0.25;
      if (gap && start < 0) start = b;
      if (!gap && start >= 0) {
        // сглаживание сужает провал: расширяем края по несглаженному покрытию
        const raw = (j: number) => low[j] / (bin * 1.8);
        let s0 = start, s1 = b;
        while (s0 > 0 && raw(s0 - 1) < 0.5) s0--;
        while (s1 < nb && raw(s1) < 0.5) s1++;
        const a0 = s0 * bin, a1 = Math.min(L, s1 * bin);
        if (a1 - a0 >= 0.6 - 1e-9 && a0 > 0.05 && a1 < L - 0.05) {
          // высота: первый уровень, где над проёмом снова есть стена
          let height = d.height;
          for (let zb = Math.ceil(1.6 / 0.1); zb < zBins; zb++) {
            let s = 0;
            for (let j = s0; j < s1; j++) s += byZ[j][zb];
            if (s / ((s1 - s0) * bin * 0.1) > 0.4) { height = zb * 0.1; break; }
          }
          out.push({ wall: w.wall, a0: round(a0), a1: round(a1), height: round(height) });
        }
        start = -1;
        b = Math.max(b, s1 - 1);
      }
    }
  }
  return out;
}

/** Коридор за проёмом: дальняя стена, протяжённость вдоль стены, открытые концы. */
export function findExtension(T: Tris, vertical: number[], d: Dims, o: LayoutOpening): LayoutResult['extension'] {
  const w = WALLS.find((x) => x.wall === o.wall)!;
  const along = w.axis === 0 ? 1 : 0;
  const plane = w.pos(d);
  const beyond = (i: number) => (T.c[i * 3 + w.axis] - plane) * w.outward; // расстояние за стеной
  // дальняя стена: параллельные поверхности за стеной (до 4 м)
  const bin = 0.05;
  const hist = new Float64Array(Math.ceil(4 / bin));
  for (const i of vertical) {
    if (Math.abs(T.nr[i * 3 + w.axis]) < 0.8) continue;
    const dd = beyond(i);
    if (dd < 0.25 || dd >= 4) continue;
    const z = T.c[i * 3 + 2];
    if (z < 0.5 * d.height) continue;
    hist[Math.floor(dd / bin)] += T.a[i];
  }
  let max = 0;
  for (const v of hist) max = Math.max(max, v);
  if (max < 0.5) return null;
  let depthBin = -1;
  for (let b = 0; b < hist.length; b++) if (hist[b] >= 0.3 * max) { depthBin = b; break; }
  if (depthBin < 0) return null;
  // уточняем по взвешенному среднему в окне
  let sw = 0, sp = 0;
  for (let b = Math.max(0, depthBin - 2); b <= Math.min(hist.length - 1, depthBin + 2); b++) { sw += hist[b]; sp += hist[b] * (b + 0.5) * bin; }
  const depth = sp / sw;
  // протяжённость вдоль стены и высота коридора
  let a0 = Infinity, a1 = -Infinity, zTop = 0;
  for (let i = 0; i < T.n; i++) {
    const dd = beyond(i);
    if (dd < 0.05 || dd > depth + 0.1) continue;
    const a = T.c[i * 3 + along];
    a0 = Math.min(a0, a); a1 = Math.max(a1, a);
    zTop = Math.max(zTop, T.c[i * 3 + 2]);
  }
  if (!(a1 > a0)) return null;
  // торцы: есть ли перпендикулярная стена у края
  const endWall = (edge: number) => {
    let area = 0;
    for (const i of vertical) {
      if (Math.abs(T.nr[i * 3 + along]) < 0.8) continue;
      const dd = beyond(i);
      if (dd < 0.05 || dd > depth) continue;
      if (Math.abs(T.c[i * 3 + along] - edge) > 0.15) continue;
      area += T.a[i];
    }
    return area > 0.3 * depth * d.height;
  };
  // высота коридора: по его потолку; почти равная высоте комнаты — считаем равной
  const height = zTop > 1.5 && Math.abs(zTop - d.height) > 0.15 ? Math.min(zTop, d.height + 1) : d.height;
  return {
    wall: o.wall,
    a0: round(a0),
    a1: round(a1),
    depth: round(depth),
    height: round(height),
    arch: { a0: o.a0, a1: o.a1, height: o.height },
    openStart: !endWall(a0),
    openEnd: !endWall(a1),
    openFar: false,
  };
}

const round = (v: number) => Math.round(v * 100) / 100;
