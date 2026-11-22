import { describe, expect, it } from 'vitest';
import { analyzeSweep, calAt, clapRT60, convolve, logGrid, logSweep, parseCalibration, powerAverage, smoothOct } from '../../src/core/dsp';
import { afterSmoothing, beforeSmoothing, correctionAt, micKey, type AppliedMic } from '../../src/core/micApply';
import type { MicProfile } from '../../src/core/micCalibration';

const fs = 48000;
const base: MicProfile = {
  id: 'c2', version: 1, name: 'C2', deviceModel: 'Test', inputKind: 'unknown', captureMode: 'Test', orientation: null,
  origin: 'user', sourceURL: null, sourceDate: null, method: 'Synthetic', referenceHz: 1000, validRangeHz: [20, 400],
  digitizationUncertaintyDb: null, validationStatus: 'unverified', notes: '', directivitySource: null,
  curve: { kind: 'correction', frequencyHz: [20, 50, 100, 200, 400], correctionDb: [6, 3, 0, -3, -6] },
};
const legacy = { name: 'legacy.txt', ...parseCalibration('20 4\n100 1\n500 -2') };
const catalog: AppliedMic = { mode: 'catalog', profile: base };
const old: AppliedMic = { mode: 'legacy', legacy };
const grid = logGrid(15, 250, 24);
const rough = grid.map((f, i) => -40 + 8 * Math.sin(i / 3) + (f > 60 && f < 70 ? 12 : 0));

/** Вход, записанный «комнатой» из прямого звука и одного отражения, как в тестах ДСП. */
function room(sweep: Float32Array) {
  const h = new Float32Array(Math.round(0.4 * fs));
  const d0 = Math.round(0.3 * fs);
  h[d0] = 0.3; h[d0 + Math.round(0.0071428 * fs)] = 0.15;
  return Float32Array.from(convolve(sweep, h));
}

describe('054 · применение микрофонной калибровки в «Анализаторе» и «Свипе»', () => {
  it('legacy по-прежнему вычитается после сглаживания; без файла и в режиме «без калибровки» данные не меняются', () => {
    const smoothed = smoothOct(grid, rough, 1 / 12);
    const before = smoothed.map((v, i) => v - calAt(legacy, grid[i]));
    expect(afterSmoothing(old, grid, smoothOct(grid, beforeSmoothing(old, grid, rough), 1 / 12))).toEqual(before);
    expect(beforeSmoothing(old, grid, rough)).toBe(rough);
    expect(afterSmoothing({ mode: 'legacy', legacy: null }, grid, smoothed)).toBe(smoothed);
    for (const step of [beforeSmoothing, afterSmoothing]) expect(step({ mode: 'none' }, grid, rough)).toBe(rough);
  });

  it('профиль каталога добавляется до сглаживания, вне диапазона — без поправки, ровно одна поправка', () => {
    const c = correctionAt(base, grid);
    const expected = smoothOct(grid, rough.map((v, i) => v + c[i]), 1 / 12);
    const got = afterSmoothing(catalog, grid, smoothOct(grid, beforeSmoothing(catalog, grid, rough), 1 / 12));
    expect(got).toEqual(expected);
    // legacy-файл существует, но при выбранном профиле не вычитается
    expect(afterSmoothing(catalog, grid, expected)).toBe(expected);
    expect(got).not.toEqual(expected.map((v, i) => v - calAt(legacy, grid[i])));
    expect(correctionAt(base, [15, 19.9, 20, 400, 401, 1000])).toEqual([0, 0, 6, -6, 0, 0]);
    // постоянная поправка сдвигает сглаженный уровень ровно на столько же
    const flat: MicProfile = { ...base, curve: { kind: 'correction', frequencyHz: [10, 1000], correctionDb: [4, 4] }, validRangeHz: [10, 1000] };
    const shifted = smoothOct(grid, beforeSmoothing({ mode: 'catalog', profile: flat }, grid, rough), 1 / 12);
    smoothOct(grid, rough, 1 / 12).forEach((v, i) => expect(shifted[i] - v).toBeCloseTo(4, 10));
  });

  it('АЧХ микрофона нормируется на 1 кГц и вычитается, готовая поправка берётся как есть, усиление ограничено', () => {
    const response: MicProfile = { ...base, validRangeHz: [20, 2000],
      curve: { kind: 'response', frequencyHz: [20, 100, 1000, 2000], responseDb: [-10, -2, 1, 1] } };
    expect(correctionAt(response, [20, 100, 1000])).toEqual([11, 3, 0]);
    expect(correctionAt({ ...response, maxBoostDb: 3 }, [20, 100, 1000])).toEqual([3, 3, 0]);
    expect(correctionAt({ ...base, maxBoostDb: 0 }, [20, 100, 400])).toEqual([0, 0, -6]);
  });

  it('«Свип»: поправка к АЧХ точки до сглаживания 1/24; сигнал, ИХ, запас по шуму и время не меняются', () => {
    const sweep = logSweep(10, 1000, 4, fs);
    const rec = room(sweep);
    let grid24: number[] = [], raw: number[] = [];
    const plain = analyzeSweep(rec, sweep, 10, 1000, fs);
    const corrected = analyzeSweep(rec, sweep, 10, 1000, fs, (f, db) => { grid24 = f; raw = db; return beforeSmoothing(catalog, f, db); });
    expect(corrected.f).toEqual(plain.f);
    expect(grid24).toEqual(plain.f);
    expect([corrected.peak, corrected.snrDb, corrected.irPeakAt]).toEqual([plain.peak, plain.snrDb, plain.irPeakAt]);
    expect(smoothOct(grid24, raw, 1 / 24)).toEqual(plain.db);
    const c = correctionAt(base, grid24);
    expect(corrected.db).toEqual(smoothOct(grid24, raw.map((v, i) => v + c[i]), 1 / 24));
    // в середине диапазона гладкой поправки сдвиг близок к поправке; за 400 Гц — без поправки
    const at = (r: { f: number[]; db: number[] }, hz: number) => r.db[r.f.findIndex(x => x >= hz)];
    expect(at(corrected, 100) - at(plain, 100)).toBeCloseTo(0, 0);
    expect(at(corrected, 30) - at(plain, 30)).toBeGreaterThan(4);
    expect(at(corrected, 480) - at(plain, 480)).toBeCloseTo(0, 9);
    // legacy-путь «Свипа» прежний: вычитание после сглаживания
    expect(afterSmoothing(old, plain.f, plain.db)).toEqual(plain.db.map((v, i) => v - calAt(legacy, plain.f[i])));
    // усреднение точек одного сеанса с одной поправкой
    expect(powerAverage([corrected.db, corrected.db])).toEqual(corrected.db.map(v => expect.closeTo(v, 9)));
  });

  it('ключ поправки различает режимы и версии, но не название', () => {
    expect(micKey(catalog)).toBe(micKey({ mode: 'catalog', profile: { ...base, name: 'Другое' } }));
    expect(micKey(catalog)).not.toBe(micKey({ mode: 'catalog', profile: { ...base, version: 2 } }));
    expect(micKey({ mode: 'none' })).not.toBe(micKey(old));
  });
});

describe('054 · «Хлопок»: RT60 не зависит от постоянного усиления', () => {
  it('усиление сигнала на 6 и −12 дБ не меняет RT60 ни в одной полосе', () => {
    const T = 0.6, x = new Float32Array(fs * 2);
    let seed = 7;
    for (let i = 0; i < x.length; i++) {
      seed = (seed * 16807) % 2147483647;
      x[i] = ((seed / 2147483647) * 2 - 1) * Math.pow(10, (-60 * (i / fs) / T) / 20) * 0.4;
    }
    const ref = clapRT60(x, fs);
    for (const gain of [2, 0.25]) {
      const scaled = clapRT60(Float32Array.from(x, v => v * gain), fs);
      scaled.forEach((band, k) => {
        expect(band.band).toBe(ref[k].band);
        if (ref[k].t60 === null) expect(band.t60).toBeNull();
        else expect(band.t60!).toBeCloseTo(ref[k].t60!, 3);
      });
    }
  });
});
