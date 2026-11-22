import { describe, expect, it } from 'vitest';
import { computeModes } from '../../src/core/modes';
import { FFT_SIZE, NoiseMeter } from '../../src/core/noise';
import { exportRecord, parseNoiseFile } from '../../src/core/noiseFile';
import {
  checkRoomSnapshot, coincident, matchPeaks, matchTolerance, MAX_MARKERS, modeMarkers, PEAK_MIN_FRAMES, roomSnapshot, sameRoom, spectralPeaks,
  type NoiseMode, type NoiseRoomSnapshot,
} from '../../src/core/noiseModes';
import { checkRecord } from '../../src/core/noiseRecord';
import { SPECTRUM_HOP } from '../../src/core/noiseSpectrum';
import { speedOfSound } from '../../src/core/physics';
import { defaultRoom } from '../../src/state/project';
import { BUILD, sessionRecord, toneMeter } from '../fixtures/noise';

const room = (depth: number, width: number, height: number) => ({ ...defaultRoom(), depth, width, height });
const snapshotOf = (r = room(5, 4, 2.5), fMax = 300) => roomSnapshot(r, computeModes(r, fMax), fMax, 120);

/** Детерминированный белый шум (Бокс — Мюллер на LCG) с синусом поверх: тот же тракт NoiseMeter, без микрофона. */
function noiseMeter(seconds: number, tone?: { hz: number; amp: number }, fs = 48000) {
  const meter = new NoiseMeter(fs);
  let seed = 12345;
  const rnd = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  for (let seq = 0; seq < Math.ceil(seconds * fs / FFT_SIZE); seq++) {
    const pcm = new Float32Array(FFT_SIZE);
    for (let i = 0; i < FFT_SIZE; i++) {
      const n = seq * FFT_SIZE + i;
      pcm[i] = 0.01 * Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd()) + (tone ? tone.amp * Math.sin(2 * Math.PI * tone.hz * n / fs) : 0);
    }
    meter.push(pcm, seq, 1000 + seq);
  }
  return meter;
}
const framesOf = (seconds: number, fs: number) => Math.floor(seconds * fs / SPECTRUM_HOP + 1e-9);

describe('057 · снимок комнаты', () => {
  it('тот же список мод, что computeModes, без пересчёта; признак приближения', () => {
    const r = room(5, 4, 2.5), modes = computeModes(r, 300), s = roomSnapshot(r, modes, 300, 120);
    expect(s.modes).toEqual(modes.map(m => ({ f: m.f, n: m.n, kind: m.kind })));
    expect(s.modes[0]).toMatchObject({ n: [1, 0, 0], kind: 'axial' });
    expect(s.modes[0].f).toBeCloseTo(speedOfSound(20) / 10, 9);
    expect(s).toMatchObject({ version: 1, model: 'rect-rigid', depth: 5, width: 4, height: 2.5, temperatureC: 20, approximate: false, schroederHz: 120, fMax: 300 });
    expect(checkRoomSnapshot(structuredClone(s))).toEqual(s);
    expect(roomSnapshot({ ...r, slope: { wall: 'front', low: 1.5, run: 1 } }, modes, 300, 120).approximate).toBe(true);
    expect(roomSnapshot({ ...r, model: 'wave' }, modes, 300, 120).approximate).toBe(true);
    // сравнение размеров, а не списков: другая температура — другие моды
    expect(sameRoom(s, snapshotOf())).toBe(true);
    expect(sameRoom(s, snapshotOf(room(5.1, 4, 2.5)))).toBe(false);
    expect(sameRoom(s, snapshotOf({ ...r, temperatureC: 24 }))).toBe(false);
  });

  it('отказ на неверном снимке', () => {
    const s = snapshotOf();
    const bad: ((x: NoiseRoomSnapshot) => void)[] = [
      x => { (x as { version: number }).version = 2; },
      x => { x.depth = 0; },
      x => { x.temperatureC = NaN; },
      x => { x.modes[0].kind = 'oblique'; },
      x => { x.modes[0].n = [1, 0, 0.5]; },
      x => { x.modes.reverse(); },
      x => { x.modes[x.modes.length - 1].f = x.fMax + 1; },
      x => { (x as { approximate: unknown }).approximate = 'no'; },
    ];
    for (const change of bad) {
      const copy = structuredClone(s);
      change(copy);
      expect(() => checkRoomSnapshot(copy)).toThrow(/снимок комнаты/);
    }
  });
});

describe('057 · маркеры мод', () => {
  const modes = snapshotOf(room(5, 4, 2.5), 300).modes;
  it('диапазон графика и типы', () => {
    const axial = modeMarkers(modes, { lo: 20, hi: 250, kinds: ['axial'] });
    expect(axial.shown.every(m => m.kind === 'axial' && m.f >= 20 && m.f <= 250)).toBe(true);
    expect(axial.total).toBe(modes.filter(m => m.kind === 'axial' && m.f <= 250).length);
    expect(modeMarkers(modes, { lo: 20, hi: 30, kinds: ['axial', 'tangential', 'oblique'] }).total).toBe(0);
  });
  it('при избытке — не больше предела, сначала осевые, по частоте', () => {
    const all = modeMarkers(modes, { lo: 20, hi: 300, kinds: ['axial', 'tangential', 'oblique'] });
    expect(all.total).toBeGreaterThan(MAX_MARKERS);
    expect(all.shown).toHaveLength(MAX_MARKERS);
    const axial = modes.filter(m => m.kind === 'axial' && m.f >= 20);
    expect(all.shown.filter(m => m.kind === 'axial')).toHaveLength(Math.min(axial.length, MAX_MARKERS));
    expect(all.shown.map(m => m.f)).toEqual(all.shown.map(m => m.f).sort((a, b) => a - b));
  });
  it('совпадение — как на экране «Моды» (< 0,5 %)', () => {
    const cube = snapshotOf(room(4, 4, 3), 200).modes;
    const x = cube.find(m => m.n.join() === '1,0,0')!;
    expect(coincident(cube, x)).toBe(true);
    expect(coincident(modes, modes[0])).toBe(false);
  });
});

describe('057 · пики и возможные соответствия', () => {
  it('тон на средней PSD: пик в пределах одного бина; мгновенный спектр не используется', () => {
    const fs = 48000, meter = noiseMeter(12, { hz: 41.3, amp: 0.02 });
    const avg = meter.spectral.average('session', 'Z');
    const search = spectralPeaks(avg.density, meter.spectral.binHz, { lo: 20, hi: 250, frames: framesOf(avg.seconds, fs) });
    expect(search.ok).toBe(true);
    if (!search.ok) return;
    expect(search.peaks).toHaveLength(1);
    expect(Math.abs(search.peaks[0].f - 41.3)).toBeLessThanOrEqual(meter.spectral.binHz);
    expect(search.peaks[0].prominenceDb).toBeGreaterThan(20);
    const now = meter.spectral.average('now', 'Z');
    expect(spectralPeaks(now.density, meter.spectral.binHz, { lo: 20, hi: 250, frames: framesOf(now.seconds, fs) }))
      .toEqual({ ok: false, reason: 'frames', frames: 1 });
  });
  it('белый шум без тона: пиков нет (нет ложных срабатываний)', () => {
    const fs = 48000, meter = noiseMeter(30);
    const avg = meter.spectral.average('session', 'Z');
    const frames = framesOf(avg.seconds, fs);
    expect(frames).toBeGreaterThanOrEqual(PEAK_MIN_FRAMES);
    for (const weight of ['Z', 'A'] as const) {
      const density = meter.spectral.average('session', weight).density;
      expect(spectralPeaks(density, meter.spectral.binHz, { lo: 20, hi: 500, frames })).toMatchObject({ ok: true, peaks: [] });
    }
  });
  it('44,1 кГц: другой шаг спектра, тот же результат', () => {
    const fs = 44100, meter = noiseMeter(12, { hz: 68.6, amp: 0.02 }, fs);
    const avg = meter.spectral.average('session', 'Z');
    const search = spectralPeaks(avg.density, meter.spectral.binHz, { lo: 20, hi: 250, frames: framesOf(avg.seconds, fs) });
    expect(search.ok && search.peaks.map(p => Math.abs(p.f - 68.6) <= meter.spectral.binHz)).toEqual([true]);
  });
  it('пустой диапазон', () => {
    expect(spectralPeaks(new Float64Array(16385), 1.46, { lo: 300, hi: 200, frames: 100 })).toEqual({ ok: false, reason: 'range' });
  });

  it('допуск 3 % + шаг спектра; все моды в допуске, ближайшие первыми; без вывода причины', () => {
    const modes: NoiseMode[] = [
      { f: 40, n: [1, 0, 0], kind: 'axial' }, { f: 41.5, n: [1, 1, 0], kind: 'tangential' },
      { f: 42.2, n: [1, 1, 1], kind: 'oblique' }, { f: 44, n: [0, 1, 0], kind: 'axial' },
    ];
    const binHz = 48000 / 32768;
    const peak = { f: 41, bin: 28, levelDb: -60, prominenceDb: 12 };
    expect(matchTolerance(41, binHz)).toBeCloseTo(0.03 * 41 + binHz, 12);
    const [m] = matchPeaks([peak], modes, binHz);
    expect(m.tolerance).toBeCloseTo(2.695, 3);
    expect(m.candidates.map(c => c.mode.f)).toEqual([41.5, 40, 42.2]);
    expect(m.candidates[0].df).toBeCloseTo(0.5, 12);
    expect(Object.keys(m).sort()).toEqual(['candidates', 'peak', 'tolerance']);
    expect(matchPeaks([{ ...peak, f: 100 }], modes, binHz)[0].candidates).toEqual([]);
  });

  it('тон на осевой моде комнаты находит её среди возможных соответствий; вдали от мод — нет', () => {
    const s = snapshotOf(room(5, 4, 2.5), 300), fs = 48000;
    const axial = s.modes.find(m => m.n.join() === '1,0,0')!;
    for (const [hz, expected] of [[axial.f, true], [27, false]] as const) {
      const meter = noiseMeter(12, { hz, amp: 0.02 }, fs), avg = meter.spectral.average('session', 'Z');
      const search = spectralPeaks(avg.density, meter.spectral.binHz, { lo: 20, hi: s.schroederHz, frames: framesOf(avg.seconds, fs) });
      if (!search.ok) throw new Error('нет поиска');
      const [m] = matchPeaks(search.peaks, s.modes, meter.spectral.binHz);
      expect(m.candidates.some(c => c.mode === axial)).toBe(expected);
      if (!expected) expect(m.candidates).toEqual([]);
    }
  });
});

describe('057 · снимок в записи истории', () => {
  const linked = () => {
    const r = sessionRecord(toneMeter({ seconds: 2 }));
    return { ...r, project: { id: 'p1', name: 'Студия' }, context: { ...r.context, room: snapshotOf() } };
  };
  it('запись со снимком проходит проверку, schema 4 переносит снимок без изменений', () => {
    const r = linked();
    expect(checkRecord(r)).toBe(r);
    const back = parseNoiseFile(exportRecord(r, BUILD), 'room.json').record;
    expect(back.project).toEqual(r.project);
    expect(back.context.room).toEqual(r.context.room);
  });
  it('записи 056 без снимка остаются действительными', () => {
    const r = sessionRecord(toneMeter({ seconds: 2 }));
    expect('room' in r.context).toBe(false);
    expect(checkRecord({ ...r, project: { id: 'p1', name: 'Студия' } })).toBeTruthy();
  });
  it('отказ: снимок без связи с проектом, повреждённый снимок', () => {
    const r = linked();
    expect(() => checkRecord({ ...r, project: null })).toThrow(/без связи с проектом/);
    const broken = structuredClone(r);
    broken.context.room!.modes[0].f = -1;
    expect(() => checkRecord(broken)).toThrow(/снимок комнаты/);
    expect(() => parseNoiseFile(exportRecord(broken, BUILD), 'broken.json')).toThrow(/снимок комнаты/);
  });
});
