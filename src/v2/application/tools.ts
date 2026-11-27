// Расчёты независимых инструментов (V2-038–V2-040). Где есть функция ядра — используется она (скорость звука,
// пористое поглощение, Баттерворт, пиковый фильтр, экспорт); здесь — стандартные соотношения, которых в ядре нет (R33):
// интерференция прямого и отражённого звука, сумма двух источников, фильтры RBJ Audio EQ Cookbook, LP Баттерворта
// через HP ядра, звуковое давление по чувствительности, направленность поршня в бесконечном экране, частоты
// Гельмгольца, перфорированной панели и мембраны, глубины ячеек QRD.
import type { DspFilterType } from '../domain/model';
import { butterworthHp } from '../../core/deepBass';
import { biquad as peakBiquad } from '../../core/eq';
import { speedOfSound } from '../../core/physics';
import type { Complex, Furnishing, Room as CoreRoom, SurfaceId } from '../../core/types';
import { defaultRoom } from '../../state/project';

const TAU = 2 * Math.PI;
const cabs = (c: Complex) => Math.hypot(c.re, c.im);
const cmul = (a: Complex, b: Complex): Complex => ({ re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re });
const conj = (a: Complex): Complex => ({ re: a.re, im: -a.im });
const db = (v: number) => 20 * Math.log10(Math.max(1e-12, v));

/** Логарифмическая сетка частот, точек на октаву. */
export function logFreqs(f0: number, f1: number, ppo = 48): number[] {
  const n = Math.max(2, Math.round(Math.log2(f1 / f0) * ppo) + 1);
  return Array.from({ length: n }, (_, i) => f0 * (f1 / f0) ** (i / (n - 1)));
}

// ---------- Комната для калькуляторов ----------

/** Параметры прямоугольной комнаты, которые задаются в калькуляторах мод, реверберации и геометрии. */
export interface CalcRoom { depth: number; width: number; height: number; temperatureC: number; materials: Record<SurfaceId, string>; furnishing: Furnishing }

/** Комната ядра без проёмов, зон, обработки и покрытий: только размеры, отделка и обстановка. */
export const coreRoom = (r: CalcRoom): CoreRoom => ({ ...defaultRoom(), ...r, materials: { ...r.materials } });
export const calcRoomOf = (r: CoreRoom): CalcRoom => ({ depth: r.depth, width: r.width, height: r.height, temperatureC: r.temperatureC, materials: { ...r.materials }, furnishing: r.furnishing });
export const DEFAULT_CALC_ROOM: CalcRoom = calcRoomOf(defaultRoom());

// ---------- Длина волны, расстояние и задержка ----------

export function wavelength(f: number, tempC = 20) {
  const c = speedOfSound(tempC);
  const lambda = c / f;
  return { c, lambda, half: lambda / 2, quarter: lambda / 4, periodMs: 1000 / f };
}

export const delayMs = (distance: number, tempC = 20) => (distance / speedOfSound(tempC)) * 1000;
export const distanceOf = (ms: number, tempC = 20) => (ms / 1000) * speedOfSound(tempC);
/** Сдвиг фазы задержки на частоте f, ° (0…360). */
export const phaseOfDelay = (f: number, ms: number) => ((((f * ms) / 1000) * 360) % 360 + 360) % 360;

// ---------- Интерференция с отражением (SBIR) ----------

/**
 * Сумма прямого звука и одного отражения с разностью путей `pathDiff`, м, и коэффициентом отражения по давлению
 * r = √(1 − α): уровень относительно прямого, дБ. Плоская волна, отражение без зависимости от частоты.
 */
export function combResponse(freqs: readonly number[], pathDiff: number, alpha: number, tempC = 20): number[] {
  const c = speedOfSound(tempC);
  const r = Math.sqrt(Math.max(0, 1 - alpha));
  return freqs.map((f) => {
    const ph = (TAU * f * pathDiff) / c;
    return db(Math.hypot(1 + r * Math.cos(ph), -r * Math.sin(ph)));
  });
}

/** Частоты провалов: разность путей — нечётное число полуволн. */
export function combNotches(pathDiff: number, fMax: number, tempC = 20): number[] {
  const c = speedOfSound(tempC);
  const out: number[] = [];
  for (let n = 0; ; n++) {
    const f = ((2 * n + 1) * c) / (2 * pathDiff);
    if (f > fMax || n > 200) break;
    out.push(f);
  }
  return out;
}

// ---------- Геометрия помещения ----------

export function roomGeometry(depth: number, width: number, height: number) {
  const floor = depth * width;
  const surface = 2 * (depth * width + depth * height + width * height);
  const dims = [height, width, depth].sort((a, b) => a - b);
  return { volume: depth * width * height, floor, surface, ratio: dims.map((v) => v / dims[0]) as [number, number, number] };
}

// ---------- Стереотреугольник ----------

/** База между колонками, расстояние от середины базы до слушателя, м → угол, разворот колонок, расстояние до колонки. */
export function stereoTriangle(base: number, distance: number) {
  const half = Math.atan2(base / 2, distance);
  return { angleDeg: (2 * half * 180) / Math.PI, toeInDeg: (half * 180) / Math.PI, toSpeaker: Math.hypot(base / 2, distance) };
}

/** Расстояние до слушателя для заданного угла, м. */
export const distanceForAngle = (base: number, angleDeg: number) => base / 2 / Math.tan((angleDeg * Math.PI) / 360);

// ---------- Сумма двух источников ----------

/** Второй источник: уровень относительно первого, задержка, полярность → уровень суммы относительно первого, дБ, и фаза, °. */
export function twoSourceSum(freqs: readonly number[], gainDb: number, ms: number, invert: boolean) {
  const g = 10 ** (gainDb / 20) * (invert ? -1 : 1);
  return freqs.map((f) => {
    const ph = TAU * f * (ms / 1000);
    const s: Complex = { re: 1 + g * Math.cos(ph), im: -g * Math.sin(ph) };
    return { db: db(cabs(s)), phaseDeg: (Math.atan2(s.im, s.re) * 180) / Math.PI };
  });
}

// ---------- Кроссовер ----------

export type CrossoverFamily = 'butterworth' | 'linkwitz-riley';
export const CROSSOVER_ORDERS: Record<CrossoverFamily, readonly number[]> = { butterworth: [1, 2, 3, 4], 'linkwitz-riley': [2, 4, 8] };

/** Аналоговый фильтр кроссовера. LP Баттерворта — HP ядра с заменой s → 1/s: H_lp(f) = conj(H_hp(fc²/f)). LR — квадрат Баттерворта половинного порядка. */
export function crossoverFilter(family: CrossoverFamily, order: number, type: 'lp' | 'hp', fc: number, f: number): Complex {
  if (!CROSSOVER_ORDERS[family].includes(order)) throw new Error(`Порядок ${order} недопустим для этого семейства.`);
  const bw = (n: number) => (type === 'hp' ? butterworthHp(n, fc, f) : conj(butterworthHp(n, fc, (fc * fc) / f)));
  if (family === 'butterworth') return bw(order);
  const h = bw(order / 2);
  return cmul(h, h);
}

export function crossoverResponse(family: CrossoverFamily, order: number, fc: number, freqs: readonly number[], invertHigh: boolean) {
  return freqs.map((f) => {
    const lp = crossoverFilter(family, order, 'lp', fc, f);
    let hp = crossoverFilter(family, order, 'hp', fc, f);
    if (invertHigh) hp = { re: -hp.re, im: -hp.im };
    return { lp: db(cabs(lp)), hp: db(cabs(hp)), sum: db(cabs({ re: lp.re + hp.re, im: lp.im + hp.im })) };
  });
}

// ---------- Эквалайзер: биквады RBJ ----------

export type EqType = DspFilterType;
export const EQ_TYPES: readonly EqType[] = ['peaking', 'lowshelf', 'highshelf', 'lowpass', 'highpass', 'bandpass', 'notch', 'allpass'];
export const EQ_HAS_GAIN: Record<EqType, boolean> = { peaking: true, lowshelf: true, highshelf: true, lowpass: false, highpass: false, bandpass: false, notch: false, allpass: false };

export interface EqFilter { id: string; type: EqType; f: number; gainDb: number; q: number; enabled: boolean }
export interface Biquad { b0: number; b1: number; b2: number; a1: number; a2: number }

/** Коэффициенты по RBJ Audio EQ Cookbook (нормированы на a0). Пиковый — функция ядра. */
export function rbj(p: Pick<EqFilter, 'type' | 'f' | 'gainDb' | 'q'>, fs: number): Biquad {
  if (p.type === 'peaking') return peakBiquad({ f: p.f, gainDb: p.gainDb, q: p.q }, fs);
  const w0 = (TAU * p.f) / fs, cw = Math.cos(w0), sw = Math.sin(w0), alpha = sw / (2 * p.q);
  const A = 10 ** (p.gainDb / 40), sa = 2 * Math.sqrt(A) * alpha;
  let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number;
  switch (p.type) {
    case 'lowshelf':
      b0 = A * ((A + 1) - (A - 1) * cw + sa); b1 = 2 * A * ((A - 1) - (A + 1) * cw); b2 = A * ((A + 1) - (A - 1) * cw - sa);
      a0 = (A + 1) + (A - 1) * cw + sa; a1 = -2 * ((A - 1) + (A + 1) * cw); a2 = (A + 1) + (A - 1) * cw - sa; break;
    case 'highshelf':
      b0 = A * ((A + 1) + (A - 1) * cw + sa); b1 = -2 * A * ((A - 1) + (A + 1) * cw); b2 = A * ((A + 1) + (A - 1) * cw - sa);
      a0 = (A + 1) - (A - 1) * cw + sa; a1 = 2 * ((A - 1) - (A + 1) * cw); a2 = (A + 1) - (A - 1) * cw - sa; break;
    case 'lowpass': b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = (1 - cw) / 2; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha; break;
    case 'highpass': b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = (1 + cw) / 2; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha; break;
    case 'bandpass': b0 = alpha; b1 = 0; b2 = -alpha; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha; break;
    case 'notch': b0 = 1; b1 = -2 * cw; b2 = 1; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha; break;
    case 'allpass': b0 = 1 - alpha; b1 = -2 * cw; b2 = 1 + alpha; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha; break;
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

export function biquadAt(c: Biquad, f: number, fs: number): Complex {
  const w = (TAU * f) / fs;
  const z1: Complex = { re: Math.cos(w), im: -Math.sin(w) }, z2: Complex = { re: Math.cos(2 * w), im: -Math.sin(2 * w) };
  const num: Complex = { re: c.b0 + c.b1 * z1.re + c.b2 * z2.re, im: c.b1 * z1.im + c.b2 * z2.im };
  const den: Complex = { re: 1 + c.a1 * z1.re + c.a2 * z2.re, im: c.a1 * z1.im + c.a2 * z2.im };
  const d = den.re * den.re + den.im * den.im;
  return { re: (num.re * den.re + num.im * den.im) / d, im: (num.im * den.re - num.re * den.im) / d };
}

/** Полюсы внутри единичного круга: |a2| < 1 и |a1| < 1 + a2. */
export const stable = (c: Biquad) => Math.abs(c.a2) < 1 && Math.abs(c.a1) < 1 + c.a2;

export function eqIssues(p: EqFilter, fs: number): string[] {
  const out: string[] = [];
  if (!(p.f > 0 && p.f < fs / 2)) out.push(`Частота должна быть ниже половины частоты дискретизации (${Math.round(fs / 2)} Гц).`);
  if (!(p.q > 0)) out.push('Добротность должна быть больше нуля.');
  if (!out.length && !stable(rbj(p, fs))) out.push('Фильтр неустойчив.');
  return out;
}

/** Суммарная характеристика включённых фильтров: уровень, дБ, и фаза, °. */
export function eqChain(filters: readonly EqFilter[], freqs: readonly number[], fs: number) {
  const cs = filters.filter((p) => p.enabled && !eqIssues(p, fs).length).map((p) => rbj(p, fs));
  return freqs.map((f) => {
    const h = cs.reduce<Complex>((acc, c) => cmul(acc, biquadAt(c, f, fs)), { re: 1, im: 0 });
    return { db: db(cabs(h)), phaseDeg: (Math.atan2(h.im, h.re) * 180) / Math.PI };
  });
}

const APO: Record<EqType, string> = { peaking: 'PK', lowshelf: 'LSC', highshelf: 'HSC', lowpass: 'LPQ', highpass: 'HPQ', bandpass: 'BP', notch: 'NO', allpass: 'AP' };
const fx = (v: number, d: number) => v.toFixed(d);

/** Equalizer APO (и совместимый Peace): все типы с добротностью; Preamp — запас против перегрузки. */
export function exportApo(filters: readonly EqFilter[], preampDb: number): string {
  const lines = [`Preamp: ${fx(preampDb, 1)} dB`];
  filters.forEach((p, i) => lines.push(`Filter ${i + 1}: ${p.enabled ? 'ON' : 'OFF'} ${APO[p.type]} Fc ${fx(p.f, 1)} Hz${EQ_HAS_GAIN[p.type] ? ` Gain ${fx(p.gainDb, 1)} dB` : ''} Q ${fx(p.q, 3)}`));
  return lines.join('\n') + '\n';
}

/** Коэффициенты биквадов (miniDSP и др.: a1, a2 со сменой знака). */
export function exportBiquads(filters: readonly EqFilter[], fs: number): string {
  return filters.filter((p) => p.enabled).map((p, i) => {
    const c = rbj(p, fs);
    return [`biquad${i + 1},`, `b0=${c.b0.toPrecision(15)},`, `b1=${c.b1.toPrecision(15)},`, `b2=${c.b2.toPrecision(15)},`, `a1=${(-c.a1).toPrecision(15)},`, `a2=${(-c.a2).toPrecision(15)}`].join('\n');
  }).join(',\n') + '\n';
}

// ---------- Звуковое давление ----------

export interface SplInput {
  /** Чувствительность пассивной колонки, дБ (1 Вт, 1 м). */
  sensitivity: number;
  powerW: number;
  distance: number;
  /** Число колонок, играющих одно и то же: на низких частотах рядом — сложение по давлению, выше — по мощности. */
  speakers: number;
  /** Пик-фактор программы, дБ, и желаемый средний уровень в месте слушателя, дБ SPL. */
  crestDb: number;
  targetDb: number;
  /** Измеренный или заявленный изготовителем предел активной системы, дБ SPL на 1 м; null — нет. */
  limitAt1m: number | null;
}

/** Свободное поле, без вклада комнаты: оценка, а не гарантия. Предел по мощности — теоретический (без компрессии и ограничителей). */
export function splBudget(s: SplInput) {
  const byPower = s.sensitivity + 10 * Math.log10(Math.max(1e-9, s.powerW));
  const at1m = s.limitAt1m !== null ? Math.min(byPower, s.limitAt1m) : byPower;
  const loss = 20 * Math.log10(Math.max(1e-3, s.distance));
  const sum = s.speakers > 1 ? 10 * Math.log10(s.speakers) : 0;
  const peak = at1m - loss + sum;
  return { byPower, at1m, peak, needed: s.targetDb + s.crestDb, headroom: peak - (s.targetDb + s.crestDb), sumDb: sum, lossDb: loss };
}

// ---------- Направленность ----------

/** Бессель J1 (Numerical Recipes, bessj1): рациональные приближения, погрешность ~1e-8. */
export function besselJ1(x: number): number {
  const ax = Math.abs(x);
  if (ax < 8) {
    const y = x * x;
    const a = x * (72362614232.0 + y * (-7895059235.0 + y * (242396853.1 + y * (-2972611.439 + y * (15704.48260 + y * -30.16036606)))));
    const b = 144725228442.0 + y * (2300535178.0 + y * (18583304.74 + y * (99447.43394 + y * (376.9991397 + y))));
    return a / b;
  }
  const z = 8 / ax, y = z * z, xx = ax - 2.356194491;
  const a = 1 + y * (0.183105e-2 + y * (-0.3516396496e-4 + y * (0.2457520174e-5 + y * -0.240337019e-6)));
  const b = 0.04687499995 + y * (-0.2002690873e-3 + y * (0.8449199096e-5 + y * (-0.88228987e-6 + y * 0.105787412e-6)));
  const v = Math.sqrt(0.636619772 / ax) * (Math.cos(xx) * a - z * Math.sin(xx) * b);
  return x < 0 ? -v : v;
}

/** Ослабление вне оси поршня радиусом a в бесконечном экране: 20·lg|2·J1(ka·sinθ)/(ka·sinθ)|, дБ. */
export function pistonDb(f: number, radius: number, angleDeg: number, tempC = 20): number {
  const x = ((TAU * f) / speedOfSound(tempC)) * radius * Math.sin((angleDeg * Math.PI) / 180);
  if (Math.abs(x) < 1e-9) return 0;
  return db(Math.abs((2 * besselJ1(x)) / x));
}

/** Угол, на котором уровень падает на 6 дБ; null — не падает до 90°. */
export function beamwidth6(f: number, radius: number, tempC = 20): number | null {
  for (let a = 0; a <= 90; a += 0.5) if (pistonDb(f, radius, a, tempC) <= -6) return a;
  return null;
}

// ---------- Резонансные поглотители и диффузоры ----------

/** Гельмгольц: f0 = c/2π·√(S/(V·L')), L' = L + 1,7·r (концевые поправки горла с фланцем). */
export function helmholtz(neckRadius: number, neckLength: number, volume: number, tempC = 20) {
  const S = Math.PI * neckRadius ** 2;
  const Leff = neckLength + 1.7 * neckRadius;
  return (speedOfSound(tempC) / TAU) * Math.sqrt(S / (volume * Leff));
}

/** Перфорированная панель: f0 = c/2π·√(p/(D·t')), p — перфорация (доля), t' = t + 1,6·r, D — глубина полости. */
export function perforated(holeRadius: number, spacing: number, thickness: number, depth: number, tempC = 20) {
  const p = (Math.PI * holeRadius ** 2) / spacing ** 2;
  const teff = thickness + 1.6 * holeRadius;
  return { f0: (speedOfSound(tempC) / TAU) * Math.sqrt(p / (depth * teff)), porosity: p };
}

/** Мембранный поглотитель: f0 ≈ 60/√(m·d) (m — поверхностная масса, кг/м², d — глубина полости, м), без заполнения. */
export const membrane = (mass: number, depth: number) => 60 / Math.sqrt(mass * depth);

export const PRIMES = [5, 7, 11, 13, 17, 19, 23] as const;

/**
 * QRD: глубины ячеек d_n = (n² mod N)·λ0/(2N) для одномерного, (n² + m²) mod N — для двумерного; нижняя граница
 * рабочей полосы ≈ f0, верхняя — по ширине ячейки: c/(2w).
 */
export function qrd(N: number, f0: number, well: number, tempC = 20, twoD = false) {
  const c = speedOfSound(tempC);
  const step = c / f0 / (2 * N);
  const seq = Array.from({ length: N }, (_, n) => (n * n) % N);
  const grid = twoD ? seq.map((_, m) => seq.map((__, n) => (n * n + m * m) % N)) : [seq];
  return { depths: grid.map((row) => row.map((k) => k * step)), maxDepth: Math.max(...grid.flat()) * step, fMax: c / (2 * well), period: N * well, step };
}
