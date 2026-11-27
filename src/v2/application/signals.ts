// Тестовые сигналы генераторов (V2-037) и статистика уровней шумомера (V2-036). Свип и октавная полоса — функции
// ядра; уровень сигнала — пиковый, в дБ относительно полной шкалы, в безопасных пределах (R34).
import { logSweep, octaveBand, wavFloat32 } from '../../core/dsp';

export type SignalKind = 'sine' | 'white' | 'pink' | 'sweep' | 'multitone' | 'pulse';
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
}

export const LEVEL_MIN = -60;
export const LEVEL_MAX = -6;
export const LEVEL_DEFAULT = -20;
export const MAX_SECONDS = 60;
export const OCTAVES = [31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000] as const;
export const SIGNAL_LABEL: Record<SignalKind, string> = {
  sine: 'Синус', white: 'Белый шум', pink: 'Розовый шум', sweep: 'Логарифмический свип', multitone: 'Мультитон', pulse: 'Импульсы',
};
/** Повторяются без пауз: свип и импульсы — однократно (импульсы и так периодичны в буфере). */
export const LOOPED: Record<SignalKind, boolean> = { sine: true, white: true, pink: true, sweep: false, multitone: true, pulse: false };

export const DEFAULT_SIGNAL: SignalSettings = { kind: 'pink', levelDb: LEVEL_DEFAULT, seconds: 10, f: 1000, f1: 20, f2: 20000, band: null, channel: 'both', invertRight: false };

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

export function signalIssues(s: SignalSettings, fs: number): string[] {
  const out: string[] = [];
  const nyq = fs / 2;
  if (!(s.levelDb >= LEVEL_MIN && s.levelDb <= LEVEL_MAX)) out.push(`Уровень — от ${LEVEL_MIN} до ${LEVEL_MAX} дБ полной шкалы.`);
  if (!(s.seconds >= 0.5 && s.seconds <= MAX_SECONDS)) out.push(`Длительность — от 0,5 до ${MAX_SECONDS} с.`);
  if (s.kind === 'sine' && !(s.f >= 10 && s.f < nyq)) out.push(`Частота синуса — от 10 Гц до ${Math.round(nyq)} Гц.`);
  if ((s.kind === 'sweep' || s.kind === 'multitone') && !(s.f1 >= 10 && s.f2 > s.f1 && s.f2 < nyq)) out.push(`Диапазон — от 10 Гц, верхняя частота выше нижней и ниже ${Math.round(nyq)} Гц.`);
  return out;
}

const normalize = (x: Float32Array, peak: number) => {
  let m = 0;
  for (let i = 0; i < x.length; i++) m = Math.max(m, Math.abs(x[i]));
  if (m > 0) for (let i = 0; i < x.length; i++) x[i] *= peak / m;
  return x;
};

/** Моно-сигнал с пиком ровно levelDb. Повторяемые — на целом числе периодов, у свипа плавные края ядра. */
export function synth(s: SignalSettings, fs: number, rand = seeded(1)): Float32Array {
  const n = Math.max(1, Math.round(s.seconds * fs));
  const peak = 10 ** (s.levelDb / 20);
  let x: Float32Array = new Float32Array(n);
  switch (s.kind) {
    case 'sine': {
      // целое число периодов в буфере — повтор без щелчка
      const cycles = Math.max(1, Math.round((s.f * n) / fs));
      for (let i = 0; i < n; i++) x[i] = Math.sin((2 * Math.PI * cycles * i) / n);
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
        const cycles = Math.max(1, Math.round((f * n) / fs)), ph = 2 * Math.PI * rand();
        for (let i = 0; i < n; i++) x[i] += Math.sin((2 * Math.PI * cycles * i) / n + ph);
      }
      break;
    }
    case 'pulse': {
      // положительная полуволна синуса 1 мс каждые 0,5 с: по знаку отклика видна полярность
      const w = Math.max(2, Math.round(0.001 * fs)), period = Math.round(0.5 * fs);
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

export function signalWav(s: SignalSettings, fs: number): ArrayBuffer {
  return wavFloat32(toChannels(synth(s, fs), s.channel, s.invertRight), fs);
}

export function signalFileName(s: SignalSettings): string {
  const what = s.kind === 'sine' ? `sine-${Math.round(s.f)}Hz` : s.kind === 'sweep' || s.kind === 'multitone' ? `${s.kind}-${Math.round(s.f1)}-${Math.round(s.f2)}Hz` : s.band ? `${s.kind}-${s.band}Hz` : s.kind;
  return `${what}_${s.levelDb}dBFS_${s.seconds}s_${s.channel}${s.invertRight ? '_inv' : ''}.wav`;
}

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
