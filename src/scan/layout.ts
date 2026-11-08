// Разбор планировки скана (research R24): контур стен, проёмы до пола, коридор за проёмом.
// Работает в координатах комнаты (матрица из detectRoom). Чистый модуль.
import type { Extension, WallId } from '../core/types';

export type OpeningKind = 'door' | 'opening' | 'gap';

export interface LayoutOpening {
  wall: WallId;
  a0: number;
  a1: number;
  height: number;
  /** door — дверь из разметки скана (RoomPlan), opening — проём из разметки, gap — найден по дыре в стене. */
  kind?: OpeningKind;
}

/** Размеченные объекты скана (RoomPlan/Polycam: Door_0, Window_1, Opening_2). */
export type ScanObjectKind = 'door' | 'window' | 'opening';
export interface ScanLabels {
  /** Номер объекта для каждого треугольника: 0 — без разметки, k — objects[k − 1]. */
  ids: Uint16Array;
  objects: ScanObjectKind[];
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

/**
 * Треугольники в координатах комнаты: центры, нормали, площади.
 * Крупные треугольники (сканы RoomPlan: стена из нескольких треугольников по 4 м) дробятся на мелкие,
 * чтобы покрытие стены по участкам считалось по площади, а не по центру большого треугольника.
 */
function transformTris(raw: Float32Array, m: number[], labels?: ScanLabels) {
  const n0 = Math.floor(raw.length / 9);
  const V = new Float64Array(n0 * 9);
  for (let i = 0; i < n0 * 3; i++) {
    const x = raw[i * 3], y = raw[i * 3 + 1], z = raw[i * 3 + 2];
    V[i * 3] = m[0] * x + m[4] * y + m[8] * z + m[12];
    V[i * 3 + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
    V[i * 3 + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
  }
  // сколько частей на сторону: самая длинная сторона ≤ edge (не больше 2 млн мелких треугольников)
  const maxEdge = new Float32Array(n0);
  for (let i = 0; i < n0; i++) {
    const o = i * 9;
    const e = (p: number, q: number) => Math.hypot(V[o + q] - V[o + p], V[o + q + 1] - V[o + p + 1], V[o + q + 2] - V[o + p + 2]);
    maxEdge[i] = Math.max(e(0, 3), e(3, 6), e(0, 6));
  }
  let edge = 0.1;
  const parts = (i: number) => Math.min(400, Math.max(1, Math.ceil(maxEdge[i] / edge)));
  for (;;) {
    let total = 0;
    for (let i = 0; i < n0; i++) total += parts(i) ** 2;
    if (total <= 2_000_000) break;
    edge *= 1.5;
  }
  let n = 0;
  for (let i = 0; i < n0; i++) n += parts(i) ** 2;
  const c = new Float32Array(n * 3);
  const nr = new Float32Array(n * 3);
  const a = new Float32Array(n);
  const lab = new Uint8Array(n); // 0 — поверхность, 1 — дверь, 2 — окно, 3 — проём
  const kindCode = { door: 1, window: 2, opening: 3 } as const;
  // габариты размеченных объектов
  const nObj = labels?.objects.length ?? 0;
  const box = new Float64Array(nObj * 6);
  for (let k = 0; k < nObj; k++) { box.fill(Infinity, k * 6, k * 6 + 3); box.fill(-Infinity, k * 6 + 3, k * 6 + 6); }
  let t = 0;
  for (let i = 0; i < n0; i++) {
    const o = i * 9;
    const ux = V[o + 3] - V[o], uy = V[o + 4] - V[o + 1], uz = V[o + 5] - V[o + 2];
    const wx = V[o + 6] - V[o], wy = V[o + 7] - V[o + 1], wz = V[o + 8] - V[o + 2];
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    const l = Math.hypot(nx, ny, nz);
    const id = labels?.ids[i] ?? 0;
    const code = id > 0 && id <= nObj ? kindCode[labels!.objects[id - 1]] : 0;
    if (code) {
      const b = (id - 1) * 6;
      for (let k = 0; k < 3; k++)
        for (let ax = 0; ax < 3; ax++) {
          const v = V[o + k * 3 + ax];
          if (v < box[b + ax]) box[b + ax] = v;
          if (v > box[b + 3 + ax]) box[b + 3 + ax] = v;
        }
    }
    const p = parts(i);
    const sa = l / 2 / (p * p);
    const put = (fs: number, ft: number) => {
      c[t * 3] = V[o] + ux * fs + wx * ft;
      c[t * 3 + 1] = V[o + 1] + uy * fs + wy * ft;
      c[t * 3 + 2] = V[o + 2] + uz * fs + wz * ft;
      if (l > 0) { nr[t * 3] = nx / l; nr[t * 3 + 1] = ny / l; nr[t * 3 + 2] = nz / l; }
      a[t] = sa;
      lab[t] = code;
      t++;
    };
    for (let s0 = 0; s0 < p; s0++)
      for (let s1 = 0; s0 + s1 < p; s1++) {
        put((s0 + 1 / 3) / p, (s1 + 1 / 3) / p);
        if (s0 + s1 < p - 1) put((s0 + 2 / 3) / p, (s1 + 2 / 3) / p);
      }
  }
  const objects = Array.from({ length: nObj }, (_, k) => ({
    kind: labels!.objects[k],
    x0: box[k * 6], y0: box[k * 6 + 1], z0: box[k * 6 + 2],
    x1: box[k * 6 + 3], y1: box[k * 6 + 4], z1: box[k * 6 + 5],
  })).filter((b) => Number.isFinite(b.x0));
  return { c, nr, a, lab, n: t, objects };
}

/** Двери и проёмы из разметки скана, стоящие на стенах выбранной комнаты. */
function labeledOpenings(T: Tris, d: Dims): LayoutOpening[] {
  const out: LayoutOpening[] = [];
  for (const b of T.objects) {
    if (b.kind === 'window') continue;
    if (b.z0 > 0.4 || b.z1 - b.z0 < 1.2) continue; // не до пола — не проём
    let best: { w: (typeof WALLS)[number]; dist: number } | null = null;
    for (const w of WALLS) {
      const thin = w.axis === 0 ? b.x1 - b.x0 : b.y1 - b.y0;
      if (thin > 0.3) continue;
      const mid = w.axis === 0 ? (b.x0 + b.x1) / 2 : (b.y0 + b.y1) / 2;
      const dist = Math.abs(mid - w.pos(d));
      if (dist < 0.3 && (!best || dist < best.dist)) best = { w, dist };
    }
    if (!best) continue;
    const L = best.w.axis === 0 ? d.width : d.depth;
    const a0 = Math.max(0, best.w.axis === 0 ? b.y0 : b.x0);
    const a1 = Math.min(L, best.w.axis === 0 ? b.y1 : b.x1);
    if (a1 - a0 < 0.3) continue;
    out.push({ wall: best.w.wall, a0: round(a0), a1: round(a1), height: round(Math.min(d.height, b.z1)), kind: b.kind });
  }
  return out;
}

export function analyzeLayout(raw: Float32Array, transform: number[], d: Dims, labels?: ScanLabels): LayoutResult {
  const T = transformTris(raw, transform, labels);
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

  // размеченные двери и проёмы точнее дыр в сетке: дыры, которые с ними совпадают, отбрасываем
  const marked = labeledOpenings(T, d);
  const overlaps = (p: LayoutOpening, q: LayoutOpening) => p.wall === q.wall && Math.min(p.a1, q.a1) - Math.max(p.a0, q.a0) > 0.1;
  const openings = [...marked, ...findOpenings(T, vertical, d).filter((g) => !marked.some((m) => overlaps(g, m)))];
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
      if (T.lab[i] === 1 || T.lab[i] === 3) continue; // полотно двери и проём не закрывают стену
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
          out.push({ wall: w.wall, a0: round(a0), a1: round(a1), height: round(height), kind: 'gap' });
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
