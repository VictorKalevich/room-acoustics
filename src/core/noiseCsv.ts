import { FFT_SIZE } from './noise';
import { bandPowers, SPECTRUM_SIZE, type SpectrumPeriod, type Weight } from './noiseSpectrum';
import { recordHeader, NoiseRecordError, PERIODS, type NoiseRecord, type NoiseView } from './noiseRecord';

/**
 * Экспорт CSV сохранённого измерения (056). Каждая таблица начинается строками «#» с измерением, единицами, весом,
 * наличием поправки и смыслом столбцов. Разделитель — запятая, десятичная точка, UTF-8 с BOM, строки CRLF.
 * Исходные и исправленные профилем значения — в разных столбцах с пометкой corrected. Точные данные — в JSON schema 4.
 */
export type CsvKind = 'spectrum' | 'ltas' | 'levels' | 'rms' | 'bands' | 'spectrogram';
export interface CsvOptions { weight: Weight; period: SpectrumPeriod; corrected: boolean; from: number; to: number }
export const CSV_FORMAT = 1;
/** Ячеек спектрограммы в одном файле; сеанс 12 ч по 10 с — около 0,52 млн. */
export const MAX_SPECTROGRAM_CELLS = 1_000_000;

const PERIOD_LABEL: Record<SpectrumPeriod, string> = { now: 'последний кадр', '10': 'среднее за 10 с', '60': 'среднее за 60 с', session: 'среднее за сеанс (LTAS)' };

/** Представления, которые можно получить из записи. Импорт schema 2/3 не содержит истории по секундам и спектрограммы. */
export function csvKinds(r: NoiseRecord): CsvKind[] {
  if (r.content.type === 'session') return ['spectrum', 'ltas', 'levels', 'rms', 'bands', 'spectrogram'];
  return r.content.legacy.spectrum?.psd ? ['spectrum', 'rms', 'bands'] : ['rms'];
}

const lin = (v: number | null | undefined) => v == null || Number.isNaN(v) ? '' : String(v);
const dB = (p: number | null | undefined, digits = 4) => p == null || Number.isNaN(p) ? '' : p === 0 ? '-inf' : p > 0 ? (10 * Math.log10(p)).toFixed(digits) : '';
const s = (v: number) => String(v);
const tag = (w: Weight) => w.toLowerCase();

function document(r: NoiseRecord, view: NoiseView, title: string, lines: string[], columns: [string, string][], rows: string[][]) {
  const h = recordHeader(r);
  const profile = view.profile;
  const head = [
    `Room Acoustics · шумомер · ${title}`,
    `Формат: noise-csv ${CSV_FORMAT} · разделитель — запятая, десятичная точка, UTF-8`,
    `Измерение: ${r.name || '(без названия)'} · id ${r.id}`,
    `Начало: ${h.startedAt ?? 'неизвестно'} · принято сигнала ${h.activeSeconds.toFixed(3)} с · шкала сеанса ${h.spanSeconds.toFixed(3)} с · частота дискретизации ${h.sampleRate} Гц`,
    `FFT ${SPECTRUM_SIZE}, шаг ${(h.sampleRate / SPECTRUM_SIZE).toFixed(6)} Гц, окно Ханна, шаг кадра ${SPECTRUM_SIZE / 2}; блок RMS ${FFT_SIZE} отсчётов`,
    `Источник: ${h.source === 'session' ? 'сеанс шумомера, снимок v' + h.sourceVersion : 'импорт экспорта schema ' + h.sourceVersion}`,
    'Уровни: цифровая шкала dBFS (0 dBFS — полная шкала), не дБ SPL',
    profile ? `Поправка микрофона: столбцы с «corrected» — с поправкой снимка профиля «${profile.name}» v${profile.version} (как при записи); остальные — исходные`
      : 'Поправка микрофона: нет, все значения исходные',
    'Пустая ячейка — нет данных; -inf — цифровая тишина (нулевая мощность)',
    ...lines,
    'Столбцы:',
    ...columns.filter(c => c[1]).map(([name, about]) => `  ${name} — ${about}`),
  ].map(line => '# ' + line);
  return '﻿' + [...head, columns.map(c => c[0]).join(','), ...rows.map(row => row.join(','))].join('\r\n') + '\r\n';
}

function interval(view: NoiseView, o: CsvOptions) {
  const tl = view.timeline!, n0 = Math.max(0, Math.floor(Math.min(o.from, o.to))), n1 = Math.min(tl.levelCount, Math.ceil(Math.max(o.from, o.to)));
  if (n1 <= n0) throw new NoiseRecordError('invalid', 'В выбранном интервале нет данных.');
  return { tl, n0, n1 };
}

export function noiseCsv(r: NoiseRecord, view: NoiseView, kind: CsvKind, o: CsvOptions): string {
  if (!csvKinds(r).includes(kind)) throw new NoiseRecordError('invalid', 'Это представление нельзя получить из данных записи.');
  const fs = view.sampleRate, binHz = view.spectral.binHz, profile = !!view.profile;
  const legacy = r.content.type === 'legacy' ? r.content.legacy : null;
  const weight = legacy?.spectrum?.weight ?? o.weight, period = legacy?.spectrum?.period ?? o.period, w = tag(weight);
  if (kind === 'spectrum') {
    const raw = view.spectral.average(period, weight), corr = profile ? view.spectral.average(period, weight, true) : null;
    const columns: [string, string][] = [['frequency_hz', 'центр бина FFT, Гц'], [`psd_${w}_fs2_hz`, `PSD, вес ${weight}, исходная, FS²/Гц`],
      [`psd_${w}_dbfs_hz`, `PSD, вес ${weight}, исходная, dBFS/Гц`]];
    if (corr) columns.push([`psd_${w}_corrected_fs2_hz`, `PSD, вес ${weight}, с поправкой профиля, FS²/Гц`],
      [`psd_${w}_corrected_dbfs_hz`, `PSD, вес ${weight}, с поправкой профиля, dBFS/Гц`], ['correction_db', 'поправка профиля в бине, дБ мощности (пусто, где исходная PSD равна 0)']);
    const rows = Array.from(raw.density, (p, k) => {
      const row = [s(k * binHz), lin(p), dB(p)];
      if (corr) { const c = corr.density[k]; row.push(lin(c), dB(c), p > 0 ? (10 * Math.log10(c / p)).toFixed(4) : ''); }
      return row;
    });
    return document(r, view, 'спектр', [`Период: ${PERIOD_LABEL[period]} · учтено ${raw.seconds.toFixed(3)} с · вес ${weight}`, 'Односторонняя спектральная плотность мощности на момент остановки'], columns, rows);
  }
  if (kind === 'ltas') {
    const spectra = PERIODS.map(p => ({ p, raw: view.spectral.average(p, weight), corr: profile ? view.spectral.average(p, weight, true) : null }));
    const columns: [string, string][] = [['frequency_hz', 'центр бина FFT, Гц']];
    for (const x of spectra) {
      columns.push([`psd_${x.p}_${w}_dbfs_hz`, `PSD, ${PERIOD_LABEL[x.p]}, вес ${weight}, исходная, dBFS/Гц`]);
      if (x.corr) columns.push([`psd_${x.p}_${w}_corrected_dbfs_hz`, `PSD, ${PERIOD_LABEL[x.p]}, вес ${weight}, с поправкой профиля, dBFS/Гц`]);
    }
    const rows = Array.from({ length: SPECTRUM_SIZE / 2 + 1 }, (_, k) => {
      const row = [s(k * binHz)];
      for (const x of spectra) {
        row.push(x.raw.seconds ? dB(x.raw.density[k]) : '');
        if (x.corr) row.push(x.corr.seconds ? dB(x.corr.density[k]) : '');
      }
      return row;
    });
    return document(r, view, 'LTAS', [...spectra.map(x => `Учтено «${PERIOD_LABEL[x.p]}»: ${x.raw.seconds.toFixed(3)} с`),
      'Средние спектры на момент остановки; линейные значения — в CSV «Спектр» и JSON'], columns, rows);
  }
  if (kind === 'levels') {
    const { tl, n0, n1 } = interval(view, o), v = tl.variant(weight, o.corrected);
    const corrected = v >= 3 ? '_corrected' : '';
    const series = (['leq1', 'leq10', 'leq60', 'leqAll'] as const).map(m => tl.series(m, weight, n0, n1));
    const peak = tl.series('peak', 'Z', n0, n1);
    const bands = Array.from({ length: tl.energyCount }, (_, j) => tl.bandSeries(v, j, n0, n1));
    const edges = tl.energyEdges;
    const columns: [string, string][] = [['t_start_s', 'начало столбца 1 с на шкале сеанса, с'], ['t_end_s', 'конец столбца, с'],
      ['accepted_s', 'принято отсчётов PCM в столбце, с'], ['spectral_s', 'учтено спектром в столбце, с'],
      ...(['1s', '10s', '60s'] as const).flatMap(label => [[`leq_${label}_${w}_dbfs`, `Leq ${label.replace('s', ' с')} на конце столбца, вес ${weight}, dBFS`],
        [`leq_${label}_complete`, `1 — окно полное (без пропусков и прогрева), 0 — неполное`]] as [string, string][]),
      [`leq_since_start_${w}_dbfs`, `Leq с начала сеанса, вес ${weight}, dBFS`], ['peak_1s_z_dbfs', 'цифровой sample peak за секунду, без веса, dBFS'],
      ...Array.from({ length: tl.energyCount }, (_, j) => [`band_${Math.round(edges[j])}_${Math.round(edges[j + 1])}_${w}${corrected}_dbfs`,
        `средняя мощность полосы ${Math.round(edges[j])}–${Math.round(edges[j + 1])} Гц в столбце, вес ${weight}${corrected ? ', с поправкой профиля' : ', исходная'}, dBFS`] as [string, string]),
    ];
    const rows = Array.from({ length: n1 - n0 }, (_, i) => {
      const n = n0 + i, [, end] = tl.columnSpan(n);
      const row = [s(n), s(end / fs), s(tl.pcmSamples(n) / fs), s(bands[0].valid[i] / fs)];
      for (let m = 0; m < 3; m++) row.push(dB(series[m].power[i]), series[m].valid[i] ? s(series[m].complete[i]) : '');
      row.push(dB(series[3].power[i]), dB(peak.power[i]));
      for (const b of bands) row.push(dB(b.power[i]));
      return row;
    });
    return document(r, view, 'временная история', [`Интервал: ${n0}–${n1} с · вес ${weight}${corrected ? ' · полосы с поправкой профиля' : ''}`,
      'Z — по отсчётам PCM; A и C — по спектральным кадрам; Leq и пик — исходные, поправка профиля к ним не применяется'], columns, rows);
  }
  if (kind === 'rms') {
    const start = view.audioStartMs, rows: string[][] = [];
    for (let i = 0; i < view.history.length; i++) {
      const p = view.history.at(i)!;
      rows.push([s(i), s(p.endSeconds), start === null ? '' : new Date(start + p.endSeconds * 1000).toISOString(),
        p.rmsDbfs === null ? '-inf' : p.rmsDbfs.toFixed(4), p.windowComplete ? (p.rms1sDbfs === null ? '-inf' : p.rms1sDbfs.toFixed(4)) : '',
        p.windowComplete ? '1' : '0', p.peakHz === null ? '' : s(p.peakHz), p.clipped ? '1' : '0', s(p.missingBefore)]);
    }
    return document(r, view, 'история RMS по блокам', [`Блок ${FFT_SIZE} отсчётов, Z, без поправки профиля`], [
      ['block', 'номер принятого блока'], ['t_end_s', 'конец блока на шкале сеанса, с'], ['time_utc', 'приблизительное время устройства, ISO UTC'],
      ['rms_block_z_dbfs', 'RMS блока, dBFS'], ['rms_1s_z_dbfs', 'энергетическое среднее за последнюю 1 с, dBFS (пусто — окно неполное)'],
      ['window_1s_complete', '1 — окно 1 с без пропусков'], ['peak_hz', 'частота наибольшей амплитуды спектра блока 4096, Гц'],
      ['clipped', '1 — в блоке есть отсчёт с |x| ≥ 1'], ['missing_blocks_before', 'пропущенных блоков перед этим'],
    ], rows);
  }
  if (kind === 'bands') {
    const columns: [string, string][] = [['band_lo_hz', 'нижняя граница полосы, Гц'], ['band_hi_hz', 'верхняя граница (не выше Найквиста), Гц'],
      [`power_${w}_fs2`, `средняя мощность полосы, вес ${weight}, исходная, FS²`], [`level_${w}_dbfs`, `уровень полосы, вес ${weight}, исходный, dBFS`],
      [`share_${w}_percent`, 'доля энергии от суммы шести полос, %']];
    if (profile) columns.push([`power_${w}_corrected_fs2`, `то же с поправкой профиля, FS²`], [`level_${w}_corrected_dbfs`, 'то же с поправкой профиля, dBFS'],
      [`share_${w}_corrected_percent`, 'доля с поправкой профиля, %']);
    let raw: { lo: number; hi: number; power: number; percent: number | null }[], corr: typeof raw | null = null, about: string;
    if (view.timeline) {
      const { tl, n0, n1 } = interval(view, o);
      const x = tl.interval(n0, n1, weight, tl.variant(weight, false));
      raw = x.bands;
      if (profile) corr = tl.interval(n0, n1, weight, tl.variant(weight, true)).bands;
      about = `Интервал: ${n0}–${n1} с · учтено спектром ${(x.spectralSamples / fs).toFixed(3)} с`;
    } else {
      const a = view.spectral.average(period, weight);
      raw = bandPowers(a.density, binHz);
      if (profile) corr = bandPowers(view.spectral.average(period, weight, true).density, binHz);
      about = `Период: ${PERIOD_LABEL[period]} · учтено ${a.seconds.toFixed(3)} с`;
    }
    const rows = raw.map((b, j) => {
      const row = [s(b.lo), s(b.hi), lin(b.power), dB(b.power), b.percent === null ? '' : b.percent.toFixed(4)];
      if (corr) row.push(lin(corr[j].power), dB(corr[j].power), corr[j].percent === null ? '' : corr[j].percent!.toFixed(4));
      return row;
    });
    return document(r, view, 'энергия полос', [about, `Вес ${weight}; мощность бина делится между полосами по пересечению его ячейки`], columns, rows);
  }
  const { tl } = interval(view, o), v = tl.variant(weight, o.corrected);
  const t0 = Math.max(0, Math.min(o.from, o.to)) * fs, t1 = Math.max(o.from, o.to) * fs, tier = tl.tierFor(t0);
  const cols = tl.spectrogramColumns(t0, t1, v, tier), edges = tl.spectrogramEdges;
  if (cols.length * tl.bandCount > MAX_SPECTROGRAM_CELLS) throw new NoiseRecordError('size', 'Спектрограмма интервала слишком велика для CSV. Выберите интервал короче.');
  const centers = Array.from({ length: tl.bandCount }, (_, b) => Math.sqrt(edges[b] * edges[b + 1]));
  const rows = cols.map(c => [s(c.start / fs), s(c.end / fs), c.coverage.toFixed(4),
    ...Array.from(c.power, (p, b) => dB(p / (edges[b + 1] - edges[b]), 3))]);
  return document(r, view, 'спектрограмма', [
    `Интервал: ${(t0 / fs).toFixed(3)}–${(t1 / fs).toFixed(3)} с · вес ${weight}${v >= 3 ? ' · с поправкой профиля' : ' · исходная'}`,
    tier === 'fine' ? `Ярус: кадры по ${(tl.hop / fs).toFixed(4)} с (последние 10 мин сеанса)` : 'Ярус: средние за 10 с (весь сеанс)',
    'Значение — средняя PSD полосы 1/12 октавы (мощность полосы / ширина), dBFS/Гц',
    `Границы полос, Гц: ${edges.map(e => e.toFixed(3)).join(' ')}`,
    `Столбцы psd_<f>hz${v >= 3 ? '_corrected' : ''} — средняя PSD полосы с центром f Гц, dBFS/Гц`,
  ], [['t_start_s', 'начало столбца, с'], ['t_end_s', 'конец столбца, с'], ['data_fraction', 'доля времени столбца со спектральными данными'],
    ...centers.map(f => [`psd_${f.toFixed(1)}hz${v >= 3 ? '_corrected' : ''}`, ''] as [string, string])], rows);
}
