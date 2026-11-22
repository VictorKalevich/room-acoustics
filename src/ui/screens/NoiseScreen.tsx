import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { micCatalog } from '../../state/micCatalog';
import { NoiseMeter, type NoiseRows } from '../../core/noise';
import { exportRecord, legacyReport } from '../../core/noiseFile';
import { NoiseRecordError, type NoiseRecord } from '../../core/noiseRecord';
import { createNoiseSession } from '../../core/noiseSession';
import { noiseHistory } from '../../state/noiseHistory';
import { openMic, shareFile } from '../audio/mic';
import type { NoiseDiagnostics } from '../audio/noiseDiagnostics';
import type { SpectrumPeriod, Weight } from '../../core/noiseSpectrum';
import { NoiseAnalysis, NoiseLevels, levelText } from './NoiseAnalysis';
import { NoiseLibrary } from './NoiseHistory';
import { NoiseTimeline } from './NoiseTimeline';
import { Details, DetailPanel, Note, Panel, SelectField, RmsHistoryChart, Toast } from '../design-system';
import { S } from '../strings';
import { BUILD } from '../updates';
import { noiseFileName } from '../format';
import { displayName, newRecordId, useNoiseHistory } from '../noiseRecords';
import { loadCal } from '../../state/legacyMicCalibration';
import { MicCalibrationPanel, MicStartHint, announceCatalogChange, fromCatalog, micLoading, type MicSetup, type MicState } from '../components/MicCalibrationPanel';
import { AbsoluteReference, matchingAbsolute } from '../components/AbsoluteReference';
import type { MicScope } from '../../core/micCalibration';

const noiseScope: MicScope = { tool: 'noise' };
const t = S.noise;
interface Report {
  date: string;
  status: string;
  error: string | null;
  path: NoiseDiagnostics | null;
  measurement: ReturnType<NoiseMeter['snapshot']> | null;
  manual: string;
  name: string;
  audioStartMs: number | null;
  history: NoiseRows;
}
const fresh = (): Report => ({
  date: new Date().toISOString(), status: t.idle, error: null, path: null, measurement: null, manual: 'untested',
  name: '', audioStartMs: null, history: [],
});
// Один последний отчёт в памяти вкладки, независимо от проекта. PCM здесь нет.
let last = fresh();
let capturedSetup: MicSetup | null = null;
let lastMeter: NoiseMeter | null = null;
// 056: один идентификатор записи на сеанс — расширенный JSON и сохранение в историю совпадают.
const recordIds = new WeakMap<NoiseMeter, string>();
const savedMeters = new WeakSet<NoiseMeter>();
const describe = (v: unknown): string => {
  if (v == null) return t.unknown;
  if (typeof v === 'boolean') return v ? t.yes : t.no;
  return typeof v === 'object' ? JSON.stringify(v) : String(v);
};
const percent = (v?: number | null) => v == null ? '—' : (100 * v).toFixed(1) + ' %';

export function NoiseScreen({ project = null }: { project?: { id: string; name: string } | null }) {
  const [report, render] = useState(last);
  const [label, setLabel] = useState('');
  const [weight, setWeight] = useState<Weight>('Z');
  const [period, setPeriod] = useState<SpectrumPeriod>('now');
  // Общие для спектра, полос и подэкрана истории (055).
  const [view, setView] = useState('corrected');
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [exportError, setExportError] = useState(false);
  const [micState, setMic] = useState<MicState>(micLoading);
  const setup = micState.setup;
  const [legacy] = useState(loadCal);
  const [routeEpoch, setRouteEpoch] = useState(0);
  const history = useNoiseHistory();
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [linkProject, setLinkProject] = useState(false);
  const [storeNote, setStoreNote] = useState<string | null>(null);
  const [toast, setToast] = useState({ text: '', n: 0 });
  const session = useRef<{ controller: AbortController; meter: NoiseMeter | null } | null>(null);
  const update = (changes: Partial<Report>) => { last = { ...last, ...changes }; render(last); };

  function stop(status: string) {
    const active = session.current;
    if (!active) return;
    session.current = null;
    active.controller.abort();
    lastMeter = active.meter;
    lastMeter?.spectral.releasePcm();
    update({ status, measurement: active.meter?.snapshot() ?? null, history: active.meter?.history ?? [],
      audioStartMs: active.meter?.audioStartMs ?? null, error: status === t.noData ? 'NoAudioData' : last.error });
  }
  useLayoutEffect(() => {
    const leave = () => stop(t.hidden);
    const visibility = () => { if (document.hidden) leave(); };
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', leave);
    return () => {
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pagehide', leave);
      leave();
    };
  }, []);

  async function start() {
    if (session.current || !setup) return;
    capturedSetup = setup;
    const active = { controller: new AbortController(), meter: null as NoiseMeter | null };
    session.current = active;
    lastMeter = null;
    update({ ...fresh(), name: last.status === t.idle ? last.name : '', status: t.pending });
    setExportError(false);
    setStoreNote(null);
    setLabel('');
    let nextRefresh = 0;
    let verified = false;
    try {
      if (!window.isSecureContext) throw new DOMException('', 'NotSupportedError');
      const opening = openMic({
        signal: active.controller.signal,
        deviceId: setup.input.source === 'system' ? undefined : setup.input.source.localDeviceId,
        onInterrupt: reason => { if (session.current === active) { stop(t[reason]); setRouteEpoch(n => n + 1); } },
        onBackendChange: path => { if (session.current === active) update({ path }); },
        onBlock(pcm, sequence) {
          if (session.current !== active || !verified || !last.path) return;
          active.meter ??= new NoiseMeter(last.path.sampleRate, setup.profile);
          active.meter.push(pcm, sequence);
          if (active.meter.limitReached) { stop(t.limit); return; }
          const now = performance.now();
          if (now < nextRefresh) return;
          nextRefresh = now + (last.path.backend === 'AudioWorklet' ? 150 : 350);
          update({ status: t.running, measurement: active.meter.snapshot(), history: active.meter.history,
            audioStartMs: active.meter.audioStartMs });
        },
      });
      // Open inside the user gesture. Before accepting any blocks, verify the
      // pinned selection against edits/archives made concurrently in another tab.
      const verify = setup.profile ? micCatalog.read(noiseScope).then(row => {
        const pinned = setup.profile!;
        if (row.selection.mode !== 'catalog' || row.selection.profileId !== pinned.id || row.selection.version !== pinned.version ||
            !row.profiles.some(p => p.id === pinned.id && p.version === pinned.version) ||
            JSON.stringify(row.input) !== JSON.stringify(setup.input)) throw new Error('Выбор микрофона изменился. Проверьте настройки.');
      }) : Promise.resolve();
      const [mic] = await Promise.all([opening, verify]);
      if (session.current !== active) { mic.close(); return; }
      if (setup.profile) {
        // Тот же вход, что при подтверждении; первое подтверждённое измерение его привязывает (UX-003).
        try { await micCatalog.bindRoute(noiseScope, setup, mic.route); } catch (error) { mic.close(); throw error; }
        announceCatalogChange();
        if (session.current !== active) { mic.close(); return; }
      }
      verified = true;
      active.meter ??= new NoiseMeter(mic.sampleRate, setup.profile);
      setLabel(mic.label);
      update({ status: t.waitingForAudio, path: mic.diagnostics });
    } catch (error) {
      if (session.current !== active) return;
      const name = (error as Error).name;
      session.current = null;
      active.controller.abort();
      const key = Object.hasOwn(t.errors, name) ? name as keyof typeof t.errors : 'unknown';
      if (setup.profile) setRouteEpoch(n => n + 1);
      update({ error: key, status: fromCatalog(error) ? (error as Error).message : t.errors[key] });
    }
  }

  async function save() {
    const meter = session.current?.meter ?? lastMeter;
    const data = legacyReport(meter, last, { weight, period, model: capturedSetup?.input.confirmedModel, build: BUILD,
      secureContext: window.isSecureContext, microphoneApi: !!navigator.mediaDevices?.getUserMedia });
    try { await shareFile(JSON.stringify(data), noiseFileName(last.name.trim(), meter?.audioStartMs ?? last.audioStartMs), 'application/json'); }
    catch { setExportError(true); }
  }

  /** 056: запись истории из завершённого сеанса; суммы — снимок NoiseSessionV1, PCM не входит. */
  function sessionRecord(meter: NoiseMeter): NoiseRecord {
    const id = recordIds.get(meter) ?? newRecordId();
    recordIds.set(meter, id);
    const name = last.name.trim().slice(0, 100), absolute = matchingAbsolute(capturedSetup, last.path);
    return {
      id, name, savedAt: new Date().toISOString(), project: linkProject && project ? { id: project.id, name: project.name } : null, imported: null,
      context: {
        view: { weight, period, corrected: view === 'corrected' && !!meter.profile },
        input: capturedSetup && { source: capturedSetup.input.source === 'system' ? 'system' : 'selected', confirmedModel: capturedSetup.input.confirmedModel },
        absolute: absolute && { offsetDb: absolute.offsetDb, verifiedAt: absolute.verifiedAt, references: absolute.references!.map(r => ({ ...r })) },
        ranges: { Z: { ...meter.blockPower }, A: { ...meter.spectral.range.A }, C: { ...meter.spectral.range.C } },
      },
      content: { type: 'session', session: createNoiseSession(meter, { name, stopReason: last.status, manualCheck: last.manual, build: BUILD },
        last.path, capturedSetup?.input.confirmedModel ?? null) },
    };
  }
  async function saveToHistory() {
    const meter = lastMeter;
    if (!meter || session.current || !meter.history.length) return;
    if (savedMeters.has(meter)) { setStoreNote(S.noise.store.already); return; }
    const persisting = noiseHistory.persist();
    try {
      const record = sessionRecord(meter);
      await noiseHistory.save(record);
      savedMeters.add(meter);
      setStoreNote(null);
      setToast(v => ({ text: S.noise.store.saved(displayName({ name: record.name, startedAt: null, savedAt: record.savedAt })), n: v.n + 1 }));
    } catch (e) {
      if (e instanceof NoiseRecordError && e.code === 'conflict') { savedMeters.add(meter); setStoreNote(S.noise.store.already); }
      else setStoreNote((e as Error).message);
    }
    await persisting;
    history.reload();
  }
  async function exportSession() {
    const meter = lastMeter;
    if (!meter || session.current || !meter.history.length) return;
    try {
      const record = sessionRecord(meter);
      await shareFile(exportRecord(record, BUILD), noiseFileName(record.name, meter.audioStartMs, Date.now(), '-session'), 'application/json');
    } catch { setExportError(true); }
  }
  const { measurement: m, path } = report;
  const busy = !!session.current;
  const meter = session.current?.meter ?? lastMeter;
  const current = weight === 'Z' ? meter?.blockPower.current : meter?.spectral.range[weight].current;
  const canStore = !busy && !!lastMeter?.history.length;
  const stored = history.list;
  return <div class="screen">
    <Panel title={t.subtitle}>
      <p class="small">{t.raw}</p>
      <div class="btn-row">
        <button type="button" class="btn btn--primary" disabled={busy || !setup} onClick={start}>{t.start}</button>
        <button type="button" class="btn" disabled={!busy} onClick={() => stop(t.stopped)}>{t.stop}</button>
        <button type="button" class="btn btn--ghost" disabled={busy || report.status === t.idle}
          onClick={() => { lastMeter = null; update(fresh()); setLabel(''); setExportError(false); }}>{t.reset}</button>
      </div>
      {!busy && <MicStartHint block={micState.block} />}
      <p role="status">{report.status}</p>
      <SelectField label="Частотное взвешивание" value={weight} options={['Z', 'A', 'C'].map(value => ({ value, label: value }))}
        onChange={v => setWeight(v as Weight)} />
      <p class="small">{t.rms} ({weight})</p>
      <p class="rta-big"><strong>{levelText(current)}</strong> {t.unit}</p>
      <p>{t.secondRms} · {m?.windowComplete ? (m.rms1sDbfs?.toFixed(1) ?? '−∞') + ' dBFS' : '—'} (Z)</p>
      <NoiseLevels meter={meter} weight={weight} />
      <p class="small">{t.time} · {m?.activeSeconds.toFixed(1) ?? '0'} с</p>
      {!!m?.clipped && <Note tone="warn">{t.clipping}</Note>}
      <DetailPanel title={S.noise.store.title} open={libraryOpen} onOpenChange={setLibraryOpen}
        summary={history.error ?? S.noise.store.summary(stored?.headers.length ?? 0, ((stored?.bytes ?? 0) / 2 ** 20).toFixed(1))}>
        <NoiseLibrary state={history} reload={history.reload} open={libraryOpen} />
      </DetailPanel>
    </Panel>
    <MicCalibrationPanel scope={noiseScope} busy={busy} changed={setMic} routeEpoch={routeEpoch} legacy={legacy} />
    <AbsoluteReference meter={meter} path={path} setup={capturedSetup} next={setup} busy={busy}
      refresh={() => setRouteEpoch(v => v + 1)} />
    <NoiseAnalysis meter={meter} blocks={m?.blocks ?? 0} weight={weight} period={period} onPeriod={setPeriod} view={view} onView={setView} />
    <Panel title={t.history}>
      {report.history.length ? <>
        <RmsHistoryChart rows={report.history} live={busy} />
        <p class="small">{busy ? t.liveHistory : t.fullHistory}</p>
        {meter && <DetailPanel title={t.timeline.title} summary={t.timeline.summary} open={timelineOpen} onOpenChange={setTimelineOpen}>
          <NoiseTimeline meter={meter} busy={busy} open={timelineOpen} weight={weight} onWeight={setWeight}
            corrected={view === 'corrected'} onCorrected={v => setView(v ? 'corrected' : 'raw')} />
        </DetailPanel>}
      </> : <p class="small">{t.empty}</p>}
    </Panel>
    <Panel title={t.diagnostics}>
      <p>{t.secure} · {describe(window.isSecureContext)}</p>
      {path && <>
        <p>{t.path} · {path.backend} · {path.sampleRate} Гц</p>
        {label && <p>{t.input} · {label}</p>}
        <p>{t.fallback} · {describe(path.constraintsFallback)}</p>
        <p>{t.clips} · {percent(m?.clippedFraction)} · {t.missing} · {percent(m?.missingFraction)}</p>
        {(['settings', 'supported', 'constraints', 'capabilities'] as const).map(key =>
          <Details key={key} summary={t[key]}><ul class="plain-list">
            {Object.entries(path[key]).map(([name, value]) => <li key={name}>{name} · {describe(value)}</li>)}
          </ul></Details>)}
        <Note>{t.processing}</Note>
      </>}
      <SelectField label={t.manual} value={report.manual} options={(['untested', 'passed', 'failed'] as const)
        .map(value => ({ value, label: t[value] }))} onChange={manual => update({ manual })} />
      <p class="small">{t.privacy}</p>
      <div class="field">
        <label for="noise-name">{t.name}</label>
        <div class="field__box"><input id="noise-name" maxLength={100} value={report.name}
          onInput={e => update({ name: e.currentTarget.value })} /></div>
      </div>
      <button type="button" class="btn" onClick={save}>{t.export}</button>
      {exportError && <Note tone="warn">{t.exportError}</Note>}
      {project && <label class="check"><input type="checkbox" checked={linkProject} onChange={e => setLinkProject(e.currentTarget.checked)} />
        {S.noise.store.link(project.name)}</label>}
      <div class="btn-row">
        <button type="button" class="btn btn--tonal" disabled={!canStore} onClick={() => void saveToHistory()}>{S.noise.store.save}</button>
        <button type="button" class="btn" disabled={!canStore} onClick={() => void exportSession()}>{S.noise.store.extended}</button>
      </div>
      <p class="small">{S.noise.store.saveHint}</p>
      {storeNote && <Note tone="warn">{storeNote}</Note>}
    </Panel>
    <Toast message={toast.text} trigger={toast.n} />
  </div>;
}
