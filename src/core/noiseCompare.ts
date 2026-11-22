import { bandCells, bandPowers, SPECTRUM_SIZE, type SpectrumPeriod, type Weight } from './noiseSpectrum';
import { spectrogramEdges } from './noiseTimeline';
import { recordHeader, type NoiseRecord, type NoiseView } from './noiseRecord';

/**
 * Сравнение двух сохранённых измерений (056). Обе стороны — цифровая шкала dBFS; абсолютная привязка не применяется.
 * Спектры приводятся к общим полосам 1/12 октавы интегрированием мощности бинов по их ячейкам (геометрия bandPowers):
 * энергия сохраняется, интерполяции между бинами нет. Исторические данные не пересчитываются с текущим профилем.
 */
export interface CompareSide { record: NoiseRecord; view: NoiseView }
export interface CompareOptions { weight: Weight; period: SpectrumPeriod; corrected: boolean }
export type CheckLevel = 'ok' | 'warn' | 'block';
export type CheckKey = 'units' | 'kind' | 'weight' | 'grid' | 'averaging' | 'calibration' | 'input' | 'range';
export interface CompareCheck { key: CheckKey; level: CheckLevel; detail: string }

const BINS = SPECTRUM_SIZE / 2 + 1;
const profileLabel = (p: { name: string; version: number } | null) => p ? `${p.name} · v${p.version}` : 'без профиля';
const db = (p: number | null | undefined) => p != null && p > 0 ? 10 * Math.log10(p) : null;

export interface SideSpectrum {
  available: boolean;
  missing: 'noSpectrum' | 'weight' | null;
  weight: Weight;
  period: SpectrumPeriod;
  seconds: number;
  corrected: boolean;
  profile: { id: string; name: string; version: number } | null;
  binHz: number;
  sampleRate: number;
  density: Float64Array | null;
}

/** Спектр стороны: у сеанса — любой вес и период; у импорта schema 2/3 — только сохранённые в файле. */
export function sideSpectrum({ record, view }: CompareSide, o: CompareOptions): SideSpectrum {
  const profile = view.profile && { id: view.profile.id, name: view.profile.name, version: view.profile.version };
  const base = { profile, binHz: view.spectral.binHz, sampleRate: view.sampleRate };
  if (record.content.type === 'legacy') {
    const l = record.content.legacy, sp = l.spectrum;
    if (!sp?.psd) return { ...base, available: false, missing: 'noSpectrum', weight: sp?.weight ?? o.weight, period: sp?.period ?? o.period, seconds: 0, corrected: false, density: null };
    const corrected = o.corrected && !!l.calibration?.corrected.psd;
    if (sp.weight !== o.weight) return { ...base, available: false, missing: 'weight', weight: sp.weight, period: sp.period, seconds: sp.seconds, corrected, density: null };
    const { density, seconds } = view.spectral.average(sp.period, sp.weight, corrected);
    return { ...base, available: true, missing: null, weight: sp.weight, period: sp.period, seconds, corrected, density };
  }
  const corrected = o.corrected && !!view.profile;
  const { density, seconds } = view.spectral.average(o.period, o.weight, corrected);
  return { ...base, available: seconds > 0, missing: seconds > 0 ? null : 'noSpectrum', weight: o.weight, period: o.period, seconds, corrected, density: seconds > 0 ? density : null };
}

function inputOf({ record }: CompareSide) {
  const capture = record.content.type === 'session' ? record.content.session.capture : record.content.legacy.capture;
  const model = record.content.type === 'session' ? record.context.input?.confirmedModel ?? record.content.session.calibration?.model ?? null
    : record.content.legacy.calibration?.model ?? null;
  const settings = (capture?.settings ?? {}) as Record<string, unknown>;
  const processing = ['autoGainControl', 'noiseSuppression', 'echoCancellation'].map(k => settings[k] ?? null);
  return { model, source: record.context.input?.source ?? null, backend: capture?.backend ?? null, processing };
}

/** Энергия бинов в полосах edges: Σ PSD[k]·Δf·(пересечение/ячейка); средняя PSD полосы = мощность / ширина. */
export function bandDensity(density: Float64Array, binHz: number, edges: readonly number[]) {
  return bandCells(binHz, BINS, edges).map(cell => {
    let power = 0;
    for (let i = 0; i < cell.bins.length; i++) power += density[cell.bins[i]] * binHz * cell.width[i] / cell.span[i];
    return { lo: cell.lo, hi: cell.hi, power, psd: power / (cell.hi - cell.lo) };
  });
}

export function compareRecords(a: CompareSide, b: CompareSide, o: CompareOptions) {
  const A = sideSpectrum(a, o), B = sideSpectrum(b, o);
  const ha = recordHeader(a.record), hb = recordHeader(b.record);
  const checks: CompareCheck[] = [];
  const absolute = a.record.context.absolute || b.record.context.absolute;
  checks.push({ key: 'units', level: 'ok', detail: absolute ? 'absolute' : '' });
  const missing = [A, B].map((s, i) => s.missing === 'noSpectrum' ? 'AB'[i] : '').join('');
  checks.push({ key: 'kind', level: missing ? 'block' : 'ok', detail: missing });
  const weights = A.weight === B.weight;
  checks.push({ key: 'weight', level: weights ? 'ok' : 'block', detail: A.weight + '/' + B.weight });
  checks.push({ key: 'grid', level: A.sampleRate === B.sampleRate ? 'ok' : 'warn', detail: `${A.sampleRate}/${B.sampleRate}` });
  checks.push({ key: 'averaging', level: A.period === B.period ? 'ok' : 'warn', detail: `${A.period}/${B.period}` });
  const sameProfile = A.profile?.id === B.profile?.id && A.profile?.version === B.profile?.version;
  const calibration: CheckLevel = A.corrected !== B.corrected || (A.corrected && !sameProfile) ? 'warn' : 'ok';
  checks.push({ key: 'calibration', level: calibration,
    detail: `${A.corrected ? profileLabel(A.profile) : 'исходный'} / ${B.corrected ? profileLabel(B.profile) : 'исходный'}` });
  const ia = inputOf(a), ib = inputOf(b);
  const knownInput = ia.model !== null && ib.model !== null && ia.backend !== null && ib.backend !== null;
  const sameInput = JSON.stringify(ia) === JSON.stringify(ib);
  checks.push({ key: 'input', level: knownInput && sameInput ? 'ok' : 'warn', detail: `${ia.model ?? '?'} / ${ib.model ?? '?'}` });
  const upper = Math.min(A.sampleRate, B.sampleRate) / 2;
  checks.push({ key: 'range', level: upper < 20000 ? 'warn' : 'ok', detail: String(Math.min(20000, upper)) });
  const spectral = A.available && B.available && weights;
  let bands: { f: number; lo: number; hi: number; a: number; b: number; diff: number | null }[] | null = null;
  let six: { lo: number; hi: number; a: number; b: number; shareA: number | null; shareB: number | null; diff: number | null }[] | null = null;
  if (spectral) {
    const edges = spectrogramEdges(Math.min(A.sampleRate, B.sampleRate));
    const da = bandDensity(A.density!, A.binHz, edges), dbb = bandDensity(B.density!, B.binHz, edges);
    bands = da.map((x, i) => {
      const y = dbb[i], la = db(x.psd), lb = db(y.psd);
      return { f: Math.sqrt(x.lo * x.hi), lo: x.lo, hi: x.hi, a: x.psd, b: y.psd, diff: la !== null && lb !== null ? lb - la : null };
    });
    const pa = bandPowers(A.density!, A.binHz), pb = bandPowers(B.density!, B.binHz);
    six = pa.map((x, i) => {
      const la = db(x.power), lb = db(pb[i].power);
      return { lo: x.lo, hi: x.hi, a: x.power, b: pb[i].power, shareA: x.percent, shareB: pb[i].percent, diff: la !== null && lb !== null ? lb - la : null };
    });
  }
  const leq = (['Z', 'A', 'C'] as const).map(w => {
    const la = db(ha.leq[w]), lb = db(hb.leq[w]);
    return { weight: w, a: ha.leq[w], b: hb.leq[w], diff: la !== null && lb !== null ? lb - la : null };
  });
  return { a: A, b: B, checks, spectral, bands, six, leq, headers: [ha, hb] as const };
}
