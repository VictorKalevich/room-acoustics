// Синтетические сеансы шумомера для тестов истории (056) и файлов e2e: тот же тракт NoiseMeter, без микрофона.
import type { MicProfile } from '../../src/core/micCalibration';
import { FFT_SIZE, NoiseMeter } from '../../src/core/noise';
import { legacyReport } from '../../src/core/noiseFile';
import type { NoiseRecord } from '../../src/core/noiseRecord';
import { createNoiseSession } from '../../src/core/noiseSession';
import type { SpectrumPeriod, Weight } from '../../src/core/noiseSpectrum';

export const START_MS = Date.UTC(2026, 10, 22, 9, 30, 0);
export const BUILD = { sha: 'fixture', time: '2026-11-22T09:00:00.000Z' };
export const testProfile: MicProfile = {
  id: 'fixture-profile', name: 'Тестовая поправка', version: 1, origin: 'user', deviceModel: 'test', inputKind: 'unknown', captureMode: 'test',
  orientation: null, sourceURL: null, sourceDate: null, method: 'synthetic', referenceHz: 1000, validRangeHz: [20, 20000],
  digitizationUncertaintyDb: null, validationStatus: 'unverified', notes: '', directivitySource: null,
  curve: { kind: 'correction', frequencyHz: [20, 1000, 20000], correctionDb: [6, 0, -3] },
};

export interface ToneOptions { fs?: number; seconds?: number; hz?: number | ((t: number) => number); amp?: number | ((t: number) => number);
  profile?: MicProfile | null; skip?: (seq: number) => boolean; clipAt?: number }
/** Синус по номеру отсчёта; пропуски не передаются, время блока — по START_MS. */
export function toneMeter(o: ToneOptions = {}) {
  const fs = o.fs ?? 48000, blocks = Math.ceil((o.seconds ?? 12) * fs / FFT_SIZE);
  const meter = new NoiseMeter(fs, o.profile ?? null);
  const at = <T>(v: T | ((t: number) => T), t: number) => typeof v === 'function' ? (v as (t: number) => T)(t) : v;
  for (let seq = 0; seq < blocks; seq++) {
    if (o.skip?.(seq)) continue;
    const pcm = Float32Array.from({ length: FFT_SIZE }, (_, i) => {
      const n = seq * FFT_SIZE + i, t = n / fs;
      return at(o.amp ?? 0.25, t) * Math.sin(2 * Math.PI * at(o.hz ?? 1000, t) * n / fs);
    });
    if (o.clipAt === seq) pcm[0] = 1;
    meter.push(pcm, seq, START_MS + (seq + 1) * FFT_SIZE / fs * 1000);
  }
  return meter;
}

export const capture = (fs: number) => ({
  sampleRate: fs, backend: 'AudioWorklet', constraintsFallback: false,
  supported: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: true, sampleRate: true },
  settings: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1, sampleRate: fs },
  capabilities: { echoCancellation: [true, false], noiseSuppression: [true, false], autoGainControl: [true, false], channelCount: { min: 1, max: 1 }, sampleRate: null },
  constraints: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1, sampleRate: null },
});

/** Запись истории как в NoiseScreen.sessionRecord. */
export function sessionRecord(meter: NoiseMeter, o: { id?: string; name?: string; weight?: Weight; period?: SpectrumPeriod; corrected?: boolean;
  model?: string | null; manual?: string } = {}): NoiseRecord {
  const name = o.name ?? 'Синтетический сеанс';
  return {
    id: o.id ?? 'fixture-' + meter.sampleRate + '-' + (meter.profile ? 'p' : 'n'), name, savedAt: '2026-11-22T10:00:00.000Z', project: null, imported: null,
    context: {
      view: { weight: o.weight ?? 'Z', period: o.period ?? 'session', corrected: o.corrected ?? !!meter.profile },
      input: { source: 'system', confirmedModel: o.model ?? 'iPhone 17 Pro' }, absolute: null,
      ranges: { Z: { ...meter.blockPower }, A: { ...meter.spectral.range.A }, C: { ...meter.spectral.range.C } },
    },
    content: { type: 'session', session: createNoiseSession(meter, { name, stopReason: 'Измерение остановлено', manualCheck: o.manual ?? 'untested',
      build: BUILD, createdAt: '2026-11-22T10:00:00.000Z' }, capture(meter.sampleRate), o.model ?? 'iPhone 17 Pro') },
  };
}

/** Прежний экспорт schema 2/3 той же функцией, что и кнопка «Сохранить JSON». */
export function legacyExport(meter: NoiseMeter, weight: Weight, period: SpectrumPeriod, name = 'Прежний экспорт') {
  const snapshot = meter.snapshot();
  return legacyReport(meter, {
    date: new Date(START_MS).toISOString(), status: 'Измерение остановлено', error: null, path: capture(meter.sampleRate),
    measurement: snapshot, manual: 'passed', name, audioStartMs: meter.audioStartMs, history: meter.history,
  }, { weight, period, model: meter.profile ? 'iPhone 17 Pro' : undefined, build: BUILD, secureContext: true, microphoneApi: true });
}
