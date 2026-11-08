// Цель подбора мест для баса: как оценивать АЧХ у слушателя при поиске расстановки и на картах.
// Все оценки — в децибелах, меньше — лучше, и складываются со штрафами расстановки (угол, симметрия).
//
// Почему не только «ровность»: пики эквалайзер срезает, а провалы (антирезонансы) им не поднять —
// там, сколько ни добавляй усиления, звук гасится интерференцией. Поэтому для баса важнее, где провалов
// меньше, и особенно — внизу, где их нельзя прикрыть другими источниками и где пропадает «низ».
import type { BassObjective, Mode, ModePreset, Room } from './types';
import { flatnessScore } from './metric';
import { computeModes } from './modes';

/** Мелкая рябь не считается провалом, дБ. */
const DIP_TOL = 1;
/** Ограничение глубины одного провала, дБ: как в оценке ровности, чтобы одна точка не решала всё. */
const DIP_MAX = 25;
/**
 * Доля общей оценки провалов в целях «моды» и «широкие внизу»: многие места по главному признаку
 * одинаково хороши (оценка ≈ 0), и между ними выбираем то, где провалов меньше вообще.
 */
const BACKGROUND = 0.2;

export const OBJECTIVE_IDS = ['flat', 'dips', 'lowDips', 'wideLow', 'modes'] as const;
export const MODE_PRESETS: readonly ModePreset[] = ['first', 'axial', 'lowest', 'custom'];

export const DEFAULT_OBJECTIVE: BassObjective = { id: 'flat' };

export function isFlat(o: BassObjective | undefined): boolean {
  return !o || o.id === 'flat';
}

/** Вес моды по типу: осевые сильнее всего (≈ вдвое против касательных и вчетверо против косых). */
export function modeTypeWeight(m: Pick<Mode, 'kind'>): number {
  return m.kind === 'axial' ? 1 : m.kind === 'tangential' ? 0.5 : 0.25;
}

export interface ModeTarget {
  n: [number, number, number];
  f: number;
  w: number;
}

const sameN = (a: readonly number[], b: readonly number[]) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

/**
 * Моды, на которых не должно быть провала, с весами. Для комнаты со смежными помещениями частоты —
 * по основной комнате (приближённо: окно поиска провала — ±1/12 октавы).
 */
export function objectiveModes(room: Room, o: BassObjective, fLo: number, fHi: number): ModeTarget[] {
  const all = computeModes(room, Math.max(fHi, 40), 10).filter((m) => m.f >= fLo && m.f <= fHi);
  const preset = o.modePreset ?? 'first';
  let picked: ModeTarget[];
  if (preset === 'first') {
    // первая осевая мода по каждому размеру: длина, ширина, высота
    picked = ([[1, 0, 0], [0, 1, 0], [0, 0, 1]] as [number, number, number][])
      .map((n) => all.find((m) => sameN(m.n, n)))
      .filter((m): m is Mode => !!m)
      .map((m) => ({ n: m.n, f: m.f, w: 1 }));
  } else if (preset === 'axial') {
    // осевые до 150 Гц: первые гармоники важнее
    picked = all
      .filter((m) => m.kind === 'axial' && m.f <= 150)
      .map((m) => {
        const order = Math.max(...m.n);
        return { n: m.n, f: m.f, w: order === 1 ? 1 : order === 2 ? 0.6 : 0.4 };
      });
  } else if (preset === 'lowest') {
    picked = all.slice(0, 6).map((m) => ({ n: m.n, f: m.f, w: modeTypeWeight(m) }));
  } else {
    const want = o.modes ?? [];
    picked = all.filter((m) => want.some((n) => sameN(n, m.n))).map((m) => ({ n: m.n, f: m.f, w: modeTypeWeight(m) }));
  }
  return picked;
}

export type Scorer = (db: ArrayLike<number>, target: ArrayLike<number>) => number;

/** Медиана быстрым выбором (массив портится). */
function median(a: Float64Array, n: number): number {
  const k = n >> 1;
  let lo = 0, hi = n - 1;
  while (hi > lo) {
    const pivot = a[(lo + hi) >> 1];
    let i = lo, j = hi;
    while (i <= j) {
      while (a[i] < pivot) i++;
      while (a[j] > pivot) j--;
      if (i <= j) { const t = a[i]; a[i] = a[j]; a[j] = t; i++; j--; }
    }
    if (k <= j) hi = j;
    else if (k >= i) lo = i;
    else break;
  }
  return a[k];
}

/**
 * Оценка АЧХ по цели. freqs — сетка частот (логарифмическая), одинаковая для всех вызовов.
 * Опорный уровень для провалов — медиана отклонения от цели: пики (их срежет эквалайзер)
 * и сами провалы его не сдвигают.
 */
export function makeScorer(freqs: ArrayLike<number>, o: BassObjective | undefined, room?: Room): Scorer {
  if (isFlat(o)) return flatnessScore;
  const n = freqs.length;
  const fLo = freqs[0], fHi = freqs[n - 1];
  const dev = new Float64Array(n);
  const tmp = new Float64Array(n);
  const prepare = (db: ArrayLike<number>, target: ArrayLike<number>) => {
    for (let i = 0; i < n; i++) { const d = db[i] - target[i]; dev[i] = d; tmp[i] = d; }
    return median(tmp, n);
  };
  const dip = (ref: number, v: number) => Math.min(DIP_MAX, Math.max(0, ref - v - DIP_TOL));
  const weighted = (w: Float64Array, ref: number, vals: Float64Array) => {
    let s = 0, sw = 0;
    for (let i = 0; i < n; i++) { if (!w[i]) continue; const d = dip(ref, vals[i]); s += w[i] * d * d; sw += w[i]; }
    return sw ? Math.sqrt(s / sw) : 0;
  };
  const ones = new Float64Array(n).fill(1);
  const dipsAll = (db: ArrayLike<number>, target: ArrayLike<number>) => weighted(ones, prepare(db, target), dev);

  let id = o!.id;
  let targets: ModeTarget[] = [];
  if (id === 'modes') {
    targets = room ? objectiveModes(room, o!, fLo, fHi) : [];
    if (!targets.length) id = 'lowDips'; // в полосе нет выбранных мод — ищем просто меньше провалов внизу
  }

  if (id === 'dips') return dipsAll;

  if (id === 'lowDips') {
    // вес обратно пропорционален частоте: на нижней границе — 1, октавой выше — ½, двумя — ¼
    const w = Float64Array.from({ length: n }, (_, i) => fLo / freqs[i]);
    return (db, target) => weighted(w, prepare(db, target), dev);
  }

  if (id === 'wideLow') {
    // широкие провалы переживают сглаживание 1/3 октавы; вес — две нижние октавы, к нижней границе больше
    const win: [number, number][] = [];
    const half = Math.pow(2, 1 / 6);
    for (let i = 0; i < n; i++) {
      let a = i, b = i;
      while (a > 0 && freqs[a - 1] >= freqs[i] / half) a--;
      while (b < n - 1 && freqs[b + 1] <= freqs[i] * half) b++;
      win.push([a, b]);
    }
    const w = Float64Array.from({ length: n }, (_, i) => Math.max(0, 1 - Math.log2(freqs[i] / fLo) / 2));
    const sm = new Float64Array(n);
    return (db, target) => {
      const ref = prepare(db, target);
      for (let i = 0; i < n; i++) {
        let s = 0;
        const [a, b] = win[i];
        for (let j = a; j <= b; j++) s += dev[j];
        sm[i] = s / (b - a + 1);
      }
      const wide = weighted(w, ref, sm);
      const bg = weighted(ones, ref, dev);
      return Math.sqrt((1 - BACKGROUND) * wide * wide + BACKGROUND * bg * bg);
    };
  }

  // моды: уровень на частоте моды (интерполяция по логарифму частоты) против опорного
  const at = targets.map((t) => {
    let j = 0;
    while (j < n - 2 && freqs[j + 1] < t.f) j++;
    const u = Math.min(1, Math.max(0, Math.log(t.f / freqs[j]) / Math.log(freqs[j + 1] / freqs[j])));
    return { j, u, w: t.w };
  });
  const sw = at.reduce((s, t) => s + t.w, 0);
  return (db, target) => {
    const ref = prepare(db, target);
    let s = 0;
    for (const t of at) {
      const v = dev[t.j] * (1 - t.u) + dev[t.j + 1] * t.u;
      const d = dip(ref, v);
      s += t.w * d * d;
    }
    const modes = s / sw;
    const bg = weighted(ones, ref, dev);
    return Math.sqrt((1 - BACKGROUND) * modes + BACKGROUND * bg * bg);
  };
}

/** Нормализация цели из файла проекта: неизвестное — как «ровный бас». */
export function normalizeObjective(raw: unknown): BassObjective | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Partial<BassObjective>;
  if (!OBJECTIVE_IDS.includes(r.id as BassObjective['id'])) return undefined;
  const out: BassObjective = { id: r.id as BassObjective['id'] };
  if (MODE_PRESETS.includes(r.modePreset as ModePreset)) out.modePreset = r.modePreset;
  if (Array.isArray(r.modes)) {
    out.modes = r.modes
      .filter((n): n is [number, number, number] => Array.isArray(n) && n.length === 3 && n.every((v) => Number.isInteger(v) && v >= 0 && v < 50))
      .slice(0, 40);
  }
  return out;
}
