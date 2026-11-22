import { useEffect, useMemo, useState } from 'preact/hooks';
import { FFT_SIZE, type NoiseMeter } from '../../core/noise';
import type { Weight } from '../../core/noiseSpectrum';
import type { LevelMetric, WindowValue } from '../../core/noiseTimeline';
import { LevelHistoryChart, Note, NumberField, Panel, Segmented, SelectField, Spectrogram } from '../design-system';
import { plotWidth } from '../design-system/timeAxis';
import { fmtClock, fmtHz } from '../format';
import { S } from '../strings';
import { levelText as dbText } from './NoiseAnalysis';

const t = S.noise.timeline;
const dbOf = (power: number) => power > 0 ? 10 * Math.log10(power) : power === 0 ? -Infinity : NaN;
const levelText = (power: number | null | undefined, unit = 'dBFS') =>
  power == null || Number.isNaN(power) ? t.none : dbText(power) + ' ' + unit;
const frequencyRanges: Record<string, { label: string; hz: [number, number] }> = {
  full: { label: '20 Гц – 20 кГц', hz: [20, 20000] }, low: { label: '20–250 Гц', hz: [20, 250] },
  mid: { label: '20 Гц – 2 кГц', hz: [20, 2000] }, high: { label: '250 Гц – 20 кГц', hz: [250, 20000] },
};
const spans = ['auto', '60', '600', '3600', 'all', 'custom'];
const metrics: LevelMetric[] = ['leq1', 'leq10', 'leq60', 'leqAll', 'peak'];

/** Квантили конечных уровней на изображении; цифровая тишина (−∞) и пропуски не входят. Шкала от 20 до 120 дБ. */
function autoRange(values: Float32Array): [number, number] {
  const finite = values.filter(Number.isFinite).sort();
  if (!finite.length) return [-140, -40];
  const hi = Math.ceil(finite[Math.floor(0.995 * (finite.length - 1))] / 5) * 5;
  const lo = Math.floor(finite[Math.floor(0.02 * (finite.length - 1))] / 5) * 5;
  return [Math.max(hi - 120, Math.min(lo, hi - 20)), hi];
}
function windowText(w: WindowValue, fs: number) {
  if (w.power == null) return t.none;
  return levelText(w.power) + (w.complete ? '' : ' · ' + t.incomplete((w.valid / fs).toFixed(2)));
}

/** Подэкран 055: спектрограмма, история уровней и полос, значение в выбранный момент. Считает только когда открыт. */
export function NoiseTimeline({ meter, busy, open, weight, onWeight, corrected, onCorrected }: {
  meter: NoiseMeter; busy: boolean; open: boolean; weight: Weight; onWeight(w: Weight): void; corrected: boolean; onCorrected(v: boolean): void;
}) {
  const [span, setSpan] = useState('auto');
  const [from, setFrom] = useState(0);
  const [to, setTo] = useState(60);
  const [freq, setFreq] = useState('full');
  const [colour, setColour] = useState('auto');
  const [floor, setFloor] = useState(-140);
  const [ceiling, setCeiling] = useState(-40);
  const [metric, setMetric] = useState<LevelMetric>('leq1');
  const [band, setBand] = useState('3');
  const [cursor, setCursor] = useState<number | null>(null);
  const [row, setRow] = useState<number | null>(null);
  const [tick, setTick] = useState(0);
  // Отрисовка не чаще 4 раз в секунду и только на открытом подэкране; обработка блоков от неё не зависит.
  useEffect(() => {
    if (!open || !busy) return;
    const id = window.setInterval(() => setTick(n => n + 1), 250);
    return () => window.clearInterval(id);
  }, [open, busy]);
  useEffect(() => { setCursor(null); setRow(null); }, [meter]);

  const data = useMemo(() => {
    if (!open) return null;
    const tl = meter.timeline, fs = tl.sampleRate, v = tl.variant(weight, corrected);
    const total = tl.end / fs;
    let start: number, end: number;
    if (span === 'custom') { start = Math.min(from, to); end = Math.max(start + 1, from, to); }
    else if (span === 'all' || (span === 'auto' && !busy)) { start = 0; end = Math.max(total, 1); }
    else { end = Math.max(total, 1); start = Math.max(0, end - (span === 'auto' ? 60 : Number(span))); }
    const n0 = Math.floor(start), n1 = Math.min(tl.levelCount, Math.ceil(end));
    const image = tl.spectrogramImage(start * fs, end * fs, plotWidth, v);
    const edges = tl.spectrogramEdges, [fLo, fHi] = frequencyRanges[freq].hz;
    let b0 = 0, b1 = tl.bandCount;
    while (b0 < b1 && edges[b0 + 1] <= fLo) b0++;
    while (b1 > b0 && edges[b1 - 1] >= fHi) b1--;
    const rows = b1 - b0, values = new Float32Array(plotWidth * rows);
    for (let x = 0; x < plotWidth; x++) for (let r = 0; r < rows; r++) {
      const b = b0 + r;
      values[x * rows + r] = dbOf(image.power[x * tl.bandCount + b] / (edges[b + 1] - edges[b]));
    }
    const level = tl.series(metric, weight, n0, n1);
    const bandRow = tl.bandSeries(v, Number(band), n0, n1);
    const toDb = (p: Float64Array) => p.map(dbOf);
    return {
      tl, fs, v, total, start, end, n0, n1, b0, b1, image,
      view: { values, columns: plotWidth, rows, coverage: image.coverage, edgesHz: edges.slice(b0, b1 + 1), start, end,
        range: colour === 'auto' ? autoRange(values) : [Math.min(floor, ceiling - 1), Math.max(ceiling, floor + 1)] as [number, number] },
      level: { start: n0, step: 1, db: toDb(level.power), complete: level.complete, valid: level.valid },
      band: { start: n0, step: 1, db: toDb(bandRow.power), complete: bandRow.complete, valid: bandRow.valid },
      summary: tl.interval(n0, n1, weight, v),
    };
  }, [open, meter, tick, busy, weight, corrected, span, from, to, freq, colour, floor, ceiling, metric, band]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!data) return null;
  const { tl, fs, v, total, start, end, n0, n1, b0, b1 } = data;
  const history = meter.snapshot();
  if (n1 <= n0) return <p class="small">{t.empty}</p>;
  const c = Math.max(n0, Math.min(n1 - 1, cursor ?? n1 - 1));
  const at = tl.interval(c, c + 1, weight, v);
  const leqAll = tl.series('leqAll', weight, c, c + 1).power[0];
  const peak = tl.peakAt(c);
  const point = tl.spectrumAt((c + 0.5) * fs, v);
  let pick: number | null = row != null && row >= b0 && row < b1 ? row : null;
  if (point && pick == null) {
    let best = -1;
    for (let b = b0; b < b1; b++) if (point.power[b] > best) { best = point.power[b]; pick = b; }
    if (best <= 0) pick = null;
  }
  const edges = tl.spectrogramEdges;
  const bandHz = (b: number) => `${fmtHz(Math.sqrt(edges[b] * edges[b + 1]))}Гц (${Math.round(edges[b])}–${Math.round(edges[b + 1])} Гц)`;
  const toCursor = (seconds: number) => setCursor(Math.max(0, Math.floor(seconds)));
  const bandLabel = (j: number) => `${tl.energyEdges[j]}–${Math.round(tl.energyEdges[j + 1])} Гц`;
  const bandTable = (bands: { lo: number; hi: number; power: number; percent: number | null }[], seconds: number) =>
    <table class="report-table"><tbody>{bands.map((b, j) => <tr key={b.lo}>
      <th scope="row">{bandLabel(j)}</th>
      <td>{seconds ? levelText(b.power) : t.none}</td>
      <td>{b.percent == null || !seconds ? '—' : b.percent.toFixed(1) + ' %'}</td>
    </tr>)}</tbody></table>;
  return <>
    <Panel title={t.session}>
      <p class="small">{busy ? t.live : t.done}</p>
      <p class="small">{t.recorded(fmtClock(total), fmtClock(history.activeSeconds), fmtClock(history.missing * FFT_SIZE / fs))}</p>
      <Note>{t.scale}</Note>
      <Segmented label={t.weight} value={weight} options={(['Z', 'A', 'C'] as const).map(value => ({ value, label: value }))} onChange={onWeight} />
      {meter.profile && <>
        <Segmented label={t.view} value={corrected ? 'corrected' : 'raw'} onChange={value => onCorrected(value === 'corrected')}
          options={[{ value: 'raw', label: t.raw }, { value: 'corrected', label: t.corrected }]} />
        <p class="small">{t.correctedNote}</p>
      </>}
      <SelectField label={t.interval} value={span} onChange={setSpan} options={spans.map(value => ({ value, label: t.intervals[value] }))} />
      {span === 'custom' && <div class="grid-2">
        <NumberField label={t.from} value={from} onChange={setFrom} unit="с" min={0} max={Math.max(1, Math.ceil(total))} digits={0} />
        <NumberField label={t.to} value={to} onChange={setTo} unit="с" min={0} max={Math.max(1, Math.ceil(total))} digits={0} />
      </div>}
    </Panel>
    <Panel title={t.spectrogram}>
      <div class="grid-2">
        <SelectField label={t.frequencies} value={freq} onChange={setFreq} options={Object.entries(frequencyRanges).map(([value, r]) => ({ value, label: r.label }))} />
        <SelectField label={t.colour} value={colour} onChange={setColour} options={[{ value: 'auto', label: t.auto }, { value: 'manual', label: t.manual }]} />
      </div>
      {colour === 'manual' && <div class="grid-2">
        <NumberField label={t.low} value={floor} onChange={setFloor} unit={t.colourUnit} min={-200} max={0} digits={0} />
        <NumberField label={t.high} value={ceiling} onChange={setCeiling} unit={t.colourUnit} min={-200} max={0} digits={0} />
      </div>}
      <Spectrogram label={`${t.spectrogram} (${weight}${corrected && meter.profile ? ', ' + t.corrected.toLowerCase() : ''})`} view={data.view}
        unit={t.colourUnit} cursor={{ seconds: c + 0.5, row: pick == null ? null : pick - b0 }}
        onPick={(seconds, r) => { toCursor(seconds); setRow(b0 + r); }} />
      <div class="legend"><span class="legend__item legend__item--gap">{t.noData}</span></div>
      <p class="small">{data.image.tier === 'fine' ? t.tierFine(data.image.columnSeconds.toFixed(2)) : t.tierCoarse} · {t.colourNote}</p>
      <p class="small">{t.warm}</p>
    </Panel>
    <Panel title={t.at}>
      <div class="freq-slider">
        <label class="field__label" for="noise-cursor">{t.cursor}: <strong>{fmtClock(c)}</strong></label>
        <input id="noise-cursor" type="range" min={n0} max={n1 - 1} step={1} value={c}
          onInput={e => { setCursor(Number(e.currentTarget.value)); setRow(null); }} />
        <div class="freq-slider__scale muted small" aria-hidden="true"><span>{fmtClock(start)}</span><span>{fmtClock(end)}</span></div>
      </div>
      <p class="small">{t.tapHint}</p>
      <table class="report-table"><tbody>
        <tr><th scope="row">{t.at}</th><td>{t.second(fmtClock(c), fmtClock(c + 1))}</td></tr>
        <tr><th scope="row">{t.accepted}</th><td>{(100 * tl.pcmSamples(c) / fs).toFixed(0)} % · {t.spectral} {(100 * at.spectralSamples / fs).toFixed(0)} %</td></tr>
        {([1, 10, 60] as const).map(s => <tr key={s}><th scope="row">Leq {s} с ({weight})</th><td>{windowText(tl.window(c, s, weight), fs)}</td></tr>)}
        <tr><th scope="row">{t.metrics.leqAll} ({weight})</th><td>{levelText(leqAll)}</td></tr>
        <tr><th scope="row">{t.metrics.peak}</th><td>{levelText(peak == null ? null : peak * peak)}</td></tr>
        <tr><th scope="row">{row != null && pick === row ? t.spectrumAt : t.strongest}</th>
          <td>{point && pick != null ? `${bandHz(pick)} · ${levelText(point.power[pick] / (edges[pick + 1] - edges[pick]), t.colourUnit)}` : t.none}</td></tr>
      </tbody></table>
      <p class="small">{t.bandsAt} ({weight}{corrected && meter.profile ? ', ' + t.corrected.toLowerCase() : ''})</p>
      {bandTable(at.bands, at.spectralSamples)}
    </Panel>
    <Panel title={t.levels}>
      <SelectField label={t.metric} value={metric} onChange={value => setMetric(value as LevelMetric)} options={metrics.map(value => ({ value, label: t.metrics[value] }))} />
      <LevelHistoryChart label={`${t.levels}: ${t.metrics[metric]}${metric === 'peak' ? '' : ' (' + weight + ')'}`} series={data.level}
        start={start} end={end} unit="dBFS" cursor={c + 0.5} onPick={toCursor} />
      <div class="legend">
        <span class="legend__item legend__item--room">{t.complete}</span>
        <span class="legend__item legend__item--baseline">{t.partial}</span>
        <span class="legend__item legend__item--gap">{t.noData}</span>
      </div>
      {metric === 'peak' && <p class="small">{t.peakNote}</p>}
    </Panel>
    <Panel title={t.band}>
      <SelectField label={t.bandSelect} value={band} onChange={setBand} options={tl.energyEdges.slice(1).map((_, j) => ({ value: String(j), label: bandLabel(j) }))} />
      <LevelHistoryChart label={`${t.band}: ${bandLabel(Number(band))} (${weight})`} series={data.band} start={start} end={end} unit="dBFS"
        cursor={c + 0.5} onPick={toCursor} />
    </Panel>
    <Panel title={t.intervalTotal}>
      <table class="report-table"><tbody>
        <tr><th scope="row">{t.interval}</th><td>{fmtClock(start)}–{fmtClock(end)}</td></tr>
        <tr><th scope="row">Leq ({weight})</th><td>{levelText(data.summary.power)} · {t.accepted.toLowerCase()} {(data.summary.valid / fs).toFixed(1)} с</td></tr>
      </tbody></table>
      {bandTable(data.summary.bands, data.summary.spectralSamples)}
    </Panel>
  </>;
}
