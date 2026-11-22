import { describe, expect, it } from 'vitest';
import { asCopy, exportRecord, legacyReport, MAX_IMPORT_BYTES, NOISE_EXPORT_KIND, parseNoiseFile } from '../../src/core/noiseFile';
import { recordView, NoiseRecordError } from '../../src/core/noiseRecord';
import { BUILD, capture, legacyExport, sessionRecord, START_MS, testProfile, toneMeter } from '../fixtures/noise';
import { expectSameView } from '../fixtures/noiseView';

const now = new Date('2026-11-22T12:00:00.000Z');
const code = (fn: () => unknown) => { try { fn(); } catch (e) { return (e as NoiseRecordError).code; } return 'ok'; };

describe('расширенный JSON schema 4', () => {
  it('экспорт и импорт сохраняют запись побитно; просмотр после импорта совпадает с живым сеансом', () => {
    const meter = toneMeter({ seconds: 9, profile: testProfile, skip: seq => seq === 50 });
    const record = sessionRecord(meter, { name: 'Спальня, ночь' });
    const text = exportRecord(record, BUILD, now);
    const file = JSON.parse(text);
    expect(file.kind).toBe(NOISE_EXPORT_KIND);
    expect(file.schema).toBe(4);
    expect(file.record.content.session.spectra.session.psd.$typed).toBe('Float64Array');
    const { record: back, schema } = parseNoiseFile(text, 'Спальня, ночь-session.json', now);
    expect(schema).toBe(4);
    expect(back.id).toBe(record.id);
    expect(back.content).toEqual(record.content);
    expect(back.context).toEqual(record.context);
    expect(back.imported).toEqual({ at: now.toISOString(), file: 'Спальня, ночь-session.json', schema: 4 });
    expectSameView(recordView(back.content, back.context), meter);
    // Повторный экспорт импортированной записи даёт то же содержимое.
    expect(JSON.parse(exportRecord(back, BUILD, now)).record.content).toEqual(file.record.content);
  });

  it('BOM, повреждённый JSON, файл проекта, schema 1, новая и неизвестная схема, лишний объём', () => {
    const text = exportRecord(sessionRecord(toneMeter({ seconds: 2 })), BUILD, now);
    expect(code(() => parseNoiseFile('﻿' + text, 'a.json'))).toBe('ok');
    expect(code(() => parseNoiseFile(text.slice(0, -40), 'a.json'))).toBe('invalid');
    expect(code(() => parseNoiseFile('[]', 'a.json'))).toBe('invalid');
    expect(() => parseNoiseFile(JSON.stringify({ format: 'room-acoustics-project', version: 7 }), 'p.json')).toThrow(/проекта/);
    expect(() => parseNoiseFile(JSON.stringify({ schema: 1, units: 'dBFS' }), 'a.json')).toThrow(/schema 1/);
    expect(code(() => parseNoiseFile(JSON.stringify({ ...JSON.parse(text), schema: 5 }), 'a.json'))).toBe('newer');
    expect(code(() => parseNoiseFile(JSON.stringify({ ...JSON.parse(text), schema: 3.5 }), 'a.json'))).toBe('invalid');
    expect(code(() => parseNoiseFile(JSON.stringify({ schema: 9 }), 'a.json'))).toBe('invalid');
    expect(code(() => parseNoiseFile(' '.repeat(MAX_IMPORT_BYTES + 1), 'a.json'))).toBe('size');
  });

  it('отвергает подмену массивов, значений и итогов', () => {
    const file = JSON.parse(exportRecord(sessionRecord(toneMeter({ seconds: 3 })), BUILD, now));
    const cases: ((f: any) => void)[] = [
      f => { f.record.content.session.spectra.session.psd.length += 1; },
      f => { f.record.content.session.spectra.session.psd.base64 = '***'; },
      f => { f.record.content.session.spectra.session.psd.$typed = 'BigInt64Array'; },
      f => { f.record.content.session.totals.sumSquares = -1; },
      f => { f.record.content.session.settings.fftSize = 1024; },
      f => { f.record.content.session.settings.sampleRate = 'x'; },
      f => { f.record.id = '../../etc'; },
      f => { f.record.context.view.period = 'week'; },
      f => { f.record.content.session.meta.audioStartMs = 'вчера'; },
      f => { f.record.content.session.calibration = { profile: { id: 1 }, model: null, maxBoostDb: 12, outsideRange: 'uncorrected' }; },
    ];
    for (const change of cases) {
      const copy = structuredClone(file);
      change(copy);
      expect(() => parseNoiseFile(JSON.stringify(copy), 'a.json'), change.toString()).toThrow(NoiseRecordError);
    }
  });

  it('копия получает новый идентификатор и то же содержимое', () => {
    const r = sessionRecord(toneMeter({ seconds: 2 }));
    const copy = asCopy(r, 'copy-0000-1111');
    expect(copy.id).toBe('copy-0000-1111');
    expect(copy.content).toBe(r.content);
  });
});

describe('прежние экспорты schema 2/3', () => {
  it('legacyReport даёт прежний состав и порядок полей schema 2 и 3', () => {
    const plain = legacyExport(toneMeter({ seconds: 3 }), 'Z', 'session');
    expect(plain.schema).toBe(2);
    expect(Object.keys(plain)).toEqual(['schema', 'build', 'mode', 'units', 'fftSize', 'window', 'spectrum', 'rmsWindowSamples', 'secureContext',
      'microphoneApi', 'date', 'status', 'error', 'path', 'measurement', 'manual', 'name', 'audioStartMs', 'history', 'rmsAverageSeconds',
      'spectralAnalysis']);
    const calibrated = legacyExport(toneMeter({ seconds: 3, profile: testProfile }), 'A', '10');
    expect(calibrated.schema).toBe(3);
    expect(Object.keys(calibrated)[0]).toBe('calibration');
    expect(calibrated.calibration!.correctedSpectrum.period).toBe('10');
    expect(calibrated.history[0].timestamp).toBe(new Date(START_MS + calibrated.history[0].endSeconds * 1000).toISOString());
  });

  it('импорт schema 3 переносит снимок калибровки только в запись; повторный импорт — тот же идентификатор', () => {
    const meter = toneMeter({ seconds: 4, profile: testProfile });
    const text = JSON.stringify(legacyExport(meter, 'C', 'session'));
    const a = parseNoiseFile(text, 'old.json', now), b = parseNoiseFile(text, 'renamed.json', new Date());
    expect(a.record.id).toMatch(/^legacy-[0-9a-f]{16}$/);
    expect(b.record.id).toBe(a.record.id);
    expect(a.record.content.type === 'legacy' && a.record.content.legacy.calibration?.profile).toEqual(testProfile);
    const other = parseNoiseFile(JSON.stringify(legacyExport(meter, 'Z', 'session')), 'old.json', now);
    expect(other.record.id).not.toBe(a.record.id);
  });

  it('проверяет сетку времени, частоты, значения и согласованность сводки', () => {
    const base = legacyExport(toneMeter({ seconds: 3, profile: testProfile }), 'A', 'session');
    const cases: ((d: any) => void)[] = [
      d => { d.history[3].endSeconds += 0.001; },
      d => { d.history[3].missingBefore = 2; },
      d => { d.history[2].peakHz = 1000.5; },
      d => { d.history[2].rmsDbfs = 'громко'; },
      d => { d.measurement.blocks += 1; },
      d => { d.path.sampleRate = 100; },
      d => { d.path.backend = 'MediaRecorder'; },
      d => { d.spectralAnalysis.psd = d.spectralAnalysis.psd.slice(1); },
      d => { d.spectralAnalysis.psd[5] = -1; },
      d => { d.spectralAnalysis.binHz = 1; },
      d => { d.spectralAnalysis.weight = 'B'; },
      d => { d.calibration.correctedSpectrum.period = '10'; },
      d => { d.calibration.profile.curve.frequencyHz = [1000, 100]; },
      d => { delete d.calibration; },
      d => { d.units = 'dB SPL'; },
    ];
    for (const change of cases) {
      const copy = structuredClone(base);
      change(copy);
      expect(() => parseNoiseFile(JSON.stringify(copy), 'a.json'), change.toString()).toThrow(NoiseRecordError);
    }
  });

  it('диагностика тракта без идентификаторов устройства и лишних полей', () => {
    const report = legacyExport(toneMeter({ seconds: 2 }), 'Z', 'session') as any;
    report.path = { ...capture(48000), deviceId: 'secret-device', label: 'Мой микрофон', settings: { ...capture(48000).settings, deviceId: 'secret', groupId: 'g' } };
    const { record } = parseNoiseFile(JSON.stringify(report), 'a.json');
    const text = JSON.stringify(record.content);
    expect(text).not.toContain('secret');
    expect(text).not.toContain('Мой микрофон');
  });

  it('legacyReport без завершённого сеанса — только сохранённое состояние', () => {
    const report = legacyReport(null, { date: now.toISOString(), status: 'Готов', error: null, path: null, measurement: null, manual: 'untested', name: '',
      audioStartMs: null, history: { length: 0, at: () => undefined } as any }, { weight: 'Z', period: 'session', model: undefined, build: BUILD, secureContext: true, microphoneApi: true });
    expect(report.schema).toBe(2);
    expect(report.spectralAnalysis).toBeNull();
    expect(report.history).toEqual([]);
  });
});
