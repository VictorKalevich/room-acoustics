// Подготовка изготовления пористых панелей (V2-052): раскрой плит, ведомость материалов, масса и стоимость, карта
// раскроя в SVG. Неизвестная цена или плотность — не ноль: стоимость и масса тогда не считаются, а называется,
// чего не хватает. Раскрой — прямоугольная сетка кусков на плите (с поворотом), без учёта ширины пропила.

export interface PanelJob {
  /** Размер панели (лицевая сторона), м. */
  width: number;
  height: number;
  count: number;
  /** Толщина пористого заполнения, м. */
  core: number;
  board: { width: number; height: number; thickness: number; perPack: number | null; density: number | null; pricePack: number | null };
  /** Рамка по периметру: цена погонного метра бруска (null — неизвестна). */
  framePrice: number | null;
  /** Ткань: запас на подгиб с каждой стороны, м; цена квадратного метра (null — неизвестна). */
  fabricMargin: number;
  fabricPrice: number | null;
}

export interface CutPlan { across: number; along: number; rotated: boolean; pieces: number; waste: number }

/** Сколько кусков w×h помещается на плите W×H сеткой (лучшая из двух ориентаций) и доля отходов. */
export function cutPlan(w: number, h: number, W: number, H: number): CutPlan {
  const fit = (a: number, b: number) => ({ across: Math.floor(W / a + 1e-9), along: Math.floor(H / b + 1e-9) });
  const p = fit(w, h), q = fit(h, w);
  const n = p.across * p.along, m = q.across * q.along;
  const rotated = m > n;
  const best = rotated ? q : p;
  const pieces = best.across * best.along;
  return { ...best, rotated, pieces, waste: pieces ? 1 - (pieces * w * h) / (W * H) : 1 };
}

export interface Bom {
  layers: number;
  pieces: number;
  plan: CutPlan;
  /** Панель больше плиты: собирается из частей, плиты считаются по площади. */
  assembled: boolean;
  boards: number;
  packs: number | null;
  frameLength: number;
  fabricArea: number;
  mass: number | null;
  cost: number | null;
  missing: string[];
}

export function panelBom(j: PanelJob): Bom {
  const layers = Math.max(1, Math.ceil(j.core / j.board.thickness - 1e-9));
  const pieces = layers * j.count;
  const plan = cutPlan(j.width, j.height, j.board.width, j.board.height);
  const assembled = plan.pieces === 0;
  const boards = assembled ? Math.ceil((pieces * j.width * j.height) / (j.board.width * j.board.height) - 1e-9) : Math.ceil(pieces / plan.pieces);
  const packs = j.board.perPack ? Math.ceil(boards / j.board.perPack) : null;
  const frameLength = 2 * (j.width + j.height) * j.count;
  const wrap = j.core + j.fabricMargin;
  const fabricArea = (j.width + 2 * wrap) * (j.height + 2 * wrap) * j.count;
  const mass = j.board.density === null ? null : pieces * j.width * j.height * j.board.thickness * j.board.density;
  const missing = [
    ...(j.board.pricePack === null || packs === null ? ['цена или число плит в упаковке'] : []),
    ...(j.framePrice === null ? ['цена бруска'] : []),
    ...(j.fabricPrice === null ? ['цена ткани'] : []),
  ];
  const cost = missing.length ? null : packs! * j.board.pricePack! + frameLength * j.framePrice! + fabricArea * j.fabricPrice!;
  return { layers, pieces, plan, assembled, boards, packs, frameLength, fabricArea, mass, cost, missing };
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

/** Карта раскроя одной плиты в SVG (миллиметры): куски сеткой, остаток штрихом. */
export function cutMapSvg(w: number, h: number, W: number, H: number, plan: CutPlan, title: string): string {
  const mm = (v: number) => Math.round(v * 1000);
  const [pw, ph] = plan.rotated ? [h, w] : [w, h];
  const rects: string[] = [];
  for (let i = 0; i < plan.across; i++)
    for (let k = 0; k < plan.along; k++)
      rects.push(`<rect x="${mm(i * pw)}" y="${mm(k * ph)}" width="${mm(pw)}" height="${mm(ph)}" fill="#dfe9f5" stroke="#255eab" stroke-width="2"/><text x="${mm(i * pw + pw / 2)}" y="${mm(k * ph + ph / 2)}" font-size="${Math.max(12, mm(Math.min(pw, ph)) / 8)}" text-anchor="middle" dominant-baseline="middle">${mm(pw)} × ${mm(ph)}</text>`);
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="-20 -60 ${mm(W) + 40} ${mm(H) + 80}" width="${mm(W) / 4}mm" height="${(mm(H) + 80) / 4}mm" font-family="sans-serif">
<title>${esc(title)}</title>
<text x="0" y="-25" font-size="28">${esc(title)}: плита ${mm(W)} × ${mm(H)} мм, кусков ${plan.pieces}, отход ${Math.round(plan.waste * 100)} %</text>
<rect x="0" y="0" width="${mm(W)}" height="${mm(H)}" fill="none" stroke="#333" stroke-width="3" stroke-dasharray="12 8"/>
${rects.join('\n')}
</svg>
`;
}
