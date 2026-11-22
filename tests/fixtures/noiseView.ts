// Сравнение просмотра записи с живым шумомером для тестов 056.
import { expect } from 'vitest';
import type { NoiseMeter } from '../../src/core/noise';
import { PERIODS, type NoiseView } from '../../src/core/noiseRecord';
import type { Weight } from '../../src/core/noiseSpectrum';

const weights: Weight[] = ['Z', 'A', 'C'];
const rows = (v: Pick<NoiseView, 'history'>) => Array.from({ length: v.history.length }, (_, i) => v.history.at(i));

/** Все представления, которые читают панели шумомера: просмотр записи совпадает с живым сеансом побитно. */
export function expectSameView(view: NoiseView, meter: NoiseMeter) {
  expect(view.sampleRate).toBe(meter.sampleRate);
  expect(view.audioStartMs).toBe(meter.audioStartMs);
  expect(view.sessionPower).toBe(meter.sessionPower);
  expect(view.peakAmplitude).toBe(meter.peakAmplitude);
  expect(view.blockPower).toEqual(meter.blockPower);
  expect(view.spectral.binHz).toBe(meter.spectral.binHz);
  expect(view.spectral.range).toEqual(meter.spectral.range);
  expect(view.spectral.weightedSeconds).toBe(meter.spectral.weightedSeconds);
  expect(meter.snapshot()).toMatchObject(view.snapshot());
  for (const w of ['A', 'C'] as const) expect(view.spectral.leqPower(w)).toBe(meter.spectral.leqPower(w));
  for (const p of PERIODS) for (const w of weights) for (const corrected of [false, true]) {
    const a = view.spectral.average(p, w, corrected), b = meter.spectral.average(p, w, corrected);
    expect(a.seconds).toBe(b.seconds);
    expect(a.density).toEqual(b.density);
  }
  expect(rows(view)).toEqual(rows(meter));
  const tl = view.timeline!, live = meter.timeline;
  expect(tl.end).toBe(live.end);
  expect(tl.levelCount).toBe(live.levelCount);
  for (const w of weights) for (const m of ['leq1', 'leq10', 'leq60', 'leqAll', 'peak'] as const)
    expect(tl.series(m, w, 0, tl.levelCount)).toEqual(live.series(m, w, 0, live.levelCount));
  for (const corrected of [false, true]) for (const w of weights) {
    const v = tl.variant(w, corrected);
    expect(v).toBe(live.variant(w, corrected));
    expect(tl.interval(0, tl.levelCount, w, v)).toEqual(live.interval(0, live.levelCount, w, v));
    expect(tl.spectrogramColumns(0, tl.end, v)).toEqual(live.spectrogramColumns(0, live.end, v));
  }
}

