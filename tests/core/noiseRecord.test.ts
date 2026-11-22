import { describe, expect, it } from 'vitest';
import { FFT_SIZE } from '../../src/core/noise';
import { checkRecord, recordHeader, recordView, recordWarnings, NoiseRecordError, type NoiseRecord, type NoiseView } from '../../src/core/noiseRecord';
import type { Weight } from '../../src/core/noiseSpectrum';
import { legacyExport, sessionRecord, testProfile, toneMeter } from '../fixtures/noise';
import { expectSameView } from '../fixtures/noiseView';
import { parseNoiseFile } from '../../src/core/noiseFile';

const rows = (v: Pick<NoiseView, 'history'>) => Array.from({ length: v.history.length }, (_, i) => v.history.at(i));

describe('запись истории сеанса', () => {
  it('просмотр сохранённого сеанса совпадает с живым шумомером побитно, с профилем и без', () => {
    for (const profile of [null, testProfile]) {
      const meter = toneMeter({ seconds: 14, profile, hz: t => 200 + 400 * t, amp: t => 0.05 + 0.02 * t });
      const r = checkRecord(sessionRecord(meter));
      expectSameView(recordView(r.content, r.context), meter);
    }
  });

  it('заголовок выводится из содержимого: Leq Z/A/C, длительность, калибровка, объём', () => {
    const meter = toneMeter({ seconds: 6, profile: testProfile, skip: seq => seq === 20 || seq === 21, clipAt: 30 });
    const r = sessionRecord(meter), h = recordHeader(r);
    expect(h.leq.Z).toBe(meter.sessionPower);
    expect(h.leq.A).toBe(meter.spectral.leqPower('A'));
    expect(h.leq.C).toBe(meter.spectral.leqPower('C'));
    expect(h.activeSeconds).toBe(meter.history.length * FFT_SIZE / 48000);
    expect(h.missingBlocks).toBe(2);
    expect(h.clippedBlocks).toBe(1);
    expect(h.calibration).toEqual({ id: testProfile.id, version: 1, name: testProfile.name });
    expect(h.startedAt).toBe(new Date(meter.audioStartMs!).toISOString());
    expect(h.bytes).toBeGreaterThan(0);
    const codes = recordWarnings(r).map(w => w.code);
    expect(codes).toEqual(expect.arrayContaining(['missing', 'clipped']));
    expect(codes).not.toContain('noProfile');
  });

  it('проверка отвергает неверные идентификатор, название, контекст и несогласованные итоги', () => {
    const r = sessionRecord(toneMeter({ seconds: 3 }));
    const bad: ((x: NoiseRecord) => unknown)[] = [
      x => { x.id = 'a b'; }, x => { x.name = 'x'.repeat(101); }, x => { x.savedAt = 'вчера'; },
      x => { x.context.view.weight = 'B' as Weight; }, x => { x.context.ranges!.Z.max = -1; },
      x => { x.context.absolute = { offsetDb: NaN, verifiedAt: '2026-01-01T00:00:00.000Z', references: [] }; },
      x => { if (x.content.type === 'session') x.content.session.totals.blocks += 1; },
      x => { if (x.content.type === 'session') x.content.session.spectra.session.psd = new Float64Array(10); },
      x => { (x.content as { type: string }).type = 'pcm'; },
    ];
    for (const change of bad) {
      const copy = structuredClone(r);
      change(copy);
      expect(() => checkRecord(copy)).toThrow(NoiseRecordError);
    }
    expect(() => checkRecord(structuredClone(r))).not.toThrow();
  });
});

describe('импорт schema 2/3 как запись истории', () => {
  it('история блоков переносится точно, спектр — только сохранённого веса и периода', () => {
    const meter = toneMeter({ seconds: 8, profile: testProfile, skip: seq => seq === 40 });
    const report = legacyExport(meter, 'A', '60');
    const { record, schema } = parseNoiseFile(JSON.stringify(report), 'old.json');
    expect(schema).toBe(3);
    const view = recordView(record.content, record.context);
    expect(rows(view)).toEqual(rows(meter));
    expect(view.timeline).toBeNull();
    const live = meter.spectral.average('60', 'A'), saved = view.spectral.average('60', 'A');
    expect(saved.density).toEqual(live.density);
    expect(saved.seconds).toBe(live.seconds);
    expect(view.spectral.average('60', 'A', true).density).toEqual(meter.spectral.average('60', 'A', true).density);
    expect(view.spectral.average('session', 'A').seconds).toBe(0);
    expect(view.spectral.average('60', 'Z').seconds).toBe(0);
    expect(view.spectral.leqPower('A')).toBe(meter.spectral.leqPower('A'));
    expect(view.spectral.leqPower('C')).toBeNull();
    const h = recordHeader(record);
    expect(h.leq.A).toBe(meter.spectral.leqPower('A'));
    expect(h.leq.C).toBeNull();
    expect(h.leq.Z).toBeCloseTo(meter.sessionPower!, 12);
    expect(h.missingBlocks).toBe(1);
    const codes = recordWarnings(record).map(w => w.code);
    expect(codes).toEqual(expect.arrayContaining(['legacy', 'legacySpectrum']));
  });

  it('schema 2 без спектра: только история RMS', () => {
    const meter = toneMeter({ seconds: 3 });
    const report = { ...legacyExport(meter, 'Z', 'session'), spectralAnalysis: null };
    const { record, schema } = parseNoiseFile(JSON.stringify(report), 'old.json');
    expect(schema).toBe(2);
    expect(record.content.type === 'legacy' && record.content.legacy.spectrum).toBeNull();
    expect(recordWarnings(record).map(w => w.code)).toContain('noSpectrum');
  });
});
