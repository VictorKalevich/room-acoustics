import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { analyzeSweep, convolve, logSweep, parseCalibration } from '../../src/core/dsp';
import { afterSmoothing, beforeSmoothing, correctionAt, type AppliedMic } from '../../src/core/micApply';
import { parseMicFile } from '../../src/core/micCurve';
import type { MicProfile } from '../../src/core/micCalibration';

const fs = 48000;
const text = readFileSync('public/field-check/c2-correction.txt', 'utf8');
const profile = (correctionDb: number[]): MicProfile => ({
  id: 'c2', version: 1, name: 'c2-correction', origin: 'user', deviceModel: 'test', inputKind: 'unknown', captureMode: 'test',
  orientation: null, sourceURL: null, sourceDate: null, method: 'fixture', referenceHz: 1000, validRangeHz: [15, 500],
  digitizationUncertaintyDb: null, validationStatus: 'unverified', notes: '', directivitySource: null,
  curve: { kind: 'correction', frequencyHz: [15, 50, 70, 120, 180, 500], correctionDb },
});

it('комплект C2: поправка читается обоими загрузчиками, сигналы на плато поправки', () => {
  const { f, db } = parseMicFile(text);
  expect(f).toEqual([15, 50, 70, 120, 180, 500]);
  expect(db).toEqual([6, 6, 0, 0, -6, -6]);
  expect(parseCalibration(text)).toEqual({ f, db });
  expect(correctionAt(profile(db), [40, 90, 220])).toEqual([6, 0, -6]);
  const tones = readFileSync('public/field-check/c2-bass-tones.wav');
  expect([tones.readUInt16LE(22), tones.readUInt32LE(24), tones.readUInt16LE(34), tones.length - 44]).toEqual([1, 24000, 16, 24000 * 30 * 2]);
  const sweep = readFileSync('public/field-check/c2-sweep-10-1000Hz-6s.wav');
  expect([sweep.readUInt32LE(24), sweep.length - 44]).toEqual([48000, 48000 * 6 * 2]);
  const app = logSweep(10, 1000, 6, 48000);
  // тот же сигнал, что кнопка «Скачать сигнал» в «Свипе»
  expect(sweep.readInt16LE(44 + 2 * 24000)).toBe(Math.trunc(Math.max(-1, Math.min(1, app[24000])) * 32767));
});

it('скрипт C2 различает поправку каталога, прежнюю калибровку, её копию и двойную поправку', () => {
  const { db } = parseMicFile(text);
  const legacy: AppliedMic = { mode: 'legacy', legacy: { name: 'c2-correction.txt', ...parseCalibration(text) } };
  const catalog: AppliedMic = { mode: 'catalog', profile: profile(db) };
  const copy: AppliedMic = { mode: 'catalog', profile: profile(db.map(v => -v)) };
  const sweep = logSweep(10, 1000, 6, fs);
  const h = new Float32Array(Math.round(0.4 * fs));
  h[Math.round(0.3 * fs)] = 0.3; h[Math.round(0.3 * fs) + 300] = 0.12;
  const take = (mic: AppliedMic, gain: number, session: string) => {
    const rec = Float32Array.from(convolve(sweep, h), v => v * gain);
    const r = analyzeSweep(rec, sweep, 10, 1000, fs, mic.mode === 'catalog' ? (f, d) => beforeSmoothing(mic, f, d) : undefined);
    return { name: session, importedAt: '2026-11-22T00:00:00Z', f: r.f, db: afterSmoothing(mic, r.f, r.db), points: 1, session };
  };
  const none = take({ mode: 'none' }, 1, 'none');
  const withProfile = take(catalog, 1.3, 'catalog');
  const withLegacy = take(legacy, 0.8, 'legacy');
  const withCopy = take(copy, 1, 'copy');
  // ошибка, которой нет в приложении: обе поправки сразу
  const double = { ...withProfile, session: 'double', db: afterSmoothing(legacy, withProfile.f, withProfile.db) };
  const run = (list: unknown[], ...flags: string[]) => spawnSync(process.execPath, ['scripts/check-c2-sweep.mjs', '-', ...flags], {
    input: JSON.stringify({ format: 'room-acoustics-project', version: 5, project: { current: { measurement: list[0], history: list.slice(1) } } }),
    encoding: 'utf8',
  });
  const ok = run([withProfile, none]);
  expect(ok.status, ok.stderr).toBe(0);
  expect(ok.stdout).toMatch(/Сдвиг уровня между записями по 75–115 Гц: 2\.2/);
  expect(run([withLegacy, withProfile, none], '--pair=0,2', '--sign=-1').status).toBe(0);
  expect(run([withCopy, withLegacy], '--sign=0').status).toBe(0);
  expect(run([withProfile, none], '--sign=-1').status).toBe(1);
  expect(run([double, none]).status).toBe(1);
  expect(run([withProfile, { ...none, session: 'catalog' }]).status).toBe(1);
  expect(run([withProfile]).status).toBe(1);
});

it('058: вариант C2 для слабого баса — те же три знака поправки выше 50 Гц, динамики с завалом баса не влияют на разность', () => {
  const mid = readFileSync('public/field-check/c2-midbass-correction.txt', 'utf8');
  const { f, db } = parseMicFile(mid);
  expect(f).toEqual([15, 90, 115, 170, 200, 500]);
  expect(db).toEqual([6, 6, 0, 0, -6, -6]);
  expect(parseCalibration(mid)).toEqual({ f, db });
  const catalogProfile = { ...profile(db), curve: { kind: 'correction' as const, frequencyHz: f, correctionDb: db } };
  expect(correctionAt(catalogProfile, [65, 140, 235])).toEqual([6, 0, -6]);
  const tones = readFileSync('public/field-check/c2-midbass-tones.wav');
  expect([tones.readUInt16LE(22), tones.readUInt32LE(24), tones.length - 44]).toEqual([1, 24000, 24000 * 30 * 2]);
  // Динамики без баса: ВЧ-фильтр 2-го порядка 60 Гц на обеих записях.
  const w = 2 * Math.PI * 60 / fs, c = Math.cos(w), alpha = Math.sin(w) / Math.SQRT2, a0 = 1 + alpha;
  const highpass = (x: ArrayLike<number>) => {
    const y = new Float64Array(x.length);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < x.length; i++) {
      y[i] = ((1 + c) / 2 * x[i] - (1 + c) * x1 + (1 + c) / 2 * x2 + 2 * c * y1 - (1 - alpha) * y2) / a0;
      x2 = x1; x1 = x[i]; y2 = y1; y1 = y[i];
    }
    return y;
  };
  const sweep = logSweep(10, 1000, 6, fs);
  const h = new Float32Array(Math.round(0.4 * fs));
  h[Math.round(0.3 * fs)] = 0.3; h[Math.round(0.3 * fs) + 300] = 0.12;
  const take = (mic: AppliedMic, gain: number, session: string) => {
    const rec = Float32Array.from(highpass(convolve(sweep, h)), v => v * gain);
    const r = analyzeSweep(rec, sweep, 10, 1000, fs, mic.mode === 'catalog' ? (fr, d) => beforeSmoothing(mic, fr, d) : undefined);
    return { name: session, importedAt: '2026-11-23T00:00:00Z', f: r.f, db: afterSmoothing(mic, r.f, r.db), points: 1, session };
  };
  const none = take({ mode: 'none' }, 1, 'none');
  const withProfile = take({ mode: 'catalog', profile: catalogProfile }, 1.3, 'catalog');
  const legacy: AppliedMic = { mode: 'legacy', legacy: { name: 'c2-midbass-correction.txt', f, db } };
  const withLegacy = take(legacy, 0.8, 'legacy');
  const double = { ...withProfile, session: 'double', db: afterSmoothing(legacy, withProfile.f, withProfile.db) };
  const flags = ['--cal=public/field-check/c2-midbass-correction.txt', '--zones=50-82,122-160,212-480', '--ref=122-160'];
  const run = (list: unknown[], ...extra: string[]) => spawnSync(process.execPath, ['scripts/check-c2-sweep.mjs', '-', ...flags, ...extra], {
    input: JSON.stringify({ format: 'room-acoustics-project', version: 5, project: { current: { measurement: list[0], history: list.slice(1) } } }),
    encoding: 'utf8',
  });
  const ok = run([withProfile, none]);
  expect(ok.status, ok.stdout + ok.stderr).toBe(0);
  expect(ok.stdout).toMatch(/Сдвиг уровня между записями по 122–160 Гц: 2\.2/);
  expect(ok.stdout).toMatch(/50–82 \| 6\.\d\d \| 6\.00/);
  expect(run([withLegacy, none], '--sign=-1').status).toBe(0);
  expect(run([withProfile, none], '--sign=-1').status).toBe(1);
  expect(run([double, none]).status).toBe(1);
});
