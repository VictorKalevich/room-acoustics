import type { MicProfile } from './micCalibration';
import { powerGains, validateProfile } from './micCurve';
import { FFT_SIZE, NoiseBlocks, type NoiseBlocksData, type NoiseRows } from './noise';
import { checkNoiseSession, noiseSessionBytes, restoreNoiseSession, type NoiseSessionV1 } from './noiseSession';
import { emptyPowerRange, SPECTRUM_HOP, SPECTRUM_SIZE, weightPower, type PowerRange, type SpectrumPeriod, type Weight } from './noiseSpectrum';
import { checkRoomSnapshot, type NoiseRoomSnapshot } from './noiseModes';
import { MAX_SESSION_SECONDS, type NoiseTimeline } from './noiseTimeline';

/**
 * Запись постоянной истории шумомера (056). Содержимое — неизменяемый снимок сеанса NoiseSessionV1 (055)
 * или данные импортированного экспорта schema 2/3; контекст — сведения захвата вне снимка; заголовок — сводка для списка,
 * всегда выводится из содержимого. Уровни dB, окна, доли и цвета выводятся при просмотре.
 */
export const NOISE_RECORD_FORMAT = 1;
/** Предел одной записи (массивы): сеанс 12 ч с профилем — около 38 МиБ. */
export const MAX_RECORD_BYTES = 48 * 2 ** 20;
/** Пределы всей истории. При заполнении новая запись не сохраняется; удаление — только по действию пользователя. */
export const MAX_HISTORY_BYTES = 512 * 2 ** 20;
export const MAX_HISTORY_RECORDS = 500;
export const MAX_NAME_LENGTH = 100;

export const PERIODS: readonly SpectrumPeriod[] = ['now', '10', '60', 'session'];
const BINS = SPECTRUM_SIZE / 2 + 1;

/** Импорт schema 2/3: только данные, которые в файле были. Спектр — одного веса и одного периода. */
export interface LegacyNoiseV1 {
  schema: 2 | 3;
  sampleRate: number;
  name: string;
  date: string | null;
  status: string;
  manual: string;
  build: { sha: string; time: string } | null;
  audioStartMs: number | null;
  capture: NoiseSessionV1['capture'];
  blocks: NoiseBlocksData;
  spectrum: {
    weight: Weight; period: SpectrumPeriod; seconds: number; psd: Float64Array | null;
    leqPower: number | null; leqSeconds: number; rmsPower: PowerRange | null; sessionPeakAmplitude: number | null;
  } | null;
  calibration: {
    profile: MicProfile; model: string | null; maxBoostDb: number;
    corrected: { seconds: number; psd: Float64Array | null; meanSquare: number | null };
  } | null;
}

export type NoiseRecordContent = { type: 'session'; session: NoiseSessionV1 } | { type: 'legacy'; legacy: LegacyNoiseV1 };

/** Сведения захвата вне снимка сеанса. Идентификаторы устройства не хранятся. */
export interface NoiseRecordContext {
  /** Представление на экране в момент сохранения. */
  view: { weight: Weight; period: SpectrumPeriod; corrected: boolean };
  input: { source: 'system' | 'selected'; confirmedModel: string | null } | null;
  /** Абсолютная привязка входа, действительная для этого входа и тракта. Только сведения: уровни остаются dBFS. */
  absolute: { offsetDb: number; verifiedAt: string; references: { referenceSpl: number; measuredDbfs: number }[] } | null;
  /** Экстремумы RMS блоков (Z) и кадров A/C; из снимка не выводятся. */
  ranges: { Z: PowerRange; A: PowerRange; C: PowerRange } | null;
  /** 057: комната проекта на момент измерения — только при явной связи с проектом. Нет у записей 056. */
  room?: NoiseRoomSnapshot | null;
}

export interface NoiseRecord {
  id: string;
  name: string;
  savedAt: string;
  project: { id: string; name: string } | null;
  imported: { at: string; file: string; schema: number } | null;
  context: NoiseRecordContext;
  content: NoiseRecordContent;
}

/** Сводка для списка. Не хранит данных, которых нет в записи. */
export interface NoiseRecordHeader {
  id: string;
  format: typeof NOISE_RECORD_FORMAT;
  name: string;
  savedAt: string;
  startedAt: string | null;
  activeSeconds: number;
  spanSeconds: number;
  sampleRate: number;
  source: 'session' | 'legacy';
  sourceVersion: number;
  /** Средняя мощность сеанса, FS² (Leq до логарифма); null — нет данных этого веса. */
  leq: Record<Weight, number | null>;
  spectrumWeight: Weight | null;
  calibration: { id: string; version: number; name: string } | null;
  absolute: boolean;
  bytes: number;
  project: { id: string; name: string } | null;
  imported: NoiseRecord['imported'];
  build: { sha: string; time: string } | null;
  missingBlocks: number;
  clippedBlocks: number;
}

/** Ошибка содержимого или хранилища истории с кодом для интерфейса. */
export class NoiseRecordError extends Error {
  constructor(readonly code: 'invalid' | 'corrupt' | 'conflict' | 'full' | 'limit' | 'newer' | 'unavailable' | 'missing' | 'size', message: string) {
    super(message);
    this.name = 'NoiseRecordError';
  }
}
const invalid = (reason: string): never => { throw new NoiseRecordError('invalid', reason); };

const typedViews = (o: object): ArrayBufferView[] => Object.values(o).filter(ArrayBuffer.isView);
export function contentBytes(c: NoiseRecordContent) {
  if (c.type === 'session') return noiseSessionBytes(c.session);
  const l = c.legacy;
  return [...typedViews(l.blocks), l.spectrum?.psd, l.calibration?.corrected.psd].reduce((n, a) => n + (a?.byteLength ?? 0), 0);
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const nonNegative = (v: unknown): v is number => finite(v) && v >= 0;
const optionalPower = (v: unknown) => v === null || nonNegative(v);
const isRange = (r: unknown): r is PowerRange => !!r && typeof r === 'object' &&
  ['current', 'min', 'max'].every(k => optionalPower((r as Record<string, unknown>)[k]));
export const isWeight = (v: unknown): v is Weight => v === 'Z' || v === 'A' || v === 'C';
export const isPeriod = (v: unknown): v is SpectrumPeriod => PERIODS.includes(v as SpectrumPeriod);
const isoOrNull = (v: unknown) => v === null || (typeof v === 'string' && Number.isFinite(Date.parse(v)));

/** Колонки блоков: длины, номера блоков по возрастанию и счётчики пропусков согласованы. */
export function checkBlocks(b: NoiseBlocksData, sampleRate: number) {
  const n = b?.next?.length;
  if (!(b?.next instanceof Uint32Array) || !(b.rms instanceof Float64Array) || !(b.rms1s instanceof Float64Array) ||
      !(b.peakBin instanceof Uint16Array) || !(b.flags instanceof Uint8Array) || !(b.missingBefore instanceof Uint32Array) ||
      [b.rms, b.rms1s, b.peakBin, b.flags, b.missingBefore].some(a => a.length !== n)) invalid('неверные колонки блоков');
  if (n > Math.ceil(MAX_SESSION_SECONDS * sampleRate / FFT_SIZE)) invalid('история длиннее 12 ч');
  let previous = 0;
  for (let i = 0; i < n; i++) {
    if (b.next[i] !== previous + 1 + b.missingBefore[i]) invalid('неверная нумерация блоков');
    previous = b.next[i];
    if (!(Number.isNaN(b.rms[i]) || finite(b.rms[i])) || !(Number.isNaN(b.rms1s[i]) || finite(b.rms1s[i])) || b.flags[i] > 3 ||
        (b.peakBin[i] !== 0xffff && b.peakBin[i] > FFT_SIZE / 2)) invalid('недопустимое значение блока');
  }
  return b;
}

/** Импортированные данные schema 2/3 после преобразования: формы, единицы и согласованность. */
export function checkLegacy(l: LegacyNoiseV1) {
  if (!l || ![2, 3].includes(l.schema) || !finite(l.sampleRate) || l.sampleRate < 8000 || l.sampleRate > 768000)
    invalid('неверная частота дискретизации');
  if (typeof l.name !== 'string' || typeof l.status !== 'string' || typeof l.manual !== 'string' || !isoOrNull(l.date) ||
      !(l.audioStartMs === null || finite(l.audioStartMs))) invalid('неверные сведения измерения');
  checkBlocks(l.blocks, l.sampleRate);
  const s = l.spectrum;
  if (s) {
    if (!isWeight(s.weight) || !isPeriod(s.period) || !nonNegative(s.seconds) || !optionalPower(s.leqPower) || !nonNegative(s.leqSeconds) ||
        !(s.rmsPower === null || isRange(s.rmsPower)) || !optionalPower(s.sessionPeakAmplitude)) invalid('неверный спектр');
    if (s.psd !== null) checkPsd(s.psd, 'спектра');
    if ((s.psd === null) !== (s.seconds === 0)) invalid('спектр не согласован с длительностью');
  }
  if ((l.schema === 3) !== !!l.calibration) invalid('schema 3 требует снимок калибровки, schema 2 — без него');
  if (l.calibration) {
    const c = l.calibration;
    validateProfile(c.profile);
    if (!s || !(c.model === null || typeof c.model === 'string') || !nonNegative(c.maxBoostDb) || c.corrected.seconds !== s!.seconds ||
        !optionalPower(c.corrected.meanSquare)) invalid('неверный спектр с поправкой');
    if (c.corrected.psd !== null) checkPsd(c.corrected.psd, 'спектра с поправкой');
    if ((c.corrected.psd === null) !== (s!.psd === null)) invalid('спектр с поправкой не согласован с исходным');
  }
  return l;
}
function checkPsd(psd: Float64Array, name: string) {
  if (!(psd instanceof Float64Array) || psd.length !== BINS) invalid('неверная длина ' + name);
  for (let k = 0; k < BINS; k++) if (!nonNegative(psd[k])) invalid('недопустимое значение ' + name);
}

/** Итоги снимка согласованы с его массивами (дополняет checkNoiseSession для данных из файла и базы). */
function checkTotals(s: NoiseSessionV1) {
  const t = s.totals, b = s.blocks, n = b.next.length;
  checkBlocks(b, s.settings.sampleRate);
  let missing = 0, clipped = 0;
  for (let i = 0; i < n; i++) { missing += b.missingBefore[i]; if (b.flags[i] & 2) clipped++; }
  if (!t || t.blocks !== n || t.missingBlocks !== missing || t.clippedBlocks !== clipped || t.endSamples !== s.timeline.end ||
      t.endSamples !== (n ? b.next[n - 1] * FFT_SIZE : 0) || !nonNegative(t.sumSquares) || !nonNegative(t.samplePeak) ||
      !Number.isSafeInteger(t.spectralFrames) || t.spectralFrames < 0 || !optionalPower(t.weightedPower?.A) || !optionalPower(t.weightedPower?.C))
    invalid('итоги сеанса не согласованы с данными');
  for (const p of PERIODS) if (!nonNegative(s.spectra[p].seconds)) invalid('неверная длительность спектра ' + p);
  const m = s.meta;
  if (!m || typeof m.name !== 'string' || !isoOrNull(m.createdAt) || !(m.audioStartMs === null || finite(m.audioStartMs)))
    invalid('неверные сведения сеанса');
  if (s.calibration) validateProfile(s.calibration.profile);
}

export function checkContext(c: NoiseRecordContext) {
  if (!c || !c.view || !isWeight(c.view.weight) || !isPeriod(c.view.period) || typeof c.view.corrected !== 'boolean') invalid('неверное представление');
  if (c.input !== null && (!c.input || !['system', 'selected'].includes(c.input.source) ||
      !(c.input.confirmedModel === null || typeof c.input.confirmedModel === 'string'))) invalid('неверные сведения входа');
  const a = c.absolute;
  if (a !== null && (!a || !finite(a.offsetDb) || !isoOrNull(a.verifiedAt) || !Array.isArray(a.references) ||
      a.references.some(r => !finite(r?.referenceSpl) || !finite(r?.measuredDbfs)))) invalid('неверная абсолютная привязка');
  if (c.ranges !== null && (!c.ranges || !(['Z', 'A', 'C'] as const).every(w => isRange(c.ranges![w])))) invalid('неверные экстремумы');
  if (c.room != null) try { checkRoomSnapshot(c.room); } catch (e) { invalid((e as Error).message); }
  return c;
}

/** Проверка записи целиком перед сохранением и после чтения. Повреждённая запись — ошибка без частичного чтения. */
export function checkRecord(r: NoiseRecord): NoiseRecord {
  if (!r || typeof r.id !== 'string' || !/^[A-Za-z0-9-]{8,64}$/.test(r.id)) invalid('неверный идентификатор');
  if (typeof r.name !== 'string' || r.name.length > MAX_NAME_LENGTH || !isoOrNull(r.savedAt) || !r.savedAt) invalid('неверное название или дата');
  if (r.project !== null && (typeof r.project?.id !== 'string' || typeof r.project.name !== 'string')) invalid('неверная связь с проектом');
  if (r.imported !== null && (!isoOrNull(r.imported?.at) || typeof r.imported?.file !== 'string' || !Number.isSafeInteger(r.imported.schema)))
    invalid('неверные сведения импорта');
  checkContext(r.context);
  if (r.context.room != null && r.project === null) invalid('снимок комнаты без связи с проектом');
  const c = r.content;
  try {
    if (c?.type === 'session') { checkNoiseSession(c.session); checkTotals(c.session); }
    else if (c?.type === 'legacy') checkLegacy(c.legacy);
    else invalid('неизвестное содержимое');
  } catch (e) {
    if (e instanceof NoiseRecordError) throw e;
    invalid((e as Error).message);
  }
  if (contentBytes(c) > MAX_RECORD_BYTES) throw new NoiseRecordError('size', 'Измерение больше предела одной записи 48 МиБ.');
  if (c.type === 'legacy' && r.context.ranges !== null) invalid('экстремумы есть только у сеанса');
  return r;
}

const blocksPower = (b: NoiseBlocksData) => {
  let sum = 0;
  for (let i = 0; i < b.rms.length; i++) if (!Number.isNaN(b.rms[i])) sum += 10 ** (b.rms[i] / 10);
  return b.rms.length ? sum / b.rms.length : null;
};

export function recordHeader(r: NoiseRecord): NoiseRecordHeader {
  const base = { id: r.id, format: NOISE_RECORD_FORMAT, name: r.name, savedAt: r.savedAt, project: r.project, imported: r.imported,
    absolute: r.context.absolute !== null, bytes: contentBytes(r.content) } as const;
  const iso = (ms: number | null) => ms === null ? null : new Date(ms).toISOString();
  if (r.content.type === 'session') {
    const s = r.content.session, t = s.totals, fs = s.settings.sampleRate;
    return { ...base, startedAt: iso(s.meta.audioStartMs), activeSeconds: t.blocks * FFT_SIZE / fs, spanSeconds: t.endSamples / fs,
      sampleRate: fs, source: 'session', sourceVersion: s.version, spectrumWeight: null,
      leq: { Z: t.blocks ? t.sumSquares / (t.blocks * FFT_SIZE) : null, A: t.weightedPower.A, C: t.weightedPower.C },
      calibration: s.calibration && { id: s.calibration.profile.id, version: s.calibration.profile.version, name: s.calibration.profile.name },
      build: s.meta.build, missingBlocks: t.missingBlocks, clippedBlocks: t.clippedBlocks };
  }
  const l = r.content.legacy, n = l.blocks.next.length, sp = l.spectrum;
  let missing = 0, clipped = 0;
  for (let i = 0; i < n; i++) { missing += l.blocks.missingBefore[i]; if (l.blocks.flags[i] & 2) clipped++; }
  const leq: Record<Weight, number | null> = { Z: blocksPower(l.blocks), A: null, C: null };
  if (sp) leq[sp.weight] = sp.leqPower;
  return { ...base, startedAt: iso(l.audioStartMs) ?? l.date, activeSeconds: n * FFT_SIZE / l.sampleRate,
    spanSeconds: n ? l.blocks.next[n - 1] * FFT_SIZE / l.sampleRate : 0, sampleRate: l.sampleRate, source: 'legacy', sourceVersion: l.schema,
    spectrumWeight: sp?.weight ?? null, leq,
    calibration: l.calibration && { id: l.calibration.profile.id, version: l.calibration.profile.version, name: l.calibration.profile.name },
    build: l.build, missingBlocks: missing, clippedBlocks: clipped };
}

/** Спектральная часть, которую читают панели шумомера: живой NoiseSpectrum или сохранённая запись. */
export interface NoiseSpectralView {
  readonly binHz: number;
  readonly range: Readonly<Record<'A' | 'C', PowerRange>>;
  readonly weightedSeconds: number;
  leqPower(weight: 'A' | 'C'): number | null;
  average(period: SpectrumPeriod, weight: Weight, corrected?: boolean): { density: Float64Array; seconds: number };
}
/** Только чтение измерения: NoiseMeter или запись истории. История уровней (timeline) есть только у сеанса 055. */
export interface NoiseView {
  readonly sampleRate: number;
  readonly profile: MicProfile | null;
  readonly history: NoiseRows;
  readonly timeline: NoiseTimeline | null;
  readonly spectral: NoiseSpectralView;
  readonly blockPower: PowerRange;
  readonly sessionPower: number | null;
  readonly peakAmplitude: number | null;
  readonly audioStartMs: number | null;
  snapshot(): { activeSeconds: number; blocks: number; missing: number; clipped: number; missingFraction: number | null; clippedFraction: number | null };
}

function counts(blocks: number, missing: number, clipped: number, fs: number) {
  return { activeSeconds: blocks * FFT_SIZE / fs, blocks, missing, clipped,
    missingFraction: blocks ? missing / (blocks + missing) : null, clippedFraction: blocks ? clipped / blocks : null };
}
const copyRange = (r: PowerRange | null | undefined): PowerRange => r ? { ...r } : emptyPowerRange();

/** Те же множители бинов, что у NoiseSpectrum: результат совпадает с живым average побитно. */
function gains(binHz: number, profile: MicProfile | null) {
  const of = (w: Weight) => Float64Array.from({ length: BINS }, (_, k) => weightPower(k * binHz, w));
  return { A: of('A'), C: of('C'), calibration: profile ? powerGains(profile, binHz, BINS) : null };
}
function apply(density: Float64Array, weight: Weight, corrected: boolean, g: ReturnType<typeof gains>) {
  if (weight !== 'Z') for (let k = 0; k < BINS; k++) density[k] *= g[weight][k];
  if (corrected && g.calibration) for (let k = 0; k < BINS; k++) density[k] *= g.calibration[k];
  return density;
}

/** Просмотр записи теми же панелями, что и живой шумомер. Сохранённые суммы не пересчитываются с текущим профилем. */
export function recordView(content: NoiseRecordContent, context: NoiseRecordContext): NoiseView {
  if (content.type === 'session') {
    const s = content.session, fs = s.settings.sampleRate, t = s.totals, profile = s.calibration?.profile ?? null;
    const { timeline, blocks } = restoreNoiseSession(s);
    const binHz = fs / SPECTRUM_SIZE, g = gains(binHz, profile);
    return {
      sampleRate: fs, profile, history: blocks, timeline, audioStartMs: s.meta.audioStartMs,
      blockPower: copyRange(context.ranges?.Z),
      sessionPower: t.blocks ? t.sumSquares / (t.blocks * FFT_SIZE) : null,
      peakAmplitude: t.blocks ? t.samplePeak : null,
      spectral: {
        binHz, range: { A: copyRange(context.ranges?.A), C: copyRange(context.ranges?.C) },
        weightedSeconds: t.spectralFrames * SPECTRUM_HOP / fs,
        leqPower: w => t.weightedPower[w],
        average(period, weight, corrected = false) {
          const { psd, seconds } = s.spectra[period];
          return { density: apply(psd.slice(), weight, corrected, g), seconds };
        },
      },
      snapshot: () => counts(t.blocks, t.missingBlocks, t.clippedBlocks, fs),
    };
  }
  const l = content.legacy, fs = l.sampleRate, sp = l.spectrum, n = l.blocks.next.length;
  const history = new NoiseBlocks(fs, Math.max(n, 1), l.blocks);
  const header = recordHeader({ id: 'legacy-view', name: '', savedAt: '', project: null, imported: null, context, content });
  let low: number | null = null, high: number | null = null;
  for (let i = 0; i < n; i++) {
    const p = Number.isNaN(l.blocks.rms[i]) ? 0 : 10 ** (l.blocks.rms[i] / 10);
    low = Math.min(low ?? p, p); high = Math.max(high ?? p, p);
  }
  const last = n ? (Number.isNaN(l.blocks.rms[n - 1]) ? 0 : 10 ** (l.blocks.rms[n - 1] / 10)) : null;
  const range = (w: Weight) => sp?.weight === w && sp.rmsPower ? { ...sp.rmsPower } : emptyPowerRange();
  return {
    sampleRate: fs, profile: l.calibration?.profile ?? null, history, timeline: null, audioStartMs: l.audioStartMs,
    blockPower: sp?.weight === 'Z' && sp.rmsPower ? { ...sp.rmsPower } : { current: last, min: low, max: high },
    // Z по сохранённым RMS блоков: средняя мощность блока, как sumSquares / (blocks·4096).
    sessionPower: sp?.weight === 'Z' && sp.leqPower !== null ? sp.leqPower : header.leq.Z,
    peakAmplitude: sp?.sessionPeakAmplitude ?? null,
    spectral: {
      binHz: fs / SPECTRUM_SIZE, range: { A: range('A'), C: range('C') },
      weightedSeconds: sp && sp.weight !== 'Z' ? sp.leqSeconds : 0,
      leqPower: w => sp?.weight === w ? sp.leqPower : null,
      average(period, weight, corrected = false) {
        if (!sp || sp.period !== period || sp.weight !== weight || !sp.psd) return { density: new Float64Array(BINS), seconds: 0 };
        const source = corrected && l.calibration?.corrected.psd ? l.calibration.corrected.psd : sp.psd;
        return { density: source.slice(), seconds: sp.seconds };
      },
    },
    snapshot: () => counts(n, header.missingBlocks, header.clippedBlocks, fs),
  };
}

export type NoiseWarning =
  | { code: 'missing'; blocks: number; fraction: number } | { code: 'clipped'; blocks: number } | { code: 'limit' }
  | { code: 'processing'; flags: string[] } | { code: 'fallback' } | { code: 'noProfile' } | { code: 'manualFailed' }
  | { code: 'legacy'; schema: number } | { code: 'legacySpectrum'; weight: Weight; period: SpectrumPeriod } | { code: 'noSpectrum' }
  | { code: 'absolute' };

/** Пропуски, предупреждения и ограничения достоверности, выведенные из сохранённых данных. */
export function recordWarnings(r: NoiseRecord): NoiseWarning[] {
  const h = recordHeader(r), list: NoiseWarning[] = [];
  const capture = r.content.type === 'session' ? r.content.session.capture : r.content.legacy.capture;
  if (h.missingBlocks) list.push({ code: 'missing', blocks: h.missingBlocks, fraction: h.missingBlocks / (h.missingBlocks + h.activeSeconds * h.sampleRate / FFT_SIZE) });
  if (h.clippedBlocks) list.push({ code: 'clipped', blocks: h.clippedBlocks });
  if (r.content.type === 'session' && r.content.session.totals.endSamples + FFT_SIZE > MAX_SESSION_SECONDS * h.sampleRate) list.push({ code: 'limit' });
  const settings = (capture?.settings ?? {}) as Record<string, unknown>;
  const flags = ['autoGainControl', 'noiseSuppression', 'echoCancellation'].filter(k => settings[k] === true);
  if (flags.length) list.push({ code: 'processing', flags });
  if (capture?.constraintsFallback === true) list.push({ code: 'fallback' });
  if (!h.calibration) list.push({ code: 'noProfile' });
  const manual = r.content.type === 'session' ? r.content.session.meta.manualCheck : r.content.legacy.manual;
  if (manual === 'failed') list.push({ code: 'manualFailed' });
  if (r.content.type === 'legacy') {
    const sp = r.content.legacy.spectrum;
    list.push({ code: 'legacy', schema: r.content.legacy.schema });
    list.push(sp?.psd ? { code: 'legacySpectrum', weight: sp.weight, period: sp.period } : { code: 'noSpectrum' });
  }
  if (r.context.absolute) list.push({ code: 'absolute' });
  return list;
}
