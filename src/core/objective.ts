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
 * Мода системы «комната + смежные помещения» из волнового расчёта: частота, доля энергии в основной комнате
 * и на какие моды основной комнаты похожа форма поля (MAC, см. systemModes).
 */
export interface SysModeLike {
  f: number;
  roomShare: number;
  like?: readonly { n: readonly number[]; mac: number }[];
}

/** Верхняя частота расчёта мод системы: выше 150 Гц моды идут густо, и их сдвиг проёмом не важен. */
export const SYS_MODES_FMAX = 160;

/**
 * Сколько энергии моды системы должно приходиться на комнату: при сравнении по форме — от 30 % (первая по ширине
 * у коридора вдоль стены уходит в коридор почти наполовину: 49 % в комнате, MAC 0,64), без сведений о форме — от 50 %.
 */
const SYS_ROOM_SHARE = 0.3;
const SYS_ROOM_SHARE_NEAR = 0.5;
/** Форма похожа на моду комнаты, если MAC ≥ 0,5 (у слившихся мод — около 0,5 у каждой, у чужих — меньше 0,2). */
const SYS_MAC_MIN = 0.5;
/** Без сведений о форме (старые расчёты) — ближайшая мода системы в пределах ±3 полутонов. */
const SYS_SHIFT_NEAR = Math.pow(2, 3 / 12);
/** Как далеко может уйти мода из-за проёма: широкая арка в нишу опускает первую по глубине почти на 7 полутонов. */
const SYS_SHIFT_MAX = Math.pow(2, 7 / 12);

/**
 * Частоты мод основной комнаты в системе с проёмом: мода системы, форма поля которой в комнате больше
 * всего похожа на эту моду (MAC ≥ 0,5, ≥ 30 % энергии в комнате). Проём сдвигает моды на 0,5–3 полутона,
 * а широкая арка — и дальше; ближайшая по частоте мода часто чужая (например, ширина вместо глубины).
 * Не нашлось похожей — остаётся частота по основной комнате.
 */
export function shiftModesToSystem(modes: readonly { n: readonly number[]; f: number }[], sys: readonly SysModeLike[] | undefined): number[] {
  const out = modes.map((m) => m.f);
  if (!sys?.length) return out;
  const shapes = sys.some((s) => s.like);
  const own = sys.filter((s) => s.roomShare >= (shapes ? SYS_ROOM_SHARE : SYS_ROOM_SHARE_NEAR));
  modes.forEach((m, i) => {
    let best = -1;
    let bestV = shapes ? SYS_MAC_MIN : -Math.log(SYS_SHIFT_NEAR) - 1e-9;
    for (const s of own) {
      const d = Math.abs(Math.log(s.f / m.f));
      if (d > Math.log(SYS_SHIFT_MAX)) continue;
      const v = shapes ? (s.like?.find((l) => sameN(l.n, m.n))?.mac ?? 0) : -d;
      if (v >= bestV) { bestV = v; best = s.f; }
    }
    if (best > 0) out[i] = best;
  });
  return out;
}

/**
 * Моды, на которых не должно быть провала, с весами. Для комнаты со смежными помещениями (sys — моды
 * системы из волнового расчёта) частоты — настоящие, по форме поля, см. shiftModesToSystem.
 */
export function objectiveModes(room: Room, o: BassObjective, fLo: number, fHi: number, sys?: readonly SysModeLike[]): ModeTarget[] {
  // сдвиг — до отбора по полосе и выбора «низших»: мода у края полосы может уйти внутрь или наружу
  const box = computeModes(room, Math.max(fHi * (sys?.length ? SYS_SHIFT_MAX : 1), 40), 10);
  const fs = shiftModesToSystem(box, sys);
  const all = box
    .map((m, i) => ({ ...m, f: fs[i] }))
    .filter((m) => m.f >= fLo && m.f <= fHi)
    .sort((a, b) => a.f - b.f);
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
 * Шаг сетки частот (точек на октаву) для оценки по цели. Провалы оцениваются по АЧХ, усреднённой
 * по энергии в пределах полутона (±1/24 октавы); для этого нужно ≥ 3 точек на полутон, т. е. 24 на октаву.
 * На сетке 1/12 октавы узкий провал попадает в точку или между точками случайно — и подбор
 * «прятал» провалы между точками (проверка полным перебором: до 0,5 дБ хуже при точной оценке).
 */
export function objectivePpo(o: BassObjective | undefined, flatPpo: number): number {
  return isFlat(o) ? flatPpo : Math.max(24, flatPpo);
}

/** Полуширина окна усреднения: полутон — нота; более узкие нули не забирают целую ноту и смещаются при повороте головы. */
const SEMITONE_HALF = Math.pow(2, 1 / 24);

/**
 * Оценка АЧХ по цели. freqs — сетка частот (логарифмическая), одинаковая для всех вызовов.
 * Опорный уровень для провалов — медиана отклонения от цели: пики (их срежет эквалайзер)
 * и сами провалы его не сдвигают. Уровни сначала усредняются по энергии в полосе полутона.
 */
export function makeScorer(freqs: ArrayLike<number>, o: BassObjective | undefined, room?: Room, sys?: readonly SysModeLike[]): Scorer {
  if (isFlat(o)) return flatnessScore;
  const n = freqs.length;
  const fLo = freqs[0], fHi = freqs[n - 1];
  const dev = new Float64Array(n);
  const tmp = new Float64Array(n);
  const pw = new Float64Array(n);
  // окна полутона: индексы a..b вокруг каждой точки
  const wa = new Int32Array(n), wb = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    let a = i, b = i;
    while (a > 0 && freqs[a - 1] >= freqs[i] / SEMITONE_HALF * 0.9999) a--;
    while (b < n - 1 && freqs[b + 1] <= freqs[i] * SEMITONE_HALF * 1.0001) b++;
    wa[i] = a; wb[i] = b;
  }
  const prepare = (db: ArrayLike<number>, target: ArrayLike<number>) => {
    for (let i = 0; i < n; i++) pw[i] = Math.pow(10, db[i] / 10);
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let j = wa[i]; j <= wb[i]; j++) s += pw[j];
      const d = 10 * Math.log10(Math.max(s / (wb[i] - wa[i] + 1), 1e-30)) - target[i];
      dev[i] = d;
      tmp[i] = d;
    }
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
    targets = room ? objectiveModes(room, o!, fLo, fHi, sys) : [];
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
