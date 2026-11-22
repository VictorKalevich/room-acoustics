import type { MicProfile } from './micCalibration';
import { maxBoostDb } from './micCurve';
import { FFT_SIZE, NoiseBlocks, type NoiseBlocksData, type NoiseMeter } from './noise';
import { SPECTRUM_HOP, SPECTRUM_SIZE, type SpectrumPeriod, type Weight } from './noiseSpectrum';
import { COARSE_SECONDS, FINE_SECONDS, LEVEL_SECONDS, MAX_SESSION_SECONDS, NoiseTimeline, WEIGHTS, type TimelineData } from './noiseTimeline';

/**
 * Снимок завершённого сеанса шумомера (055), контракт для хранения и просмотра в блоке 2.
 * Массивы — типизированные, пригодны для structured clone (IndexedDB). Непрерывный PCM не входит.
 * Исходные данные — суммы и счётчики; уровни dB, окна Leq, доли и цвета спектрограммы выводятся из них при просмотре.
 */
export const NOISE_SESSION_KIND = 'room-acoustics/noise-session';
export const NOISE_SESSION_VERSION = 1;

export const NOISE_SESSION_UNITS = {
  time: 'отсчёты аудиошкалы от начала сеанса; секунды = отсчёты / sampleRate; пропуски занимают своё время',
  pcm: 'цифровая шкала, полная амплитуда 1 (FS)',
  energy: 'FS²·отсчёт: сумма квадратов или мощность × длительность в отсчётах',
  power: 'FS², средний квадрат; уровень 10·log10 — dBFS, не дБ SPL',
  psd: 'FS²/Гц, односторонняя',
  spectrogram: 'средняя PSD полосы 1/12 октавы = мощность полосы / ширина полосы, FS²/Гц; цвет — dBFS/Гц',
} as const;

export interface NoiseSessionV1 {
  kind: typeof NOISE_SESSION_KIND;
  version: typeof NOISE_SESSION_VERSION;
  meta: {
    name: string;
    /** Момент снимка, ISO UTC. */
    createdAt: string;
    /** Начало аудиошкалы по часам устройства, мс UTC, приблизительно. */
    audioStartMs: number | null;
    stopReason: string;
    manualCheck: string;
    build: { sha: string; time: string };
  };
  /** Диагностика тракта без deviceId, groupId и названия входа. */
  capture: { backend: string; sampleRate: number; constraintsFallback: boolean; [key: string]: unknown } | null;
  settings: {
    sampleRate: number;
    blockSamples: number;
    fftSize: number;
    hopSamples: number;
    window: 'periodic Hann';
    levelColumnSeconds: number;
    coarseColumnSeconds: number;
    fineSeconds: number;
    maxSessionSeconds: number;
    /** Порядок вариантов в массивах энергии полос и спектрограммы. */
    variants: { weight: Weight; corrected: boolean }[];
    spectrogramEdgesHz: number[];
    energyEdgesHz: number[];
  };
  /** Снимок профиля, закреплённого за сеансом. Варианты «с поправкой» посчитаны с ним при записи. */
  calibration: { profile: MicProfile; model: string | null; maxBoostDb: number; outsideRange: 'uncorrected' } | null;
  units: typeof NOISE_SESSION_UNITS;
  totals: {
    endSamples: number;
    blocks: number;
    missingBlocks: number;
    clippedBlocks: number;
    sumSquares: number;
    samplePeak: number;
    spectralFrames: number;
    /** Средняя мощность A/C по всем полным кадрам — Leq A/C сеанса до логарифма. */
    weightedPower: { A: number | null; C: number | null };
  };
  /** Точки A по блоку 4096 (как history JSON schema 2). */
  blocks: NoiseBlocksData;
  timeline: TimelineData;
  /** Исходная PSD Z по бинам на момент остановки; A/C и поправка выводятся умножением на коэффициенты бина. */
  spectra: Record<SpectrumPeriod, { seconds: number; psd: Float64Array }>;
}

export function createNoiseSession(meter: NoiseMeter, meta: Omit<NoiseSessionV1['meta'], 'audioStartMs' | 'createdAt'> & { createdAt?: string },
  capture: NoiseSessionV1['capture'], model: string | null): NoiseSessionV1 {
  const timeline = meter.timeline.toData();
  const spectra = Object.fromEntries((['now', '10', '60', 'session'] as const).map(period => {
    const { density, seconds } = meter.spectral.average(period, 'Z');
    return [period, { seconds, psd: density }];
  })) as NoiseSessionV1['spectra'];
  return {
    kind: NOISE_SESSION_KIND, version: NOISE_SESSION_VERSION,
    meta: { ...meta, createdAt: meta.createdAt ?? new Date().toISOString(), audioStartMs: meter.audioStartMs },
    capture,
    settings: {
      sampleRate: meter.sampleRate, blockSamples: FFT_SIZE, fftSize: SPECTRUM_SIZE, hopSamples: SPECTRUM_HOP, window: 'periodic Hann',
      levelColumnSeconds: LEVEL_SECONDS, coarseColumnSeconds: COARSE_SECONDS, fineSeconds: FINE_SECONDS, maxSessionSeconds: MAX_SESSION_SECONDS,
      variants: Array.from({ length: timeline.variants }, (_, v) => ({ weight: WEIGHTS[v % 3], corrected: v >= 3 })),
      spectrogramEdgesHz: timeline.spectrogramEdgesHz, energyEdgesHz: timeline.energyEdgesHz,
    },
    calibration: meter.profile ? { profile: meter.profile, model, maxBoostDb: meter.profile.maxBoostDb ?? maxBoostDb, outsideRange: 'uncorrected' } : null,
    units: NOISE_SESSION_UNITS,
    totals: { ...meter.totals, spectralFrames: meter.spectral.frameCount,
      weightedPower: { A: meter.spectral.leqPower('A'), C: meter.spectral.leqPower('C') } },
    blocks: meter.history.toData(),
    timeline,
    spectra,
  };
}

const fail = (reason: string): never => { throw new Error('Снимок сеанса шумомера: ' + reason); };
function typed<T>(value: unknown, type: new (n: number) => T, length: number, name: string): T {
  if (!(value instanceof type) || (value as unknown as ArrayLike<number>).length !== length) fail('неверный массив ' + name);
  const array = value as unknown as ArrayLike<number>;
  for (let i = 0; i < array.length; i++) if (!(array[i] >= 0) || !Number.isFinite(array[i])) fail('недопустимое значение в ' + name);
  return value as T;
}
function edges(value: unknown, name: string) {
  if (!Array.isArray(value) || value.length < 2 || value.some((v, i) => !Number.isFinite(v) || v <= 0 || (i && v <= value[i - 1])))
    fail('неверные границы ' + name);
  return value as number[];
}

/** Проверка формы и согласованности длин перед просмотром сохранённого сеанса. Неизвестная версия — ошибка. */
export function checkNoiseSession(value: unknown): NoiseSessionV1 {
  const s = value as NoiseSessionV1;
  if (!s || s.kind !== NOISE_SESSION_KIND) fail('неизвестный формат');
  if (s.version !== NOISE_SESSION_VERSION) fail('неподдерживаемая версия ' + String(s.version));
  const { settings, timeline: t, blocks: b } = s;
  if (!settings || !(settings.sampleRate > 0) || settings.blockSamples !== FFT_SIZE || settings.fftSize !== SPECTRUM_SIZE ||
      settings.hopSamples !== SPECTRUM_HOP || !t || t.sampleRate !== settings.sampleRate || t.hop !== settings.hopSamples ||
      ![3, 6].includes(t.variants) || settings.variants?.length !== t.variants || (t.variants === 6) !== !!s.calibration)
    fail('несогласованные настройки');
  const B = edges(t.spectrogramEdgesHz, 'спектрограммы').length - 1, E = edges(t.energyEdgesHz, 'полос').length - 1;
  const L = t.levels?.pcm?.length ?? fail('нет уровней'), M = t.coarse?.spec?.length ?? fail('нет спектрограммы');
  const F = t.fine?.ends?.length ?? fail('нет кадров');
  if (L > Math.ceil(MAX_SESSION_SECONDS) || !(t.end >= 0) || L !== Math.ceil(t.end / settings.sampleRate)) fail('неверная длительность');
  typed(t.levels.pcm, Float64Array, L, 'pcm');
  typed(t.levels.z, Float64Array, L, 'z');
  typed(t.levels.peak, Float32Array, L, 'peak');
  typed(t.levels.spec, Float64Array, L, 'spec');
  typed(t.levels.a, Float64Array, L, 'a');
  typed(t.levels.c, Float64Array, L, 'c');
  typed(t.levels.energy, Float32Array, L * E * t.variants, 'energy');
  typed(t.coarse.spec, Float64Array, M, 'coarse.spec');
  typed(t.coarse.energy, Float32Array, M * B * t.variants, 'coarse.energy');
  typed(t.fine.ends, Float64Array, F, 'fine.ends');
  typed(t.fine.power, Float32Array, F * B * t.variants, 'fine.power');
  if (!Number.isSafeInteger(t.fine.dropped) || t.fine.dropped < 0) fail('неверное число вытесненных кадров');
  const n = b?.next?.length ?? fail('нет блоков');
  typed(b.next, Uint32Array, n, 'next');
  if (!(b.rms instanceof Float64Array) || b.rms.length !== n || !(b.rms1s instanceof Float64Array) || b.rms1s.length !== n) fail('неверные RMS');
  typed(b.peakBin, Uint16Array, n, 'peakBin');
  typed(b.flags, Uint8Array, n, 'flags');
  typed(b.missingBefore, Uint32Array, n, 'missingBefore');
  for (const period of ['now', '10', '60', 'session'] as const) {
    const spectrum = s.spectra?.[period] ?? fail('нет спектра ' + period);
    typed(spectrum.psd, Float64Array, SPECTRUM_SIZE / 2 + 1, 'psd ' + period);
  }
  return s;
}

/** Просмотр сохранённого сеанса теми же функциями, что и живой: история только для чтения. */
export function restoreNoiseSession(session: NoiseSessionV1) {
  const s = checkNoiseSession(session);
  return {
    timeline: new NoiseTimeline(s.timeline),
    blocks: new NoiseBlocks(s.settings.sampleRate, Math.ceil(MAX_SESSION_SECONDS * s.settings.sampleRate / FFT_SIZE), s.blocks),
  };
}

/** Объём массивов снимка, байты. */
export function noiseSessionBytes(s: NoiseSessionV1) {
  const views = [...Object.values(s.blocks), ...Object.values(s.timeline.levels), s.timeline.coarse.spec, s.timeline.coarse.energy,
    s.timeline.fine.ends, s.timeline.fine.power, ...Object.values(s.spectra).map(p => p.psd)];
  return views.reduce((sum, a: ArrayBufferView) => sum + a.byteLength, 0);
}
