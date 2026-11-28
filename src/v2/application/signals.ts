// Тестовые сигналы генераторов (V2-037) и статистика уровней шумомера (V2-036). Логарифмический свип и октавная
// полоса — функции ядра; уровень сигнала — пиковый, в дБ относительно полной шкалы, в безопасных пределах (R34).
// Пакет 8б: линейный и ступенчатый свип, двухтоновый сигнал, MLS, пакеты синусоид, начальная фаза, огибающая,
// независимый шум в каналах, частота дискретизации файла (R40).
import { logSweep, octaveBand, wavFloat32 } from '../../core/dsp';

export type SignalKind = 'sine' | 'white' | 'pink' | 'sweep' | 'linear-sweep' | 'stepped' | 'multitone' | 'two-tone' | 'mls' | 'burst' | 'pulse';
export type WavRate = 44100 | 48000 | 96000;
export type SignalChannel = 'both' | 'left' | 'right';

export interface SignalSettings {
  kind: SignalKind;
  /** Пиковый уровень, дБ относительно полной шкалы. */
  levelDb: number;
  seconds: number;
  /** Синус — частота; свип и мультитон — нижняя и верхняя частоты. */
  f: number;
  f1: number;
  f2: number;
  /** Шум в одной октаве (центр, Гц); null — во всей полосе. */
  band: number | null;
  channel: SignalChannel;
  /** Правый канал в противофазе (проверка полярности и подключения). */
  invertRight: boolean;
  /** Начальная фаза синуса, пакетов, ступеней и первого тона двухтонового, градусы. */
  phaseDeg: number;
  /** Плавное нарастание и спад линейного свипа и каждой ступени, мс. */
  fadeMs: number;
  /** Шум: независимый в левом и правом канале (некоррелированный). */
  uncorrelated: boolean;
  /** Двухтоновый: уровень второго тона относительно первого, дБ (SMPTE — −12). */
  ratioDb: number;
  /** Ступенчатый синус: ступеней на октаву, длительность ступени, свой список частот через запятую (пусто — от f1 до f2). */
  stepsPerOctave: number;
  stepSeconds: number;
  list: string;
  /** MLS: порядок n, период 2ⁿ − 1 отсчётов. */
  mlsOrder: number;
  /** Пакеты: число периодов в пакете, окно Ханна вместо прямоугольного. Пакеты и импульсы — период повтора, мс. */
  cycles: number;
  hannBurst: boolean;
  intervalMs: number;
  /** Частота дискретизации файла WAV; воспроизведение идёт с частотой устройства. */
  wavRate: WavRate;
}

export const LEVEL_MIN = -60;
export const LEVEL_MAX = -6;
export const LEVEL_DEFAULT = -20;
export const MAX_SECONDS = 60;
export const OCTAVES = [31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000] as const;
export const SIGNAL_LABEL: Record<SignalKind, string> = {
  sine: 'Синус', white: 'Белый шум', pink: 'Розовый шум', sweep: 'Логарифмический свип', 'linear-sweep': 'Линейный свип', stepped: 'Ступенчатый синус',
  multitone: 'Мультитон', 'two-tone': 'Двухтоновый', mls: 'MLS', burst: 'Пакеты синусоид', pulse: 'Импульсы',
};
/** Повторяются без пауз; свипы, ступени, пакеты и импульсы — однократно (пакеты и импульсы и так периодичны в буфере). */
export const LOOPED: Record<SignalKind, boolean> = {
  sine: true, white: true, pink: true, sweep: false, 'linear-sweep': false, stepped: false, multitone: true, 'two-tone': true, mls: true, burst: false, pulse: false,
};
export const WAV_RATES: readonly WavRate[] = [44100, 48000, 96000];
export const MLS_ORDERS = [10, 11, 12, 13, 14, 15, 16, 17, 18] as const;
/** Отводы регистра сдвига максимальной длины (XAPP052) по порядку. */
const MLS_TAPS: Record<number, readonly number[]> = { 10: [10, 7], 11: [11, 9], 12: [12, 6, 4, 1], 13: [13, 4, 3, 1], 14: [14, 5, 3, 1], 15: [15, 14], 16: [16, 15, 13, 4], 17: [17, 14], 18: [18, 11] };

export const DEFAULT_SIGNAL: SignalSettings = {
  kind: 'pink', levelDb: LEVEL_DEFAULT, seconds: 10, f: 1000, f1: 20, f2: 20000, band: null, channel: 'both', invertRight: false,
  phaseDeg: 0, fadeMs: 10, uncorrelated: false, ratioDb: -12, stepsPerOctave: 3, stepSeconds: 1, list: '', mlsOrder: 16, cycles: 10, hannBurst: false, intervalMs: 500, wavRate: 48000,
};

/** Детерминированный генератор (mulberry32): одинаковые настройки — одинаковый файл. */
export function seeded(seed = 1): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const positive = (v: number) => Number.isFinite(v) && v > 0;

/** Частоты ступенчатого синуса: свой список или ряд от f1 до f2 с шагом 1/stepsPerOctave октавы. */
export function stepFrequencies(s: Pick<SignalSettings, 'f1' | 'f2' | 'stepsPerOctave' | 'list'>): number[] {
  if (s.list.trim()) return s.list.split(/[;\s]+|,(?!\d)/).map((t) => Number(t.replace(',', '.'))).filter(positive);
  const out: number[] = [];
  const k = Math.max(1, Math.round(s.stepsPerOctave));
  for (let i = 0; i < 1000; i++) {
    const f = s.f1 * 2 ** (i / k);
    if (f > s.f2 * (1 + 1e-9)) break;
    out.push(f);
  }
  return out;
}

/** Длительность сигнала, с: у ступенчатого — число ступеней × длительность ступени. */
export function signalSeconds(s: SignalSettings): number {
  return s.kind === 'stepped' ? stepFrequencies(s).length * s.stepSeconds : s.seconds;
}

/** Последовательность максимальной длины порядка n: ±1, период 2ⁿ − 1. */
export function mls(order: number): Float32Array {
  const taps = MLS_TAPS[order];
  if (!taps) throw new Error(`MLS порядка ${order} не поддерживается`);
  const len = 2 ** order - 1, mask = 2 ** order - 1;
  const out = new Float32Array(len);
  let state = 1;
  for (let i = 0; i < len; i++) {
    out[i] = (state >> (order - 1)) & 1 ? 1 : -1;
    let fb = 0;
    for (const tp of taps) fb ^= (state >> (tp - 1)) & 1;
    state = ((state << 1) | fb) & mask;
  }
  return out;
}

export function signalIssues(s: SignalSettings, fs: number): string[] {
  const out: string[] = [];
  const nyq = fs / 2;
  if (!(s.levelDb >= LEVEL_MIN && s.levelDb <= LEVEL_MAX)) out.push(`Уровень — от ${LEVEL_MIN} до ${LEVEL_MAX} дБ полной шкалы.`);
  if (!(s.seconds >= 0.5 && s.seconds <= MAX_SECONDS)) out.push(`Длительность — от 0,5 до ${MAX_SECONDS} с.`);
  if (s.kind === 'sine' && !(s.f >= 10 && s.f < nyq)) out.push(`Частота синуса — от 10 Гц до ${Math.round(nyq)} Гц.`);
  if ((s.kind === 'sweep' || s.kind === 'linear-sweep' || s.kind === 'multitone' || (s.kind === 'stepped' && !s.list.trim())) && !(s.f1 >= 10 && s.f2 > s.f1 && s.f2 < nyq)) out.push(`Диапазон — от 10 Гц, верхняя частота выше нижней и ниже ${Math.round(nyq)} Гц.`);
  if (s.kind === 'two-tone' && !(s.f1 >= 10 && s.f2 >= 10 && s.f1 < nyq && s.f2 < nyq && s.f1 !== s.f2)) out.push(`Частоты тонов — разные, от 10 Гц до ${Math.round(nyq)} Гц.`);
  if (s.kind === 'two-tone' && !(s.ratioDb >= -40 && s.ratioDb <= 0)) out.push('Уровень второго тона — от −40 до 0 дБ относительно первого.');
  if (s.kind === 'stepped') {
    const fr = stepFrequencies(s);
    if (s.list.trim() && (!fr.length || fr.some((f) => f < 10 || f >= nyq))) out.push(`Список частот — числа через запятую или пробел, от 10 Гц до ${Math.round(nyq)} Гц.`);
    if (!(s.stepSeconds >= 0.1 && s.stepSeconds <= 10)) out.push('Ступень — от 0,1 до 10 с.');
    else if (fr.length * s.stepSeconds > MAX_SECONDS) out.push(`Всего ${fr.length} ступеней: общая длительность больше ${MAX_SECONDS} с.`);
  }
  if (s.kind === 'mls' && !(MLS_ORDERS as readonly number[]).includes(s.mlsOrder)) out.push('Порядок MLS — от 10 до 18.');
  if (s.kind === 'burst') {
    if (!(s.f >= 10 && s.f < nyq)) out.push(`Частота пакета — от 10 Гц до ${Math.round(nyq)} Гц.`);
    if (!(s.cycles >= 1 && s.cycles <= 1000)) out.push('В пакете — от 1 до 1000 периодов.');
    else if (s.intervalMs / 1000 <= s.cycles / s.f) out.push('Период повтора должен быть длиннее пакета.');
  }
  if ((s.kind === 'burst' || s.kind === 'pulse') && !(s.intervalMs >= 20 && s.intervalMs <= 5000)) out.push('Период повтора — от 20 до 5000 мс.');
  if (!(s.phaseDeg >= -360 && s.phaseDeg <= 360)) out.push('Начальная фаза — от −360° до 360°.');
  if (!(s.fadeMs >= 0 && s.fadeMs <= 500)) out.push('Нарастание и спад — от 0 до 500 мс.');
  return out;
}

const normalize = (x: Float32Array, peak: number) => {
  let m = 0;
  for (let i = 0; i < x.length; i++) m = Math.max(m, Math.abs(x[i]));
  if (m > 0) for (let i = 0; i < x.length; i++) x[i] *= peak / m;
  return x;
};

/** Плавные края (полуволна косинуса) длиной m отсчётов в начале и в конце участка [a, b). */
function fade(x: Float32Array, a: number, b: number, m: number) {
  const k = Math.min(m, Math.floor((b - a) / 2));
  for (let i = 0; i < k; i++) {
    const g = 0.5 - 0.5 * Math.cos((Math.PI * i) / k);
    x[a + i] *= g;
    x[b - 1 - i] *= g;
  }
}

/** Моно-сигнал с пиком ровно levelDb. Повторяемые — на целом числе периодов, у свипа плавные края ядра. */
export function synth(s: SignalSettings, fs: number, rand = seeded(1)): Float32Array {
  const n = Math.max(1, Math.round(signalSeconds(s) * fs));
  const peak = 10 ** (s.levelDb / 20);
  const ph = (s.phaseDeg * Math.PI) / 180;
  let x: Float32Array = new Float32Array(n);
  switch (s.kind) {
    case 'sine': {
      // целое число периодов в буфере — повтор без щелчка
      const cycles = Math.max(1, Math.round((s.f * n) / fs));
      for (let i = 0; i < n; i++) x[i] = Math.sin((2 * Math.PI * cycles * i) / n + ph);
      break;
    }
    case 'linear-sweep': {
      const T = n / fs;
      for (let i = 0; i < n; i++) { const tt = i / fs; x[i] = Math.sin(2 * Math.PI * (s.f1 * tt + ((s.f2 - s.f1) * tt * tt) / (2 * T))); }
      fade(x, 0, n, Math.round((s.fadeMs / 1000) * fs));
      break;
    }
    case 'stepped': {
      const step = Math.round(s.stepSeconds * fs), m = Math.round((s.fadeMs / 1000) * fs);
      stepFrequencies(s).forEach((f, j) => {
        for (let i = 0; i < step; i++) x[j * step + i] = Math.sin((2 * Math.PI * f * i) / fs + ph);
        fade(x, j * step, (j + 1) * step, m);
      });
      break;
    }
    case 'two-tone': {
      const a = 10 ** (s.ratioDb / 20);
      const c1 = Math.max(1, Math.round((s.f1 * n) / fs)), c2 = Math.max(1, Math.round((s.f2 * n) / fs));
      for (let i = 0; i < n; i++) x[i] = Math.sin((2 * Math.PI * c1 * i) / n + ph) + a * Math.sin((2 * Math.PI * c2 * i) / n);
      break;
    }
    case 'mls': {
      // целое число периодов: повтор без разрыва последовательности
      const seq = mls(s.mlsOrder);
      x = new Float32Array(Math.max(1, Math.round(n / seq.length)) * seq.length);
      for (let i = 0; i < x.length; i++) x[i] = seq[i % seq.length];
      break;
    }
    case 'burst': {
      const len = Math.max(1, Math.round((s.cycles / s.f) * fs)), period = Math.round((s.intervalMs / 1000) * fs);
      for (let at = 0; at + len <= n; at += period) {
        for (let i = 0; i < len; i++) {
          const g = s.hannBurst ? 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / len) : 1;
          x[at + i] = g * Math.sin((2 * Math.PI * s.f * i) / fs + ph);
        }
      }
      break;
    }
    case 'white': for (let i = 0; i < n; i++) x[i] = 2 * rand() - 1; break;
    case 'pink': {
      // фильтр Пола Келлета: −3 дБ на октаву в пределах ±0,05 дБ выше 10 Гц
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < n; i++) {
        const w = 2 * rand() - 1;
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
        x[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
        b6 = w * 0.115926;
      }
      break;
    }
    case 'sweep': x = logSweep(s.f1, s.f2, s.seconds, fs, 1); break;
    case 'multitone': {
      // тоны по третям октавы со случайной фазой, на целом числе периодов
      for (let f = s.f1; f <= s.f2; f *= 2 ** (1 / 3)) {
        const cycles = Math.max(1, Math.round((f * n) / fs)), rnd = 2 * Math.PI * rand();
        for (let i = 0; i < n; i++) x[i] += Math.sin((2 * Math.PI * cycles * i) / n + rnd);
      }
      break;
    }
    case 'pulse': {
      // положительная полуволна синуса 1 мс каждые 0,5 с: по знаку отклика видна полярность
      const w = Math.max(2, Math.round(0.001 * fs)), period = Math.round((s.intervalMs / 1000) * fs);
      for (let at = Math.round(0.1 * fs); at + w < n; at += period) for (let i = 0; i < w; i++) x[at + i] = Math.sin((Math.PI * i) / w);
      break;
    }
  }
  if ((s.kind === 'white' || s.kind === 'pink') && s.band !== null) x = octaveBand(x, s.band, fs);
  return normalize(x, peak);
}

/** Каналы [левый, правый] по выбранному каналу и полярности правого. */
export function toChannels(x: Float32Array, channel: SignalChannel, invertRight: boolean): [Float32Array, Float32Array] {
  const silent = new Float32Array(x.length);
  const right = invertRight ? x.map((v) => -v) : x;
  return channel === 'left' ? [x, silent] : channel === 'right' ? [silent, right] : [x, right];
}

/** Каналы сигнала: независимый шум — второй канал из другой последовательности случайных чисел. */
export function signalChannels(s: SignalSettings, fs: number): [Float32Array, Float32Array] {
  const x = synth(s, fs);
  if ((s.kind === 'white' || s.kind === 'pink') && s.uncorrelated && s.channel === 'both') return [x, synth(s, fs, seeded(2))];
  return toChannels(x, s.channel, s.invertRight);
}

/** WAV с частотой файла из настроек (или явно заданной). */
export function signalWav(s: SignalSettings, fs: number = s.wavRate): ArrayBuffer {
  return wavFloat32(signalChannels(s, fs), fs);
}

export function signalFileName(s: SignalSettings): string {
  const range = `${Math.round(s.f1)}-${Math.round(s.f2)}Hz`;
  const what = s.kind === 'sine' || s.kind === 'burst' ? `${s.kind}-${Math.round(s.f)}Hz`
    : s.kind === 'sweep' || s.kind === 'linear-sweep' || s.kind === 'multitone' || s.kind === 'two-tone' || (s.kind === 'stepped' && !s.list.trim()) ? `${s.kind}-${range}`
    : s.kind === 'mls' ? `mls-${s.mlsOrder}` : s.band ? `${s.kind}-${s.band}Hz` : s.kind;
  const ch = s.uncorrelated && (s.kind === 'white' || s.kind === 'pink') && s.channel === 'both' ? '_uncorrelated' : '';
  return `${what}_${s.levelDb}dBFS_${n1s(signalSeconds(s))}s_${s.channel}${s.invertRight ? '_inv' : ''}${ch}_${s.wavRate / 1000}k.wav`;
}
const n1s = (v: number) => String(Math.round(v * 10) / 10);

export type TestGroup = 'channels' | 'reference' | 'band';
export interface TestSignal { id: string; group: TestGroup; title: string; text: string; settings: SignalSettings }

/** Готовые сигналы (V2-037): проверка каналов, полярности, полос и свипы. */
export const TEST_SIGNALS: readonly TestSignal[] = [
  { id: 'left', group: 'channels', title: 'Левый канал', text: 'Розовый шум только в левой колонке', settings: { ...DEFAULT_SIGNAL, channel: 'left' } },
  { id: 'right', group: 'channels', title: 'Правый канал', text: 'Розовый шум только в правой колонке', settings: { ...DEFAULT_SIGNAL, channel: 'right' } },
  { id: 'center', group: 'channels', title: 'Оба канала синфазно', text: 'Звук собирается в центре между колонками', settings: { ...DEFAULT_SIGNAL } },
  { id: 'out-of-phase', group: 'channels', title: 'Оба канала в противофазе', text: 'Звук «размыт» и без баса — так звучит перепутанная полярность', settings: { ...DEFAULT_SIGNAL, invertRight: true } },
  { id: 'polarity', group: 'channels', title: 'Импульсы полярности', text: 'Положительные импульсы для проверки полярности измерителем', settings: { ...DEFAULT_SIGNAL, kind: 'pulse', seconds: 5 } },
  { id: 'reference', group: 'reference', title: 'Синус 1 кГц', text: 'Опорный тон для выставления уровня', settings: { ...DEFAULT_SIGNAL, kind: 'sine', f: 1000 } },
  { id: 'sweep-full', group: 'reference', title: 'Свип 20 Гц – 20 кГц', text: 'Логарифмический свип 10 с для внешних программ', settings: { ...DEFAULT_SIGNAL, kind: 'sweep', f1: 20, f2: 20000, seconds: 10 } },
  { id: 'sweep-bass', group: 'reference', title: 'Свип 15–200 Гц', text: 'Низкочастотный свип для сабвуфера и мод', settings: { ...DEFAULT_SIGNAL, kind: 'sweep', f1: 15, f2: 200, seconds: 10 } },
  ...OCTAVES.slice(1, 8).map((b) => ({
    id: `band-${b}`, group: 'band' as const, title: `Шум в октаве ${b >= 1000 ? `${b / 1000} кГц` : `${b} Гц`}`, text: 'Розовый шум одной октавы',
    settings: { ...DEFAULT_SIGNAL, band: b },
  })),
];

/** Уровень, превышаемый p % времени (L10, L50, L90), по секундным уровням; null — данных нет. */
export function exceeded(levelsDb: readonly number[], p: number): number | null {
  const v = levelsDb.filter(Number.isFinite).sort((a, b) => b - a);
  if (!v.length) return null;
  const k = Math.min(v.length - 1, Math.max(0, Math.ceil((p / 100) * v.length) - 1));
  return v[k];
}
