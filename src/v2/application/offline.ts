// Обработка записи из файла и многоточечные замеры (V2-049). Свип записывается любой программой (например, файл
// генератора, сыгранный другим плеером) и обрабатывается здесь деконволюцией ядра; импульсная характеристика (WAV из
// REW и т. п.) — окном и спектром. Время прихода — только по петле (loopback): второй канал записи с электрической
// копией сигнала; разность пиков двух деконволюций — время пролёта без задержек звуковой карты.
import { analyzeSweep, convolve, inverseSweep, logGrid, logSweep, nextPow2, powerAverage, smoothOct, spectrumDb, sweepSegment, type SweepResult } from '../../core/dsp';
import { measurementAt } from '../../core/measure';
import type { MeasurementData, MeasurementPoint, MeasurementRecord } from '../domain/measurement';
import { analyzeSweepBand } from './analyzer';

// ---------- WAV ----------

export interface WavData { fs: number; channels: Float32Array[]; bits: number; float: boolean }

/** WAV: PCM 8/16/24/32 бит и плавающая точка 32/64 бит, в том числе WAVE_FORMAT_EXTENSIBLE. */
export function decodeWav(buf: ArrayBuffer): WavData {
  const v = new DataView(buf);
  const tag = (at: number) => String.fromCharCode(v.getUint8(at), v.getUint8(at + 1), v.getUint8(at + 2), v.getUint8(at + 3));
  if (buf.byteLength < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('Это не файл WAV.');
  let fmt: { format: number; ch: number; fs: number; bits: number; align: number } | null = null;
  let data: { at: number; len: number } | null = null;
  for (let p = 12; p + 8 <= buf.byteLength;) {
    const id = tag(p), len = v.getUint32(p + 4, true), body = p + 8;
    if (id === 'fmt ') {
      let format = v.getUint16(body, true);
      if (format === 0xfffe && len >= 26) format = v.getUint16(body + 24, true);
      fmt = { format, ch: v.getUint16(body + 2, true), fs: v.getUint32(body + 4, true), bits: v.getUint16(body + 14, true), align: v.getUint16(body + 12, true) };
    } else if (id === 'data') data = { at: body, len: Math.min(len, buf.byteLength - body) };
    p = body + len + (len % 2);
  }
  if (!fmt || !data) throw new Error('В файле WAV нет описания формата или данных.');
  const { format, ch, fs, bits, align } = fmt;
  const float = format === 3;
  if (!(format === 1 || float) || ch < 1 || fs < 8000 || !align) throw new Error('Формат WAV не поддерживается: нужен PCM или плавающая точка.');
  if (float ? bits !== 32 && bits !== 64 : ![8, 16, 24, 32].includes(bits)) throw new Error(`Разрядность ${bits} бит не поддерживается.`);
  const n = Math.floor(data.len / align), step = bits / 8;
  const channels = Array.from({ length: ch }, () => new Float32Array(n));
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < ch; k++) {
      const at = data.at + i * align + k * step;
      channels[k][i] = float ? (bits === 32 ? v.getFloat32(at, true) : v.getFloat64(at, true))
        : bits === 8 ? (v.getUint8(at) - 128) / 128
        : bits === 16 ? v.getInt16(at, true) / 32768
        : bits === 24 ? (((v.getUint8(at + 2) << 24) | (v.getUint8(at + 1) << 16) | (v.getUint8(at) << 8)) >> 8) / 8388608
        : v.getInt32(at, true) / 2147483648;
    }
  }
  return { fs, channels, bits, float };
}

// ---------- Свип и импульсная характеристика ----------

export interface SweepParams { f1: number; f2: number; seconds: number }

export interface Arrival {
  /** Время пролёта от колонки до микрофона по петле, мс, и соответствующее расстояние, м. */
  ms: number;
  distance: number;
}

export interface OfflineResult extends SweepResult {
  /** Пик импульсной характеристики от начала файла (без петли в него входят задержки звуковой карты и плеера), мс. */
  peakMs: number;
  arrival: Arrival | null;
  warnings: string[];
}

/** Индекс пика модуля и сам пик. */
function peakOf(x: ArrayLike<number>): { at: number; v: number } {
  let at = 0, v = 0;
  for (let i = 0; i < x.length; i++) if (Math.abs(x[i]) > v) { v = Math.abs(x[i]); at = i; }
  return { at, v };
}

/** Начало участка внутри записи (subarray той же памяти). */
const offsetOf = (part: Float32Array, whole: Float32Array) => (part.byteOffset - whole.byteOffset) / 4;

/**
 * Запись свипа: АЧХ как у инструмента «Измерение АЧХ свипом» (полоса 15–500 Гц, если свип её покрывает и выше
 * 1 кГц не уходит, иначе 20 Гц – 20 кГц в пределах свипа). С петлёй — время пролёта по разности пиков деконволюций.
 */
export function analyzeSweepRecording(mic: Float32Array, fs: number, p: SweepParams, speed: number, loop?: Float32Array): OfflineResult {
  const nyq = fs / 2;
  if (!(p.f1 >= 5 && p.f2 > p.f1 && p.f2 < nyq) || !(p.seconds >= 0.5)) throw new Error(`Параметры свипа: от 5 Гц, верхняя частота выше нижней и ниже ${Math.round(nyq)} Гц, длительность от 0,5 с.`);
  const sweep = logSweep(p.f1, p.f2, p.seconds, fs, 1);
  const guide = loop ?? mic;
  if (guide.length < sweep.length) throw new Error('Запись короче свипа: проверьте длительность свипа и файл.');
  const seg = sweepSegment(guide, sweep.length, fs);
  if (!seg) throw new Error('Свип не найден в записи: запись оборвана или тишина.');
  const start = offsetOf(seg, guide);
  const segMic = mic.subarray(start, start + seg.length);
  const low = p.f1 <= 15 && p.f2 <= 1000;
  const r = low ? analyzeSweep(segMic, sweep, p.f1, p.f2, fs) : analyzeSweepBand(segMic, sweep, p.f1, p.f2, fs, Math.max(20, p.f1), Math.min(20000, p.f2, nyq - 1));
  const inv = inverseSweep(sweep, p.f1, p.f2, fs);
  const zero = peakOf(convolve(sweep, inv)).at;
  const pm = peakOf(convolve(segMic, inv));
  const warnings: string[] = [];
  if (r.peak > 0.98) warnings.push('Перегрузка записи: пик у полной шкалы — АЧХ может быть искажена.');
  if (r.peak < 0.01) warnings.push('Очень тихая запись: мало запаса над шумом.');
  if (r.snrDb < 20) warnings.push(`Мало запаса над шумом (${Math.round(r.snrDb)} дБ).`);
  let arrival: Arrival | null = null;
  if (loop) {
    const pl = peakOf(convolve(seg, inv));
    if (pl.v <= 0) warnings.push('В канале петли нет сигнала: время прихода не определено.');
    else {
      const ms = ((pm.at - pl.at) / fs) * 1000;
      if (ms < -0.5) warnings.push('Сигнал микрофона пришёл раньше петли: каналы, вероятно, перепутаны — время прихода не сохранено.');
      else arrival = { ms: Math.max(0, ms), distance: (Math.max(0, ms) / 1000) * speed };
    }
  }
  return { ...r, peakMs: ((start + pm.at - zero) / fs) * 1000, arrival, warnings };
}

/** Импульсная характеристика из файла: окно 10 мс до пика и 1 с после (как у ядра), спектр, сглаживание 1/24 октавы. */
export function analyzeImpulse(ir: Float32Array, fs: number): OfflineResult {
  if (ir.length < Math.round(0.05 * fs)) throw new Error('Импульсная характеристика короче 50 мс.');
  const pk = peakOf(ir);
  if (pk.v <= 0) throw new Error('В файле тишина.');
  const pre = Math.round(0.01 * fs), post = Math.round(1.0 * fs);
  const cut = new Float64Array(pre + post);
  for (let i = 0; i < cut.length; i++) {
    const j = pk.at - pre + i;
    const tail = i > pre + post * 0.7 ? 0.5 * (1 + Math.cos((Math.PI * (i - pre - post * 0.7)) / (post * 0.3))) : 1;
    cut[i] = j >= 0 && j < ir.length ? ir[j] * tail : 0;
  }
  const hi = Math.min(20000, (fs / 2) * 0.9);
  const f = logGrid(15, hi, 48);
  const db = spectrumDb(cut, fs, f, nextPow2(cut.length));
  let noise = 0, nc = 0;
  for (let i = Math.max(0, pk.at - Math.round(0.6 * fs)); i < pk.at - Math.round(0.1 * fs); i++) { noise += ir[i] * ir[i]; nc++; }
  const snrDb = nc ? 10 * Math.log10((pk.v * pk.v) / (noise / nc + 1e-30)) : 60;
  const warnings = ir.length - pk.at < post * 0.5 ? ['Импульсная характеристика обрезана раньше 0,5 с после пика: низкие частоты и моды занижены.'] : [];
  return { f, db: smoothOct(f, db, 1 / 24), peak: pk.v, snrDb, irPeakAt: pk.at / fs, peakMs: (pk.at / fs) * 1000, arrival: null, warnings };
}

// ---------- Несколько точек ----------

export interface PointAverage {
  f: number[];
  db: number[];
  /** Разброс между точками: наименьший и наибольший уровень на частоте, дБ. */
  min: number[];
  max: number[];
  count: number;
}

/**
 * Среднее по мощности нескольких АЧХ на сетке первой в общей полосе (логарифмическая интерполяция ядра). Уровни не
 * выравниваются: замеры без калибровки сравнимы, только если громкость и усиление не менялись между точками.
 */
export function averagePoints(items: readonly Pick<MeasurementData, 'f' | 'db'>[]): PointAverage {
  if (items.length < 2) throw new Error('Для среднего нужны хотя бы два замера.');
  const lo = Math.max(...items.map((m) => m.f[0])), hi = Math.min(...items.map((m) => m.f[m.f.length - 1]));
  if (!(hi > lo)) throw new Error('Полосы замеров не пересекаются.');
  const grid = items[0].f.filter((x) => x >= lo && x <= hi);
  const curves = items.map((m) => measurementAt({ name: '', importedAt: '', f: m.f, db: m.db }, grid) as number[]);
  return {
    f: grid, db: powerAverage(curves), count: items.length,
    min: grid.map((_, i) => Math.min(...curves.map((c) => c[i]))), max: grid.map((_, i) => Math.max(...curves.map((c) => c[i]))),
  };
}

// ---------- Временная привязка ----------

export interface AlignmentRow { id: string; name: string; sourceIds: string[]; arrivalMs: number; distance: number; addMs: number }
export interface AlignmentGroup { point: string; rows: AlignmentRow[] }

const pointKey = (p: MeasurementPoint | undefined) => p?.label ?? 'Точка не указана';

/**
 * Время прихода источников в одной точке по замерам с петлёй. Чтобы звук пришёл одновременно, к каждому источнику,
 * кроме самого позднего, добавляется задержка до времени самого позднего (уменьшить задержку нельзя).
 */
export function alignment(records: readonly MeasurementRecord[]): AlignmentGroup[] {
  const timed = records.filter((r) => r.timing?.ref === 'loopback');
  const groups = new Map<string, MeasurementRecord[]>();
  for (const r of timed) groups.set(pointKey(r.point), [...(groups.get(pointKey(r.point)) ?? []), r]);
  return [...groups].map(([point, rs]) => {
    const latest = Math.max(...rs.map((r) => r.timing!.arrivalMs));
    return {
      point,
      rows: rs.map((r) => ({ id: r.id, name: r.name, sourceIds: r.sourceIds ?? [], arrivalMs: r.timing!.arrivalMs, distance: r.timing!.distance ?? 0, addMs: latest - r.timing!.arrivalMs }))
        .sort((a, b) => a.arrivalMs - b.arrivalMs),
    };
  });
}

/** Поздняя привязка: точка, источники и конфигурация меняются в описании; исходные данные — нет. */
export function rebind(rec: MeasurementRecord, patch: Partial<Pick<MeasurementRecord, 'configId' | 'point' | 'sourceIds'>>, now: string): MeasurementRecord {
  return { ...rec, ...patch, lateBinding: true, boundAt: now };
}

/** Запись среднего по точкам: новый замер, рассчитанный из исходных; они сами не меняются. */
export function averageRecord(from: readonly MeasurementRecord[], avg: PointAverage, id: string, now: string): { rec: MeasurementRecord; data: MeasurementData } {
  const configs = [...new Set(from.map((r) => r.configId))];
  const configId = configs.length === 1 ? configs[0] : null;
  const rec: MeasurementRecord = {
    id, roomId: from[0].roomId, configId, kind: 'frequency-response', name: `Среднее по ${from.length} точкам`, recordedAt: now,
    source: { kind: 'derived', from: from.map((r) => r.id), method: 'Среднее по мощности' },
    provenance: {
      kind: 'measured', method: `Среднее по мощности ${from.length} замеров в общей полосе, без выравнивания уровней`, algorithmVersion: 'v2-offline-1',
      ...(configId ? { configId } : {}), inputHash: '', createdAt: now,
      warnings: configs.length > 1 ? ['Замеры относятся к разным конфигурациям.'] : [],
      limitations: ['Уровни замеров не выравниваются: среднее верно, только если громкость и усиление между точками не менялись.'],
    },
    snapshotId: null, lateBinding: false, points: from.reduce((s, r) => s + (r.points ?? 1), 0),
    point: { label: `Среднее: ${from.map((r) => r.point?.label ?? '?').join(', ')}`, position: null },
    summary: { fMin: avg.f[0], fMax: avg.f[avg.f.length - 1], count: avg.f.length },
  };
  return { rec, data: { id, f: avg.f, db: avg.db, ref: 'dB re 1' } };
}
