import { describe, expect, it } from 'vitest';
import { csvKinds, MAX_SPECTROGRAM_CELLS, noiseCsv, type CsvKind } from '../../src/core/noiseCsv';
import { parseNoiseFile } from '../../src/core/noiseFile';
import { recordView, NoiseRecordError } from '../../src/core/noiseRecord';
import { bandPowers, SPECTRUM_SIZE } from '../../src/core/noiseSpectrum';
import { legacyExport, sessionRecord, testProfile, toneMeter } from '../fixtures/noise';

const meter = toneMeter({ seconds: 13, profile: testProfile, hz: 1000, amp: 0.1 });
const record = sessionRecord(meter, { name: 'Кухня, вытяжка' });
const view = recordView(record.content, record.context);
const options = { weight: 'A' as const, period: 'session' as const, corrected: false, from: 0, to: 13 };

/** Таблица без строк «#»: заголовок и строки данных. */
function table(text: string) {
  expect(text.startsWith('﻿# Room Acoustics')).toBe(true);
  expect(text.endsWith('\r\n')).toBe(true);
  const lines = text.slice(1).split('\r\n').slice(0, -1);
  const meta = lines.filter(l => l.startsWith('# '));
  const data = lines.filter(l => !l.startsWith('# '));
  const head = data[0].split(','), rows = data.slice(1).map(l => l.split(','));
  for (const row of rows) expect(row.length).toBe(head.length);
  return { meta: meta.join('\n'), head, rows, col: (name: string) => rows.map(r => r[head.indexOf(name)]) };
}

describe('CSV сохранённого сеанса', () => {
  it('у каждой таблицы есть единицы dBFS, вес, сведения о поправке и описания столбцов', () => {
    for (const kind of csvKinds(record)) {
      const { meta, head } = table(noiseCsv(record, view, kind, options));
      expect(meta).toContain('dBFS');
      expect(meta).toContain('не дБ SPL');
      expect(meta).toContain('Тестовая поправка');
      expect(meta).toContain('Кухня, вытяжка');
      for (const name of head) if (!name.startsWith('psd_')) expect(meta, kind + ' ' + name).toContain(`  ${name} — `);
    }
  });

  it('спектр: исходная и исправленная PSD в разных столбцах, значения из записи', () => {
    const { head, rows, col } = table(noiseCsv(record, view, 'spectrum', options));
    expect(head).toEqual(['frequency_hz', 'psd_a_fs2_hz', 'psd_a_dbfs_hz', 'psd_a_corrected_fs2_hz', 'psd_a_corrected_dbfs_hz', 'correction_db']);
    expect(rows.length).toBe(SPECTRUM_SIZE / 2 + 1);
    const raw = meter.spectral.average('session', 'A'), corr = meter.spectral.average('session', 'A', true);
    const k = Math.round(1000 / meter.spectral.binHz);
    expect(Number(col('psd_a_fs2_hz')[k])).toBe(raw.density[k]);
    expect(Number(col('psd_a_corrected_fs2_hz')[k])).toBe(corr.density[k]);
    expect(Number(col('frequency_hz')[k])).toBe(k * meter.spectral.binHz);
    expect(col('psd_a_dbfs_hz')[0]).toBe('-inf');
  });

  it('полосы, история по секундам и блоки RMS согласованы с данными шумомера', () => {
    const bands = table(noiseCsv(record, view, 'bands', { ...options, weight: 'Z', from: 0, to: 13 }));
    const live = meter.timeline.interval(0, meter.timeline.levelCount, 'Z', meter.timeline.variant('Z', false)).bands;
    expect(bands.col('power_z_fs2').map(Number)).toEqual(live.map(b => b.power));
    const levels = table(noiseCsv(record, view, 'levels', { ...options, weight: 'Z', from: 2, to: 6 }));
    expect(levels.col('t_start_s')).toEqual(['2', '3', '4', '5']);
    const leq1 = meter.timeline.series('leq1', 'Z', 2, 6);
    expect(levels.col('leq_1s_z_dbfs').map(Number)).toEqual(Array.from(leq1.power, p => Number((10 * Math.log10(p)).toFixed(4))));
    const rms = table(noiseCsv(record, view, 'rms', options));
    expect(rms.rows.length).toBe(meter.history.length);
    expect(Number(rms.col('rms_block_z_dbfs')[5])).toBe(Number(meter.history.at(5)!.rmsDbfs!.toFixed(4)));
  });

  it('спектрограмма: интервал, доля данных и предел объёма', () => {
    const { head, rows, col } = table(noiseCsv(record, view, 'spectrogram', { ...options, corrected: true, from: 1, to: 3 }));
    expect(head.slice(0, 3)).toEqual(['t_start_s', 't_end_s', 'data_fraction']);
    expect(head.every((h, i) => i < 3 || /^psd_[\d.]+hz_corrected$/.test(h))).toBe(true);
    expect(rows.length).toBeGreaterThan(4);
    expect(Number(col('t_start_s')[0])).toBeLessThanOrEqual(1);
    expect(Number(col('t_end_s').at(-1))).toBeGreaterThanOrEqual(3);
    expect(MAX_SPECTROGRAM_CELLS).toBeGreaterThan(12 * 360 * head.length);
  });

  it('пустой интервал — ошибка, а не пустая таблица', () => {
    expect(() => noiseCsv(record, view, 'levels', { ...options, from: 40, to: 50 })).toThrow(NoiseRecordError);
  });
});

describe('CSV импорта schema 2/3', () => {
  it('только представления, которые есть в файле; вес и период — из файла', () => {
    const old = parseNoiseFile(JSON.stringify(legacyExport(meter, 'C', '60')), 'old.json').record;
    const v = recordView(old.content, old.context);
    expect(csvKinds(old)).toEqual(['spectrum', 'rms', 'bands']);
    for (const kind of ['levels', 'spectrogram', 'ltas'] as CsvKind[]) expect(() => noiseCsv(old, v, kind, options)).toThrow(NoiseRecordError);
    const spectrum = table(noiseCsv(old, v, 'spectrum', { ...options, weight: 'Z', period: 'session' }));
    expect(spectrum.head[1]).toBe('psd_c_fs2_hz');
    expect(spectrum.meta).toContain('среднее за 60 с');
    const bands = table(noiseCsv(old, v, 'bands', options));
    expect(bands.col('power_c_fs2').map(Number)).toEqual(bandPowers(meter.spectral.average('60', 'C').density, meter.spectral.binHz).map(b => b.power));
    const plain = parseNoiseFile(JSON.stringify({ ...legacyExport(toneMeter({ seconds: 2 }), 'Z', 'session'), spectralAnalysis: null }), 'p.json').record;
    expect(csvKinds(plain)).toEqual(['rms']);
  });
});
