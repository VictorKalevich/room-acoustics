// Место для записи голоса: где встать и куда смотреть, чтобы комната меньше окрашивала голос в микрофоне.
//
// Модель (для каждого места рта S и направления взгляда u; микрофон M = S + d·u смотрит на рот):
//  • прямой звук и отражения методом мнимых источников до 2-го порядка в прямоугольной комнате; в точке
//    каждого отражения — поглощение того, что там: отделка стены, окно, дверь, панель, облако, мебель на полу;
//    проём и арка звук не возвращают; первые отражения от скоса — от наклонной плоскости;
//  • направленность голоса (голова и тело: назад на ВЧ тише на 10–20 дБ, на басу почти одинаково во все стороны);
//  • тело как препятствие: звук, пришедший к микрофону через голову или туловище, на ВЧ ослаблен;
//  • тело как отражатель: звук, вернувшийся от стены перед лицом, отражается от груди обратно в микрофон;
//  • микрофон — кардиоида или суперкардиоида (у суперкардиоиды узкий передний лепесток и задний −11 дБ);
//  • поздний хвост — статистически (Barron): энергия после первых двух отражений по RT60 комнаты, с учётом
//    направленности голоса и случайной чувствительности микрофона; на басу, ниже ~1,5·частоты Шрёдера, —
//    с модальным множителем: в углах и у стен моды возбуждаются и слышны сильнее, в узлах — слабее.
// Итог по полосам 1/6 октавы в выбранном диапазоне: уровень относительно прямого звука; оценка — неровность
// (СКО по полосам, дБ), как «Неровность АЧХ» на других экранах.
import type { Room, SurfaceId, Vec3, Zone } from './types';
import { speedOfSound } from './physics';
import { computeReverb, rt60At } from './reverb';
import { roomPatches, patchContains, cornerLegs, type Patch } from './patches';
import { alphaAt, getMaterial } from './materials';
import { prepareModes } from './response';
import { ceilingAt } from './geometry';

export type MicPattern = 'cardioid' | 'supercardioid';
export type Posture = 'standing' | 'sitting';
export interface VoiceSpot { x: number; y: number; facing: number }
export interface VoiceSettings {
  mic: MicPattern;
  /** От рта до микрофона, м. */
  distance: number;
  posture: Posture;
  /** Высота рта над полом, м. */
  mouthZ: number;
  /** Полоса, в которой оценивается окраска, Гц. */
  fLo: number;
  fHi: number;
  /** Где стоит исполнитель (рот, м) и куда смотрит (угол в плане: 0 — к задней стене, π/2 — к правой, π — к передней). */
  spot: VoiceSpot | null;
}

export const MOUTH_Z: Record<Posture, number> = { standing: 1.6, sitting: 1.2 };
export const VOICE_BAND: [number, number] = [80, 12000];
export const VOICE_DEFAULTS: VoiceSettings = { mic: 'cardioid', distance: 0.2, posture: 'standing', mouthZ: 1.6, fLo: 80, fHi: 12000, spot: null };
/** Направлений взгляда при поиске. */
export const FACINGS = 16;

const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : d);

/** Настройки из файла проекта: неизвестное и мусор — к значениям по умолчанию. */
export function normalizeVoice(raw: unknown): VoiceSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
  const posture: Posture = r.posture === 'sitting' ? 'sitting' : 'standing';
  let fLo = num(r.fLo, 20, 2000, VOICE_BAND[0]);
  let fHi = num(r.fHi, 200, 20000, VOICE_BAND[1]);
  if (fHi < fLo * 2) [fLo, fHi] = VOICE_BAND;
  const s = r.spot;
  const spot = s && typeof s === 'object' && [s.x, s.y, s.facing].every((v) => typeof v === 'number' && Number.isFinite(v)) ? { x: s.x, y: s.y, facing: s.facing } : null;
  return {
    mic: r.mic === 'supercardioid' ? 'supercardioid' : 'cardioid',
    distance: num(r.distance, 0.05, 0.6, VOICE_DEFAULTS.distance),
    posture,
    mouthZ: num(r.mouthZ, 0.6, 2.2, MOUTH_Z[posture]),
    fLo,
    fHi,
    spot,
  };
}

// ---------- направленности ----------

const OCT = [125, 250, 500, 1000, 2000, 4000, 8000, 16000];
/** Голос: насколько тише назад (180°), дБ — по измерениям речи и пения (Chu & Warnock 2002, Monson 2012). */
const VOICE_BACK_DB = [1, 3, 5, 8, 11, 14, 17, 20];
/** Отражение от тела (грудь, лицо, одежда), амплитуда. */
const BODY_R = [0.05, 0.1, 0.2, 0.3, 0.35, 0.3, 0.25, 0.2];
/** Мебель на полу (мягкая мебель, столы — в среднем): α по октавам 125…4000. */
const FURN_ALPHA = [0.1, 0.15, 0.25, 0.35, 0.45, 0.5, 0.5];

function octInterp(table: number[], f: number): number {
  if (f <= OCT[0]) return table[0];
  if (f >= OCT[OCT.length - 1]) return table[table.length - 1];
  let i = 0;
  while (f >= OCT[i + 1]) i++;
  const t = Math.log(f / OCT[i]) / Math.log(OCT[i + 1] / OCT[i]);
  return table[i] * (1 - t) + table[i + 1] * t;
}

/** Амплитудная направленность голоса под углом θ к направлению взгляда. */
export function voiceDir(cosT: number, backDb: number): number {
  return 10 ** ((-backDb * ((1 - cosT) / 2) ** 1.35) / 20);
}

/** Коэффициент направленности голоса Q = 4π / ∮D². */
function voiceQ(backDb: number): number {
  let s = 0;
  const n = 180;
  for (let i = 0; i < n; i++) {
    const t = ((i + 0.5) / n) * Math.PI;
    s += voiceDir(Math.cos(t), backDb) ** 2 * Math.sin(t) * (Math.PI / n);
  }
  return 2 / s;
}

const MIC_A: Record<MicPattern, number> = { cardioid: 0.5, supercardioid: 0.37 };
/** Чувствительность микрофона (амплитуда) к звуку под углом θ к оси; реальные нули — не глубже −26 дБ. */
export function micGain(p: MicPattern, cosT: number): number {
  const a = MIC_A[p];
  return Math.max(0.05, Math.abs(a + (1 - a) * cosT));
}
/** Чувствительность к диффузному полю (случайная эффективность): кардиоида 1/3, суперкардиоида ≈ 0,27. */
export function micREE(p: MicPattern): number {
  const a = MIC_A[p];
  return a * a + ((1 - a) * (1 - a)) / 3;
}

// ---------- геометрия ----------

type V = [number, number, number];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: V) => Math.hypot(a[0], a[1], a[2]);
const norm = (a: V): V => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/** Расстояние от точки до отрезка и параметр ближайшей точки. */
function segPoint(a: V, b: V, p: V): { d: number; t: number } {
  const ab = sub(b, a);
  const l2 = dot(ab, ab) || 1;
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2));
  return { d: len(sub(p, [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t])), t };
}

/** Кратчайшее расстояние между отрезками. */
function segSeg(p1: V, q1: V, p2: V, q2: V): number {
  const d1 = sub(q1, p1), d2 = sub(q2, p2), r = sub(p1, p2);
  const a = dot(d1, d1), e = dot(d2, d2), f = dot(d2, r);
  let s: number, t: number;
  const c = dot(d1, r), b = dot(d1, d2), den = a * e - b * b;
  s = den > 1e-12 ? Math.max(0, Math.min(1, (b * f - c * e) / den)) : 0;
  t = (b * s + f) / e;
  if (t < 0) { t = 0; s = Math.max(0, Math.min(1, -c / a)); } else if (t > 1) { t = 1; s = Math.max(0, Math.min(1, (b - c) / a)); }
  const c1: V = [p1[0] + d1[0] * s, p1[1] + d1[1] * s, p1[2] + d1[2] * s];
  const c2: V = [p2[0] + d2[0] * t, p2[1] + d2[1] * t, p2[2] + d2[2] * t];
  return len(sub(c1, c2));
}

/** Доля перекрытия: 1 — луч проходит сквозь препятствие радиуса r, 0 — мимо. */
const occl = (d: number, r: number) => Math.max(0, Math.min(1, (1.25 * r - d) / (0.5 * r)));
const ramp = (f: number, f0: number, f1: number) => Math.max(0, Math.min(1, Math.log(f / f0) / Math.log(f1 / f0)));

const fold = (v: number, L: number) => {
  const r = ((v % (2 * L)) + 2 * L) % (2 * L);
  return r <= L ? r : 2 * L - r;
};

// ---------- контекст расчёта ----------

export interface VoiceBands {
  /** Центры, нижние и верхние границы полос 1/6 октавы. */
  fc: number[];
  f1: number[];
  f2: number[];
}

export function voiceBands(fLo: number, fHi: number): VoiceBands {
  const L = Math.log2(fHi / fLo);
  const n = Math.max(3, Math.round(6 * L));
  const fc: number[] = [], f1: number[] = [], f2: number[] = [];
  for (let k = 0; k < n; k++) {
    fc.push(fLo * 2 ** (((k + 0.5) * L) / n));
    f1.push(fLo * 2 ** ((k * L) / n));
    f2.push(fLo * 2 ** (((k + 1) * L) / n));
  }
  return { fc, f1, f2 };
}

export interface VoiceCtx {
  room: Room;
  s: VoiceSettings;
  c: number;
  bands: VoiceBands;
  nb: number;
  /** Коэффициенты отражения (амплитуда, √(1 − α)) по полосам: отделка, участки, мебель на полу. */
  surf: Record<SurfaceId, Float64Array>;
  patches: { p: Patch; r: Float64Array | null }[];
  furniture: Zone[];
  furnR: Float64Array;
  voiceBack: Float64Array;
  /** Затухание голоса назад в неперах на полосу: D = exp(−voiceLn·((1 − cos θ)/2)^1,35). */
  voiceLn: Float64Array;
  bodyR: Float64Array;
  /** Тень головы и туловища в полосах при полном перекрытии, амплитуда. */
  headSh: Float64Array;
  torsoSh: Float64Array;
  /** Поздний хвост относительно прямого звука (без модального множителя). */
  late: Float64Array;
  /** Вес модального множителя по полосам (1 — бас, 0 — выше). */
  modalW: Float64Array;
  modal: ModalCtx | null;
}

interface ModalCtx {
  n: number;
  kx: Float64Array; ky: Float64Array; kz: Float64Array;
  /** K[m·nf + j] — комплексное ядро моды m на частоте j. */
  kre: Float64Array; kim: Float64Array;
  nf: number;
  /** Для каждой полосы — индексы частот (3 на полосу) и среднее |H|² по комнате. */
  bandFreqs: number[][];
  mean: Float64Array;
}

/** Готовит всё, что не зависит от места и направления. */
export function voiceContext(room: Room, s: VoiceSettings): VoiceCtx {
  const c = speedOfSound(room.temperatureC);
  const bands = voiceBands(s.fLo, s.fHi);
  const nb = bands.fc.length;
  const at = (fn: (f: number) => number) => Float64Array.from(bands.fc, fn);
  const refl = (a: readonly number[]) => at((f) => Math.sqrt(Math.max(0, 1 - alphaAt(a, f))));
  const surf = {} as Record<SurfaceId, Float64Array>;
  for (const id of ['floor', 'ceiling', 'front', 'back', 'left', 'right'] as SurfaceId[]) surf[id] = refl(getMaterial(room.materials[id]).alpha);
  const patches = roomPatches(room).flatMap((p) => (p.diag ? cornerLegs(room, p).map((q) => ({ ...q, alpha: p.alpha })) : [p]))
    .map((p) => ({ p, r: p.alpha ? refl(p.alpha) : null }));
  const rev = computeReverb(room);
  const V = rev.volume, S = rev.surfaceArea;
  const voiceBack = at((f) => octInterp(VOICE_BACK_DB, f));
  // поздняя энергия после времени t0 ≈ двух средних пробегов (Barron, «revised theory»),
  // относительно прямого звука на расстоянии d по оси голоса и микрофона
  const t0 = (2 * 4 * V) / (S * c);
  const ree = micREE(s.mic);
  const late = Float64Array.from(bands.fc, (f, k) => {
    const T = Math.max(0.05, rt60At(rev, f));
    return ((312 * T) / V) * s.distance ** 2 * Math.exp((-13.82 * t0) / T) * ree / voiceQ(voiceBack[k]);
  });
  const fM = Math.min(300, Math.max(150, 1.5 * rev.schroeder));
  const modalW = Float64Array.from(bands.fc, (f) => 1 - ramp(f, fM / 1.5, fM));
  const ctx: VoiceCtx = {
    room, s, c, bands, nb, surf, patches,
    furniture: (room.zones ?? []).filter((z) => z.kind === 'furniture'),
    furnR: refl(FURN_ALPHA),
    voiceBack,
    voiceLn: Float64Array.from(voiceBack, (b) => (b * Math.LN10) / 20),
    bodyR: at((f) => octInterp(BODY_R, f)),
    headSh: at((f) => 10 ** ((-12 * ramp(f, 300, 4000)) / 20)),
    torsoSh: at((f) => 10 ** ((-10 * ramp(f, 200, 3000)) / 20)),
    late,
    modalW,
    modal: null,
  };
  if (modalW.some((w) => w > 0)) ctx.modal = modalContext(ctx, rev, fM);
  return ctx;
}

function modalContext(ctx: VoiceCtx, rev: ReturnType<typeof computeReverb>, fM: number): ModalCtx {
  const pm = prepareModes(ctx.room, 1.25 * fM, rev);
  const freqs: number[] = [];
  const bandFreqs: number[][] = [];
  ctx.bands.fc.forEach((f, k) => {
    if (ctx.modalW[k] <= 0) { bandFreqs.push([]); return; }
    const idx: number[] = [];
    for (const m of [-1, 0, 1]) { idx.push(freqs.length); freqs.push(f * 2 ** (m / 18)); }
    bandFreqs.push(idx);
  });
  const nf = freqs.length, n = pm.count;
  const kre = new Float64Array(n * nf), kim = new Float64Array(n * nf);
  for (let m = 0; m < n; m++) {
    for (let j = 0; j < nf; j++) {
      const w = 2 * Math.PI * freqs[j];
      const dr = pm.omega2[m] - w * w, di = 2 * pm.delta[m] * w;
      const d = dr * dr + di * di;
      kre[m * nf + j] = (pm.invLambda[m] * dr) / d;
      kim[m * nf + j] = (-pm.invLambda[m] * di) / d;
    }
  }
  const mc: ModalCtx = { n, kx: pm.kx, ky: pm.ky, kz: pm.kz, kre, kim, nf, bandFreqs, mean: new Float64Array(ctx.nb).fill(1) };
  // среднее |H|² по комнате: места по сетке и разные направления
  const { depth: D, width: W } = ctx.room;
  const acc = new Float64Array(ctx.nb);
  let cnt = 0;
  for (let i = 0; i < 7; i++) {
    for (let j = 0; j < 7; j++) {
      const x = 0.4 + ((D - 0.8) * (i + 0.5)) / 7, y = 0.4 + ((W - 0.8) * (j + 0.5)) / 7;
      for (let q = 0; q < 4; q++) {
        const phi = (q * Math.PI) / 2 + 0.3;
        const h = modalPower(ctx, mc, [x, y, ctx.s.mouthZ], [x + ctx.s.distance * Math.cos(phi), y + ctx.s.distance * Math.sin(phi), ctx.s.mouthZ]);
        for (let k = 0; k < ctx.nb; k++) acc[k] += h[k];
        cnt++;
      }
    }
  }
  for (let k = 0; k < ctx.nb; k++) mc.mean[k] = acc[k] / cnt || 1;
  return mc;
}

function shapes(mc: ModalCtx, p: V): Float64Array {
  const o = new Float64Array(mc.n);
  for (let m = 0; m < mc.n; m++) o[m] = Math.cos(mc.kx[m] * p[0]) * Math.cos(mc.ky[m] * p[1]) * Math.cos(mc.kz[m] * p[2]);
  return o;
}

/** |H|² модальной суммы рот → микрофон, среднее по частотам полосы. */
function modalPower(ctx: VoiceCtx, mc: ModalCtx, src: V, rcv: V, psiS?: Float64Array): Float64Array {
  const a = psiS ?? shapes(mc, src), b = shapes(mc, rcv);
  const re = new Float64Array(mc.nf), im = new Float64Array(mc.nf);
  for (let m = 0; m < mc.n; m++) {
    const g = a[m] * b[m];
    if (g === 0) continue;
    const base = m * mc.nf;
    for (let j = 0; j < mc.nf; j++) { re[j] += g * mc.kre[base + j]; im[j] += g * mc.kim[base + j]; }
  }
  const out = new Float64Array(ctx.nb);
  mc.bandFreqs.forEach((idx, k) => {
    if (!idx.length) return;
    let s = 0;
    for (const j of idx) s += re[j] * re[j] + im[j] * im[j];
    out[k] = s / idx.length;
  });
  return out;
}

// ---------- пути звука ----------

export type VoiceSurface = SurfaceId | 'slope';

export interface VoicePath {
  /** Амплитуда относительно прямого звука по полосам. */
  amp: Float64Array;
  /** Задержка относительно прямого звука, с. */
  delay: number;
  order: number;
  /** Для первого отражения: поверхность и точка. */
  surface?: VoiceSurface;
  point?: Vec3;
  on?: 'window' | 'door' | 'opening' | 'treatment' | 'furniture' | null;
  /** Вернулся от стены к телу и отразился от него в микрофон. */
  body?: boolean;
}

const SURF_OF: [SurfaceId, SurfaceId][] = [['front', 'back'], ['left', 'right'], ['floor', 'ceiling']];

/** Мнимые источники до 2-го порядка: по каждой оси (m, p, отражений) → координата (1 − 2p)·s + 2m·L. */
const AXIS_OPTS: [number, number, number][] = [[0, 0, 0], [0, 1, 1], [1, 1, 1], [1, 0, 2], [-1, 0, 2]];
const IMAGES = AXIS_OPTS.flatMap((ox) => AXIS_OPTS.flatMap((oy) => AXIS_OPTS.map((oz) => ({ o: [ox, oy, oz], order: ox[2] + oy[2] + oz[2] }))))
  .filter((x) => x.order > 0 && x.order <= 2);

/** Коэффициент отражения точки поверхности по полосам (null — проём: отражения нет) и что там. */
function reflAtPoint(ctx: VoiceCtx, surface: SurfaceId, p: V): { r: Float64Array | null; on: VoicePath['on'] } {
  const u = surface === 'front' || surface === 'back' ? p[1] : p[0];
  const v = surface === 'floor' || surface === 'ceiling' ? p[1] : p[2];
  let r: Float64Array = ctx.surf[surface];
  let on: VoicePath['on'] = null;
  for (const { p: pt, r: pr } of ctx.patches) {
    if (!patchContains(pt, surface, u, v)) continue;
    if (!pr) return { r: null, on: 'opening' };
    if (pt.kind === 'treatment') {
      if (on !== 'window' && on !== 'door') on = 'treatment';
      r = Float64Array.from(r, (x, k) => Math.min(x, pr[k]));
    } else {
      on = pt.kind as 'window' | 'door';
      r = pr;
    }
  }
  if (surface === 'floor' && ctx.furniture.some((z) => p[0] >= z.x0 && p[0] <= z.x1 && p[1] >= z.y0 && p[1] <= z.y1)) {
    r = Float64Array.from(r, (x, k) => Math.min(x, ctx.furnR[k]));
    on = 'furniture';
  }
  return { r, on };
}

interface Geo { S: V; M: V; u: V; head: V; t0: V; t1: V; chest: V; d: number }

function geometry(ctx: VoiceCtx, x: number, y: number, facing: number): Geo {
  const z = ctx.s.mouthZ, d = ctx.s.distance;
  const u: V = [Math.cos(facing), Math.sin(facing), 0];
  const S: V = [x, y, z];
  const M: V = [x + d * u[0], y + d * u[1], z];
  const back = (k: number, dz: number): V => [x - k * u[0], y - k * u[1], z + dz];
  return { S, M, u, d, head: back(0.08, 0.04), chest: back(0.12, -0.3), t0: back(0.12, -0.2), t1: back(0.12, -Math.min(z - 0.05, 0.85)) };
}

/** Тень тела для отрезка последнего пути Q → M, по полосам (амплитуда). */
function shadow(ctx: VoiceCtx, g: Geo, Q: V, out: Float64Array) {
  const sh = occl(segPoint(Q, g.M, g.head).d, 0.1);
  const st = occl(segSeg(Q, g.M, g.t0, g.t1), 0.17);
  if (sh <= 0 && st <= 0) return;
  for (let k = 0; k < out.length; k++) out[k] *= Math.max(0.16, ctx.headSh[k] ** sh * ctx.torsoSh[k] ** st);
}

/** Все пути звука для места и направления. */
export function voicePaths(ctx: VoiceCtx, x: number, y: number, facing: number): VoicePath[] {
  const g = geometry(ctx, x, y, facing);
  const { room, nb, s } = ctx;
  const Ls: V = [room.depth, room.width, room.height];
  const out: VoicePath[] = [{ amp: new Float64Array(nb).fill(1), delay: 0, order: 0 }];
  // мнимые источники до 2-го порядка: по каждой оси (m, p) → координата (1 − 2p)·s + 2m·L
  const micAxis = norm(sub(g.S, g.M));
  for (const { o, order } of IMAGES) {
    const I: V = [0, 0, 0];
    for (let a = 0; a < 3; a++) I[a] = (1 - 2 * o[a][1]) * g.S[a] + 2 * o[a][0] * Ls[a];
    const L = len(sub(I, g.M));
    // пересечения прямой M → I с плоскостями стен (в развёрнутом пространстве)
    const cross: { t: number; axis: number; wall: 0 | 1 }[] = [];
    for (let a = 0; a < 3; a++) {
      const m0 = g.M[a], i0 = I[a];
      if (Math.abs(i0 - m0) < 1e-12) continue;
      const lo = Math.min(m0, i0), hi = Math.max(m0, i0);
      for (let k = Math.ceil(lo / Ls[a] - 1e-9); k * Ls[a] <= hi + 1e-9; k++) {
        const plane = k * Ls[a];
        if (plane <= lo + 1e-9 || plane >= hi - 1e-9) continue;
        cross.push({ t: (plane - m0) / (i0 - m0), axis: a, wall: (Math.abs(k) % 2) as 0 | 1 });
      }
    }
    if (cross.length !== order) continue;
    cross.sort((p, q) => p.t - q.t);
    const amp = new Float64Array(nb).fill(s.distance / L);
    let ok = true;
    const pts: V[] = [];
    let first: { surface: SurfaceId; on: VoicePath['on'] } | null = null;
    for (const c of cross) {
      const P: V = [fold(g.M[0] + (I[0] - g.M[0]) * c.t, Ls[0]), fold(g.M[1] + (I[1] - g.M[1]) * c.t, Ls[1]), fold(g.M[2] + (I[2] - g.M[2]) * c.t, Ls[2])];
      P[c.axis] = c.wall ? Ls[c.axis] : 0;
      const surface = SURF_OF[c.axis][c.wall];
      // потолок над скосом — не плоский: это отражение считается ниже, от наклонной плоскости
      if (surface === 'ceiling' && room.slope && ceilingAt(room, P[0], P[1]) < room.height - 1e-6) { ok = false; break; }
      const { r, on } = reflAtPoint(ctx, surface, P);
      if (!r) { ok = false; break; }
      for (let k = 0; k < nb; k++) amp[k] *= r[k];
      pts.push(P);
      if (order === 1) first = { surface, on };
    }
    if (!ok) continue;
    // направление излучения — к первой точке отражения (последней по t), прихода — от ближней к микрофону
    const emit = norm(sub(pts[pts.length - 1], g.S));
    const arrive = norm(sub(pts[0], g.M));
    const ce = dot(emit, g.u), ca = dot(arrive, micAxis);
    const mg = micGain(s.mic, ca);
    const w = ((1 - ce) / 2) ** 1.35;
    for (let k = 0; k < nb; k++) amp[k] *= Math.exp(-ctx.voiceLn[k] * w) * mg;
    shadow(ctx, g, pts[0], amp);
    const path: VoicePath = { amp, delay: (L - s.distance) / ctx.c, order };
    if (first) Object.assign(path, { surface: first.surface, point: { x: pts[0][0], y: pts[0][1], z: pts[0][2] }, on: first.on });
    out.push(path);
  }
  // первое отражение от скоса
  if (room.slope) {
    const sp = slopePath(ctx, g, micAxis);
    if (sp) out.push(sp);
  }
  // звук, вернувшийся к телу от поверхностей перед лицом, отражается от груди в микрофон
  for (const p of out.filter((q) => q.order === 1 && q.point)) {
    const P: V = [p.point!.x, p.point!.y, p.point!.z];
    const toP = norm(sub(P, g.chest));
    const facingW = dot(toP, g.u);
    if (facingW <= 0.1) continue;
    const L = len(sub(P, g.S)) + len(sub(P, g.chest)) + len(sub(g.M, g.chest));
    const emit = norm(sub(P, g.S));
    const ce = dot(emit, g.u);
    const mg = micGain(s.mic, dot(norm(sub(g.chest, g.M)), micAxis));
    const { r } = p.surface === 'slope' ? { r: ctx.surf.ceiling } : reflAtPoint(ctx, p.surface as SurfaceId, P);
    if (!r) continue;
    const w = ((1 - ce) / 2) ** 1.35;
    const amp = Float64Array.from(ctx.bands.fc, (_, k) => (s.distance / L) * r[k] * Math.exp(-ctx.voiceLn[k] * w) * ctx.bodyR[k] * facingW * mg);
    out.push({ amp, delay: (L - s.distance) / ctx.c, order: 2, surface: p.surface, point: p.point, on: p.on, body: true });
  }
  return out;
}

/** Отражение от наклонной плоскости скоса (только первое). */
function slopePath(ctx: VoiceCtx, g: Geo, micAxis: V): VoicePath | null {
  const { room, s } = ctx;
  const sl = room.slope!;
  // плоскость через линию у стены (высота low) и линию на расстоянии run (полная высота)
  const n2: Record<string, V> = { front: [1, 0, 0], back: [-1, 0, 0], left: [0, 1, 0], right: [0, -1, 0] };
  const inw = n2[sl.wall];
  const w0: V = sl.wall === 'front' ? [0, 0, sl.low] : sl.wall === 'back' ? [room.depth, 0, sl.low] : sl.wall === 'left' ? [0, 0, sl.low] : [0, room.width, sl.low];
  // направление вверх по скосу: inw·run + z·(H − low); нормаль вниз внутрь комнаты
  const up: V = norm([inw[0] * sl.run, inw[1] * sl.run, room.height - sl.low]);
  const along: V = sl.wall === 'front' || sl.wall === 'back' ? [0, 1, 0] : [1, 0, 0];
  let n: V = norm([along[1] * up[2] - along[2] * up[1], along[2] * up[0] - along[0] * up[2], along[0] * up[1] - along[1] * up[0]]);
  if (n[2] > 0) n = [-n[0], -n[1], -n[2]];
  const dist = dot(sub(g.S, w0), n);
  if (dist <= 0) return null;
  const I: V = [g.S[0] - 2 * dist * n[0], g.S[1] - 2 * dist * n[1], g.S[2] - 2 * dist * n[2]];
  const dm = dot(sub(g.M, w0), n);
  const di = dot(sub(I, w0), n);
  if (dm <= 0 || di >= 0) return null;
  const t = dm / (dm - di);
  const P: V = [g.M[0] + (I[0] - g.M[0]) * t, g.M[1] + (I[1] - g.M[1]) * t, g.M[2] + (I[2] - g.M[2]) * t];
  const dWall = sl.wall === 'front' ? P[0] : sl.wall === 'back' ? room.depth - P[0] : sl.wall === 'left' ? P[1] : room.width - P[1];
  if (dWall < 0 || dWall > sl.run || P[0] < 0 || P[0] > room.depth || P[1] < 0 || P[1] > room.width) return null;
  const L = len(sub(I, g.M));
  const r = ctx.surf.ceiling;
  const emit = norm(sub(P, g.S)), arrive = norm(sub(P, g.M));
  const mg = micGain(s.mic, dot(arrive, micAxis));
  const w = ((1 - dot(emit, g.u)) / 2) ** 1.35;
  const amp = Float64Array.from(ctx.bands.fc, (_, k) => (s.distance / L) * r[k] * Math.exp(-ctx.voiceLn[k] * w) * mg);
  shadow(ctx, g, P, amp);
  return { amp, delay: (L - s.distance) / ctx.c, order: 1, surface: 'slope', point: { x: P[0], y: P[1], z: P[2] }, on: null };
}

// ---------- оценка ----------

export interface VoiceEval {
  /** Неровность АЧХ голоса в микрофоне (СКО уровня по полосам), дБ. */
  score: number;
  /** Уровень по полосам относительно прямого звука, дБ. */
  f: number[];
  db: number[];
  /** Всё, что приносит комната (отражения и хвост), относительно прямого звука, дБ. */
  roomDb: number;
  /** Первые отражения (и отражения от тела) с уровнем в полосе, дБ, и задержкой, мс. */
  reflections: { surface: VoiceSurface; point: Vec3; db: number; ms: number; on: VoicePath['on']; body: boolean }[];
}

/** Мощность по полосам: |Σ aᵢ e^{−jωτᵢ}|², усреднённая по полосе, + поздний хвост. */
function bandPower(ctx: VoiceCtx, paths: VoicePath[], modalG: Float64Array | null): { p: Float64Array; refl: Float64Array } {
  const { nb, bands } = ctx;
  const p = new Float64Array(nb), refl = new Float64Array(nb);
  const strong = paths.map((q) => { let m = 0; for (let k = 0; k < nb; k++) m = Math.max(m, q.amp[k]); return m; });
  for (let k = 0; k < nb; k++) {
    let e = 0;
    for (let i = 1; i < paths.length; i++) e += paths[i].amp[k] ** 2;
    refl[k] = e;
    p[k] = 1 + e;
  }
  const w1 = 2 * Math.PI;
  for (let i = 0; i < paths.length; i++) {
    for (let j = i + 1; j < paths.length; j++) {
      if (strong[i] * strong[j] < 2e-3) continue;
      const dt = paths[i].delay - paths[j].delay;
      for (let k = 0; k < nb; k++) {
        const a = paths[i].amp[k] * paths[j].amp[k];
        if (a < 1e-5) continue;
        // среднее cos(ω·dt) по полосе [f1, f2]
        const x1 = w1 * bands.f1[k] * dt, x2 = w1 * bands.f2[k] * dt;
        const avg = Math.abs(x2 - x1) < 1e-6 ? Math.cos((x1 + x2) / 2) : (Math.sin(x2) - Math.sin(x1)) / (x2 - x1);
        p[k] += 2 * a * avg;
      }
    }
  }
  for (let k = 0; k < nb; k++) {
    const g = modalG ? 1 + ctx.modalW[k] * (modalG[k] - 1) : 1;
    const lt = ctx.late[k] * g;
    p[k] = Math.max(1e-4, p[k]) + lt;
    refl[k] += lt;
  }
  return { p, refl };
}

function modalGain(ctx: VoiceCtx, g: Geo, psiS?: Float64Array): Float64Array | null {
  const mc = ctx.modal;
  if (!mc) return null;
  const h = modalPower(ctx, mc, g.S, g.M, psiS);
  return Float64Array.from(h, (v, k) => (ctx.modalW[k] > 0 ? v / mc.mean[k] : 1));
}

const std = (v: ArrayLike<number>) => {
  let m = 0;
  for (let i = 0; i < v.length; i++) m += v[i];
  m /= v.length;
  let s = 0;
  for (let i = 0; i < v.length; i++) s += (v[i] - m) ** 2;
  return Math.sqrt(s / v.length);
};

/** Подробная оценка одного места и направления. */
export function evaluateVoice(ctx: VoiceCtx, spot: VoiceSpot): VoiceEval {
  const g = geometry(ctx, spot.x, spot.y, spot.facing);
  const paths = voicePaths(ctx, spot.x, spot.y, spot.facing);
  const { p, refl } = bandPower(ctx, paths, modalGain(ctx, g));
  const db = Array.from(p, (v) => 10 * Math.log10(v));
  const meanRefl = refl.reduce((a, v) => a + v, 0) / refl.length;
  const bandDb = (amp: Float64Array) => 10 * Math.log10(amp.reduce((a, v) => a + v * v, 0) / amp.length || 1e-12);
  return {
    score: std(db),
    f: ctx.bands.fc,
    db,
    roomDb: 10 * Math.log10(meanRefl),
    reflections: paths
      .filter((q) => q.point && (q.order === 1 || q.body))
      .map((q) => ({ surface: q.surface!, point: q.point!, db: bandDb(q.amp), ms: q.delay * 1000, on: q.on ?? null, body: !!q.body }))
      .sort((a, b) => b.db - a.db),
  };
}

/** Можно ли здесь стоять: не у самой стены, не в мебели и других зонах; микрофон — в комнате. */
export function spotAllowed(room: Room, x: number, y: number, facing: number, s: VoiceSettings): boolean {
  const body = 0.3;
  if (x < body || y < body || x > room.depth - body || y > room.width - body) return false;
  const mx = x + s.distance * Math.cos(facing), my = y + s.distance * Math.sin(facing);
  if (mx < 0.08 || my < 0.08 || mx > room.depth - 0.08 || my > room.width - 0.08) return false;
  const pad = 0.2;
  return !(room.zones ?? []).some((z) => x > z.x0 - pad && x < z.x1 + pad && y > z.y0 - pad && y < z.y1 + pad);
}

export interface VoiceMap {
  goal: VoiceGoal;
  x0: number; y0: number; step: number; nx: number; ny: number;
  /** Лучшая оценка в узле (по всем направлениям); NaN — здесь не встать. */
  scores: Float32Array;
  /** Лучшее направление в узле, рад. */
  facing: Float32Array;
  allowed: Uint8Array;
  best: { x: number; y: number; facing: number; score: number }[];
  min: number;
  max: number;
}

export const facingAngle = (i: number) => (i * 2 * Math.PI) / FACINGS;

/** Only the ranking changes; both metrics use the existing acoustic calculation. */
export type VoiceGoal = 'flatness' | 'room';
function voiceMapScore(p: Float64Array, refl: Float64Array, goal: VoiceGoal): number {
  return goal === 'room'
    ? 10 * Math.log10(refl.reduce((sum, value) => sum + value, 0) / refl.length)
    : std(Array.from(p, (w) => 10 * Math.log10(w)));
}

/** Карта: в каждом узле — лучшее из 16 направлений. */
export function voiceMap(room: Room, s: VoiceSettings, onProgress?: (v: number) => void, goal: VoiceGoal = 'flatness'): VoiceMap {
  const ctx = voiceContext(room, s);
  const area = room.depth * room.width;
  const step = Math.max(0.15, Math.ceil(Math.sqrt(area / 320) * 20) / 20);
  const nx = Math.max(1, Math.floor(room.depth / step)), ny = Math.max(1, Math.floor(room.width / step));
  const x0 = (room.depth - (nx - 1) * step) / 2, y0 = (room.width - (ny - 1) * step) / 2;
  const scores = new Float32Array(nx * ny).fill(NaN), facing = new Float32Array(nx * ny), allowed = new Uint8Array(nx * ny);
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      const x = x0 + i * step, y = y0 + j * step;
      const psiS = ctx.modal ? shapes(ctx.modal, [x, y, s.mouthZ]) : undefined;
      let best = Infinity, bf = 0;
      for (let q = 0; q < FACINGS; q++) {
        const phi = facingAngle(q);
        if (!spotAllowed(room, x, y, phi, s)) continue;
        const g = geometry(ctx, x, y, phi);
        const { p, refl } = bandPower(ctx, voicePaths(ctx, x, y, phi), modalGain(ctx, g, psiS));
        const v = voiceMapScore(p, refl, goal);
        if (v < best) { best = v; bf = phi; }
      }
      if (Number.isFinite(best)) { scores[i * ny + j] = best; facing[i * ny + j] = bf; allowed[i * ny + j] = 1; }
    }
    onProgress?.((i + 1) / nx);
  }
  const nodes = Array.from(scores, (v, k) => ({ v, k })).filter((n) => Number.isFinite(n.v)).sort((a, b) => a.v - b.v);
  const best: VoiceMap['best'] = [];
  for (const n of nodes) {
    const x = x0 + Math.floor(n.k / ny) * step, y = y0 + (n.k % ny) * step;
    if (best.some((b) => Math.hypot(b.x - x, b.y - y) < 0.6)) continue;
    best.push({ x, y, facing: facing[n.k], score: n.v });
    if (best.length === 3) break;
  }
  const fin = nodes.map((n) => n.v);
  return { goal, x0, y0, step, nx, ny, scores, facing, allowed, best, min: fin.length ? fin[0] : 0, max: fin.length ? fin[fin.length - 1] : 0 };
}

/** Направление взгляда словами: к какой стене или в какой угол. */
export function facingName(facing: number): string {
  const a = ((Math.round((facing * 4) / Math.PI) % 8) + 8) % 8; // 0 — к задней, 2 — к правой, 4 — к передней, 6 — к левой
  return ['к задней стене', 'в задний правый угол', 'к правой стене', 'в передний правый угол', 'к передней стене (к колонкам)', 'в передний левый угол', 'к левой стене', 'в задний левый угол'][a];
}

/** Где отражающая поверхность относительно исполнителя. */
export function relativeSide(spot: VoiceSpot, p: Vec3, surface: VoiceSurface): 'front' | 'back' | 'left' | 'right' | 'up' | 'down' {
  if (surface === 'floor') return 'down';
  if (surface === 'ceiling' || surface === 'slope') return 'up';
  const u = [Math.cos(spot.facing), Math.sin(spot.facing)];
  const v = [p.x - spot.x, p.y - spot.y];
  const l = Math.hypot(v[0], v[1]) || 1;
  const c = (u[0] * v[0] + u[1] * v[1]) / l;
  if (c > 0.7) return 'front';
  if (c < -0.7) return 'back';
  // левая рука: z × u = (−uy, ux)
  return -u[1] * v[0] + u[0] * v[1] > 0 ? 'left' : 'right';
}

/** Оценки всех 16 направлений в одном месте (NaN — так не встать: микрофон у стены). */
export function facingScores(ctx: VoiceCtx, x: number, y: number, goal: VoiceGoal = 'flatness'): number[] {
  const g0 = geometry(ctx, x, y, 0);
  const psiS = ctx.modal ? shapes(ctx.modal, g0.S) : undefined;
  return Array.from({ length: FACINGS }, (_, q) => {
    const phi = facingAngle(q);
    if (!spotAllowed(ctx.room, x, y, phi, ctx.s)) return NaN;
    const { p, refl } = bandPower(ctx, voicePaths(ctx, x, y, phi), modalGain(ctx, geometry(ctx, x, y, phi), psiS));
    return voiceMapScore(p, refl, goal);
  });
}

/** Степень неровности спектра; не оценивает количество реверберации. */
export function voiceGrade(v: number): 'good' | 'mid' | 'bad' {
  return v < 0.5 ? 'good' : v < 1 ? 'mid' : 'bad';
}
