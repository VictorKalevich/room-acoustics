// Форма комнаты (V2-046): Г-, Т-, П-образная комната, ниша и контур с прямыми углами. Форма раскладывается на основной
// прямоугольник и примыкающие к его стенам части — смежные зоны ядра с аркой во всю ширину и высоту части. Так ядро
// считает её волновой моделью без приближения. Контур с наклонными стенами или частями, не примыкающими к одной стене
// основного прямоугольника, ядро не считает: отказ с причиной, комната не меняется.
import { validateExtension } from '../../core/geometry';
import type { Extension, WallId } from '../../core/types';
import { coreInputs } from '../adapters/core';
import type { RoomConfiguration, RoomShape, ShapeKind } from '../domain/model';
import { WALL_LABEL, setDimensions } from './editing';

export interface Pt { x: number; y: number }

/** Часть комнаты у стены основного прямоугольника: участок вдоль стены и глубина от неё. */
export interface Wing { wall: WallId; a0: number; a1: number; depth: number; height?: number }

/** Форма: основной прямоугольник и части. */
export interface ShapeDraft { depth: number; width: number; height: number; wings: Wing[] }

export type ShapeResult = { ok: true; draft: ShapeDraft } | { ok: false; reason: string };

export const SHAPE_LABEL: Record<ShapeKind, string> = {
  rect: 'Прямоугольная', l: 'Г-образная', t: 'Т-образная', u: 'П-образная', niche: 'С нишей', contour: 'По точкам контура',
};

/** Параметры шаблона: основная часть и часть у стены `wall`. */
export interface TemplateParams {
  kind: Exclude<ShapeKind, 'contour'>;
  depth: number;
  width: number;
  height: number;
  wall: WallId;
  /** Г-образная: угол у начала стены или у конца. */
  side: 'start' | 'end';
  /** Длина части вдоль стены и глубина от стены. */
  along: number;
  out: number;
  /** Ниша: начало вдоль стены и высота. */
  offset: number;
  nicheHeight: number;
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const lenOf = (p: { depth: number; width: number }, wall: WallId) => (wall === 'front' || wall === 'back' ? p.width : p.depth);

/** Как назвать концы стены: вдоль передней и задней — от левой стены, вдоль боковых — от передней. */
export function sideLabel(wall: WallId, side: 'start' | 'end'): string {
  const along = wall === 'front' || wall === 'back';
  return side === 'start' ? (along ? 'У левой стены' : 'У передней стены') : (along ? 'У правой стены' : 'У задней стены');
}

export function templateShape(p: TemplateParams): ShapeResult {
  const L = lenOf(p, p.wall);
  const wall = `${WALL_LABEL[p.wall]} стена`;
  if (p.kind === 'rect') return { ok: true, draft: { depth: p.depth, width: p.width, height: p.height, wings: [] } };
  if (!(p.along > 0) || !(p.out > 0)) return { ok: false, reason: 'Укажите длину части вдоль стены и её глубину.' };
  const wings: Wing[] = [];
  if (p.kind === 'l') {
    if (p.along >= L - 1e-6) return { ok: false, reason: `Часть во всю длину стены (${wall}) — это прямоугольная комната больших размеров: задайте её размерами.` };
    wings.push(p.side === 'start' ? { wall: p.wall, a0: 0, a1: p.along, depth: p.out } : { wall: p.wall, a0: r3(L - p.along), a1: L, depth: p.out });
  } else if (p.kind === 't') {
    if (p.along >= L - 1e-6) return { ok: false, reason: `Часть во всю длину стены (${wall}) — это прямоугольная комната больших размеров: задайте её размерами.` };
    const a0 = r3((L - p.along) / 2);
    wings.push({ wall: p.wall, a0, a1: r3(a0 + p.along), depth: p.out });
  } else if (p.kind === 'u') {
    if (2 * p.along >= L - 1e-6) return { ok: false, reason: `Две части у концов стены (${wall}) не оставляют промежутка: их общая длина должна быть меньше ${fmt(L)} м.` };
    wings.push({ wall: p.wall, a0: 0, a1: p.along, depth: p.out }, { wall: p.wall, a0: r3(L - p.along), a1: L, depth: p.out });
  } else {
    if (p.offset < 0 || p.offset + p.along > L + 1e-6) return { ok: false, reason: `Ниша выходит за стену (${wall}, ${fmt(L)} м).` };
    if (!(p.nicheHeight > 0.5 && p.nicheHeight <= p.height)) return { ok: false, reason: 'Высота ниши — больше 0,5 м и не выше комнаты.' };
    wings.push({ wall: p.wall, a0: p.offset, a1: r3(p.offset + p.along), depth: p.out, height: p.nicheHeight });
  }
  return { ok: true, draft: { depth: p.depth, width: p.width, height: p.height, wings } };
}

const fmt = (v: number) => String(Math.round(v * 100) / 100).replace('.', ',');

/** Точки «x; y» по одной в строке (десятичная запятая допустима). */
export function parseOutline(text: string): { points: Pt[]; error?: string } {
  const points: Pt[] = [];
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (const [i, line] of lines.entries()) {
    const parts = line.split(/[;\t]|\s+/).filter(Boolean).map((s) => Number(s.replace(',', '.')));
    if (parts.length !== 2 || parts.some((v) => !Number.isFinite(v))) return { points, error: `Строка ${i + 1}: нужны два числа «x; y» в метрах.` };
    points.push({ x: parts[0], y: parts[1] });
  }
  return { points };
}

const EPS = 1e-6;

function segmentsCross(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const [ax0, ax1] = [Math.min(a.x, b.x), Math.max(a.x, b.x)], [ay0, ay1] = [Math.min(a.y, b.y), Math.max(a.y, b.y)];
  const [cx0, cx1] = [Math.min(c.x, d.x), Math.max(c.x, d.x)], [cy0, cy1] = [Math.min(c.y, d.y), Math.max(c.y, d.y)];
  return ax0 <= cx1 + EPS && cx0 <= ax1 + EPS && ay0 <= cy1 + EPS && cy0 <= ay1 + EPS;
}

function inside(pts: Pt[], x: number, y: number): boolean {
  let s = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) s = !s;
  }
  return s;
}

/**
 * Контур в координатах комнаты (x — от передней стены, y — от левой) → основной прямоугольник наибольшей площади и
 * части у его стен. Начало координат переносится в передний левый угол основной части.
 */
export function decomposeContour(input: Pt[], height: number): ShapeResult {
  const pts: Pt[] = [];
  for (const p of input.map((q) => ({ x: r3(q.x), y: r3(q.y) }))) {
    const last = pts[pts.length - 1];
    if (!last || Math.abs(last.x - p.x) > EPS || Math.abs(last.y - p.y) > EPS) pts.push(p);
  }
  if (pts.length > 1 && Math.abs(pts[0].x - pts[pts.length - 1].x) < EPS && Math.abs(pts[0].y - pts[pts.length - 1].y) < EPS) pts.pop();
  if (pts.length < 4) return { ok: false, reason: 'Нужно не меньше четырёх точек контура.' };
  if (pts.length > 24) return { ok: false, reason: 'Не больше 24 точек контура.' };
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    if (Math.abs(a.x - b.x) > EPS && Math.abs(a.y - b.y) > EPS) {
      return { ok: false, reason: `Участок от точки ${i + 1} к точке ${((i + 1) % n) + 1} наклонный: ядро считает только стены под прямым углом. Задайте контур ступенями (это будет приближение) или прямоугольником.` };
    }
  }
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (segmentsCross(pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n])) return { ok: false, reason: 'Контур пересекает или касается сам себя.' };
    }
  }
  const xs = [...new Set(pts.map((p) => p.x))].sort((a, b) => a - b);
  const ys = [...new Set(pts.map((p) => p.y))].sort((a, b) => a - b);
  const I = xs.length - 1, J = ys.length - 1;
  const cell: boolean[][] = Array.from({ length: I }, (_r, i) => Array.from({ length: J }, (_c, j) => inside(pts, (xs[i] + xs[i + 1]) / 2, (ys[j] + ys[j + 1]) / 2)));
  // префиксные суммы: прямоугольник ячеек целиком внутри — за O(1)
  const S = Array.from({ length: I + 1 }, () => Array.from({ length: J + 1 }, () => 0));
  for (let i = 0; i < I; i++) for (let j = 0; j < J; j++) S[i + 1][j + 1] = S[i][j + 1] + S[i + 1][j] - S[i][j] + (cell[i][j] ? 1 : 0);
  const full = (i0: number, i1: number, j0: number, j1: number) => S[i1][j1] - S[i0][j1] - S[i1][j0] + S[i0][j0] === (i1 - i0) * (j1 - j0);
  let best: [number, number, number, number] | null = null, bestA = 0;
  for (let i0 = 0; i0 < I; i0++) for (let i1 = i0 + 1; i1 <= I; i1++) for (let j0 = 0; j0 < J; j0++) for (let j1 = j0 + 1; j1 <= J; j1++) {
    const a = (xs[i1] - xs[i0]) * (ys[j1] - ys[j0]);
    if (a > bestA + EPS && full(i0, i1, j0, j1)) { best = [i0, i1, j0, j1]; bestA = a; }
  }
  if (!best) return { ok: false, reason: 'Контур не задаёт помещение.' };
  const [mi0, mi1, mj0, mj1] = best;
  const side = (i: number, j: number): WallId | null => {
    const inX = i >= mi0 && i < mi1, inY = j >= mj0 && j < mj1;
    if (inX && j >= mj1) return 'right';
    if (inX && j < mj0) return 'left';
    if (inY && i >= mi1) return 'back';
    if (inY && i < mi0) return 'front';
    return null;
  };
  const seen = cell.map((row) => row.map(() => false));
  const wings: Wing[] = [];
  for (let i = 0; i < I; i++) for (let j = 0; j < J; j++) {
    if (!cell[i][j] || seen[i][j] || (i >= mi0 && i < mi1 && j >= mj0 && j < mj1)) continue;
    const wall = side(i, j);
    if (!wall) return { ok: false, reason: `Часть контура около точки (${fmt(xs[i])}; ${fmt(ys[j])}) не примыкает к одной стене основной части: ядро считает части только у стен прямоугольника.` };
    const comp: [number, number][] = [];
    const stack: [number, number][] = [[i, j]];
    seen[i][j] = true;
    while (stack.length) {
      const [ci, cj] = stack.pop()!;
      comp.push([ci, cj]);
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = ci + di, nj = cj + dj;
        if (ni < 0 || nj < 0 || ni >= I || nj >= J || seen[ni][nj] || !cell[ni][nj] || side(ni, nj) !== wall) continue;
        seen[ni][nj] = true;
        stack.push([ni, nj]);
      }
    }
    const ci0 = Math.min(...comp.map((c) => c[0])), ci1 = Math.max(...comp.map((c) => c[0])) + 1;
    const cj0 = Math.min(...comp.map((c) => c[1])), cj1 = Math.max(...comp.map((c) => c[1])) + 1;
    const touches = wall === 'back' ? ci0 === mi1 : wall === 'front' ? ci1 === mi0 : wall === 'right' ? cj0 === mj1 : cj1 === mj0;
    if (comp.length !== (ci1 - ci0) * (cj1 - cj0) || !touches) {
      return { ok: false, reason: `Часть у стены (${WALL_LABEL[wall]}) ступенчатая: ядро считает только прямоугольные части. Разделите её или упростите контур.` };
    }
    const [x0, x1, y0, y1] = [xs[ci0], xs[ci1], ys[cj0], ys[cj1]];
    const mx0 = xs[mi0], mx1 = xs[mi1], my0 = ys[mj0], my1 = ys[mj1];
    wings.push(wall === 'back' || wall === 'front'
      ? { wall, a0: r3(y0 - my0), a1: r3(y1 - my0), depth: r3(wall === 'back' ? x1 - mx1 : mx0 - x0) }
      : { wall, a0: r3(x0 - mx0), a1: r3(x1 - mx0), depth: r3(wall === 'right' ? y1 - my1 : my0 - y0) });
  }
  return { ok: true, draft: { depth: r3(xs[mi1] - xs[mi0]), width: r3(ys[mj1] - ys[mj0]), height, wings } };
}

/** Части формы — смежные зоны ядра: арка во всю ширину и высоту части, стороны закрыты. */
export function wingZones(d: ShapeDraft, newId: () => string): Extension[] {
  return d.wings.map((w, k) => {
    const h = w.height ?? d.height;
    return { id: newId(), name: `Часть комнаты ${k + 1}`, wall: w.wall, a0: w.a0, a1: w.a1, depth: w.depth, height: h, arch: { a0: w.a0, a1: w.a1, height: h }, openStart: false, openEnd: false, openFar: false };
  });
}

/**
 * Применить форму к конфигурации: размеры основной части (объекты вписываются, как при смене размеров), прежние части
 * формы заменяются, смежные зоны пользователя остаются. Проём на участке стены, который стал проходом в часть комнаты,
 * удаляется — там больше нет стены.
 */
export function applyShape(c: RoomConfiguration, kind: ShapeKind, d: ShapeDraft, newId: () => string, outline?: Pt[]): { config: RoomConfiguration; notes: string[] } {
  const sized = setDimensions(c, { depth: d.depth, width: d.width, height: d.height });
  const notes = [...sized.notes];
  const own = new Set(c.shape?.zoneIds ?? []);
  const wings = wingZones(d, newId);
  const base = sized.config;
  const room = coreInputs({ ...base, zones: [] }).room;
  for (const z of wings) {
    const err = validateExtension(room, z);
    if (err) throw new Error(`Часть у стены (${WALL_LABEL[z.wall]}): ${err.toLowerCase()}.`);
  }
  const open = (o: { wall: WallId; a0: number; a1: number }) => wings.some((z) => z.wall === o.wall && o.a0 < z.a1 - EPS && o.a1 > z.a0 + EPS);
  const openings = base.openings.filter((o) => !open(o));
  if (openings.length < base.openings.length) notes.push(`Проёмов на открытых участках стен удалено: ${base.openings.length - openings.length}.`);
  const panels = base.treatment.items.filter((t) => t.kind === 'panel' && t.wall && wings.some((z) => z.wall === t.wall));
  if (panels.length) notes.push('Проверьте панели на стенах, к которым примыкают части комнаты: на проходе стены нет.');
  const shape: RoomShape | undefined = kind === 'rect' ? undefined : { kind, zoneIds: wings.map((z) => z.id), ...(outline ? { outline: outline.map((p) => ({ ...p })) } : {}) };
  const config: RoomConfiguration = { ...base, openings, zones: [...base.zones.filter((z) => !own.has(z.id)), ...wings], shape };
  if (!shape) delete config.shape;
  return { config, notes };
}

/** Площадь пола и объём формы (основная часть и части). */
export function shapeSize(d: ShapeDraft): { area: number; volume: number } {
  const main = d.depth * d.width;
  const area = main + d.wings.reduce((s, w) => s + (w.a1 - w.a0) * w.depth, 0);
  const volume = main * d.height + d.wings.reduce((s, w) => s + (w.a1 - w.a0) * w.depth * (w.height ?? d.height), 0);
  return { area, volume };
}
