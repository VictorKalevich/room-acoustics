import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { wav16 } from '../../src/core/dsp';
import type { MicProfile } from '../../src/core/micCalibration';
import { parseMicFile } from '../../src/core/micCurve';
import { FFT_SIZE, NoiseMeter } from '../../src/core/noise';
import { noiseCsv, type CsvKind, type CsvOptions } from '../../src/core/noiseCsv';
import { exportRecord, parseNoiseFile } from '../../src/core/noiseFile';
import { MAX_RECORD_BYTES, contentBytes, recordView, type NoiseRecord } from '../../src/core/noiseRecord';
import { FIELD_SIGNAL, synthesizeFieldSignal } from '../../scripts/noise-field-signal';
import { BUILD, START_MS, sessionRecord, testProfile } from '../fixtures/noise';

// 058: сигнал итоговой проверки и независимый скрипт на детерминированной синтетике.
// Путь «файл → Windows → динамики → комната → iPhone» моделируется: передискретизация 16→48 кГц, слабый бас динамиков,
// резонанс комнаты, ослабление, фон, предзапись до начала файла и пропуск первых блоков, как при старте шумомера.
// Это проверка расчёта и скрипта, а не физическое испытание: микрофон, iOS и реальная комната здесь не участвуют.
const root = process.cwd(), kit = join(root, 'public/field-check');
const work = mkdtempSync(join(tmpdir(), 'ra-058-'));
afterAll(() => rmSync(work, { recursive: true, force: true }));
const check = (...args: string[]) => {
  const r = spawnSync(process.execPath, [join(root, 'scripts/check-noise-final.mjs'), ...args], { encoding: 'utf8', maxBuffer: 1 << 26 });
  return { status: r.status, out: r.stdout + r.stderr };
};
const failed = (out: string) => out.split('\n').filter(l => l.startsWith('[НЕ ПРОЙДЕНО]'));

const definition = JSON.parse(readFileSync(join(kit, 'noise-final-signal.json'), 'utf8'));
const wavBytes = readFileSync(join(kit, FIELD_SIGNAL.file));

function random(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296 - 0.5;
  };
}
function biquad(b0: number, b1: number, b2: number, a0: number, a1: number, a2: number) {
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  return (x: number) => {
    const y = (b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    return y;
  };
}
function highpass(f: number, fs: number) {
  const w = 2 * Math.PI * f / fs, c = Math.cos(w), alpha = Math.sin(w) / Math.SQRT2;
  return biquad((1 + c) / 2, -(1 + c), (1 + c) / 2, 1 + alpha, -2 * c, 1 - alpha);
}
function peaking(f: number, gainDb: number, q: number, fs: number) {
  const A = 10 ** (gainDb / 40), w = 2 * Math.PI * f / fs, c = Math.cos(w), alpha = Math.sin(w) / (2 * q);
  return biquad(1 + alpha * A, -2 * c, 1 - alpha * A, 1 + alpha / A, -2 * c, 1 - alpha / A);
}
/** ×3 окном Блэкмана: полоса пропускания до 7 кГц, зеркальные копии выше 9 кГц подавлены. */
function upsample3(x: Int16Array) {
  const N = 144, fc = 7900 / 48000, h = new Float64Array(N);
  for (let n = 0; n < N; n++) {
    const t = n - (N - 1) / 2, w = 0.42 - 0.5 * Math.cos(2 * Math.PI * n / (N - 1)) + 0.08 * Math.cos(4 * Math.PI * n / (N - 1));
    h[n] = 3 * 2 * fc * Math.sin(2 * Math.PI * fc * t) / (2 * Math.PI * fc * t) * w;
  }
  const out = new Float32Array(x.length * 3);
  for (let m = 0; m < out.length; m++) {
    let acc = 0;
    for (let n = m % 3; n < N; n += 3) { const k = (m - n) / 3; if (k >= 0 && k < x.length) acc += h[n] * x[k]; }
    out[m] = acc / 32767;
  }
  return out;
}
interface Path { gainDb: number; preroll: number; tail: number; skipFirst: number; segmentGainDb?: Record<string, number> }
/** Сеанс шумомера 48 кГц: фон всё время, файл начинается через preroll с. */
function simulate(signal: Float32Array, profile: MicProfile | null, p: Path) {
  const fs = 48000, start = Math.round(p.preroll * fs), total = start + signal.length + Math.round(p.tail * fs);
  const blocks = Math.ceil(total / FFT_SIZE), meter = new NoiseMeter(fs, profile);
  const bass = highpass(70, fs), room = peaking(120, 5, 4, fs), rumble = random(11), hiss = random(12);
  let low = 0;
  const gain = 10 ** (p.gainDb / 20), gainAt = (n: number) => {
    if (!p.segmentGainDb) return gain;
    const t = (n - start) / fs, s = FIELD_SIGNAL.segments.find(x => t >= x.from && t < x.to);
    return gain * 10 ** ((s && p.segmentGainDb[s.id] || 0) / 20);
  };
  const pcm = new Float32Array(FFT_SIZE);
  for (let seq = 0; seq < blocks; seq++) {
    for (let i = 0; i < FFT_SIZE; i++) {
      const n = seq * FFT_SIZE + i, x = n >= start && n - start < signal.length ? signal[n - start] : 0;
      low += 0.01 * (rumble() - low);
      pcm[i] = room(bass(x * gainAt(n))) + 0.003 * low + 1.2e-4 * hiss();
    }
    if (seq >= p.skipFirst) meter.push(pcm.slice(), seq, START_MS + (seq + 1) * FFT_SIZE / fs * 1000);
  }
  return meter;
}
function profileFrom(file: string): MicProfile {
  const { f, db } = parseMicFile(readFileSync(join(kit, file), 'utf8'));
  return { ...testProfile, id: 'c2-' + file, name: 'C2 синтетическая', validRangeHz: [f[0], f[f.length - 1]], curve: { kind: 'correction', frequencyHz: f, correctionDb: db } };
}
function writeCsv(r: NoiseRecord, name: string, kind: CsvKind, o: Partial<CsvOptions>) {
  const path = join(work, name);
  writeFileSync(path, noiseCsv(r, recordView(r.content, r.context), kind, { weight: 'Z', period: 'session', corrected: false, from: 0, to: 1e9, ...o }));
  return path;
}

describe('058: сигнал итоговой проверки', () => {
  it('WAV в комплекте совпадает с синтезом и описанием: 615 с, 16 кГц, без клиппинга', () => {
    const regenerated = Buffer.from(wav16(synthesizeFieldSignal(), FIELD_SIGNAL.sampleRate));
    expect(regenerated.equals(wavBytes)).toBe(true);
    expect(createHash('sha256').update(wavBytes).digest('hex')).toBe(definition.sha256);
    const { sha256: _sha, samples, peakDbfs, segments, ...rest } = definition, { segments: _segments, ...base } = FIELD_SIGNAL;
    expect(rest).toEqual(base);
    expect(segments.map(({ fileRmsDbfs: _rms, ...s }: { fileRmsDbfs: number | null }) => s)).toEqual(FIELD_SIGNAL.segments);
    expect(samples).toBe(FIELD_SIGNAL.seconds * FIELD_SIGNAL.sampleRate);
    expect(peakDbfs).toBeLessThan(-1);
    for (const s of segments) {
      if (s.kind === 'silence') expect(s.fileRmsDbfs).toBeNull();
      else if (s.kind === 'pink' || s.kind === 'band') expect(Math.abs(s.fileRmsDbfs - (FIELD_SIGNAL.referenceDbfs + s.levelDb))).toBeLessThanOrEqual(0.02);
    }
    expect(FIELD_SIGNAL.seconds - 15).toBeGreaterThanOrEqual(600);
  });
});

describe('058: сквозная проверка 10-минутного сеанса скриптом check-noise-final', () => {
  const path: Path = { gainDb: -22, preroll: 7.3, tail: 2, skipFirst: 2 };
  const file = join(work, 'final.json'), again = join(work, 'final-again.json');
  let meter: NoiseMeter, record: NoiseRecord, json: string, csv: string[], timing: number[];
  beforeAll(() => {
    const pcm = new Int16Array(wavBytes.buffer, wavBytes.byteOffset + 44, (wavBytes.length - 44) / 2);
    const t0 = performance.now(), signal = upsample3(pcm), t1 = performance.now();
    meter = simulate(signal, profileFrom('c2-correction.txt'), path);
    const t2 = performance.now();
    record = sessionRecord(meter, { id: 'final-synthetic', name: 'Итоговая проверка · синтетика', weight: 'A', period: 'session', corrected: true });
    json = exportRecord(record, BUILD);
    timing = [t1 - t0, t2 - t1, performance.now() - t2];
    writeFileSync(file, json);
    writeFileSync(again, exportRecord(parseNoiseFile(json, 'final.json').record, BUILD));
    const L = Math.ceil(meter.totals.endSamples / 48000);
    csv = [
      writeCsv(record, 'levels-z.csv', 'levels', {}),
      writeCsv(record, 'levels-a-corrected.csv', 'levels', { weight: 'A', corrected: true, from: 100, to: 400 }),
      writeCsv(record, 'bands-c.csv', 'bands', { weight: 'C' }),
      writeCsv(record, 'spectrum-a.csv', 'spectrum', { weight: 'A' }),
      writeCsv(record, 'spectrum-60-z.csv', 'spectrum', { period: '60' }),
      writeCsv(record, 'ltas-c.csv', 'ltas', { weight: 'C' }),
      writeCsv(record, 'rms.csv', 'rms', {}),
      writeCsv(record, 'spectrogram-coarse.csv', 'spectrogram', {}),
      writeCsv(record, 'spectrogram-fine-a.csv', 'spectrogram', { weight: 'A', corrected: true, from: L - 60, to: L }),
    ];
  }, 300_000);

  it('запись: 10 мин сигнала, пределы памяти и размеров соблюдены', () => {
    const s = record.content.type === 'session' ? record.content.session : null!;
    const tl = s.timeline, seconds = meter.totals.blocks * FFT_SIZE / 48000;
    expect(seconds).toBeGreaterThanOrEqual(620);
    expect(meter.totals.missingBlocks).toBe(path.skipFirst);
    expect(tl.fine.dropped).toBeGreaterThan(0);
    expect(tl.fine.ends.length).toBe(Math.ceil(600 * 48000 / 16384));
    const bytes = contentBytes(record.content);
    expect(bytes).toBeLessThan(MAX_RECORD_BYTES);
    expect(json.length).toBeLessThan(16 * 2 ** 20);
    console.info(`058 синтетика: ${seconds.toFixed(1)} с при 48 кГц; передискретизация ${(timing[0] / 1000).toFixed(1)} с, шумомер ${(timing[1] / 1000).toFixed(1)} с ` +
      `(${(seconds / (timing[1] / 1000)).toFixed(0)}× реального времени, тот же NoiseMeter), снимок и JSON ${(timing[2] / 1000).toFixed(2)} с; ` +
      `запись ${(bytes / 2 ** 20).toFixed(2)} МиБ, JSON ${(json.length / 2 ** 20).toFixed(2)} МиБ, история ${(tl.levels.pcm.length)} с, кольцо ${tl.fine.ends.length} кадров, ` +
      `CSV ${csv.map(p => (readFileSync(p).length / 1024).toFixed(0)).join('/')} КиБ`);
  });

  it('скрипт проходит: данные, математика, CSV, профиль, повторный импорт и структура сигнала', () => {
    const r = check(file, ...csv, '--signal', '--profile=' + join(kit, 'c2-correction.txt'), '--same=' + again);
    expect(failed(r.out)).toEqual([]);
    expect(r.status).toBe(0);
    for (const line of ['P2 относительно P1: ожидается -10 дБ ± 0.5', 'P3 относительно P1: ожидается -20 дБ ± 1', 'P4 относительно P1', 'P5 относительно P1',
      'Leq 60 с в секунде', 'B2 (шум 80–200 Гц)', 'B6 (шум 5600–7000 Гц)', 'T1 (тоны 90 Гц)', 'M1 (тоны 250, 1000, 4000 Гц)',
      'начало файла на шкале сеанса 7.3', 'в начале не принято блоков: 2', 'Парсеваль', 'вес A по формуле IEC 61672', 'шесть полос (A с поправкой)',
      'спектрограмма 1/12 окт (C с поправкой)', 'кадры кольца и столбцы 10 с согласованы', 'снимок профиля «C2 синтетическая»',
      'данные измерения (суммы, счётчики, спектры, кольцо кадров, снимок калибровки) совпадают побитно', 'CSV levels-a-corrected.csv', 'CSV spectrogram-fine-a.csv',
      'столбец correction_db по всем бинам равен поправке профиля']) {
      expect(r.out, line).toContain(line);
    }
    expect(r.out).toMatch(/\[пройдено\] сигнал · P2 относительно P1/);
    expect(r.out).toMatch(/\[пройдено\] сигнал · T1/);
  }, 180_000);

  it('скрипт находит ошибки расчёта, подмену профиля, среднее децибел и неверный сигнал', () => {
    const tampered = (name: string, edit: (s: Extract<NoiseRecord['content'], { type: 'session' }>['session']) => void) => {
      const copy = parseNoiseFile(json, 'x.json').record;
      if (copy.content.type !== 'session') throw new Error('session');
      edit(copy.content.session);
      const p = join(work, name);
      writeFileSync(p, exportRecord(copy, BUILD));
      return p;
    };
    const weighted = check(tampered('weighted.json', s => { s.totals.weightedPower.A = s.totals.weightedPower.A! * 1.02; }));
    expect(weighted.status).toBe(1);
    expect(failed(weighted.out).join('\n')).toContain('вес A по формуле IEC 61672');
    const band = check(tampered('band.json', s => {
      const tl = s.timeline, E = tl.energyEdgesHz.length - 1, V = tl.variants;
      tl.levels.energy[(50 * V + 4) * E + 3] *= 3;
    }));
    expect(failed(band.out).join('\n')).toContain('шесть полос (A с поправкой)');
    const sums = check(tampered('sums.json', s => { s.totals.sumSquares *= 1.01; }));
    expect(failed(sums.out).join('\n')).toContain('сумма квадратов');
    const other = check(file, '--profile=' + join(kit, 'c2-midbass-correction.txt'));
    expect(failed(other.out).join('\n')).toContain('снимок профиля');
    // CSV, где Leq 60 с — арифметическое среднее децибел за минуту, а не энергетическое.
    const text = readFileSync(csv[0], 'utf8').split('\r\n'), head = text.findIndex(l => l.startsWith('t_start_s'));
    const rows = text.slice(head + 1).filter(Boolean).map(l => l.split(','));
    for (let i = 59; i < rows.length; i++) {
      const mean = rows.slice(i - 59, i + 1).reduce((x, r) => x + Number(r[4]), 0) / 60;
      if (rows[i][9] === '1') rows[i][8] = mean.toFixed(4);
    }
    const arithmetic = join(work, 'levels-arithmetic.csv');
    writeFileSync(arithmetic, [...text.slice(0, head + 1), ...rows.map(r => r.join(',')), ''].join('\r\n'));
    const avg = check(file, arithmetic);
    expect(failed(avg.out).join('\n')).toContain('CSV levels-arithmetic.csv');
    // Скрипт сверяет запись с описанием сигнала: ступень, которой в записи нет, не проходит.
    const def = JSON.parse(JSON.stringify(definition));
    def.segments.find((x: { id: string }) => x.id === 'P2').levelDb = -8.5;
    const wrong = join(work, 'signal-wrong.json');
    writeFileSync(wrong, JSON.stringify(def));
    const step = check(file, '--signal=' + wrong);
    expect(failed(step.out).join('\n')).toContain('P2 относительно P1');
    expect(check(join(work, 'missing.json')).status).toBe(1);
  }, 180_000);
});
