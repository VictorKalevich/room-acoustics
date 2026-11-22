import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { micCatalog } from '../../state/micCatalog';
import { maxBoostDb } from '../../core/micCurve';
import { FFT_SIZE, NoiseMeter, type NoisePoint } from '../../core/noise';
import { openMic, shareFile } from '../audio/mic';
import type { NoiseDiagnostics } from '../audio/noiseDiagnostics';
import { SPECTRUM_SIZE, SPECTRUM_HOP, bandPowers, type SpectrumPeriod, type Weight } from '../../core/noiseSpectrum';
import { NoiseAnalysis, NoiseLevels, levelText } from './NoiseAnalysis';
import { Details, Note, Panel, SelectField, RmsHistoryChart } from '../design-system';
import { S } from '../strings';
import { BUILD } from '../updates';
import { noiseFileName } from '../format';
import { loadCal } from '../../state/legacyMicCalibration';
import { MicCalibrationPanel, MicStartHint, announceCatalogChange, fromCatalog, micLoading, type MicSetup, type MicState } from '../components/MicCalibrationPanel';
import { AbsoluteReference } from '../components/AbsoluteReference';
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
  history: readonly NoisePoint[];
}
const fresh = (): Report => ({
  date: new Date().toISOString(), status: t.idle, error: null, path: null, measurement: null, manual: 'untested',
  name: '', audioStartMs: null, history: [],
});
// Один последний отчёт в памяти вкладки, независимо от проекта. PCM здесь нет.
let last = fresh();
let capturedSetup: MicSetup | null = null;
let lastMeter: NoiseMeter | null = null;
const describe = (v: unknown): string => {
  if (v == null) return t.unknown;
  if (typeof v === 'boolean') return v ? t.yes : t.no;
  return typeof v === 'object' ? JSON.stringify(v) : String(v);
};
const percent = (v?: number | null) => v == null ? '—' : (100 * v).toFixed(1) + ' %';

export function NoiseScreen() {
  const [report, render] = useState(last);
  const [label, setLabel] = useState('');
  const [weight, setWeight] = useState<Weight>('Z');
  const [period, setPeriod] = useState<SpectrumPeriod>('now');
  const [exportError, setExportError] = useState(false);
  const [micState, setMic] = useState<MicState>(micLoading);
  const setup = micState.setup;
  const [legacy] = useState(loadCal);
  const [routeEpoch, setRouteEpoch] = useState(0);
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
    const spectrum = meter?.spectral.average(period, weight);
    const corrected = meter?.profile ? meter.spectral.average(period, weight, true) : null;
    const measurement = meter?.snapshot() ?? last.measurement;
    const origin = meter?.audioStartMs ?? last.audioStartMs;
    const name = last.name.trim();
    const data = {
      ...(meter?.profile && corrected ? { calibration: {
        profile: meter.profile, model: capturedSetup?.input.confirmedModel, maxBoostDb: meter.profile.maxBoostDb ?? maxBoostDb, outsideRange: 'uncorrected',
        correctedSpectrum: { period, weight, seconds: corrected.seconds, units: 'FS²/Hz',
          psd: corrected.seconds ? Array.from(corrected.density) : null,
          meanSquare: corrected.seconds ? corrected.density.reduce((sum, v) => sum + v, 0) * meter.spectral.binHz : null,
          bands: corrected.seconds ? bandPowers(corrected.density, meter.spectral.binHz) : [] },
      } } : {}),
      schema: meter?.profile ? 3 : 2, build: BUILD, mode: 'raw', units: 'dBFS', fftSize: FFT_SIZE,
      window: 'periodic Hann', spectrum: 'one-sided peak amplitude per bin', rmsWindowSamples: FFT_SIZE,
      secureContext: window.isSecureContext, microphoneApi: !!navigator.mediaDevices?.getUserMedia,
      ...last, name, measurement, rmsAverageSeconds: 1, audioStartMs: origin,
      spectralAnalysis: meter && spectrum && {
        fftSize: SPECTRUM_SIZE, hopSamples: SPECTRUM_HOP, binHz: meter.spectral.binHz, weight, period,
        validSpectralSeconds: spectrum.seconds, psdUnits: 'FS²/Hz',
        psd: spectrum.seconds ? Array.from(spectrum.density) : null,
        bands: spectrum.seconds ? bandPowers(spectrum.density, meter.spectral.binHz) : [],
        bandPowerUnits: 'FS²', leqPower: weight === 'Z' ? meter.sessionPower : meter.spectral.leqPower(weight),
        leqSeconds: weight === 'Z' ? meter.history.length * FFT_SIZE / meter.sampleRate : meter.spectral.weightedSeconds,
        rmsWindowSamples: weight === 'Z' ? FFT_SIZE : SPECTRUM_SIZE,
        rmsPower: weight === 'Z' ? meter.blockPower : meter.spectral.range[weight],
        sessionPeakAmplitude: meter.peakAmplitude,
      },
      history: (meter?.history ?? last.history).map(point => ({
        ...point, timestamp: new Date(origin! + point.endSeconds * 1000).toISOString(),
      })),
    };
    try { await shareFile(JSON.stringify(data), noiseFileName(name, origin), 'application/json'); }
    catch { setExportError(true); }
  }
  const { measurement: m, path } = report;
  const busy = !!session.current;
  const meter = session.current?.meter ?? lastMeter;
  const current = weight === 'Z' ? meter?.blockPower.current : meter?.spectral.range[weight].current;
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
    </Panel>
    <MicCalibrationPanel scope={noiseScope} busy={busy} changed={setMic} routeEpoch={routeEpoch} legacy={legacy} />
    <AbsoluteReference meter={meter} path={path} setup={capturedSetup} next={setup} busy={busy}
      refresh={() => setRouteEpoch(v => v + 1)} />
    <NoiseAnalysis meter={meter} blocks={m?.blocks ?? 0} weight={weight} period={period} onPeriod={setPeriod} />
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
