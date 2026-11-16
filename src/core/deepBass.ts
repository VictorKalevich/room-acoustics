// Спад источника по паспорту (044, у колонок — 045) и план расчёта цели подбора «Глубже низ» (044).
// Паспорт читают только эта цель и график «Расстановки» ниже полосы оценки (045): «Диапазон» источников и другие
// расчёты от паспорта не зависят.
import type { BassObjective, Complex, DeepDrop, Enclosure, SourceSpec, Passport } from './types';
import { cmul } from './frequency';

export const DEEP_DROPS: readonly DeepDrop[] = [3, 6, 10];
export const DEFAULT_DROP: DeepDrop = 6;
/** Частота цели, Гц: ниже 20 Гц приложение не считает, выше 60 Гц — уже не самый низ. */
export const DEEP_HZ_MIN = 20;
export const DEEP_HZ_MAX = 60;
/** Частоты паспорта, Гц. */
export const PASSPORT_MIN = 10;
export const PASSPORT_MAX = 200;
/** Наибольший порядок спада по двум точкам: 72 дБ на октаву (две точки почти совпадают). */
const ORDER_MAX = 12;
/** У Баттерворта на уровне −L дБ (fc/f)^(2N) = 10^(L/10) − 1; отношение для −10 и −3 дБ. */
const K_10_3 = Math.log(9 / (Math.pow(10, 0.3) - 1));

/** Спад снизу: фильтр верхних частот Баттерворта порядка order с частотой среза fc (−3 дБ). */
export interface Rolloff {
  order: number;
  fc: number;
}

/** По чему построен спад: две точки, точка −10 дБ, точка −3 дБ или нижняя граница «Диапазона». */
export type RolloffBy = 'both' | 'f10' | 'f3' | 'range';

/** Порядок спада по корпусу: закрытый — 2-й (12 дБ на октаву), фазоинвертор — 4-й (24 дБ на октаву). */
export function boxOrder(box: Enclosure | undefined): number {
  return box === 'sealed' ? 2 : 4;
}

/**
 * Фильтр верхних частот Баттерворта порядка order: звенья s²/(s² + s/Q_k + 1), Q_k = 1/(2·sin((2k − 1)π/(2N))),
 * при нечётном порядке — звено s/(s + 1); s = j·f/fc. На fc — −3,01 дБ, далеко ниже — 6·N дБ на октаву.
 */
export function butterworthHp(order: number, fc: number, f: number): Complex {
  const w = f / fc;
  let h: Complex = { re: 1, im: 0 };
  for (let k = 1; k <= Math.floor(order / 2); k++) {
    const q = 1 / (2 * Math.sin(((2 * k - 1) * Math.PI) / (2 * order)));
    const dr = 1 - w * w;
    const di = w / q;
    const d = dr * dr + di * di;
    const nr = -w * w;
    h = cmul(h, { re: (nr * dr) / d, im: (-nr * di) / d });
  }
  if (order % 2) {
    const d = 1 + w * w;
    h = cmul(h, { re: (w * w) / d, im: w / d });
  }
  return h;
}

const okHz = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= PASSPORT_MIN && v <= PASSPORT_MAX;

/**
 * Спад источника по паспорту (data-model 044): обе точки (−10 дБ ниже −3 дБ) — порядок по ним; одна точка — порядок
 * по корпусу; без паспорта — по корпусу от нижней границы «Диапазона». −10 дБ, если указана, — ровно на своей частоте.
 * conflict — точка −10 дБ не ниже точки −3 дБ: взята только точка −10 дБ.
 */
export function passportRolloff(s: SourceSpec): Rolloff & { by: RolloffBy; conflict: boolean } {
  const p = s.passport ?? {};
  const f3 = okHz(p.f3) ? p.f3 : undefined;
  const f10 = okHz(p.f10) ? p.f10 : undefined;
  const nBox = boxOrder(p.box);
  const at10 = (order: number) => f10! * Math.pow(9, 1 / (2 * order));
  if (f3 !== undefined && f10 !== undefined && f10 < f3) {
    const order = Math.max(1, Math.min(ORDER_MAX, Math.round(K_10_3 / (2 * Math.log(f3 / f10)))));
    return { order, fc: at10(order), by: 'both', conflict: false };
  }
  if (f10 !== undefined) return { order: nBox, fc: at10(nBox), by: 'f10', conflict: f3 !== undefined };
  if (f3 !== undefined) return { order: nBox, fc: f3, by: 'f3', conflict: false };
  return { order: nBox, fc: s.fLow, by: 'range', conflict: false };
}

/** Частота, на которой спад достигает −levelDb. */
export function rolloffAt(r: Rolloff, levelDb: number): number {
  return r.fc / Math.pow(Math.pow(10, levelDb / 10) - 1, 1 / (2 * r.order));
}

const clampHz = (v: number) => Math.max(DEEP_HZ_MIN, Math.min(DEEP_HZ_MAX, v));

/** Частота цели по умолчанию: самая низкая среди сабвуферов частота −10 дБ их спада. Без сабвуферов — null. */
export function autoDeepHz(sources: SourceSpec[]): number | null {
  const subs = sources.filter((s) => s.kind === 'sub');
  if (!subs.length) return null;
  return clampHz(Math.round(Math.min(...subs.map((s) => rolloffAt(passportRolloff(s), 10)))));
}

/**
 * План цели «Глубже низ»: спад каждого сабвуфера, split — наименьшая частота среза (ниже неё считается недобор,
 * выше — провалы), fT — частота цели, drop — допустимый спад. null — цель другая или сабвуферов нет.
 */
export interface DeepPlan {
  curves: Record<string, Rolloff>;
  split: number;
  fT: number;
  drop: number;
}

export function deepPlan(sources: SourceSpec[], o: BassObjective | undefined): DeepPlan | null {
  if (o?.id !== 'deep') return null;
  const subs = sources.filter((s) => s.kind === 'sub');
  if (!subs.length) return null;
  const curves: Record<string, Rolloff> = {};
  for (const s of subs) {
    const { order, fc } = passportRolloff(s);
    curves[s.id] = { order, fc };
  }
  const split = Math.min(...Object.values(curves).map((r) => r.fc));
  const fT = clampHz(typeof o.deepHz === 'number' && Number.isFinite(o.deepHz) ? o.deepHz : autoDeepHz(sources)!);
  const drop = DEEP_DROPS.includes(o.deepDrop as DeepDrop) ? (o.deepDrop as DeepDrop) : DEFAULT_DROP;
  return { curves, split, fT, drop };
}

/** Паспорт из файла проекта: неверные поля убираются, пустой паспорт — нет поля. */
export function normalizePassport(raw: unknown): Passport | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Passport;
  const out: Passport = {};
  if (okHz(r.f3)) out.f3 = r.f3;
  if (okHz(r.f10)) out.f10 = r.f10;
  if (r.box === 'ported' || r.box === 'sealed') out.box = r.box;
  return Object.keys(out).length ? out : undefined;
}
