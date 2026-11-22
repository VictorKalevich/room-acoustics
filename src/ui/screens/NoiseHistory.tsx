import { useEffect, useRef, useState } from 'preact/hooks';
import { csvKinds, noiseCsv, type CsvKind } from '../../core/noiseCsv';
import { asCopy, exportRecord, MAX_IMPORT_BYTES, parseNoiseFile, type ImportedFile } from '../../core/noiseFile';
import {
  MAX_NAME_LENGTH, NoiseRecordError, recordWarnings, type NoiseRecord, type NoiseRecordHeader, type NoiseView, type NoiseWarning,
} from '../../core/noiseRecord';
import type { SpectrumPeriod, Weight } from '../../core/noiseSpectrum';
import type { NoiseTimeline as Timeline } from '../../core/noiseTimeline';
import { noiseHistory } from '../../state/noiseHistory';
import { dateText, displayName, errorText, newRecordId, useNoiseHistory, useRecord } from '../noiseRecords';
import { shareFile } from '../audio/mic';
import { ConfirmSheet, Details, DetailPanel, Note, NumberField, Panel, RmsHistoryChart, SelectField, Toast } from '../design-system';
import { fmtClock, noiseFileName } from '../format';
import { S } from '../strings';
import { BUILD } from '../updates';
import { NoiseAnalysis, NoiseLevels, levelText } from './NoiseAnalysis';
import { NoiseCompare } from './NoiseCompare';
import { NoiseTimeline } from './NoiseTimeline';

const t = S.noise.store;
const mb = (bytes: number) => (bytes / 2 ** 20).toFixed(bytes < 10 * 2 ** 20 ? 1 : 0);
const leqLine = (h: NoiseRecordHeader) => (['Z', 'A', 'C'] as const).filter(w => h.leq[w] != null).map(w => `${w} ${levelText(h.leq[w])}`).join(' · ') + ' dBFS';
function startMs(r: NoiseRecord) {
  const start = r.content.type === 'session' ? r.content.session.meta.audioStartMs : r.content.legacy.audioStartMs;
  return start ?? Date.parse(r.savedAt);
}

function warningText(w: NoiseWarning) {
  const x = t.warnings;
  switch (w.code) {
    case 'missing': return x.missing(w.blocks, (100 * w.fraction).toFixed(1) + ' %');
    case 'clipped': return x.clipped(w.blocks);
    case 'processing': return x.processing(w.flags.map(f => t.processingNames[f] ?? f).join(', '));
    case 'legacy': return x.legacy(w.schema);
    case 'legacySpectrum': return x.legacySpectrum(w.weight, t.periods[w.period]);
    default: return x[w.code];
  }
}

/** Библиотека: хранилище, импорт, сравнение и список. Данные записи читаются только при её открытии. */
export function NoiseLibrary({ state, reload, open }: { state: ReturnType<typeof useNoiseHistory>; reload(): void; open: boolean }) {
  const [opened, setOpened] = useState<string | null>(null);
  const [compareOpen, setCompareOpen] = useState(false);
  const [note, setNote] = useState<{ text: string; tone: 'good' | 'warn' | 'info' } | null>(null);
  const [ask, setAsk] = useState<ImportedFile | null>(null);
  const [storage, setStorage] = useState<{ estimate: StorageEstimate | null; persisted: boolean | null } | null>(null);
  const [removing, setRemoving] = useState<{ id: string; name: string } | null>(null);
  const [toast, setToast] = useState({ text: '', n: 0 });
  // Одна операция импорта за раз: иначе сообщение о завершении одной перекрыло бы результат следующей.
  const [working, setWorking] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const { list, error } = state;
  useEffect(() => {
    if (!open) return;
    void Promise.all([noiseHistory.estimate(), noiseHistory.persisted()]).then(([estimate, persisted]) => setStorage({ estimate, persisted }));
  }, [open, list]);
  useEffect(() => { if (!open) { setOpened(null); setCompareOpen(false); } }, [open]);

  async function store(record: NoiseRecord, schema: number, replace = false) {
    await noiseHistory.save(record, { replace });
    setNote({ text: t.imported(displayName({ name: record.name, startedAt: null, savedAt: record.savedAt }), schema), tone: 'good' });
    reload();
  }
  async function importFile(f: File) {
    setWorking(true);
    setNote({ text: t.importing, tone: 'info' });
    try {
      if (f.size > MAX_IMPORT_BYTES) throw new NoiseRecordError('size', 'Файл больше 64 МиБ: такой импорт не поддерживается.');
      const parsed = parseNoiseFile(await f.text(), f.name);
      try { await store(parsed.record, parsed.schema); }
      catch (e) { if ((e as NoiseRecordError).code === 'conflict') { setNote(null); setAsk(parsed); } else throw e; }
    } catch (e) { setNote({ text: errorText(e), tone: 'warn' }); }
    setWorking(false);
  }
  async function resolve(choice: 'replace' | 'copy') {
    const parsed = ask!;
    setAsk(null);
    setWorking(true);
    try { await store(choice === 'copy' ? asCopy(parsed.record, newRecordId()) : parsed.record, parsed.schema, choice === 'replace'); }
    catch (e) { setNote({ text: errorText(e), tone: 'warn' }); }
    setWorking(false);
  }
  async function removeNow() {
    const target = removing!;
    setRemoving(null);
    try { await noiseHistory.remove(target.id); setToast(v => ({ text: t.removed, n: v.n + 1 })); }
    catch (e) { setNote({ text: errorText(e), tone: 'warn' }); }
    reload();
  }
  if (!open) return null;
  const headers = list?.headers ?? [];
  const limits = noiseHistory.limits;
  const conflictName = ask ? headers.find(h => h.id === ask.record.id) : undefined;
  return <>
    <Panel title={t.storage}>
      {error && <Note tone="warn">{error}</Note>}
      {list && <p>{t.usage(headers.length, mb(list.bytes), mb(limits.totalBytes), limits.records)}</p>}
      {storage?.estimate?.quota != null && storage.estimate.usage != null &&
        <p class="small">{t.browser(mb(storage.estimate.usage), mb(storage.estimate.quota))}</p>}
      <p class="small">{storage?.persisted ? t.persisted : t.notPersisted}</p>
      <p class="small">{t.policy}</p>
      <p class="small">{t.local}</p>
      <div class="btn-row">
        <button type="button" class="btn" disabled={working || !!ask} onClick={() => file.current?.click()}>{t.import}</button>
      </div>
      <input ref={file} type="file" accept=".json,application/json" class="visually-hidden" tabIndex={-1} aria-label={t.importFile}
        disabled={working || !!ask} onChange={e => { const f = e.currentTarget.files?.[0]; if (f) void importFile(f); e.currentTarget.value = ''; }} />
      <p class="small">{t.importHint}</p>
      {note && <Note tone={note.tone}>{note.text}</Note>}
    </Panel>
    <Panel title={t.list}>
      {headers.length >= 2
        ? <DetailPanel title={t.compare} summary={t.compareSummary} open={compareOpen} onOpenChange={setCompareOpen}>
          <NoiseCompare headers={headers} open={compareOpen} />
        </DetailPanel>
        : <p class="small">{t.compareNeeds}</p>}
      {list && !headers.length && !list.problems.length && <p class="small">{t.empty}</p>}
      {headers.map(h => <DetailPanel key={h.id} title={displayName(h)} open={opened === h.id} onOpenChange={v => setOpened(v ? h.id : null)}
        summary={t.line(dateText(h.startedAt ?? h.savedAt), fmtClock(h.activeSeconds), leqLine(h)) +
          (h.source === 'legacy' ? ' · ' + t.source.legacy(h.sourceVersion) : '') + (h.calibration ? ` · ${h.calibration.name} v${h.calibration.version}` : '')}>
        <NoiseRecordView header={h} open={opened === h.id} onChanged={reload} onRemove={() => setRemoving({ id: h.id, name: displayName(h) })} />
      </DetailPanel>)}
      {list?.problems.map(p => <DetailPanel key={'problem-' + p.id} title={t.damaged(p.name)} summary={t.damagedText[p.reason]}>
        <Panel>
          <Note tone="warn">{t.damagedText[p.reason]} {t.damagedNote}</Note>
          <button type="button" class="btn btn--danger" onClick={() => setRemoving({ id: p.id, name: p.name || p.id })}>{t.remove}</button>
        </Panel>
      </DetailPanel>)}
    </Panel>
    {ask && <ConfirmSheet title={t.conflictTitle} text={t.conflict(conflictName ? displayName(conflictName) : ask.record.name || ask.record.id)}
      confirm={t.replace} cancel={t.skip} extra={{ label: t.copy, onClick: () => void resolve('copy') }}
      onCancel={() => setAsk(null)} onConfirm={() => void resolve('replace')} />}
    {removing && <ConfirmSheet title={t.removeTitle} text={t.removeText(removing.name)} confirm={t.removeConfirm}
      onCancel={() => setRemoving(null)} onConfirm={() => void removeNow()} />}
    <Toast message={toast.text} trigger={toast.n} />
  </>;
}

function NoiseRecordView({ header, open, onChanged, onRemove }: { header: NoiseRecordHeader; open: boolean; onChanged(): void; onRemove(): void }) {
  const loaded = useRecord(header.id, open);
  if (!open) return null;
  if (!loaded) return <p class="small">{t.loading}</p>;
  if ('error' in loaded) return <Panel><Note tone="warn">{loaded.error}</Note>
    <button type="button" class="btn btn--danger" onClick={onRemove}>{t.remove}</button></Panel>;
  return <RecordBody key={header.id} header={header} record={{ ...loaded.record, name: header.name }} view={loaded.view} onChanged={onChanged} onRemove={onRemove} />;
}

function RecordBody({ header, record, view, onChanged, onRemove }: {
  header: NoiseRecordHeader; record: NoiseRecord; view: NoiseView; onChanged(): void; onRemove(): void;
}) {
  const legacy = record.content.type === 'legacy' ? record.content.legacy : null;
  const fixed = legacy?.spectrum ?? null;
  const [weight, setWeight] = useState<Weight>(fixed?.weight ?? record.context.view.weight);
  const [period, setPeriod] = useState<SpectrumPeriod>(fixed?.period ?? record.context.view.period);
  const [repr, setRepr] = useState(record.context.view.corrected && view.profile ? 'corrected' : 'raw');
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [name, setName] = useState(header.name);
  const [toast, setToast] = useState({ text: '', n: 0 });
  const [problem, setProblem] = useState<string | null>(null);
  const snapshot = view.snapshot();
  const capture = record.content.type === 'session' ? record.content.session.capture : legacy!.capture;
  const stopReason = record.content.type === 'session' ? record.content.session.meta.stopReason : legacy!.status;
  const manual = record.content.type === 'session' ? record.content.session.meta.manualCheck : legacy!.manual;
  const model = record.context.input?.confirmedModel ?? (record.content.type === 'session' ? record.content.session.calibration?.model : legacy!.calibration?.model) ?? null;
  async function rename() {
    try { await noiseHistory.rename(header.id, name); setToast(v => ({ text: t.renamed, n: v.n + 1 })); onChanged(); }
    catch (e) { setProblem(errorText(e)); }
  }
  async function share(data: string, file: string, type: string) {
    try { setProblem(null); await shareFile(data, file, type); } catch (e) { setProblem(e instanceof NoiseRecordError ? e.message : t.exportError); }
  }
  const profile = view.profile;
  const absolute = record.context.absolute;
  return <>
    <Panel title={t.about}>
      <div class="field">
        <label for={'noise-record-' + header.id}>{t.name}</label>
        <div class="field__box"><input id={'noise-record-' + header.id} maxLength={MAX_NAME_LENGTH} value={name} onInput={e => setName(e.currentTarget.value)} /></div>
      </div>
      <div class="btn-row"><button type="button" class="btn btn--small" disabled={name.trim() === header.name} onClick={() => void rename()}>{t.rename}</button></div>
      <table class="report-table"><tbody>
        <tr><th scope="row">{t.rows.start}</th><td>{dateText(header.startedAt)}</td></tr>
        <tr><th scope="row">{t.rows.active}</th><td>{fmtClock(header.activeSeconds)} ({header.activeSeconds.toFixed(1)} с)</td></tr>
        <tr><th scope="row">{t.rows.span}</th><td>{fmtClock(header.spanSeconds)}</td></tr>
        <tr><th scope="row">Leq</th><td>{leqLine(header)}</td></tr>
        <tr><th scope="row">{t.rows.rate}</th><td>{header.sampleRate} Гц</td></tr>
        <tr><th scope="row">{t.rows.fft}</th><td>{t.fft(view.spectral.binHz.toFixed(3))}</td></tr>
        <tr><th scope="row">{t.rows.source}</th><td>{header.source === 'session' ? t.source.session + ' · снимок v' + header.sourceVersion : t.source.legacy(header.sourceVersion)}</td></tr>
        {record.imported && <tr><th scope="row">{t.rows.imported}</th><td>{record.imported.file} · {dateText(record.imported.at)}</td></tr>}
        <tr><th scope="row">{t.rows.saved}</th><td>{dateText(header.savedAt)}</td></tr>
        <tr><th scope="row">{t.rows.build}</th><td>{header.build ? `${header.build.sha}${header.build.time ? ' · ' + dateText(header.build.time) : ''}` : t.none}</td></tr>
        {header.project && <tr><th scope="row">{t.rows.project}</th><td>{header.project.name}</td></tr>}
        <tr><th scope="row">{t.rows.stop}</th><td>{stopReason || t.none}</td></tr>
        <tr><th scope="row">{t.rows.manual}</th><td>{S.noise[manual as 'untested' | 'passed' | 'failed'] ?? manual}</td></tr>
      </tbody></table>
    </Panel>
    <Panel title={t.validity}>
      <Note>{t.scale}</Note>
      {recordWarnings(record).map(w => <Note key={w.code} tone={['noProfile', 'absolute', 'legacySpectrum'].includes(w.code) ? 'info' : 'warn'}>{warningText(w)}</Note>)}
    </Panel>
    <Panel title={t.levels}>
      <SelectField label={t.weight} value={weight} options={(fixed ? [fixed.weight] : ['Z', 'A', 'C']).map(value => ({ value, label: value }))}
        onChange={v => setWeight(v as Weight)} />
      <NoiseLevels meter={view} weight={weight} />
    </Panel>
    {(!legacy || fixed?.psd) && <NoiseAnalysis meter={view} blocks={snapshot.blocks} weight={weight} period={period} onPeriod={setPeriod}
      view={repr} onView={setRepr} periods={fixed ? [fixed.period] : undefined} />}
    <Panel title={t.rmsHistory}>
      {view.history.length ? <RmsHistoryChart rows={view.history} live={false} /> : <p class="small">{t.none}</p>}
      <p class="small">{S.noise.fullHistory}</p>
      {view.timeline
        ? <DetailPanel title={S.noise.timeline.title} summary={S.noise.timeline.summary} open={timelineOpen} onOpenChange={setTimelineOpen}>
          <NoiseTimeline meter={view as NoiseView & { timeline: Timeline }} busy={false} open={timelineOpen} weight={weight} onWeight={setWeight}
            corrected={repr === 'corrected'} onCorrected={v => setRepr(v ? 'corrected' : 'raw')} status={S.noise.timeline.saved} />
        </DetailPanel>
        : <Note>{t.noTimeline}</Note>}
    </Panel>
    <Panel title={t.calibration}>
      {profile ? <>
        <table class="report-table"><tbody>
          <tr><th scope="row">{t.profileRows.name}</th><td>{profile.name} · v{profile.version}</td></tr>
          <tr><th scope="row">{t.profileRows.id}</th><td>{profile.id}</td></tr>
          <tr><th scope="row">{t.profileRows.device}</th><td>{profile.deviceModel}</td></tr>
          <tr><th scope="row">{t.profileRows.input}</th><td>{profile.inputKind} · {profile.captureMode}</td></tr>
          <tr><th scope="row">{t.profileRows.curve}</th><td>{t.curve[profile.curve.kind]} · точек {profile.curve.frequencyHz.length}</td></tr>
          <tr><th scope="row">{t.profileRows.range}</th><td>{profile.validRangeHz.join('–')} Гц</td></tr>
          <tr><th scope="row">{t.profileRows.boost}</th><td>+{profile.maxBoostDb ?? 12} дБ</td></tr>
          <tr><th scope="row">{t.profileRows.status}</th><td>{profile.validationStatus} · {profile.origin}</td></tr>
          <tr><th scope="row">{t.profileRows.method}</th><td>{profile.method}</td></tr>
          {profile.sourceURL && <tr><th scope="row">{t.profileRows.source}</th><td>{profile.sourceURL}</td></tr>}
        </tbody></table>
        <Note>{t.calibrationFrozen}</Note>
      </> : <p class="small">{t.calibrationNone}</p>}
      {model && <p class="small">{t.profileRows.model} · {model}</p>}
      <p class="small"><strong>{t.absolute}</strong> · {absolute
        ? t.absoluteRow((absolute.offsetDb >= 0 ? '+' : '') + absolute.offsetDb.toFixed(2), dateText(absolute.verifiedAt),
          absolute.references.map(r => r.measuredDbfs.toFixed(1)).join('…'))
        : t.absoluteNone}</p>
    </Panel>
    <Panel title={t.diagnostics}>
      {capture ? <>
        <p>{S.noise.path} · {capture.backend} · {capture.sampleRate} Гц</p>
        <p>{S.noise.fallback} · {capture.constraintsFallback ? S.noise.yes : S.noise.no}</p>
        {record.context.input && <p>{S.noise.input} · {t.inputSource[record.context.input.source]}</p>}
        <p>{S.noise.clips} · {snapshot.clippedFraction == null ? '—' : (100 * snapshot.clippedFraction).toFixed(1) + ' %'} · {S.noise.missing} · {snapshot.missingFraction == null ? '—' : (100 * snapshot.missingFraction).toFixed(1) + ' %'}</p>
        {(['settings', 'supported', 'constraints', 'capabilities'] as const).map(key => capture[key] && typeof capture[key] === 'object' ?
          <Details key={key} summary={S.noise[key]}><ul class="plain-list">
            {Object.entries(capture[key] as Record<string, unknown>).map(([k, v]) => <li key={k}>{k} · {v == null ? S.noise.unknown : typeof v === 'object' ? JSON.stringify(v) : String(v)}</li>)}
          </ul></Details> : null)}
      </> : <p class="small">{t.none}</p>}
    </Panel>
    <ExportPanel record={record} view={view} weight={weight} period={period} corrected={repr === 'corrected'} share={share} onError={setProblem} />
    {problem && <Note tone="warn">{problem}</Note>}
    <div class="btn-row"><button type="button" class="btn btn--danger" onClick={onRemove}>{t.remove}</button></div>
    <Toast message={toast.text} trigger={toast.n} />
  </>;
}

function ExportPanel({ record, view, weight, period, corrected, share, onError }: {
  record: NoiseRecord; view: NoiseView; weight: Weight; period: SpectrumPeriod; corrected: boolean;
  share(data: string, file: string, type: string): Promise<void>; onError(text: string): void;
}) {
  const kinds = csvKinds(record);
  const [kind, setKind] = useState<CsvKind>(kinds[0]);
  const [range, setRange] = useState('all');
  const total = view.timeline ? view.timeline.end / view.sampleRate : 0;
  const [from, setFrom] = useState(0);
  const [to, setTo] = useState(Math.ceil(total));
  const start = startMs(record);
  const timed = ['levels', 'bands', 'spectrogram'].includes(kind) && !!view.timeline;
  function csv() {
    const [a, b] = range === 'custom' ? [from, to] : [0, Math.max(total, 1)];
    let text: string;
    try { text = noiseCsv(record, view, kind, { weight, period, corrected, from: a, to: b }); } catch (e) { onError(errorText(e)); return; }
    void share(text, noiseFileName(record.name, start, Date.now(), '-' + kind, '.csv'), 'text/csv');
  }
  return <Panel title={t.export}>
    <div class="btn-row">
      <button type="button" class="btn" onClick={() => void share(exportRecord(record, BUILD), noiseFileName(record.name, start, Date.now(), '-session'), 'application/json')}>{t.exportJson}</button>
    </div>
    <p class="small">{t.exportJsonHint}</p>
    <SelectField label={t.csv} value={kind} onChange={v => setKind(v as CsvKind)} options={kinds.map(value => ({ value, label: t.csvKinds[value] }))} />
    {timed && <>
      <SelectField label={t.csvRange} value={range} onChange={setRange} options={[{ value: 'all', label: t.all }, { value: 'custom', label: t.custom }]} />
      {range === 'custom' && <div class="grid-2">
        <NumberField label={t.from} value={from} onChange={setFrom} unit="с" min={0} max={Math.max(1, Math.ceil(total))} digits={0} />
        <NumberField label={t.to} value={to} onChange={setTo} unit="с" min={0} max={Math.max(1, Math.ceil(total))} digits={0} />
      </div>}
    </>}
    {kind === 'spectrogram' && <p class="small">{t.csvSpectrogram}</p>}
    <p class="small">Вес {record.content.type === 'legacy' ? record.content.legacy.spectrum?.weight ?? weight : weight}
      {view.profile ? ' · ' + (corrected ? S.noise.timeline.corrected : S.noise.timeline.raw).toLowerCase() : ''} — как на экране выше.</p>
    <p class="small">{t.csvHint}</p>
    <div class="btn-row"><button type="button" class="btn" onClick={csv}>{t.csvSave}</button></div>
  </Panel>;
}
