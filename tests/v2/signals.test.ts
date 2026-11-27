// V2-036, V2-037: тестовые сигналы (уровень, повтор без щелчка, каналы, WAV, ограничения), статистика уровней,
// замер инструмента в комнату со снимком конфигурации.
import { afterEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { fft } from '../../src/core/dsp';
import {
  DEFAULT_SIGNAL, LEVEL_MAX, TEST_SIGNALS, exceeded, signalFileName, signalIssues, signalWav, synth, toChannels, type SignalSettings,
} from '../../src/v2/application/signals';
import { saveToRoom } from '../../src/v2/application/measure';
import { DEFAULT_NEW_ROOM, roomsService, type Clock } from '../../src/v2/application/rooms';
import { createExperiment } from '../../src/v2/domain/operations';
import { openV2Db, type V2Db } from '../../src/v2/storage/db';
import { measurementData, roomRecords } from '../../src/v2/storage/history';

const FS = 48000;
const peakDb = (x: Float32Array) => 20 * Math.log10(x.reduce((m, v) => Math.max(m, Math.abs(v)), 0));
const sig = (p: Partial<SignalSettings>): SignalSettings => ({ ...DEFAULT_SIGNAL, seconds: 1, ...p });

/** Мощность в полосе [lo, hi) по БПФ всего сигнала. */
function bandPower(x: Float32Array, lo: number, hi: number) {
  let N = 1;
  while (N < x.length) N *= 2;
  const re = new Float64Array(N), im = new Float64Array(N);
  re.set(x);
  fft(re, im);
  let p = 0;
  for (let k = Math.ceil((lo * N) / FS); k < (hi * N) / FS; k++) p += re[k] ** 2 + im[k] ** 2;
  return p;
}

describe('059 V2-037 · сигналы', () => {
  it('пик каждого вида равен заданному уровню', () => {
    for (const kind of ['sine', 'white', 'pink', 'sweep', 'multitone', 'pulse'] as const) {
      expect(peakDb(synth(sig({ kind, levelDb: -20, f1: 20, f2: 2000 }), FS))).toBeCloseTo(-20, 5);
    }
  });

  it('синус и мультитон — на целом числе периодов: стык при повторе без скачка', () => {
    const x = synth(sig({ kind: 'sine', f: 997 }), FS);
    const step = Math.abs(x[0] - x[x.length - 1]);
    expect(step).toBeLessThan(2 * Math.sin((Math.PI * 997) / FS) * 0.1 + 0.01);
    const m = synth(sig({ kind: 'multitone', f1: 50, f2: 5000 }), FS);
    expect(Math.abs(m[0] - m[m.length - 1])).toBeLessThan(0.05);
  });

  it('розовый шум — равная мощность в октавах (−3 дБ на октаву по плотности), белый — +3 дБ на октаву', () => {
    const pink = synth(sig({ kind: 'pink', seconds: 4 }), FS), white = synth(sig({ kind: 'white', seconds: 4 }), FS);
    const perOctave = (x: Float32Array) => 10 * Math.log10(bandPower(x, 2000, 4000) / bandPower(x, 250, 500)) / 3;
    expect(Math.abs(perOctave(pink))).toBeLessThan(0.5);
    expect(perOctave(white)).toBeGreaterThan(2.5);
    expect(perOctave(white)).toBeLessThan(3.5);
  });

  it('октавный шум сосредоточен в своей октаве', () => {
    const x = synth(sig({ kind: 'pink', band: 1000, seconds: 2 }), FS);
    const inside = bandPower(x, 707, 1414), all = bandPower(x, 10, 20000);
    expect(inside / all).toBeGreaterThan(0.8);
  });

  it('каналы и полярность', () => {
    const x = synth(sig({ kind: 'sine', f: 100 }), FS);
    const [l, r] = toChannels(x, 'left', false);
    expect(peakDb(l)).toBeCloseTo(-20, 5);
    expect(r.every((v) => v === 0)).toBe(true);
    const [a, b] = toChannels(x, 'both', true);
    expect(a[100] + b[100]).toBe(0);
  });

  it('WAV: заголовок, два канала, 32 бита с плавающей точкой; имя файла', () => {
    const buf = signalWav(sig({ kind: 'sine', f: 1000 }), FS);
    const v = new DataView(buf);
    expect(String.fromCharCode(v.getUint8(0), v.getUint8(1), v.getUint8(2), v.getUint8(3))).toBe('RIFF');
    expect(v.getUint16(22, true)).toBe(2);
    expect(v.getUint32(24, true)).toBe(FS);
    expect(signalFileName(sig({ kind: 'sine', f: 1000 }))).toBe('sine-1000Hz_-20dBFS_1s_both.wav');
  });

  it('ограничения уровня, длительности и частот; готовые сигналы корректны', () => {
    expect(signalIssues(sig({ levelDb: 0 }), FS)).toHaveLength(1);
    expect(signalIssues(sig({ levelDb: LEVEL_MAX }), FS)).toHaveLength(0);
    expect(signalIssues(sig({ seconds: 600 }), FS)).toHaveLength(1);
    expect(signalIssues(sig({ kind: 'sine', f: 30000 }), FS)).toHaveLength(1);
    expect(signalIssues(sig({ kind: 'sweep', f1: 1000, f2: 100 }), FS)).toHaveLength(1);
    for (const t of TEST_SIGNALS) expect(signalIssues(t.settings, FS)).toEqual([]);
    expect(new Set(TEST_SIGNALS.map((t) => t.id)).size).toBe(TEST_SIGNALS.length);
  });
});

describe('059 V2-036 · уровни и замер в комнату', () => {
  it('L10/L50/L90 — уровни, превышаемые 10/50/90 % времени', () => {
    const v = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(exceeded(v, 10)).toBe(91);
    expect(exceeded(v, 50)).toBe(51);
    expect(exceeded(v, 90)).toBe(11);
    expect(exceeded([], 50)).toBeNull();
  });

  let dbs: V2Db[] = [];
  afterEach(() => { dbs.forEach((d) => d.close()); dbs = []; });

  it('замер сохраняется с данными, конфигурацией и снимком; запись не меняет конфигурацию', async () => {
    const db = openV2Db(new IDBFactory());
    dbs.push(db);
    let t = Date.parse('2026-11-28T10:00:00.000Z'), n = 0;
    const clock: Clock = { now: () => new Date((t += 1000)).toISOString(), newId: () => `id-${++n}` };
    const rooms = roomsService(db, clock);
    const base = await rooms.create({ ...DEFAULT_NEW_ROOM, name: 'Студия' });
    const room = await rooms.save(createExperiment(base, clock.newId, clock.now()), base);
    const rec = await saveToRoom(db, rooms, clock, room, 'experimental', {
      kind: 'rt60', name: 'RT60', method: 'хлопок', device: 'Микрофон', points: 2, warnings: [], limitations: [],
      data: { f: [], db: [], ref: 'dBFS', rt60: [{ band: 125, t60: 0.5 }, { band: 250, t60: null }] },
    });
    expect(rec.configId).toBe(room.experimental!.id);
    expect(rec.summary).toEqual({ fMin: 125, fMax: 250, count: 2 });
    expect(rec.provenance.kind).toBe('measured');
    const after = (await rooms.open(room.id))!;
    expect(after.history[0]).toMatchObject({ id: rec.snapshotId, reason: 'measurement' });
    expect(after.history[0].config).toEqual(room.experimental);
    expect(after.current).toEqual(room.current);
    expect((await roomRecords(db, room.id)).measurements.map((m) => m.id)).toEqual([rec.id]);
    expect((await measurementData(db, rec.id))?.rt60?.[0]).toEqual({ band: 125, t60: 0.5 });
  });
});
