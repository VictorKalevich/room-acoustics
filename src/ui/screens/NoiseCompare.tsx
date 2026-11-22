import { useMemo, useState } from 'preact/hooks';
import { compareRecords, type CompareSide } from '../../core/noiseCompare';
import type { NoiseRecordHeader } from '../../core/noiseRecord';
import type { SpectrumPeriod, Weight } from '../../core/noiseSpectrum';
import { ResponseChart } from '../components/Charts';
import { Note, Panel, Segmented, SelectField } from '../design-system';
import { fmtClock } from '../format';
import { S } from '../strings';
import { levelText } from './NoiseAnalysis';
import { dateText, displayName, useRecord } from '../noiseRecords';

const t = S.noise.store;
const periods: SpectrumPeriod[] = ['session', '60', '10', 'now'];
const signed = (v: number | null) => v === null ? '—' : (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(1);

/** Сравнение двух записей истории. Обе загружаются только на время открытого подэкрана. */
export function NoiseCompare({ headers, open }: { headers: NoiseRecordHeader[]; open: boolean }) {
  const [a, setA] = useState(headers[1]?.id ?? '');
  const [b, setB] = useState(headers[0]?.id ?? '');
  const [weight, setWeight] = useState<Weight>('Z');
  const [period, setPeriod] = useState<SpectrumPeriod>('session');
  const [repr, setRepr] = useState('raw');
  const [floor, setFloor] = useState('-120');
  const ids = headers.map(h => h.id);
  const idA = ids.includes(a) ? a : headers[1]?.id ?? '', idB = ids.includes(b) ? b : headers[0]?.id ?? '';
  const left = useRecord(idA, open), right = useRecord(idB, open);
  const result = useMemo(() => left && right && 'record' in left && 'record' in right
    ? compareRecords(left as CompareSide, right as CompareSide, { weight, period, corrected: repr === 'corrected' }) : null,
  [left, right, weight, period, repr]);
  if (!open) return null;
  const options = headers.map(h => ({ value: h.id, label: `${displayName(h)} · ${dateText(h.startedAt ?? h.savedAt)}` }));
  const failure = [left, right].find(x => x && 'error' in x) as { error: string } | undefined;
  const names = result ? result.headers.map(h => displayName(h)) : ['', ''];
  const upper = result ? Math.min(20000, Math.min(result.a.sampleRate, result.b.sampleRate) / 2) : 20000;
  const range = result?.bands ? Math.max(10, ...result.bands.map(x => Math.abs(x.diff ?? 0))) : 10;
  const span = range <= 10 ? 10 : range <= 20 ? 20 : 40;
  const line = (side: 'a' | 'b') => {
    const pts = (result?.bands ?? []).filter(x => x[side] > 0);
    return { f: pts.map(x => x.f), db: pts.map(x => 10 * Math.log10(x[side])) };
  };
  const diff = (result?.bands ?? []).filter(x => x.diff !== null);
  return <>
    <Panel title={t.compareTitle}>
      <SelectField label={t.a} value={idA} options={options} onChange={setA} />
      <SelectField label={t.b} value={idB} options={options} onChange={setB} />
      <Segmented label={t.weight} value={weight} options={(['Z', 'A', 'C'] as const).map(value => ({ value, label: value }))} onChange={setWeight} />
      <div class="grid-2">
        <SelectField label="Спектр и полосы" value={period} onChange={v => setPeriod(v as SpectrumPeriod)}
          options={periods.map(value => ({ value, label: t.periods[value] }))} />
        <SelectField label={t.representation} value={repr} onChange={setRepr} options={[{ value: 'raw', label: t.raw }, { value: 'corrected', label: t.corrected }]} />
      </div>
      {idA === idB && <Note tone="warn">{t.same}</Note>}
      {failure && <Note tone="warn">{failure.error}</Note>}
      {!result && !failure && <p class="small">{t.loading}</p>}
      {result && <>
        <ul class="plain-list small">{result.checks.filter(c => c.level === 'ok').map(c =>
          <li key={c.key}>{t.checks[c.key](c.detail, true)}</li>)}</ul>
        {result.checks.filter(c => c.level !== 'ok').map(c =>
          <Note key={c.key} tone={c.level === 'block' ? 'warn' : 'info'}>{t.checks[c.key](c.detail, false)}</Note>)}
      </>}
    </Panel>
    {result?.bands && <Panel title={t.overlay}>
      <SelectField label={t.scaleSelect} value={floor} onChange={setFloor} options={['-100', '-120', '-140'].map(value => ({ value, label: value + '…0 dBFS/Гц' }))} />
      <ResponseChart label={t.overlay} fLo={20} fHi={upper} yRange={[Number(floor), 0]} yTicks={Array.from({ length: 1 - Number(floor) / 20 }, (_, i) => -20 * i)}
        lines={[{ ...line('a'), cls: 'is-measured' }, { ...line('b'), cls: 'is-compare' }]} />
      <div class="legend">
        <span class="legend__item legend__item--measured">A · {names[0]}</span>
        <span class="legend__item legend__item--compare">B · {names[1]}</span>
      </div>
      <p class="small">{t.overlayNote} Вес {weight}.</p>
      <h3 class="subhead">{t.difference}</h3>
      <ResponseChart label={t.difference} fLo={20} fHi={upper} yRange={[-span, span]} yTicks={[-span, -span / 2, 0, span / 2, span]}
        lines={[{ f: diff.map(x => x.f), db: diff.map(x => x.diff!), cls: 'is-room' }]} />
      <p class="small">{t.differenceNote}</p>
    </Panel>}
    {result && <Panel title={t.leq}>
      <table class="rt-table compare-table">
        <thead><tr><th /><th scope="col">A</th><th scope="col">B</th><th scope="col">{t.delta}</th></tr></thead>
        <tbody>{result.leq.map(row => <tr key={row.weight}>
          <th scope="row">Leq {row.weight}</th>
          <td class="num"><span class="v">{row.a == null ? '—' : levelText(row.a)}</span></td>
          <td class="num"><span class="v">{row.b == null ? '—' : levelText(row.b)}</span></td>
          <td class="num"><span class="v">{signed(row.diff)}</span></td>
        </tr>)}</tbody>
      </table>
      <p class="small">{t.leqNote}</p>
    </Panel>}
    {result?.six && <Panel title={t.bands}>
      <table class="rt-table compare-table">
        <thead><tr><th /><th scope="col">A</th><th scope="col">B</th><th scope="col">{t.delta}</th></tr></thead>
        <tbody>{result.six.map(row => <tr key={row.lo}>
          <th scope="row">{row.lo}–{Math.round(row.hi)} Гц</th>
          <td class="num"><span class="v">{levelText(row.a)}</span><span class="f">{row.shareA == null ? '—' : row.shareA.toFixed(1) + ' %'}</span></td>
          <td class="num"><span class="v">{levelText(row.b)}</span><span class="f">{row.shareB == null ? '—' : row.shareB.toFixed(1) + ' %'}</span></td>
          <td class="num"><span class="v">{signed(row.diff)}</span></td>
        </tr>)}</tbody>
      </table>
      <p class="small">{t.bandsNote(weight, `${t.periods[result.a.period]} / ${t.periods[result.b.period]}`)}</p>
    </Panel>}
    {result && <Panel title={t.conditions}>
      <table class="report-table"><tbody>
        {conditionRows(result, left as CompareSide, right as CompareSide).map(([label, x, y]) =>
          <tr key={label}><th scope="row">{label}</th><td>A · {x}<br />B · {y}</td></tr>)}
      </tbody></table>
    </Panel>}
  </>;
}

function conditionRows(r: ReturnType<typeof compareRecords>, a: CompareSide, b: CompareSide): [string, string, string][] {
  const c = t.conditionRows;
  const side = (s: CompareSide, x: typeof r.a, h: NoiseRecordHeader) => {
    const capture = s.record.content.type === 'session' ? s.record.content.session.capture : s.record.content.legacy.capture;
    const settings = (capture?.settings ?? {}) as Record<string, unknown>;
    const processing = ['autoGainControl', 'noiseSuppression', 'echoCancellation'].map(k => `${t.processingNames[k]} ${settings[k] == null ? '?' : settings[k] ? 'вкл' : 'выкл'}`).join(', ');
    const model = s.record.context.input?.confirmedModel ?? (s.record.content.type === 'session' ? s.record.content.session.calibration?.model : s.record.content.legacy.calibration?.model) ?? '—';
    return {
      date: dateText(h.startedAt), duration: fmtClock(h.activeSeconds), rate: h.sampleRate + ' Гц',
      averaging: `${x.weight}, ${t.periods[x.period]}, учтено ${x.seconds.toFixed(1)} с, ${x.corrected ? 'с поправкой' : 'исходный'}`,
      profile: x.profile ? `${x.profile.name} · v${x.profile.version}` : 'без профиля', model,
      input: s.record.context.input ? t.inputSource[s.record.context.input.source] : '—', backend: capture?.backend ?? '—', processing,
      source: h.source === 'session' ? t.source.session : t.source.legacy(h.sourceVersion),
    };
  };
  const x = side(a, r.a, r.headers[0]), y = side(b, r.b, r.headers[1]);
  return (Object.keys(x) as (keyof typeof x)[]).map(k => [c[k], x[k], y[k]]);
}

