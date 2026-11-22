import { describe, expect, it } from 'vitest';
import { bandDensity, compareRecords, type CompareSide } from '../../src/core/noiseCompare';
import { parseNoiseFile } from '../../src/core/noiseFile';
import { recordView, type NoiseRecord } from '../../src/core/noiseRecord';
import { SPECTRUM_SIZE } from '../../src/core/noiseSpectrum';
import { spectrogramEdges } from '../../src/core/noiseTimeline';
import { legacyExport, sessionRecord, testProfile, toneMeter } from '../fixtures/noise';

const side = (record: NoiseRecord): CompareSide => ({ record, view: recordView(record.content, record.context) });
const level = (c: ReturnType<typeof compareRecords>, key: string) => c.checks.find(x => x.key === key)!.level;
const options = { weight: 'Z' as const, period: 'session' as const, corrected: false };

describe('сравнение двух записей', () => {
  it('совместимые сеансы: разница уровней полос и Leq, все проверки пройдены', () => {
    const quiet = side(sessionRecord(toneMeter({ seconds: 8, amp: 0.05 }), { id: 'quiet-0001' }));
    const loud = side(sessionRecord(toneMeter({ seconds: 8, amp: 0.1 }), { id: 'loud-00001' }));
    const c = compareRecords(quiet, loud, options);
    expect(c.checks.every(x => x.level === 'ok')).toBe(true);
    expect(c.spectral).toBe(true);
    const peak = c.bands!.reduce((best, x) => x.b > best.b ? x : best);
    expect(peak.lo).toBeLessThan(1000);
    expect(peak.hi).toBeGreaterThan(1000);
    expect(peak.diff).toBeCloseTo(20 * Math.log10(2), 6);
    expect(c.leq.find(x => x.weight === 'Z')!.diff).toBeCloseTo(20 * Math.log10(2), 6);
    expect(c.six!.find(x => x.lo <= 1000 && x.hi > 1000)!.diff).toBeCloseTo(20 * Math.log10(2), 6);
  });

  it('разная частота дискретизации: полосы 1/12 октавы с сохранением энергии', () => {
    const a = side(sessionRecord(toneMeter({ seconds: 8, fs: 48000, amp: 0.1 }), { id: 'rate-48000' }));
    const b = side(sessionRecord(toneMeter({ seconds: 8, fs: 44100, amp: 0.1 }), { id: 'rate-44100' }));
    const c = compareRecords(a, b, options);
    expect(level(c, 'grid')).toBe('warn');
    expect(level(c, 'range')).toBe('ok');
    const peak = c.bands!.reduce((best, x) => x.a > best.a ? x : best);
    expect(Math.abs(peak.diff!)).toBeLessThan(0.05);
    // Энергия до верхней общей полосы сохраняется при переходе от бинов к полосам.
    const edges = spectrogramEdges(44100), psd = a.view.spectral.average('session', 'Z').density, binHz = 48000 / SPECTRUM_SIZE;
    const top = edges.at(-1)!;
    let direct = 0;
    for (let k = 0; k < psd.length; k++) {
      const lo = Math.max(edges[0], (k - 0.5) * binHz), hi = Math.min(top, (k + 0.5) * binHz);
      if (hi > lo) direct += psd[k] * (hi - lo);
    }
    const banded = bandDensity(psd, binHz, edges).reduce((n, x) => n + x.power, 0);
    expect(banded / direct).toBeCloseTo(1, 9);
  });

  it('разные веса и импорт без нужного веса — спектральное сравнение запрещено', () => {
    const meter = toneMeter({ seconds: 6 });
    const session = side(sessionRecord(meter, { id: 'session-01' }));
    const old = side(parseNoiseFile(JSON.stringify(legacyExport(meter, 'A', 'session')), 'old.json').record);
    const c = compareRecords(session, old, options);
    expect(level(c, 'weight')).toBe('block');
    expect(c.spectral).toBe(false);
    expect(c.bands).toBeNull();
    expect(c.six).toBeNull();
    // Leq сравнивается по тем весам, что есть в обеих записях.
    expect(c.leq.find(x => x.weight === 'A')!.diff).toBeCloseTo(0, 9);
    expect(c.leq.find(x => x.weight === 'C')!.b).toBeNull();
    const same = compareRecords(session, old, { ...options, weight: 'A' });
    expect(same.spectral).toBe(true);
    expect(level(same, 'input')).toBe('warn');
    expect(Math.max(...same.bands!.map(x => Math.abs(x.diff ?? 0)))).toBeLessThan(1e-9);
  });

  it('поправка профиля: разный представленный вид и разные профили помечаются', () => {
    const raw = side(sessionRecord(toneMeter({ seconds: 6 }), { id: 'raw-000001' }));
    const corrected = side(sessionRecord(toneMeter({ seconds: 6, profile: testProfile }), { id: 'corr-00001' }));
    const c = compareRecords(raw, corrected, { ...options, corrected: true });
    expect(level(c, 'calibration')).toBe('warn');
    expect(c.a.corrected).toBe(false);
    expect(c.b.corrected).toBe(true);
    expect(compareRecords(corrected, corrected, { ...options, corrected: true }).checks.find(x => x.key === 'calibration')!.level).toBe('ok');
  });

  it('нет спектра у импорта schema 2 — сравнение спектров недоступно', () => {
    const meter = toneMeter({ seconds: 4 });
    const plain = side(parseNoiseFile(JSON.stringify({ ...legacyExport(meter, 'Z', 'session'), spectralAnalysis: null }), 'p.json').record);
    const c = compareRecords(side(sessionRecord(meter)), plain, options);
    expect(level(c, 'kind')).toBe('block');
    expect(c.checks.find(x => x.key === 'kind')!.detail).toBe('B');
    expect(c.bands).toBeNull();
  });
});
