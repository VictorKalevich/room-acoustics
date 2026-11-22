// Сигнал итоговой физической проверки шумомера (058): структура и синтез. Файлы пишет scripts/make-noise-field-kit.ts.
// Детерминирован: шум — генератор mulberry32, фильтры — биквады Баттерворта и розовый фильтр из звеньев первого порядка,
// уровень каждого отрезка нормируется по самому сигналу. Тот же синтез при другой частоте дискретизации — для тестов.

export type FieldSegmentKind = 'silence' | 'pink' | 'band' | 'tone' | 'tones';
export interface FieldSegment {
  id: string;
  /** Время файла, с. */
  from: number;
  to: number;
  kind: FieldSegmentKind;
  /** RMS шумовой части, дБ относительно опорного уровня referenceDbfs. */
  levelDb?: number;
  /** Полоса шума, Гц. */
  bandHz?: [number, number];
  tonesHz?: number[];
  /** RMS каждого тона, дБ относительно опорного уровня. */
  toneDb?: number;
  check: string;
}

const PINK: [number, number] = [40, 7000];
export const FIELD_SIGNAL = {
  kind: 'room-acoustics/noise-field-signal',
  version: 1,
  file: 'noise-final-signal.wav',
  sampleRate: 16000,
  bits: 16,
  seconds: 615,
  /** RMS опорного розового шума в файле, dBFS. */
  referenceDbfs: -18,
  /** Равномощная смена отрезков: синус и косинус на ±0,25 с вокруг границы. */
  fadeSeconds: 0.5,
  note: 'Синтетический сигнал проверки шумомера Room Acoustics. Уровни — относительные: громкость, динамики, комната и микрофон их сдвигают одинаково для всех отрезков одного спектра.',
  segments: [
    { id: 'S0', from: 0, to: 15, kind: 'silence', check: 'фон комнаты до сигнала' },
    { id: 'P1', from: 15, to: 85, kind: 'pink', levelDb: 0, bandHz: PINK, check: 'опорное плато: Leq 1/10/60 с, A/C/Z, PSD' },
    { id: 'P2', from: 85, to: 155, kind: 'pink', levelDb: -10, bandHz: PINK, check: 'ступень −10 дБ; окно 60 с через ступень — энергетическое среднее' },
    { id: 'P3', from: 155, to: 225, kind: 'pink', levelDb: -20, bandHz: PINK, check: 'ступень −20 дБ' },
    { id: 'P4', from: 225, to: 285, kind: 'pink', levelDb: 0, bandHz: PINK, check: 'возврат к опорному уровню' },
    { id: 'G1', from: 285, to: 305, kind: 'silence', check: 'пауза сигнала: уровень падает до фона' },
    { id: 'B1', from: 305, to: 325, kind: 'band', levelDb: -6, bandHz: [35, 55], check: 'полоса 20–60 Гц (необязательно: слабый бас)' },
    { id: 'B2', from: 325, to: 345, kind: 'band', levelDb: 0, bandHz: [80, 200], check: 'полоса 60–250 Гц; A заметно ниже Z' },
    { id: 'B3', from: 345, to: 365, kind: 'band', levelDb: 0, bandHz: [300, 420], check: 'полоса 250–500 Гц' },
    { id: 'B4', from: 365, to: 385, kind: 'band', levelDb: 0, bandHz: [630, 1600], check: 'полоса 500–2000 Гц; A и C близки к Z' },
    { id: 'B5', from: 385, to: 405, kind: 'band', levelDb: 0, bandHz: [2500, 4000], check: 'полоса 2–5 кГц' },
    { id: 'B6', from: 405, to: 425, kind: 'band', levelDb: 0, bandHz: [5600, 7000], check: 'полоса 5–20 кГц; C ниже Z' },
    { id: 'T1', from: 425, to: 485, kind: 'tone', levelDb: -10, bandHz: PINK, tonesHz: [90], toneDb: -10, check: 'тон 90 Гц в розовом шуме: пик спектра' },
    { id: 'M1', from: 485, to: 515, kind: 'tones', tonesHz: [250, 1000, 4000], toneDb: -16, check: 'три тона: шкала частот' },
    { id: 'P5', from: 515, to: 600, kind: 'pink', levelDb: 0, bandHz: PINK, check: 'опорный уровень в конце: стабильность за 10 мин' },
    { id: 'S1', from: 600, to: 615, kind: 'silence', check: 'фон комнаты после сигнала' },
  ] as FieldSegment[],
};

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** Почти гауссов белый шум с единичной дисперсией: сумма четырёх равномерных (без трансцендентных функций). */
function white(seed: number) {
  const next = mulberry32(seed);
  return () => (next() + next() + next() + next() - 2) * Math.sqrt(3);
}

type Stage = (x: number) => number;
function biquad(type: 'lp' | 'hp', f: number, q: number, fs: number): Stage {
  const w = 2 * Math.PI * f / fs, cos = Math.cos(w), alpha = Math.sin(w) / (2 * q), a0 = 1 + alpha;
  const b0 = (type === 'lp' ? (1 - cos) / 2 : (1 + cos) / 2) / a0, b1 = (type === 'lp' ? 1 - cos : -(1 + cos)) / a0, b2 = b0;
  const a1 = -2 * cos / a0, a2 = (1 - alpha) / a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  return x => {
    const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    return y;
  };
}
/** Баттерворт порядка order (чётный) — каскад биквадов. */
function butterworth(type: 'lp' | 'hp', f: number, order: number, fs: number): Stage[] {
  return Array.from({ length: order / 2 }, (_, k) => biquad(type, f, 1 / (2 * Math.cos((2 * k + 1) * Math.PI / (2 * order))), fs));
}
/** −3 дБ/окт: пары полюс–нуль через октаву ниже fs/4, билинейное преобразование с предыскажением. При 16 кГц отклонение от наклона в 40 Гц – 7 кГц не больше 1,1 дБ. */
function pinking(fs: number): Stage[] {
  const stages: Stage[] = [];
  for (let fp = 10; fp * Math.SQRT2 < 0.25 * fs; fp *= 2) {
    const tz = 1 / Math.tan(Math.PI * fp * Math.SQRT2 / fs), tp = 1 / Math.tan(Math.PI * fp / fs);
    const b0 = (1 + tz) / (1 + tp), b1 = (1 - tz) / (1 + tp), a1 = (1 - tp) / (1 + tp);
    let x1 = 0, y1 = 0;
    stages.push(x => { const y = b0 * x + b1 * x1 - a1 * y1; x1 = x; y1 = y; return y; });
  }
  return stages;
}

function noiseSource(s: FieldSegment, index: number, fs: number) {
  const next = white(0x5eed + 7919 * index);
  const [lo, hi] = s.bandHz!;
  const chain = s.kind === 'band'
    ? [...butterworth('hp', lo, 8, fs), ...butterworth('lp', hi, 8, fs)]
    : [...pinking(fs), ...butterworth('hp', lo, 4, fs), ...butterworth('lp', hi, 8, fs)];
  return () => { let x = next(); for (const stage of chain) x = stage(x); return x; };
}

/** Сигнал целиком при частоте fs: Float32Array длиной seconds·fs. */
export function synthesizeFieldSignal(fs = FIELD_SIGNAL.sampleRate): Float32Array {
  const { segments, seconds, referenceDbfs, fadeSeconds } = FIELD_SIGNAL;
  const out = new Float32Array(Math.round(seconds * fs));
  const reference = 10 ** (referenceDbfs / 20), half = fadeSeconds / 2;
  segments.forEach((s, index) => {
    if (s.kind === 'silence') return;
    const n0 = Math.round((s.from - half) * fs), n1 = Math.round((s.to + half) * fs);
    const full0 = Math.round((s.from + half) * fs), full1 = Math.round((s.to - half) * fs);
    const part = new Float64Array(n1 - n0);
    if (s.levelDb !== undefined) {
      const source = noiseSource(s, index, fs);
      for (let i = 0; i < fs; i++) source();
      for (let i = 0; i < part.length; i++) part[i] = source();
      let sum = 0;
      for (let n = full0; n < full1; n++) sum += part[n - n0] ** 2;
      const gain = reference * 10 ** (s.levelDb / 20) / Math.sqrt(sum / (full1 - full0));
      for (let i = 0; i < part.length; i++) part[i] *= gain;
    }
    if (s.tonesHz) {
      const amplitude = Math.SQRT2 * reference * 10 ** (s.toneDb! / 20);
      for (let i = 0; i < part.length; i++) {
        const n = n0 + i;
        for (const f of s.tonesHz) part[i] += amplitude * Math.sin(2 * Math.PI * f * n / fs);
      }
    }
    for (let i = 0; i < part.length; i++) {
      const t = (n0 + i) / fs;
      const rise = Math.min(1, (t - (s.from - half)) / fadeSeconds), fall = Math.min(1, ((s.to + half) - t) / fadeSeconds);
      const w = Math.sin(Math.PI / 2 * Math.max(0, rise)) * Math.sin(Math.PI / 2 * Math.max(0, fall));
      out[n0 + i] += part[i] * w;
    }
  });
  return out;
}
