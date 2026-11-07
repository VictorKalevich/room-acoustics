// Распознавание прямоугольной комнаты в треугольной сетке LiDAR-скана (research R3).
// Чистый модуль без DOM: работает в Web Worker и в тестах.

export type Units = 'm' | 'cm' | 'mm';
type V3 = [number, number, number];

export interface DetectResult {
  depth: number;
  width: number;
  height: number;
  units: Units;
  unitsGuessed: boolean;
  up: V3;
  /** Матрица 4×4 (по столбцам, как в three.js): координаты файла → координаты комнаты (м). */
  transform: number[];
  rotationDeg: number;
  tiltDeg: number;
  confidence: number;
  /** Покрытие стен: передняя, задняя, левая, правая (0…1). */
  wallCoverage: [number, number, number, number];
  hasCeiling: boolean;
  outsideFraction: number;
  warnings: string[];
  triangleCount: number;
}

/** Краткая сводка для хранения в проекте (без матрицы). */
export type DetectSummary = Omit<DetectResult, 'transform'> & { fileName: string; format: string };

export class DetectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DetectError';
  }
}

const UNIT_SCALE: Record<Units, number> = { m: 1, cm: 0.01, mm: 0.001 };

const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

interface Tri {
  n: Float32Array; // единичные нормали, 3 на треугольник
  c: Float32Array; // центроиды
  a: Float32Array; // площади
  count: number;
}

function triangles(t: Float32Array): Tri {
  const count = Math.floor(t.length / 9);
  const n = new Float32Array(count * 3);
  const c = new Float32Array(count * 3);
  const a = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const o = i * 9;
    const ux = t[o + 3] - t[o], uy = t[o + 4] - t[o + 1], uz = t[o + 5] - t[o + 2];
    const vx = t[o + 6] - t[o], vy = t[o + 7] - t[o + 1], vz = t[o + 8] - t[o + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz);
    a[i] = l / 2;
    if (l > 0) { n[i * 3] = nx / l; n[i * 3 + 1] = ny / l; n[i * 3 + 2] = nz / l; }
    c[i * 3] = (t[o] + t[o + 3] + t[o + 6]) / 3;
    c[i * 3 + 1] = (t[o + 1] + t[o + 4] + t[o + 7]) / 3;
    c[i * 3 + 2] = (t[o + 2] + t[o + 5] + t[o + 8]) / 3;
  }
  return { n, c, a, count };
}

// ---------- Гистограммы ----------

interface Hist {
  lo: number;
  bin: number;
  w: Float64Array;
}

function makeHist(lo: number, hi: number, bin: number): Hist {
  const nb = Math.max(1, Math.ceil((hi - lo) / bin) + 1);
  return { lo, bin, w: new Float64Array(nb) };
}

function addHist(h: Hist, v: number, w: number) {
  const i = Math.floor((v - h.lo) / h.bin);
  if (i >= 0 && i < h.w.length) h.w[i] += w;
}

function smooth(w: Float64Array, r: number): Float64Array {
  const out = new Float64Array(w.length);
  for (let i = 0; i < w.length; i++) {
    let s = 0;
    for (let k = -r; k <= r; k++) {
      const j = i + k;
      if (j >= 0 && j < w.length) s += w[j];
    }
    out[i] = s;
  }
  return out;
}

/** Локальные максимумы со значением ≥ frac · максимум. Возвращает центры бинов. */
function peaks(h: Hist, smoothR: number, frac: number): { pos: number; weight: number }[] {
  const s = smooth(h.w, smoothR);
  let max = 0;
  for (const v of s) max = Math.max(max, v);
  if (max <= 0) return [];
  const out: { pos: number; weight: number }[] = [];
  for (let i = 0; i < s.length; i++) {
    const left = i > 0 ? s[i - 1] : -1;
    const right = i < s.length - 1 ? s[i + 1] : -1;
    if (s[i] >= frac * max && s[i] >= left && s[i] > right) {
      // уточнение центра взвешенным средним в окне
      let sw = 0, sp = 0;
      for (let k = -smoothR; k <= smoothR; k++) {
        const j = i + k;
        if (j < 0 || j >= h.w.length) continue;
        sw += h.w[j];
        sp += h.w[j] * (h.lo + (j + 0.5) * h.bin);
      }
      out.push({ pos: sw > 0 ? sp / sw : h.lo + (i + 0.5) * h.bin, weight: s[i] });
    }
  }
  return out;
}

function windowWeight(h: Hist, pos: number, halfWidth: number): number {
  let s = 0;
  const i0 = Math.floor((pos - halfWidth - h.lo) / h.bin);
  const i1 = Math.floor((pos + halfWidth - h.lo) / h.bin);
  for (let i = Math.max(0, i0); i <= Math.min(h.w.length - 1, i1); i++) s += h.w[i];
  return s;
}

// ---------- Основной алгоритм ----------

export function detectRoom(raw: Float32Array, opts: { units?: Units } = {}): DetectResult {
  const T = triangles(raw);
  if (T.count < 20) throw new DetectError('В скане слишком мало поверхностей для распознавания комнаты.');
  const warnings: string[] = [];

  // Габариты в единицах файла
  const min: V3 = [Infinity, Infinity, Infinity];
  const max: V3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < T.count; i++)
    for (let k = 0; k < 3; k++) {
      const v = T.c[i * 3 + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  const extent: V3 = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  const maxExtent = Math.max(...extent);
  if (!(maxExtent > 0)) throw new DetectError('Скан не содержит объёма.');

  // 1. Ось «вверх». Для каждой оси считается площадь поверхностей с нормалью вдоль неё
  //    отдельно в нижней и верхней половине габарита; берётся большая из двух. Для истинной
  //    вертикали это пол (+ столешницы), для горизонтальной оси — лишь одна стена, а она
  //    обычно меньше пола. Не зависит от наличия потолка и устойчиво к наклону.
  const axes: V3[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const prior = [0.8, 1.2, 1.1]; // сканеры экспортируют Y-up (ARKit/glTF) или Z-up (STL/PLY)
  let bestAxis = 1;
  let bestScore = -1;
  axes.forEach((_, k) => {
    const mid = (min[k] + max[k]) / 2;
    let low = 0, high = 0;
    for (let i = 0; i < T.count; i++) {
      if (Math.abs(T.n[i * 3 + k]) <= 0.9) continue;
      if (T.c[i * 3 + k] < mid) low += T.a[i];
      else high += T.a[i];
    }
    const smallest = extent[k] <= Math.min(...extent) + 1e-9 ? 1.15 : 1;
    const score = Math.max(low, high) * prior[k] * smallest;
    if (score > bestScore) { bestScore = score; bestAxis = k; }
  });

  // Знак: мебель (горизонтальные поверхности между полом и потолком) ближе к полу
  const k0 = bestAxis;
  let up: V3 = axes[k0].slice() as V3;
  {
    let sw = 0, sh = 0;
    const lo = min[k0] + 0.08 * extent[k0];
    const hi = max[k0] - 0.08 * extent[k0];
    for (let i = 0; i < T.count; i++) {
      const v = T.c[i * 3 + k0];
      if (Math.abs(T.n[i * 3 + k0]) > 0.9 && v > lo && v < hi) { sw += T.a[i]; sh += T.a[i] * v; }
    }
    if (sw > 0 && sh / sw > (min[k0] + max[k0]) / 2) up = [-up[0], -up[1], -up[2]];
  }

  // Уточнение вектора «вверх» по нормалям горизонтальных поверхностей (компенсация наклона)
  {
    const acc: V3 = [0, 0, 0];
    for (let i = 0; i < T.count; i++) {
      const n: V3 = [T.n[i * 3], T.n[i * 3 + 1], T.n[i * 3 + 2]];
      const d = dot(n, up);
      if (Math.abs(d) > 0.95) {
        const s = d > 0 ? T.a[i] : -T.a[i];
        acc[0] += n[0] * s; acc[1] += n[1] * s; acc[2] += n[2] * s;
      }
    }
    if (Math.hypot(...acc) > 0) up = norm(acc);
  }
  const tiltDeg = (Math.acos(Math.min(1, Math.abs(dot(up, axes[k0])))) * 180) / Math.PI;
  if (tiltDeg > 2) warnings.push(`Скан был наклонён на ${tiltDeg.toFixed(1)}° — выровнено по полу.`);

  // Горизонтальный базис
  const helper: V3 = Math.abs(up[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const e1 = norm(cross(helper, up));
  const e2 = norm(cross(up, e1));

  // 2. Пол и потолок (единицы файла)
  const heights = new Float64Array(T.count);
  let hMin = Infinity, hMax = -Infinity;
  for (let i = 0; i < T.count; i++) {
    const h = T.c[i * 3] * up[0] + T.c[i * 3 + 1] * up[1] + T.c[i * 3 + 2] * up[2];
    heights[i] = h;
    if (h < hMin) hMin = h;
    if (h > hMax) hMax = h;
  }
  const hBinRaw = (hMax - hMin) / 400 || 1;
  const hh = makeHist(hMin, hMax, hBinRaw);
  for (let i = 0; i < T.count; i++) {
    const d = T.n[i * 3] * up[0] + T.n[i * 3 + 1] * up[1] + T.n[i * 3 + 2] * up[2];
    if (Math.abs(d) > 0.9) addHist(hh, heights[i], T.a[i]);
  }
  const hp = peaks(hh, 2, 0.08);
  if (!hp.length) throw new DetectError('Не удалось найти пол: в скане нет горизонтальных поверхностей.');
  const floorRaw = hp[0].pos;
  const floorW = windowWeight(hh, floorRaw, 3 * hBinRaw);
  let ceilRaw = hp[hp.length - 1].pos;
  const ceilW = windowWeight(hh, ceilRaw, 3 * hBinRaw);

  // Единицы по высоте
  let units: Units = opts.units ?? 'm';
  let unitsGuessed = false;
  if (!opts.units) {
    const rawH = Math.max(ceilRaw - floorRaw, hMax - floorRaw);
    const guess = (['m', 'cm', 'mm'] as Units[]).find((u) => {
      const v = rawH * UNIT_SCALE[u];
      return v >= 1.5 && v <= 8;
    });
    if (guess) units = guess;
    else { unitsGuessed = true; warnings.push('Не удалось определить единицы скана — приняты метры. Проверьте размеры.'); }
  }
  const sc = UNIT_SCALE[units];

  let hasCeiling = hp.length > 1 && (ceilRaw - floorRaw) * sc > 1.5 && ceilW > 0.2 * floorW;
  if (!hasCeiling) {
    // верхняя вершина стен (по вершинам, а не центроидам)
    let vMax = -Infinity;
    for (let i = 0; i < raw.length; i += 3) {
      const h = raw[i] * up[0] + raw[i + 1] * up[1] + raw[i + 2] * up[2];
      if (h > vMax) vMax = h;
    }
    ceilRaw = vMax;
    warnings.push('Потолок не найден в скане — высота взята по верхней точке стен. Уточните её вручную.');
  }
  const height = (ceilRaw - floorRaw) * sc;

  // 3. Ориентация стен
  let C = 0, S = 0;
  for (let i = 0; i < T.count; i++) {
    const n: V3 = [T.n[i * 3], T.n[i * 3 + 1], T.n[i * 3 + 2]];
    if (Math.abs(dot(n, up)) < 0.2) {
      const th = Math.atan2(dot(n, e2), dot(n, e1));
      C += T.a[i] * Math.cos(4 * th);
      S += T.a[i] * Math.sin(4 * th);
    }
  }
  const phi = Math.atan2(S, C) / 4;
  const ux: V3 = norm([
    e1[0] * Math.cos(phi) + e2[0] * Math.sin(phi),
    e1[1] * Math.cos(phi) + e2[1] * Math.sin(phi),
    e1[2] * Math.cos(phi) + e2[2] * Math.sin(phi),
  ]);
  const vy = norm(cross(up, ux));

  // 4. Положение стен по верхней половине высоты (м)
  const bin = 0.01;
  const proj = (i: number, ax: V3) => (T.c[i * 3] * ax[0] + T.c[i * 3 + 1] * ax[1] + T.c[i * 3 + 2] * ax[2]) * sc;
  let pu0 = Infinity, pu1 = -Infinity, pv0 = Infinity, pv1 = -Infinity;
  for (let i = 0; i < T.count; i++) {
    const u = proj(i, ux), v = proj(i, vy);
    if (u < pu0) pu0 = u; if (u > pu1) pu1 = u;
    if (v < pv0) pv0 = v; if (v > pv1) pv1 = v;
  }
  const hu = makeHist(pu0 - 0.05, pu1 + 0.05, bin);
  const hv = makeHist(pv0 - 0.05, pv1 + 0.05, bin);
  const zLo = floorRaw * sc + 0.5 * height;
  const zHi = floorRaw * sc + 0.97 * height;
  for (let i = 0; i < T.count; i++) {
    const z = heights[i] * sc;
    if (z < zLo || z > zHi) continue;
    const n: V3 = [T.n[i * 3], T.n[i * 3 + 1], T.n[i * 3 + 2]];
    const a = T.a[i] * sc * sc;
    if (Math.abs(dot(n, ux)) > 0.9) addHist(hu, proj(i, ux), a);
    else if (Math.abs(dot(n, vy)) > 0.9) addHist(hv, proj(i, vy), a);
  }
  const pU = peaks(hu, 3, 0.15);
  const pV = peaks(hv, 3, 0.15);
  if (pU.length < 2 || pV.length < 2) {
    throw new DetectError('Не удалось найти четыре стены. Отсканируйте стены целиком, включая верхнюю часть.');
  }
  let [u0, u1] = pickWalls(pU);
  let [v0, v1] = pickWalls(pV);
  let lenU = u1 - u0;
  let lenV = v1 - v0;

  // Покрытие стен (площадь в пике / ожидаемая площадь верхней части)
  const band = zHi - zLo;
  const cov = (h: Hist, pos: number, len: number) => Math.min(1, windowWeight(h, pos, 0.05) / (len * band));
  let covU0 = cov(hu, u0, lenV), covU1 = cov(hu, u1, lenV);
  let covV0 = cov(hv, v0, lenU), covV1 = cov(hv, v1, lenU);

  // Доля площади за пределами найденного прямоугольника (> 15 см)
  let outside = 0, total = 0;
  for (let i = 0; i < T.count; i++) {
    const u = proj(i, ux), v = proj(i, vy);
    total += T.a[i];
    if (u < u0 - 0.15 || u > u1 + 0.15 || v < v0 - 0.15 || v > v1 + 0.15) outside += T.a[i];
  }
  const outsideFraction = total > 0 ? outside / total : 0;

  // Глубина — длинная сторона (колонки у короткой стены по умолчанию)
  let xAx = ux, yAx = vy;
  if (lenU < lenV) {
    // меняем оси: x вдоль v, y = up × x
    xAx = vy;
    yAx = norm(cross(up, xAx));
    [lenU, lenV] = [lenV, lenU];
    const ou0 = u0, ou1 = u1;
    [u0, u1] = [v0, v1];
    // y = up × vy = −ux  → новые границы по y: [−ou1, −ou0]
    [v0, v1] = [-ou1, -ou0];
    [covU0, covU1, covV0, covV1] = [covV0, covV1, covU1, covU0];
  }
  // Проверка правой тройки: y должен быть up × x
  const yCheck = norm(cross(up, xAx));
  if (dot(yCheck, yAx) < 0) { yAx = yCheck; [v0, v1] = [-v1, -v0]; [covV0, covV1] = [covV1, covV0]; }

  const depth = lenU;
  const width = lenV;
  const rotationDeg = (Math.atan2(dot(xAx, e2), dot(xAx, e1)) * 180) / Math.PI;

  // Матрица: p_room = R·(sc·p) − origin; R — строки xAx, yAx, up
  const ox = u0, oy = v0, oz = floorRaw * sc;
  const transform = [
    xAx[0] * sc, yAx[0] * sc, up[0] * sc, 0,
    xAx[1] * sc, yAx[1] * sc, up[1] * sc, 0,
    xAx[2] * sc, yAx[2] * sc, up[2] * sc, 0,
    -ox, -oy, -oz, 1,
  ];

  const wallCoverage: [number, number, number, number] = [covU0, covU1, covV0, covV1];
  const names = ['передняя', 'задняя', 'левая', 'правая'];
  wallCoverage.forEach((cv, i) => {
    if (cv < 0.4) warnings.push(`Стена «${names[i]}» отсканирована частично (${Math.round(cv * 100)} %).`);
  });
  if (outsideFraction > 0.1) {
    warnings.push(
      `Комната не прямоугольная или есть проём в соседнее помещение: ${Math.round(outsideFraction * 100)} % ` +
        'поверхностей вне найденного прямоугольника. Расчёт будет приближённым.',
    );
  }
  if (depth < 1 || width < 1 || height < 1.5) warnings.push('Размеры выглядят неправдоподобно — проверьте единицы.');

  const meanCov = wallCoverage.reduce((a, b) => a + b, 0) / 4;
  const minCov = Math.min(...wallCoverage);
  let confidence = 0.5 * meanCov + 0.3 * minCov + 0.2 * (hasCeiling ? 1 : 0);
  confidence *= 1 - Math.min(1, 2 * outsideFraction);
  if (unitsGuessed) confidence *= 0.5;
  confidence = Math.max(0, Math.min(1, confidence));

  return {
    depth: round3(depth), width: round3(width), height: round3(height),
    units, unitsGuessed, up, transform, rotationDeg, tiltDeg,
    confidence, wallCoverage, hasCeiling, outsideFraction, warnings,
    triangleCount: T.count,
  };
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;

/**
 * Выбор пары противоположных стен среди пиков гистограммы: на каждой стороне берётся самый
 * весомый пик, но более внешний пик предпочитается, если его вес ≥ 60 % от самого весомого
 * (частично отсканированная стена). Ниши и выступы мебели меньше основной стены и отбрасываются.
 */
function pickWalls(p: { pos: number; weight: number }[]): [number, number] {
  const mid = (p[0].pos + p[p.length - 1].pos) / 2;
  const side = (list: { pos: number; weight: number }[], outerFirst: boolean) => {
    const sorted = list.slice().sort((a, b) => (outerFirst ? a.pos - b.pos : b.pos - a.pos));
    const maxW = Math.max(...sorted.map((x) => x.weight));
    return sorted.find((x) => x.weight >= 0.6 * maxW)!.pos;
  };
  const lowSide = p.filter((x) => x.pos <= mid);
  const highSide = p.filter((x) => x.pos > mid);
  const lo = lowSide.length ? side(lowSide, true) : p[0].pos;
  const hi = highSide.length ? side(highSide, false) : p[p.length - 1].pos;
  return [lo, hi];
}
