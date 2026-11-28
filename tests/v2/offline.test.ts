// V2-049: обработка записи из файла и многоточечные замеры — разбор WAV, свип с петлёй (время пролёта), импульсная
// характеристика, среднее по точкам, время прихода и задержки, поздняя привязка, сохранение замера из файла.
import { afterEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { logSweep, wav16, wavFloat32 } from '../../src/core/dsp';
import { listenerPoint, saveToRoom } from '../../src/v2/application/measure';
import { alignment, analyzeImpulse, analyzeSweepRecording, averagePoints, averageRecord, decodeWav, rebind } from '../../src/v2/application/offline';
import { DEFAULT_NEW_ROOM, roomsService, type Clock } from '../../src/v2/application/rooms';
import type { MeasurementRecord } from '../../src/v2/domain/measurement';
import { openV2Db, type V2Db } from '../../src/v2/storage/db';
import { measurementData, roomRecords, updateMeasurement } from '../../src/v2/storage/history';

const FS = 48000, C = 343;

/** WAV PCM 24 бит из целых отсчётов (каналы чередуются). */
function wav24(samples: number[][], fs: number): ArrayBuffer {
  const ch = samples.length, n = samples[0].length, data = n * ch * 3;
  const b = new ArrayBuffer(44 + data), v = new DataView(b);
  const str = (at: number, t: string) => [...t].forEach((x, i) => v.setUint8(at + i, x.charCodeAt(0)));
  str(0, 'RIFF'); v.setUint32(4, 36 + data, true); str(8, 'WAVE'); str(12, 'fmt '); v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); v.setUint16(22, ch, true); v.setUint32(24, fs, true); v.setUint32(28, fs * ch * 3, true); v.setUint16(32, ch * 3, true); v.setUint16(34, 24, true);
  str(36, 'data'); v.setUint32(40, data, true);
  let at = 44;
  for (let i = 0; i < n; i++) for (let k = 0; k < ch; k++) { const x = samples[k][i] & 0xffffff; v.setUint8(at++, x & 0xff); v.setUint8(at++, (x >> 8) & 0xff); v.setUint8(at++, (x >> 16) & 0xff); }
  return b;
}

/** Запись: тишина, свип с задержкой и усилением, тишина после. */
function delayed(sweep: Float32Array, delay: number, gain: number, total: number): Float32Array {
  const out = new Float32Array(total);
  for (let i = 0; i < sweep.length && i + delay < total; i++) out[i + delay] = sweep[i] * gain;
  return out;
}

describe('WAV (V2-049)', () => {
  it('плавающая точка 32 бит, PCM 16 и 24 бит; не WAV — отказ', () => {
    const a = new Float32Array([0, 0.5, -0.25, 1]), b = new Float32Array([0.1, -0.1, 0, 0]);
    const f32 = decodeWav(wavFloat32([a, b], 44100));
    expect([f32.fs, f32.channels.length, f32.bits, f32.float]).toEqual([44100, 2, 32, true]);
    expect([...f32.channels[0]]).toEqual([...a]);
    expect([...f32.channels[1]]).toEqual([...b]);
    const p16 = decodeWav(wav16(new Float32Array([0, 0.5, -0.5]), 48000));
    expect([p16.bits, p16.float, p16.channels.length]).toEqual([16, false, 1]);
    expect(p16.channels[0][1]).toBeCloseTo(0.5, 3);
    expect(p16.channels[0][2]).toBeCloseTo(-0.5, 3);
    const p24 = decodeWav(wav24([[0, 4194304, -4194304, -8388608]], 96000));
    expect([...p24.channels[0]]).toEqual([0, 0.5, -0.5, -1]);
    expect(() => decodeWav(new TextEncoder().encode('not a wave file at all').buffer)).toThrow(/не файл WAV/);
  });
});

describe('обработка записи (V2-049)', () => {
  const p = { f1: 20, f2: 20000, seconds: 2 };
  const sweep = logSweep(p.f1, p.f2, p.seconds, FS, 1);
  const latency = 1234, tof = 480; // задержка звуковой карты и пролёт 10 мс (3,43 м)
  const total = sweep.length + Math.round(1.5 * FS);

  it('свип с петлёй: время пролёта и расстояние по разности пиков; ровная АЧХ на уровне усиления', () => {
    const loop = delayed(sweep, Math.round(0.4 * FS) + latency, 1, total);
    const mic = delayed(sweep, Math.round(0.4 * FS) + latency + tof, 0.25, total);
    const r = analyzeSweepRecording(mic, FS, p, C, loop);
    expect(r.arrival!.ms).toBeCloseTo((tof / FS) * 1000, 3);
    expect(r.arrival!.distance).toBeCloseTo((tof / FS) * C, 3);
    const mid = r.db.filter((_, i) => r.f[i] >= 100 && r.f[i] <= 10000);
    for (const v of mid) expect(v).toBeCloseTo(20 * Math.log10(0.25), 0);
    expect(r.warnings).toEqual([]);
    // каналы перепутаны: микрофон «раньше» петли — время не сохраняется
    const swapped = analyzeSweepRecording(loop, FS, p, C, mic);
    expect(swapped.arrival).toBeNull();
    expect(swapped.warnings.join(' ')).toMatch(/перепутаны/);
    // без петли времени нет
    expect(analyzeSweepRecording(mic, FS, p, C).arrival).toBeNull();
  });

  it('низкочастотный свип — полоса ядра 15–500 Гц; неверные параметры и короткая запись — отказ', () => {
    const low = { f1: 10, f2: 1000, seconds: 2 };
    const s = logSweep(low.f1, low.f2, low.seconds, FS, 0.5);
    const r = analyzeSweepRecording(delayed(s, 2000, 0.5, s.length + FS * 2), FS, low, C);
    expect(r.f[0]).toBe(15);
    expect(r.f[r.f.length - 1]).toBeGreaterThan(480);
    expect(r.f[r.f.length - 1]).toBeLessThanOrEqual(500);
    expect(() => analyzeSweepRecording(new Float32Array(1000), FS, { f1: 20, f2: 30000, seconds: 2 }, C)).toThrow(/ниже 24000 Гц/);
    expect(() => analyzeSweepRecording(new Float32Array(1000), FS, p, C)).toThrow(/короче свипа/);
  });

  it('импульсная характеристика: ровная АЧХ на уровне пика и время пика от начала файла', () => {
    const ir = new Float32Array(Math.round(0.3 * FS));
    ir[960] = 0.5;
    const r = analyzeImpulse(ir, FS);
    expect(r.peakMs).toBeCloseTo(20, 6);
    for (const v of r.db) expect(v).toBeCloseTo(20 * Math.log10(0.5), 1);
    expect(r.warnings.join(' ')).toMatch(/обрезана/);
    expect(() => analyzeImpulse(new Float32Array(FS), FS)).toThrow(/тишина/);
  });
});

describe('несколько точек и время прихода (V2-049)', () => {
  const rec = (id: string, patch: Partial<MeasurementRecord>): MeasurementRecord => ({
    id, roomId: 'r', configId: 'c', kind: 'frequency-response', name: id, recordedAt: '2026-11-28T10:00:00.000Z', source: { kind: 'file', fileName: `${id}.wav`, format: 'WAV' },
    provenance: { kind: 'measured', method: 'тест', algorithmVersion: 't', inputHash: '', createdAt: '2026-11-28T10:00:00.000Z', warnings: [], limitations: [] },
    snapshotId: null, lateBinding: true, summary: { fMin: 20, fMax: 200, count: 3 }, ...patch,
  });

  it('среднее по мощности в общей полосе на сетке первого замера; разброс', () => {
    const a = { f: [20, 40, 80, 160], db: [0, 0, 0, 0] }, b = { f: [10, 20, 40, 80, 120], db: [-10, -10, -10, -10, -10] };
    const avg = averagePoints([a, b]);
    expect(avg.f).toEqual([20, 40, 80]);
    for (const v of avg.db) expect(v).toBeCloseTo(10 * Math.log10(1.1 / 2), 9);
    expect([avg.min, avg.max]).toEqual([[-10, -10, -10], [0, 0, 0]]);
    expect(() => averagePoints([a])).toThrow(/два замера/);
    expect(() => averagePoints([a, { f: [200, 400], db: [0, 0] }])).toThrow(/не пересекаются/);
    const { rec: r, data } = averageRecord([rec('m1', { points: 2, point: { label: 'Диван', position: null } }), rec('m2', {})], avg, 'avg', '2026-11-29T10:00:00.000Z');
    expect(r.source).toEqual({ kind: 'derived', from: ['m1', 'm2'], method: 'Среднее по мощности' });
    expect([r.points, r.configId, r.name, r.point?.label]).toEqual([3, 'c', 'Среднее по 2 точкам', 'Среднее: Диван, ?']);
    expect(data.f).toEqual(avg.f);
  });

  it('время прихода по петле: группы по точкам, задержка ранним источникам до самого позднего', () => {
    const pt = { label: 'Диван', position: null };
    const groups = alignment([
      rec('L', { point: pt, sourceIds: ['L'], timing: { arrivalMs: 8.2, ref: 'loopback', distance: 2.81 } }),
      rec('S', { point: pt, sourceIds: ['S'], timing: { arrivalMs: 14.7, ref: 'loopback', distance: 5.04 } }),
      rec('X', { timing: { arrivalMs: 3, ref: 'file-start', distance: null } }),
      rec('N', {}),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].point).toBe('Диван');
    expect(groups[0].rows.map((r) => [r.id, r.addMs])).toEqual([['L', expect.closeTo(6.5, 9)], ['S', 0]]);
  });

  it('поздняя привязка меняет описание, данные остаются; замер из файла — без снимка модели', async () => {
    const db: V2Db = openV2Db(new IDBFactory());
    dbs.push(db);
    let t = Date.parse('2026-11-28T10:00:00.000Z'), n = 0;
    const clock: Clock = { now: () => new Date((t += 1000)).toISOString(), newId: () => `id-${++n}` };
    const rooms = roomsService(db, clock);
    const room = await rooms.create({ ...DEFAULT_NEW_ROOM, name: 'Студия' });
    const historyBefore = room.history.length;
    const l = room.current.listening.listeners[0];
    const saved = await saveToRoom(db, rooms, clock, room, 'current', {
      kind: 'frequency-response', name: 'Из файла', method: 'свип', device: 'Файл', file: { fileName: 'take.wav', format: 'WAV' },
      timing: { arrivalMs: 9, ref: 'loopback', distance: 3.09 }, data: { f: [20, 40], db: [0, 1], ref: 'dB re 1' }, warnings: [], limitations: [],
    }, { point: listenerPoint(l), sourceIds: [room.current.audio.sources[0].id] });
    expect([saved.snapshotId, saved.lateBinding, saved.source.kind, saved.point?.listenerId, saved.timing?.arrivalMs]).toEqual([null, true, 'file', l.id, 9]);
    expect((await rooms.open(room.id))!.history).toHaveLength(historyBefore);
    const next = rebind(saved, { sourceIds: [], configId: null }, clock.now());
    await updateMeasurement(db, next);
    const [stored] = (await roomRecords(db, room.id)).measurements;
    expect([stored.configId, stored.sourceIds, stored.lateBinding, typeof stored.boundAt]).toEqual([null, [], true, 'string']);
    expect((await measurementData(db, saved.id))?.db).toEqual([0, 1]);
    await expect(updateMeasurement(db, { ...next, id: 'нет' })).rejects.toThrow();
  });
});

let dbs: V2Db[] = [];
afterEach(() => { dbs.forEach((d) => d.close()); dbs = []; });
