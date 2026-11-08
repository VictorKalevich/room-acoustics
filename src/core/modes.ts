import type { Mode, ModeKind, Room } from './types';
import { speedOfSound } from './physics';

/**
 * Собственные частоты прямоугольной комнаты с жёсткими стенами:
 * f = (c/2)·√((nx/Lx)² + (ny/Ly)² + (nz/Lz)²)  (Kuttruff, Room Acoustics, гл. 3).
 * Lx = глубина, Ly = ширина, Lz = высота. Нулевая мода (0,0,0) не включается.
 */
export function computeModes(room: Room, fMax: number, fMin = 15): Mode[] {
  const c = speedOfSound(room.temperatureC);
  const L = [room.depth, room.width, room.height];
  const nMax = L.map((l) => Math.floor((2 * fMax * l) / c));
  const out: Mode[] = [];
  for (let a = 0; a <= nMax[0]; a++) {
    for (let b = 0; b <= nMax[1]; b++) {
      for (let d = 0; d <= nMax[2]; d++) {
        if (a + b + d === 0) continue;
        const f = (c / 2) * Math.hypot(a / L[0], b / L[1], d / L[2]);
        if (f > fMax || f < fMin) continue;
        const nz = (a > 0 ? 1 : 0) + (b > 0 ? 1 : 0) + (d > 0 ? 1 : 0);
        const kind: ModeKind = nz === 1 ? 'axial' : nz === 2 ? 'tangential' : 'oblique';
        out.push({ n: [a, b, d], f, kind, degenerate: false, clustered: false });
      }
    }
  }
  out.sort((x, y) => x.f - y.f || x.n[0] - y.n[0] || x.n[1] - y.n[1] || x.n[2] - y.n[2]);
  // Вырожденные моды: другая мода ближе 0,5 % по частоте.
  for (let i = 0; i < out.length; i++) {
    const prev = out[i - 1];
    const next = out[i + 1];
    const near = (o?: Mode) => !!o && Math.abs(o.f - out[i].f) / out[i].f < 0.005;
    out[i].degenerate = near(prev) || near(next);
  }
  // Скопления осевых мод: другая осевая мода ближе 5 %.
  const axial = out.filter((m) => m.kind === 'axial');
  for (let i = 0; i < axial.length; i++) {
    const near = (o?: Mode) => !!o && Math.abs(o.f - axial[i].f) / axial[i].f < 0.05;
    axial[i].clustered = near(axial[i - 1]) || near(axial[i + 1]);
  }
  return out;
}

export interface ModeIssues {
  clusters: { f1: number; f2: number }[];
  gaps: { f1: number; f2: number }[];
}

/** Скопления (< 5 %) и пробелы (> 20 %) между соседними осевыми модами. */
export function modeIssues(modes: Mode[], fMax = 200): ModeIssues {
  const axial = modes.filter((m) => m.kind === 'axial' && m.f <= fMax);
  const clusters: ModeIssues['clusters'] = [];
  const gaps: ModeIssues['gaps'] = [];
  for (let i = 1; i < axial.length; i++) {
    const r = axial[i].f / axial[i - 1].f;
    if (r < 1.05) clusters.push({ f1: axial[i - 1].f, f2: axial[i].f });
    else if (r > 1.2) gaps.push({ f1: axial[i - 1].f, f2: axial[i].f });
  }
  return { clusters, gaps };
}

/**
 * Критерий Бонелло (O. Bonello, JAES 1981): число мод в третьоктавных полосах
 * не должно убывать с частотой, а совпадающие моды допустимы лишь в полосах с ≥ 5 модами.
 */
export function bonelloCheck(modes: Mode[], fMax = 200): {
  ok: boolean;
  bands: { center: number; count: number; coincident: boolean }[];
  violations: number[];
} {
  const centers = [20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400].filter((x) => x <= fMax);
  const k = Math.pow(2, 1 / 6);
  const bands = centers.map((center) => {
    const inBand = modes.filter((m) => m.f >= center / k && m.f < center * k);
    return { center, count: inBand.length, coincident: inBand.some((m) => m.degenerate) };
  });
  const violations: number[] = [];
  let started = false;
  for (let i = 0; i < bands.length; i++) {
    if (bands[i].count > 0) started = true;
    if (!started) continue;
    if (i > 0 && bands[i].count < bands[i - 1].count) violations.push(bands[i].center);
    else if (bands[i].coincident && bands[i].count < 5) violations.push(bands[i].center);
  }
  return { ok: violations.length === 0, bands, violations };
}

/** Замечания о пропорциях: равные или кратные (в пределах 3 %) размеры. */
export function proportionsNotes(room: Room): string[] {
  const dims: [string, number][] = [
    ['глубина', room.depth],
    ['ширина', room.width],
    ['высота', room.height],
  ];
  const notes: string[] = [];
  for (let i = 0; i < 3; i++) {
    for (let j = i + 1; j < 3; j++) {
      const [na, a] = dims[i];
      const [nb, b] = dims[j];
      const big = Math.max(a, b);
      const small = Math.min(a, b);
      const ratio = big / small;
      const k = Math.round(ratio);
      if (k >= 1 && k <= 4 && Math.abs(ratio - k) / k < 0.03) {
        const nBig = a >= b ? na : nb;
        const nSmall = a >= b ? nb : na;
        notes.push(
          k === 1
            ? `${cap(na)} и ${nb} почти равны — осевые моды совпадают и усиливают друг друга.`
            : `${cap(nBig)} ≈ ${k} × ${nSmall} — часть осевых мод совпадает (кратные размеры).`,
        );
      }
    }
  }
  return notes;
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

const AX_BY = ['глубине', 'ширине', 'высоте'];
const AX = ['глубина', 'ширина', 'высота'];

/**
 * Где мода «живёт» — словами вместо номеров (1 0 0 и т. п.): «по глубине», «2-я по ширине»
 * (две полуволны), «глубина + высота» (тангенциальная), «по всем трём размерам» (косая).
 * short — для кнопок: у косой просто «косая».
 */
export function modeWhere(n: readonly number[], short = false): string {
  const nz = [0, 1, 2].filter((k) => n[k] > 0);
  if (nz.length === 1) {
    const k = nz[0];
    return n[k] === 1 ? `по ${AX_BY[k]}` : `${n[k]}-я по ${AX_BY[k]}`;
  }
  if (nz.length === 2) return `${AX[nz[0]]} + ${AX[nz[1]]}`;
  return short ? 'косая' : 'по всем трём размерам';
}
