import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { FFT_SIZE, NoiseMeter, type NoisePoint } from '../../core/noise';
import { openMic, shareFile } from '../audio/mic';
import type { NoiseDiagnostics } from '../audio/noiseDiagnostics';
import { ResponseChart } from '../components/Charts';
import { Details, Note, Panel, SelectField, RmsHistoryChart } from '../design-system';
import { S } from '../strings';
import { BUILD } from '../updates';

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
  history: readonly NoisePoint[];
}
const fresh = (): Report => ({
  date: new Date().toISOString(), status: t.idle, error: null, path: null, measurement: null, manual: 'untested',
  name: '', audioStartMs: null, history: [],
});
// Один последний отчёт в памяти вкладки, независимо от проекта. PCM здесь нет.
let last = fresh();
const describe = (v: unknown): string => {
  if (v == null) return t.unknown;
  if (typeof v === 'boolean') return v ? t.yes : t.no;
  return typeof v === 'object' ? JSON.stringify(v) : String(v);
};
const percent = (v?: number | null) => v == null ? '—' : (100 * v).toFixed(1) + ' %';

export function NoiseScreen() {
  const [report, render] = useState(last);
  const [label, setLabel] = useState('');
  const [exportError, setExportError] = useState(false);
  const session = useRef<{ controller: AbortController; meter: NoiseMeter | null } | null>(null);
  const update = (changes: Partial<Report>) => { last = { ...last, ...changes }; render(last); };

  function stop(status: string) {
    const active = session.current;
    if (!active) return;
    session.current = null;
    active.controller.abort();
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
    if (session.current) return;
    const active = { controller: new AbortController(), meter: null as NoiseMeter | null };
    session.current = active;
    update({ ...fresh(), name: last.status === t.idle ? last.name : '', status: t.pending });
    setExportError(false);
    setLabel('');
    let nextRefresh = 0;
    try {
      if (!window.isSecureContext) throw new DOMException('', 'NotSupportedError');
      const mic = await openMic({
        signal: active.controller.signal,
        onInterrupt: reason => { if (session.current === active) stop(t[reason]); },
        onBackendChange: path => { if (session.current === active) update({ path }); },
        onBlock(pcm, sequence) {
          if (session.current !== active || !last.path) return;
          active.meter ??= new NoiseMeter(last.path.sampleRate);
          active.meter.push(pcm, sequence);
          const now = performance.now();
          if (now < nextRefresh) return;
          nextRefresh = now + (last.path.backend === 'AudioWorklet' ? 150 : 350);
          update({ status: t.running, measurement: active.meter.snapshot(), history: active.meter.history,
            audioStartMs: active.meter.audioStartMs });
        },
      });
      if (session.current !== active) { mic.close(); return; }
      active.meter ??= new NoiseMeter(mic.sampleRate);
      setLabel(mic.label);
      update({ status: t.waitingForAudio, path: mic.diagnostics });
    } catch (error) {
      if (session.current !== active) return;
      const name = (error as Error).name;
      session.current = null;
      active.controller.abort();
      const key = Object.hasOwn(t.errors, name) ? name as keyof typeof t.errors : 'unknown';
      update({ error: key, status: t.errors[key] });
    }
  }

  async function save() {
    const meter = session.current?.meter;
    const measurement = meter?.snapshot() ?? last.measurement;
    const origin = meter?.audioStartMs ?? last.audioStartMs;
    const name = last.name.trim();
    const data = {
      schema: 2, build: BUILD, mode: 'raw', units: 'dBFS', fftSize: FFT_SIZE,
      window: 'periodic Hann', spectrum: 'one-sided peak amplitude per bin', rmsWindowSamples: FFT_SIZE,
      secureContext: window.isSecureContext, microphoneApi: !!navigator.mediaDevices?.getUserMedia,
      ...last, name, measurement, rmsAverageSeconds: 1, audioStartMs: origin,
      history: (meter?.history ?? last.history).map(point => ({
        ...point, timestamp: new Date(origin! + point.endSeconds * 1000).toISOString(),
      })),
    };
    const safeName = name.replace(/[^\p{L}\p{N}._ -]+/gu, '-').slice(0, 80);
    try { await shareFile(JSON.stringify(data), safeName ? 'noise-' + safeName + '.json' : 'noise-diagnostics.json', 'application/json'); }
    catch { setExportError(true); }
  }
  const { measurement: m, path } = report;
  const busy = !!session.current;
  return <div class="screen">
    <Panel title={t.subtitle}>
      <p class="small">{t.raw}</p>
      <div class="btn-row">
        <button type="button" class="btn btn--primary" disabled={busy} onClick={start}>{t.start}</button>
        <button type="button" class="btn" disabled={!busy} onClick={() => stop(t.stopped)}>{t.stop}</button>
        <button type="button" class="btn btn--ghost" disabled={busy || report.status === t.idle}
          onClick={() => { update(fresh()); setLabel(''); setExportError(false); }}>{t.reset}</button>
      </div>
      <p role="status">{report.status}</p>
      <p class="small">{t.rms}</p>
      <p class="rta-big"><strong>{m?.rmsDbfs == null ? (m?.blocks ? '−∞' : '—') : m.rmsDbfs.toFixed(1)}</strong> {t.unit}</p>
      <p>{t.secondRms} · {m?.windowComplete ? (m.rms1sDbfs?.toFixed(1) ?? '−∞') + ' dBFS' : '—'}</p>
      <p class="small">{t.time} · {m?.activeSeconds.toFixed(1) ?? '0'} с</p>
      {!!m?.clipped && <Note tone="warn">{t.clipping}</Note>}
    </Panel>
    <Panel title={t.spectrum}>
      {m?.f.length && path ? <>
        <ResponseChart label={t.spectrum} lines={[{ f: m.f, db: m.db, cls: 'is-measured' }]} fLo={20}
          fHi={Math.min(20000, path.sampleRate / 2)} yRange={[-100, 0]} yTicks={[-100, -80, -60, -40, -20, 0]} />
        <p class="small">{t.axis} · {t.peak} {m.peakHz?.toFixed(1)} Гц</p>
      </> : <p class="small">{m?.blocks ? t.silence : t.empty}</p>}
    </Panel>
    <Panel title={t.history}>
      {report.history.length ? <>
        <RmsHistoryChart rows={report.history} live={busy} />
        <p class="small">{busy ? t.liveHistory : t.fullHistory}</p>
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
    </Panel>
  </div>;
}
