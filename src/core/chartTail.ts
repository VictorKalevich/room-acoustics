// График АЧХ «Расстановки» ниже полосы оценки (045): спад источников в «хвосте», нижняя граница графика и сетка частот.
// Читают только графики: оценки, подбор, карты и остальные расчёты хвост не считают.
import type { Complex, SourceSpec } from './types';
import { cabs, cdiv, cmul } from './frequency';
import { sourceHighPass } from './filters';
import { butterworthHp, passportRolloff, type DeepPlan, type Rolloff } from './deepBass';

/** Хвост графика — до частоты, где спад источника по модели достигает −20 дБ, но не ниже 20 Гц. */
export const TAIL_DB = 20;
export const TAIL_MIN_HZ = 20;

/** Спад по паспорту, сшитый с номинальной моделью на нижней границе полосы оценки fLo: k = HP_ном(fLo) / HP_пасп(fLo). */
export interface TailCurve extends Rolloff {
  k: Complex;
}

/** Паспорт действует на график: у сабвуфера — всегда, у колонок — только в системе без сабвуфера. */
export function passportApplies(s: SourceSpec, system: SourceSpec[]): boolean {
  return !!s.passport && (s.kind === 'sub' || !system.some((x) => x.kind === 'sub'));
}

/** Спад по паспорту в хвосте — у источников, где паспорт действует; у остальных хвост — номинальная модель. */
export function tailCurves(system: SourceSpec[], fLo: number): Record<string, TailCurve> {
  const out: Record<string, TailCurve> = {};
  for (const s of system) {
    if (!passportApplies(s, system)) continue;
    const { order, fc } = passportRolloff(s);
    out[s.id] = { order, fc, k: cdiv(sourceHighPass(s, system, fLo), butterworthHp(order, fc, fLo)) };
  }
  return out;
}

/** Спад источника снизу на графике: у сабвуфера при цели «Глубже низ» — по плану цели, иначе по паспорту со сшивкой или номинальный. */
export function tailHighPass(s: SourceSpec, system: SourceSpec[], f: number, curves: Record<string, TailCurve>, plan?: DeepPlan | null): Complex {
  const deep = plan && s.kind === 'sub' ? plan.curves[s.id] : undefined;
  if (deep) return butterworthHp(deep.order, deep.fc, f);
  const t = curves[s.id];
  return t ? cmul(butterworthHp(t.order, t.fc, f), t.k) : sourceHighPass(s, system, f);
}

/**
 * Нижняя граница графика: наименьшая по источникам частота ниже fLo, где спад источника достигает −20 дБ, но не ниже
 * 20 Гц; fLo — если все источники уже на ней тише. Спад монотонный: частота ищется делением отрезка пополам.
 */
export function tailFloor(system: SourceSpec[], fLo: number, curves: Record<string, TailCurve>, plan?: DeepPlan | null): number {
  const level = Math.pow(10, -TAIL_DB / 20);
  let lo = fLo;
  for (const s of system) {
    const louder = (f: number) => cabs(tailHighPass(s, system, f, curves, plan)) > level;
    if (louder(TAIL_MIN_HZ)) return TAIL_MIN_HZ;
    if (!louder(lo)) continue;
    let a = TAIL_MIN_HZ, b = lo;
    for (let i = 0; i < 50; i++) {
      const m = Math.sqrt(a * b);
      if (louder(m)) b = m;
      else a = m;
    }
    lo = b;
  }
  return lo;
}

/**
 * Частоты хвоста: сетка полосы band продолжена вниз с её шагом до from, первая точка — сама from (точка сетки ближе
 * четверти шага к ней не берётся). Пусто, если from не ниже начала полосы.
 */
export function tailGrid(band: readonly number[], from: number): number[] {
  const f0 = band[0];
  if (band.length < 2 || !(from < f0)) return [];
  const q = band[1] / f0;
  const out: number[] = [];
  for (let k = 1; ; k++) {
    const f = f0 * Math.pow(q, -k);
    if (f <= from * Math.pow(q, 0.25)) break;
    out.unshift(f);
  }
  out.unshift(from);
  return out;
}
