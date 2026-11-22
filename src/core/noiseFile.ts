import type { MicProfile } from './micCalibration';
import { maxBoostDb } from './micCurve';
import { FFT_SIZE, type NoiseBlocksData, type NoiseMeter, type NoiseRows } from './noise';
import { bandPowers, SPECTRUM_HOP, SPECTRUM_SIZE, type PowerRange, type SpectrumPeriod, type Weight } from './noiseSpectrum';
import {
  checkRecord, isPeriod, isWeight, MAX_NAME_LENGTH, NoiseRecordError, type LegacyNoiseV1, type NoiseRecord, type NoiseRecordContent,
} from './noiseRecord';

/**
 * Файлы шумомера (056). Прежний экспорт schema 2/3 строится здесь без изменений полей и смысла; расширенный экспорт —
 * schema 4 с полной записью истории. Импорт читает schema 4 и совместимые schema 2/3 в пределах их данных.
 */
export const NOISE_EXPORT_KIND = 'room-acoustics/noise-export';
export const NOISE_EXPORT_SCHEMA = 4;
export const MAX_IMPORT_BYTES = 64 * 2 ** 20;

/** Состояние экрана шумомера, из которого строится прежний экспорт. */
export interface LegacyReportState {
  date: string;
  status: string;
  error: string | null;
  path: { sampleRate: number; backend: string; constraintsFallback: boolean; [key: string]: unknown } | null;
  measurement: ReturnType<NoiseMeter['snapshot']> | null;
  manual: string;
  name: string;
  audioStartMs: number | null;
  history: NoiseRows;
}

/** Прежний JSON шумомера: schema 2 без профиля, schema 3 с профилем. Поля и порядок — как до 056. */
export function legacyReport(meter: NoiseMeter | null, last: LegacyReportState, o: {
  weight: Weight; period: SpectrumPeriod; model: string | null | undefined; build: { sha: string; time: string };
  secureContext: boolean; microphoneApi: boolean;
}) {
  const { weight, period } = o;
  const spectrum = meter?.spectral.average(period, weight);
  const corrected = meter?.profile ? meter.spectral.average(period, weight, true) : null;
  const measurement = meter?.snapshot() ?? last.measurement;
  const origin = meter?.audioStartMs ?? last.audioStartMs;
  const name = last.name.trim();
  return {
    ...(meter?.profile && corrected ? { calibration: {
      profile: meter.profile, model: o.model, maxBoostDb: meter.profile.maxBoostDb ?? maxBoostDb, outsideRange: 'uncorrected',
      correctedSpectrum: { period, weight, seconds: corrected.seconds, units: 'FS²/Hz',
        psd: corrected.seconds ? Array.from(corrected.density) : null,
        meanSquare: corrected.seconds ? corrected.density.reduce((sum, v) => sum + v, 0) * meter.spectral.binHz : null,
        bands: corrected.seconds ? bandPowers(corrected.density, meter.spectral.binHz) : [] },
    } } : {}),
    schema: meter?.profile ? 3 : 2, build: o.build, mode: 'raw', units: 'dBFS', fftSize: FFT_SIZE,
    window: 'periodic Hann', spectrum: 'one-sided peak amplitude per bin', rmsWindowSamples: FFT_SIZE,
    secureContext: o.secureContext, microphoneApi: o.microphoneApi,
    ...last, name, measurement, rmsAverageSeconds: 1, audioStartMs: origin,
    spectralAnalysis: meter && spectrum && {
      fftSize: SPECTRUM_SIZE, hopSamples: SPECTRUM_HOP, binHz: meter.spectral.binHz, weight, period,
      validSpectralSeconds: spectrum.seconds, psdUnits: 'FS²/Hz',
      psd: spectrum.seconds ? Array.from(spectrum.density) : null,
      bands: spectrum.seconds ? bandPowers(spectrum.density, meter.spectral.binHz) : [],
      bandPowerUnits: 'FS²', leqPower: weight === 'Z' ? meter.sessionPower : meter.spectral.leqPower(weight),
      leqSeconds: weight === 'Z' ? meter.history.length * FFT_SIZE / meter.sampleRate : meter.spectral.weightedSeconds,
      rmsWindowSamples: weight === 'Z' ? FFT_SIZE : SPECTRUM_SIZE,
      rmsPower: weight === 'Z' ? meter.blockPower : meter.spectral.range[weight],
      sessionPeakAmplitude: meter.peakAmplitude,
    },
    history: Array.from({ length: (meter?.history ?? last.history).length }, (_, i) => {
      const point = (meter?.history ?? last.history).at(i)!;
      return { ...point, timestamp: new Date(origin! + point.endSeconds * 1000).toISOString() };
    }),
  };
}

// Типизированные массивы в JSON: {$typed, length, base64} — байты little-endian, base64 RFC 4648.
const TYPED = { Float64Array, Float32Array, Uint32Array, Uint16Array, Uint8Array } as const;
type TypedName = keyof typeof TYPED;
const littleEndian = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
function toBase64(bytes: Uint8Array) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(out);
}
function encode(value: unknown): unknown {
  if (ArrayBuffer.isView(value)) {
    const name = value.constructor.name as TypedName;
    if (!(name in TYPED) || !littleEndian) throw new Error('Неподдерживаемый массив ' + name);
    return { $typed: name, length: (value as unknown as ArrayLike<number>).length, base64: toBase64(new Uint8Array(value.buffer, value.byteOffset, value.byteLength)) };
  }
  if (Array.isArray(value)) return value.map(encode);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, encode(v)]));
  return value;
}
const bad = (reason: string): never => { throw new NoiseRecordError('invalid', 'Файл измерения повреждён: ' + reason + '.'); };
function decode(value: unknown, budget: { bytes: number }): unknown {
  if (Array.isArray(value)) return value.map(v => decode(v, budget));
  if (!value || typeof value !== 'object') return value;
  const o = value as Record<string, unknown>;
  if ('$typed' in o) {
    const type = TYPED[o.$typed as TypedName];
    if (!Object.hasOwn(TYPED, o.$typed as string) || !Number.isSafeInteger(o.length) || (o.length as number) < 0 || typeof o.base64 !== 'string')
      bad('неверный массив');
    const size = (o.length as number) * type.BYTES_PER_ELEMENT;
    if ((budget.bytes -= size) < 0) throw new NoiseRecordError('size', 'Измерение в файле больше предела одной записи 48 МиБ.');
    let text: string;
    try { text = atob(o.base64 as string); } catch { return bad('неверный base64'); }
    if (text.length !== size || !littleEndian) bad('длина массива не совпадает');
    const bytes = new Uint8Array(size);
    for (let i = 0; i < size; i++) bytes[i] = text.charCodeAt(i);
    return new type(bytes.buffer);
  }
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, decode(v, budget)]));
}

/** Расширенный экспорт: запись истории целиком. Заголовок списка не входит: он выводится из содержимого. */
export function exportRecord(r: NoiseRecord, build: { sha: string; time: string }, now = new Date()) {
  checkRecord(r);
  return JSON.stringify({
    kind: NOISE_EXPORT_KIND, schema: NOISE_EXPORT_SCHEMA, exportedAt: now.toISOString(), exportBuild: build,
    note: 'Измерение шумомера Room Acoustics: суммы и счётчики сеанса, спектры, снимок калибровки. Уровни — цифровая шкала dBFS, не дБ SPL. Запись звука не входит.',
    encoding: 'Типизированные массивы: {"$typed", "length", "base64"} — байты little-endian, base64 RFC 4648.',
    record: { id: r.id, name: r.name, savedAt: r.savedAt, project: r.project, imported: r.imported, context: encode(r.context), content: encode(r.content) },
  });
}

/** Хеш cyrb53: устойчивый идентификатор импортированного файла schema 2/3. */
function hash(text: string) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const powerOrNull = (v: unknown, what: string) => {
  if (v === null || v === undefined) return null;
  return finite(v) && v >= 0 ? v : bad('недопустимое значение ' + what);
};
const text = (v: unknown, limit: number) => typeof v === 'string' ? v.slice(0, limit) : '';
function psdOf(v: unknown, what: string) {
  if (v === null || v === undefined) return null;
  if (!Array.isArray(v) || v.length !== SPECTRUM_SIZE / 2 + 1) return bad('неверная длина ' + what);
  if (!v.every(x => finite(x) && x >= 0)) bad('недопустимое значение ' + what);
  return Float64Array.from(v as number[]);
}
function rangeOf(v: unknown): PowerRange | null {
  if (v === null || v === undefined) return null;
  const r = v as Record<string, unknown>;
  return { current: powerOrNull(r.current, 'RMS'), min: powerOrNull(r.min, 'RMS'), max: powerOrNull(r.max, 'RMS') };
}
// Диагностика тракта: известные поля и простые значения; deviceId, groupId и названия не переносятся.
const audioKeys = ['echoCancellation', 'noiseSuppression', 'autoGainControl', 'channelCount', 'sampleRate'];
function simple(v: unknown, depth = 0): unknown {
  if (v === null || typeof v === 'boolean' || finite(v)) return v;
  if (typeof v === 'string') return v.slice(0, 40);
  if (depth < 1 && Array.isArray(v)) return v.slice(0, 8).map(x => simple(x, depth + 1));
  if (depth < 1 && v && typeof v === 'object') return Object.fromEntries(Object.entries(v).filter(([k]) => ['min', 'max', 'step', 'ideal', 'exact'].includes(k)).map(([k, x]) => [k, simple(x, depth + 1)]));
  return null;
}
function captureOf(path: unknown, sampleRate: number): LegacyNoiseV1['capture'] {
  const p = path as Record<string, unknown>;
  if (!['AudioWorklet', 'ScriptProcessor'].includes(p.backend as string)) return bad('неизвестный тракт PCM');
  const group = (key: string) => {
    const o = p[key];
    return o && typeof o === 'object' ? Object.fromEntries(audioKeys.map(k => [k, simple((o as Record<string, unknown>)[k])])) : {};
  };
  return { sampleRate, backend: p.backend as string, constraintsFallback: p.constraintsFallback === true,
    supported: group('supported'), settings: group('settings'), capabilities: group('capabilities'), constraints: group('constraints') };
}

/** Точки history schema 2/3 → колонки блоков. Время и частота должны лежать точно на сетке блока 4096. */
function blocksOf(rows: unknown[], fs: number): NoiseBlocksData {
  const n = rows.length;
  if (n > Math.ceil(12 * 3600 * fs / FFT_SIZE)) bad('история длиннее 12 ч');
  const b: NoiseBlocksData = { next: new Uint32Array(n), rms: new Float64Array(n), rms1s: new Float64Array(n), peakBin: new Uint16Array(n),
    flags: new Uint8Array(n), missingBefore: new Uint32Array(n) };
  let previous = 0;
  for (let i = 0; i < n; i++) {
    const r = rows[i] as Record<string, unknown>;
    if (!r || typeof r !== 'object' || !finite(r.endSeconds) || !Number.isSafeInteger(r.missingBefore) || (r.missingBefore as number) < 0 ||
        typeof r.windowComplete !== 'boolean' || typeof r.clipped !== 'boolean') bad('неверная точка истории ' + i);
    const next = Math.round((r.endSeconds as number) * fs / FFT_SIZE);
    if (next * FFT_SIZE / fs !== r.endSeconds || next !== previous + 1 + (r.missingBefore as number)) bad('время точки истории ' + i + ' не на сетке блоков');
    for (const key of ['rmsDbfs', 'rms1sDbfs']) if (r[key] !== null && !finite(r[key])) bad('недопустимый уровень в точке ' + i);
    let peakBin = 0xffff;
    if (r.peakHz !== null) {
      const bin = finite(r.peakHz) ? Math.round((r.peakHz as number) * FFT_SIZE / fs) : -1;
      if (bin < 0 || bin > FFT_SIZE / 2 || bin * fs / FFT_SIZE !== r.peakHz) bad('частота пика в точке ' + i + ' не на сетке');
      peakBin = bin;
    }
    b.next[i] = previous = next;
    b.rms[i] = (r.rmsDbfs as number | null) ?? NaN;
    b.rms1s[i] = (r.rms1sDbfs as number | null) ?? NaN;
    b.peakBin[i] = peakBin;
    b.flags[i] = (r.windowComplete ? 1 : 0) | (r.clipped ? 2 : 0);
    b.missingBefore[i] = r.missingBefore as number;
  }
  return b;
}

function legacyOf(d: Record<string, unknown>): LegacyNoiseV1 {
  const schema = d.schema as 2 | 3;
  if (d.units !== 'dBFS' || d.mode !== 'raw' || d.fftSize !== FFT_SIZE || !Array.isArray(d.history)) bad('это не экспорт шумомера schema 2/3');
  const path = d.path as Record<string, unknown> | null;
  const fs = path?.sampleRate;
  if (!finite(fs) || fs < 8000 || fs > 768000) return bad('нет частоты дискретизации');
  const blocks = blocksOf(d.history as unknown[], fs);
  const m = d.measurement as Record<string, unknown> | null;
  if (m && typeof m === 'object') {
    let missing = 0, clipped = 0;
    for (let i = 0; i < blocks.next.length; i++) { missing += blocks.missingBefore[i]; if (blocks.flags[i] & 2) clipped++; }
    if (m.blocks !== blocks.next.length || m.missing !== missing || m.clipped !== clipped) bad('сводка измерения не совпадает с историей');
  }
  let spectrum: LegacyNoiseV1['spectrum'] = null, calibration: LegacyNoiseV1['calibration'] = null;
  const a = d.spectralAnalysis as Record<string, unknown> | null | undefined;
  if (a) {
    if (a.fftSize !== SPECTRUM_SIZE || a.hopSamples !== SPECTRUM_HOP || a.binHz !== fs / SPECTRUM_SIZE || a.psdUnits !== 'FS²/Hz' ||
        !isWeight(a.weight) || !isPeriod(a.period) || !finite(a.validSpectralSeconds) || a.validSpectralSeconds < 0)
      bad('неверные параметры спектра');
    const psd = psdOf(a.psd, 'PSD');
    spectrum = { weight: a.weight as Weight, period: a.period as SpectrumPeriod, seconds: a.validSpectralSeconds as number, psd,
      leqPower: powerOrNull(a.leqPower, 'Leq'), leqSeconds: finite(a.leqSeconds) && a.leqSeconds >= 0 ? a.leqSeconds : bad('неверная длительность Leq'),
      rmsPower: rangeOf(a.rmsPower), sessionPeakAmplitude: powerOrNull(a.sessionPeakAmplitude, 'пика') };
  }
  const c = d.calibration as Record<string, unknown> | undefined;
  if (c) {
    const cs = c.correctedSpectrum as Record<string, unknown>;
    if (!spectrum || !cs || cs.period !== spectrum.period || cs.weight !== spectrum.weight || cs.seconds !== spectrum.seconds ||
        c.outsideRange !== 'uncorrected' || (c.model != null && typeof c.model !== 'string') || !finite(c.maxBoostDb)) bad('неверный снимок калибровки');
    calibration = { profile: c.profile as MicProfile,
      model: (c.model as string | undefined) ?? null, maxBoostDb: c.maxBoostDb as number,
      corrected: { seconds: cs.seconds as number, psd: psdOf(cs.psd, 'PSD с поправкой'), meanSquare: powerOrNull(cs.meanSquare, 'среднего квадрата') } };
  }
  const build = d.build as Record<string, unknown> | undefined;
  const legacy: LegacyNoiseV1 = {
    schema, sampleRate: fs, name: text(d.name, MAX_NAME_LENGTH), date: typeof d.date === 'string' && Number.isFinite(Date.parse(d.date)) ? d.date : null,
    status: text(d.status, 300), manual: ['untested', 'passed', 'failed'].includes(d.manual as string) ? d.manual as string : 'untested',
    build: build && typeof build.sha === 'string' ? { sha: build.sha.slice(0, 40), time: text(build.time, 40) } : null,
    audioStartMs: finite(d.audioStartMs) ? d.audioStartMs : null, capture: captureOf(path, fs), blocks, spectrum, calibration,
  };
  return legacy;
}

export interface ImportedFile { record: NoiseRecord; schema: number }

/** Разбор файла: schema 4 — запись целиком с её идентификатором; schema 2/3 — новая запись с идентификатором по содержимому. */
export function parseNoiseFile(source: string, fileName: string, now = new Date()): ImportedFile {
  if (source.length > MAX_IMPORT_BYTES) throw new NoiseRecordError('size', 'Файл больше 64 МиБ: такой импорт не поддерживается.');
  let d: Record<string, unknown>;
  try { d = JSON.parse(source.replace(/^﻿/, '')); } catch { throw new NoiseRecordError('invalid', 'Файл повреждён: это не JSON.'); }
  if (!d || typeof d !== 'object' || Array.isArray(d)) bad('нет данных');
  if (d.format === 'room-acoustics-project') throw new NoiseRecordError('invalid', 'Это файл проекта комнаты, а не измерение шумомера. Откройте его в «Проектах».');
  const imported = { at: now.toISOString(), file: fileName.slice(0, 200), schema: 0 };
  if (d.kind === NOISE_EXPORT_KIND) {
    if (typeof d.schema !== 'number' || d.schema > NOISE_EXPORT_SCHEMA) throw new NoiseRecordError('newer', 'Файл создан более новой версией приложения. Обновите приложение.');
    if (d.schema !== NOISE_EXPORT_SCHEMA) bad('неизвестная схема ' + String(d.schema));
    const r = d.record as Record<string, unknown>;
    if (!r || typeof r !== 'object') bad('нет записи');
    const budget = { bytes: 48 * 2 ** 20 };
    const record = { id: r.id, name: r.name, savedAt: r.savedAt, project: r.project ?? null, imported: { ...imported, schema: NOISE_EXPORT_SCHEMA },
      context: decode(r.context, budget), content: decode(r.content, budget) } as NoiseRecord;
    return { record: checkRecord(record), schema: NOISE_EXPORT_SCHEMA };
  }
  if (d.schema === 1) throw new NoiseRecordError('invalid', 'Файл schema 1 (этап A) не содержит истории измерения: импорт не поддерживается.');
  if (d.schema !== 2 && d.schema !== 3) throw new NoiseRecordError('invalid', 'Неизвестный формат файла. Поддерживаются экспорты шумомера schema 2, 3 и 4.');
  const legacy = legacyOf(d);
  const key = JSON.stringify([legacy.schema, legacy.sampleRate, legacy.audioStartMs, legacy.date, legacy.blocks.next.length,
    legacy.blocks.next.at(-1) ?? 0, legacy.spectrum?.leqPower ?? null, legacy.spectrum?.weight ?? null, legacy.spectrum?.period ?? null]);
  const content: NoiseRecordContent = { type: 'legacy', legacy };
  const record: NoiseRecord = { id: 'legacy-' + hash(key), name: legacy.name, savedAt: now.toISOString(), project: null,
    imported: { ...imported, schema: legacy.schema }, context: { view: { weight: legacy.spectrum?.weight ?? 'Z', period: legacy.spectrum?.period ?? 'session',
      corrected: !!legacy.calibration }, input: null, absolute: null, ranges: null }, content };
  return { record: checkRecord(record), schema: legacy.schema };
}

/** Новая запись того же содержимого под другим идентификатором (импорт копией). */
export const asCopy = (r: NoiseRecord, id: string): NoiseRecord => ({ ...r, id });
