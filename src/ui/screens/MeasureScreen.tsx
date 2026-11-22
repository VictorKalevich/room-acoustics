import { CAL_KEY, loadCal } from '../../state/legacyMicCalibration';
// «Замер»: свип (АЧХ в нескольких точках → замер проекта), хлопок (RT60 по октавам), живой анализатор баса.
import { evalPpo } from '../../core/precision';
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { shownTreatments } from '../../core/treatments';
import type { Project } from '../../state/project';
import type { Measurement, Room, Setup } from '../../core/types';
import { analyzeSweep, averageRT, clapRT60, logGrid, logSweep, parseCalibration, powerAverage, RT_BANDS, smoothOct, sweepSegment, wav16, type BandRT, type SweepResult } from '../../core/dsp';
import { afterSmoothing, beforeSmoothing, micKey, type AppliedMic, type LegacyCal } from '../../core/micApply';
import type { MicRecordCalibration, MicRoute, MicScope } from '../../core/micCalibration';
import { micCatalog } from '../../state/micCatalog';
import { MicCalibrationPanel, MicStartHint, announceCatalogChange, appliedMic, fromCatalog, micLabel, micLoading, type MicSetup, type MicState } from '../components/MicCalibrationPanel';
import { setBusy } from '../updates';
import { computeReverb } from '../../core/reverb';
import { openMic, playBuffer, shareFile, type Mic } from '../audio/mic';
import { getTone, onTone } from '../audio/tone';
import { useSetupEval } from '../useEval';
import { ResponseChart } from '../components/Charts';
import { PlanView, type PlanItem } from '../components/PlanView';
import { ActionBar, ConfirmSheet, Note, Panel } from '../design-system';
import { Term } from '../components/Term';
import { S } from '../strings';
import { fmt } from '../format';
import { MeasureCompare } from '../components/MeasureCompare';
import { withMeasurement } from '../../state/variant';
import { makeId } from '../../state/project';
import { SectionNav } from '../design-system';
import { RetainedSection } from '../components/RetainedSection';
import { MeasurePanel } from './measure/MeasurePanel';
import type { Destination, MeasureView } from '../navigation';
import { useActiveView } from '../useActiveView';
import { PlacementFirst } from './Gates';

interface Props {
  project: Project; onSetup: (s: Setup) => void; onRoom: (r: Room) => void; onGo: (t: Destination) => void; view: MeasureView; active: boolean;
  /** 022: свип и сравнение привязаны к расстановке — пока места не выбраны, переход к расстановке. */
  onPlacement: (m: 'auto' | 'manual') => void;
}

const F1 = 10, F2 = 1000, T = 6;
export function MeasureScreen({ project, onSetup, onRoom, onGo, view, active, onPlacement }: Props) {
  const placed = !!project.current.placed;
  const gated = !placed && (view === 'sweep' || view === 'compare');
  const [cal, setCal] = useState(loadCal());
  const [err, setErr] = useState<string | null>(null);
  const calInput = useRef<HTMLInputElement>(null);

  return (
    <div class="screen">
      <SectionNav label="Раздел измерений" value={view} onChange={(v) => onGo(`measure/${v}`)} options={[
        { value: 'sweep', label: 'Свип', hint: 'АЧХ в точках комнаты' },
        { value: 'clap', label: 'Хлопок', hint: 'Время реверберации' },
        { value: 'rta', label: 'Анализатор', hint: 'Спектр в реальном времени' },
        { value: 'compare', label: 'Сравнение и REW', hint: 'Импорт, история, модель' },
      ]} />
      {gated && <PlacementFirst inline onGo={onPlacement} />}
      <div hidden={view === 'compare' || gated}>
      <Panel>
        <p class="small">{S.measure.intro}</p>
        <Note>{S.measure.micNote}</Note>
        <div class="btn-row">
          <button type="button" class="btn btn--small" onClick={() => calInput.current?.click()}>{cal ? S.measure.calReplace : S.measure.calLoad}</button>
          {cal && <button type="button" class="btn btn--small btn--ghost" onClick={() => { try { localStorage.removeItem(CAL_KEY); } catch { /* */ } setCal(null); }}>{S.measure.calRemove}</button>}
          <button type="button" class="btn btn--small btn--ghost" onClick={() => onGo('measure/compare')}>{S.measure.rewImport}</button>
        </div>
        {cal && <p class="muted small">{S.measure.calLoaded(cal.name)}</p>}
        <input
          ref={calInput}
          type="file"
          accept=".txt,.cal,.frd,text/plain"
          class="visually-hidden"
          onChange={async (e) => {
            const f = (e.target as HTMLInputElement).files?.[0];
            (e.target as HTMLInputElement).value = '';
            if (!f) return;
            try {
              const c = { name: f.name, ...parseCalibration(await f.text()) };
              try { localStorage.setItem(CAL_KEY, JSON.stringify(c)); } catch { /* без хранилища */ }
              setCal(c);
              setErr(null);
            } catch (x) { setErr((x as Error).message); }
          }}
        />
        {err && <Note tone="warn">{err}</Note>}
      </Panel>
      </div>
      {placed && <RetainedSection active={view === 'sweep'}><SweepTool project={project} onSetup={onSetup} onGo={onGo} legacy={cal} active={active && view === 'sweep'} /></RetainedSection>}
      <RetainedSection active={view === 'clap'}><ClapTool project={project} active={active && view === 'clap'} /></RetainedSection>
      <RetainedSection active={view === 'rta'}><RtaTool project={project} legacy={cal} active={active && view === 'rta'} /></RetainedSection>
      {placed && <RetainedSection active={view === 'compare'}>
        <MeasurePanel project={project} onSetup={onSetup} onRoom={onRoom} />
        <div class="btn-row"><button type="button" class="btn" onClick={() => onGo('tuning/eq')}>Открыть эквалайзер</button></div>
      </RetainedSection>}
    </div>
  );
}

// ---------- Общий выбор микрофона (054) ----------

/** Вход по выбору инструмента; системный вход открывается прежним запросом. */
const deviceOf = (setup: MicSetup) => setup.input.source === 'system' ? '' : setup.input.source.localDeviceId;
const openFor = (device: string) => device ? openMic({ deviceId: device }) : openMic();
/** Точки одного замера — с одной поправкой. В legacy прежняя кривая по-прежнему может смениться между точками. */
const pinOf = (mic: AppliedMic) => mic.mode === 'legacy' ? 'legacy' : micKey(mic);

/** Смена аудиоустройств, пока открыт вход с профилем каталога: поправка подтверждалась для прежнего входа. */
function useRouteChange(on: boolean, changed: () => void) {
  const latest = useRef(changed);
  latest.current = changed;
  useEffect(() => {
    const media = navigator.mediaDevices;
    if (!on || !media?.addEventListener) return;
    const handler = () => latest.current();
    media.addEventListener('devicechange', handler);
    return () => media.removeEventListener('devicechange', handler);
  }, [on]);
}

/**
 * 057: серия точек одного замера (Свип, Хлопок) при любой калибровке. devicechange говорит лишь, что список устройств изменился:
 * сменился ли вход, браузер надёжно не сообщает. Поэтому точка, которую записывали во время смены, не принимается, вход
 * открывается заново, а следующая точка непустой серии записывается только после явного подтверждения. Другой deviceId у
 * заново открытого входа — достоверно другой вход: точки не смешиваются.
 */
function useSeriesInput(points: number) {
  // вход открыт до смены: перед следующей точкой открыть заново; во время записи — точку не принимать
  const stale = useRef(false);
  const unconfirmed = useRef(false);
  const device = useRef<string | null>(null);
  const [ask, setAsk] = useState(false);
  useRouteChange(true, () => { stale.current = true; if (points) unconfirmed.current = true; });
  useEffect(() => { if (!points) { device.current = null; unconfirmed.current = false; setAsk(false); } }, [points]);
  return {
    stale, ask,
    /** Можно ли начинать следующую точку; иначе показать подтверждение. */
    ready() { if (points && unconfirmed.current) { setAsk(true); return false; } return true; },
    confirm() { unconfirmed.current = false; setAsk(false); },
    cancel() { setAsk(false); },
    /** Тот же вход, что у точек серии, насколько это видно браузеру. */
    sameInput(route: MicRoute) { return !points || !device.current || !route.deviceId || route.deviceId === device.current; },
    accepted(route: MicRoute) { device.current ??= route.deviceId || null; },
  };
}

function useMicScope(tool: 'rta' | 'sweep' | 'clap', projectId: string) {
  const scope = useMemo<MicScope>(() => ({ tool, projectId }), [tool, projectId]);
  const [state, setState] = useState<MicState>(micLoading);
  const [epoch, setEpoch] = useState(0);
  const interrupted = useCallback(() => setEpoch((n) => n + 1), []);
  return { scope, state, changed: setState, epoch, interrupted };
}

// ---------- Свип ----------

function SweepTool({ project, onSetup, onGo, legacy, active }: { project: Project; onSetup: (s: Setup) => void; onGo: (t: Destination) => void; legacy: LegacyCal | null; active: boolean }) {
  const activeView = useActiveView(active);
  const micSel = useMicScope('sweep', project.id);
  const [playHere, setPlayHere] = useState(false);
  const [takes, setTakes] = useState<SweepResult[]>([]);
  // сеанс записи: повторное сохранение с добавленными точками уточняет замер; все точки убрали — новый сеанс
  const session = useRef(makeId());
  // поправка точек сеанса: закреплена первой точкой (054)
  const sessionMic = useRef<AppliedMic | null>(null);
  const takeMic = useRef<AppliedMic | null>(null);
  useEffect(() => { if (!takes.length) { session.current = makeId(); sessionMic.current = null; } }, [takes.length]);
  const [state, setState] = useState<'idle' | 'rec' | 'busy'>('idle');
  const [opening, setOpening] = useState(false);
  const [msg, setMsg] = useState<{ t: string; tone: 'warn' | 'good' } | null>(null);
  const mic = useRef<Mic | null>(null);
  const openedFor = useRef('');
  // 057: смена устройств при любой калибровке — точку не принимаем, вход открываем и проверяем заново
  const series = useSeriesInput(takes.length);
  const { stale } = series;
  const timer = useRef<number | null>(null);
  useEffect(() => {
    if (!active) {
      mic.current?.close(); mic.current = null;
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      setState('idle');
    }
  }, [active]);
  useEffect(() => () => { mic.current?.close(); if (timer.current) clearTimeout(timer.current); }, []);

  const finish = () => {
    const m = mic.current;
    const applied = takeMic.current;
    if (!m || !applied) return;
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const rec = m.stop();
    setState('busy');
    setTimeout(() => {
      try {
        if (stale.current) throw new Error(S.mic.takeDropped);
        const sweep = logSweep(F1, F2, T, m.sampleRate);
        if (rec.length < sweep.length) throw new Error(S.measure.tooShort);
        const seg = sweepSegment(rec, sweep.length, m.sampleRate);
        if (!seg) throw new Error(S.measure.cutOff);
        const r = analyzeSweep(seg, sweep, F1, F2, m.sampleRate, applied.mode === 'catalog' ? (f, db) => beforeSmoothing(applied, f, db) : undefined);
        const warn = r.peak > 0.98 ? S.measure.clip : r.peak < 0.01 ? S.measure.quiet : r.snrDb < 20 ? S.measure.noisy(Math.round(r.snrDb)) : null;
        sessionMic.current ??= applied;
        series.accepted(m.route);
        setTakes((t) => [...t, { ...r, db: afterSmoothing(applied, r.f, r.db) }]);
        setMsg(warn ? { t: warn, tone: 'warn' } : { t: S.measure.takeOk(Math.round(r.snrDb)), tone: 'good' });
      } catch (e) {
        setMsg({ t: (e as Error).message, tone: 'warn' });
      }
      setState('idle');
    }, 30);
  };

  const record = async () => {
    setMsg(null);
    const setup = micSel.state.setup;
    if (!setup) return;
    const applied = appliedMic(setup, legacy);
    if (sessionMic.current && pinOf(sessionMic.current) !== pinOf(applied)) { setMsg({ t: S.mic.lockedTakes, tone: 'warn' }); return; }
    if (!series.ready()) return;
    const device = deviceOf(setup);
    setOpening(true);
    try {
      if (mic.current && (openedFor.current !== device || stale.current)) { mic.current.close(); mic.current = null; }
      stale.current = false;
      if (!mic.current) {
        const opened = await openFor(device);
        if (!activeView.current) { opened.close(); return; }
        mic.current = opened;
        openedFor.current = device;
      }
      const m = mic.current;
      if (!series.sameInput(m.route)) { setMsg({ t: S.mic.otherInput, tone: 'warn' }); return; }
      if (!m.running()) { setMsg({ t: S.measure.tapAgain, tone: 'warn' }); return; }
      if (applied.mode === 'catalog') {
        await micCatalog.bindRoute(micSel.scope, setup, m.route);
        announceCatalogChange();
        if (!activeView.current) return;
      }
      takeMic.current = applied;
      m.start();
      setState('rec');
      if (playHere) {
        await playBuffer(logSweep(F1, F2, T, m.sampleRate), 0.5);
        if (!activeView.current) return;
        timer.current = window.setTimeout(finish, 1200);
      } else {
        timer.current = window.setTimeout(finish, 30000);
      }
    } catch (e) {
      setState('idle');
      if (fromCatalog(e)) micSel.interrupted();
      setMsg({ t: fromCatalog(e) ? (e as Error).message : S.measure.micError((e as Error).message), tone: 'warn' });
    } finally { setOpening(false); }
  };

  const [savedN, setSavedN] = useState(0);
  // пока есть несохранённые точки, приложение не перезапускается на новую версию
  useEffect(() => { setBusy('takes', takes.length > 0 && takes.length !== savedN); return () => setBusy('takes', false); }, [takes.length, savedN]);
  // снимок поправки сохранённого замера (054): записи нет — прежняя калибровка
  const saved = project.current.measurement?.session;
  const [savedRecord, setRecord] = useState<{ session: string; calibration: MicRecordCalibration | null } | null>(null);
  useEffect(() => {
    if (!saved) return;
    let live = true;
    micCatalog.readRecord(micSel.scope, saved).then((calibration) => { if (live) setRecord({ session: saved, calibration }); }, () => undefined);
    return () => { live = false; };
  }, [saved, micSel.scope]);
  const savedCalibration = saved && savedRecord?.session === saved ? savedRecord.calibration : null;
  const avg = takes.length ? powerAverage(takes.map((t) => t.db)) : null;
  const save = () => {
    if (!avg) return;
    setSavedN(takes.length);
    const f = takes[0].f;
    const m: Measurement = { name: S.measure.measName(takes.length), importedAt: new Date().toISOString(), f, db: avg, points: takes.length, session: session.current };
    onSetup(withMeasurement(project.current, m));
    const applied = sessionMic.current;
    if (!applied || applied.mode === 'legacy') { setMsg({ t: S.measure.saved, tone: 'good' }); return; }
    const calibration: MicRecordCalibration = applied.mode === 'catalog' ? { mode: 'catalog', profile: applied.profile } : { mode: 'none' };
    const id = session.current;
    setMsg({ t: S.measure.saved + ' ' + S.mic.record(micLabel(applied)), tone: 'good' });
    micCatalog.saveRecord(micSel.scope, id, calibration).then(
      () => setRecord({ session: id, calibration }),
      (e) => setMsg({ t: S.mic.recordFailed((e as Error).message), tone: 'warn' }));
  };
  const recording = state !== 'idle' || opening;
  return (<>
    <MicCalibrationPanel scope={micSel.scope} busy={recording} lockText={takes.length ? S.mic.lockedTakes : undefined}
      changed={micSel.changed} routeEpoch={micSel.epoch} legacy={legacy} />
    <Panel title={S.measure.sweepTitle}>
      <ol class="small steps-list">
        <li>{S.measure.sweepSteps[0]}</li>
        <li>{S.measure.sweepSteps[1]}</li>
        <li>{S.measure.sweepSteps[2]}</li>
      </ol>
      <label class="check">
        <input type="checkbox" checked={playHere} onChange={(e) => setPlayHere((e.target as HTMLInputElement).checked)} />
        <span>{S.measure.playHere}</span>
      </label>
      {playHere && <p class="muted small">{S.measure.btWarn}</p>}
      {!playHere && (
        <button type="button" class="btn" onClick={() => shareFile(wav16(logSweep(F1, F2, T, 48000), 48000), 'sweep-10-1000Hz-6s.wav', 'audio/wav')}>
          {S.measure.download}
        </button>
      )}
      <ActionBar label="Запись свипа">
        {state !== 'rec' ? (
          <button type="button" class="btn btn--primary" disabled={state === 'busy' || opening || !micSel.state.setup} onClick={record}>
            {state === 'busy' ? S.measure.analyzing : S.measure.recordPoint(takes.length + 1)}
          </button>
        ) : (
          <button type="button" class="btn btn--primary is-rec" onClick={finish} disabled={playHere}>
            <span class="rec-dot" aria-hidden="true" /> {playHere ? S.measure.playing : S.measure.stop}
          </button>
        )}
        {!recording && <MicStartHint block={micSel.state.block} />}
      </ActionBar>
      {state === 'rec' && !playHere && <p class="small">{S.measure.startNow}</p>}
      {msg && <Note tone={msg.tone}>{msg.t}</Note>}
      {takes.length > 0 && (
        <>
          <ResponseChart
            fLo={15}
            fHi={500}
            lines={[
              ...takes.map((t) => ({ f: t.f, db: t.db, cls: 'is-take' })),
              ...(avg ? [{ f: takes[0].f, db: avg, cls: 'is-room' }] : []),
            ]}
          />
          <p class="muted small">{S.measure.takesLegend(takes.length)}</p>
          {sessionMic.current && sessionMic.current.mode !== 'legacy' && <p class="muted small">{S.mic.record(micLabel(sessionMic.current))}</p>}
          <div class="btn-row">
            <button type="button" class="btn btn--primary" onClick={save}>{S.measure.save}</button>
            <button type="button" class="btn btn--ghost" onClick={() => setTakes((t) => t.slice(0, -1))}>{S.measure.undo}</button>
            <button type="button" class="btn btn--ghost" onClick={() => onGo('measure/compare')}>Сравнить с моделью</button>
            <button type="button" class="btn btn--ghost" onClick={() => onGo('tuning/eq')}>{S.measure.toTuning}</button>
          </div>
        </>
      )}
      {series.ask && <ConfirmSheet tone="primary" title={S.mic.seriesTitle} text={S.mic.seriesText(takes.length)} confirm={S.mic.seriesGo}
        onCancel={series.cancel} onConfirm={() => { series.confirm(); void record(); }} />}
      {!takes.length && savedCalibration && <p class="muted small">{S.mic.savedRecord(savedCalibration.mode === 'catalog'
        ? savedCalibration.profile.name + ' · v' + savedCalibration.profile.version : S.mic.none)}</p>}
      <MeasureCompare setup={project.current} onSetup={onSetup} rise={project.constraints.houseCurve} />
    </Panel>
  </>);
}

// ---------- Хлопок ----------

function ClapTool({ project, active }: { project: Project; active: boolean }) {
  const activeView = useActiveView(active);
  // 054: выбор входа и профиля; поправка профиля в RT60 не входит — расчёт прежний
  const micSel = useMicScope('clap', project.id);
  const [state, setState] = useState<'idle' | 'rec' | 'busy'>('idle');
  const [opening, setOpening] = useState(false);
  const openedFor = useRef('');
  const [res, setRes] = useState<BandRT[][]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const mic = useRef<Mic | null>(null);
  const series = useSeriesInput(res.length);
  const { stale } = series;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!active) { mic.current?.close(); mic.current = null; if (timer.current) clearTimeout(timer.current); setState('idle'); }
    return () => { mic.current?.close(); if (timer.current) clearTimeout(timer.current); };
  }, [active]);
  const rev = useMemo(() => computeReverb(project.room), [project.room]);
  const go = async () => {
    setMsg(null);
    const setup = micSel.state.setup;
    if (!setup || !series.ready()) return;
    const device = deviceOf(setup);
    setOpening(true);
    try {
      if (mic.current && (openedFor.current !== device || stale.current)) { mic.current.close(); mic.current = null; }
      stale.current = false;
      if (!mic.current) {
        const opened = await openFor(device);
        if (!activeView.current) { opened.close(); return; }
        mic.current = opened;
        openedFor.current = device;
      }
      const m = mic.current;
      if (!series.sameInput(m.route)) { setMsg(S.mic.otherInput); return; }
      if (!m.running()) { setMsg(S.measure.tapAgain); return; }
      m.start();
      setState('rec');
      timer.current = setTimeout(() => {
        const x = m.stop();
        setState('busy');
        timer.current = setTimeout(() => {
          let pk = 0;
          for (let i = 0; i < x.length; i++) pk = Math.max(pk, Math.abs(x[i]));
          if (stale.current) { setMsg(S.mic.takeDropped); setState('idle'); return; }
          if (pk < 0.05) { setMsg(S.measure.noClap); setState('idle'); return; }
          series.accepted(m.route);
          setRes((r) => [...r, clapRT60(x, m.sampleRate)]);
          setState('idle');
        }, 30);
      }, 3500);
    } catch (e) {
      setState('idle');
      setMsg(S.measure.micError((e as Error).message));
    } finally { setOpening(false); }
  };
  const avgRT = averageRT(res);
  const avg = avgRT.map((r) => r.t60);
  const anyApprox = avgRT.some((r) => r.t60 != null && r.approx);
  const model = (band: number) => rev.used[rev.bands.indexOf(band)] ?? null;
  const midM = [avg[2], avg[3]].filter((x): x is number => x != null);
  const mid = midM.length ? midM.reduce((a, b) => a + b, 0) / midM.length : null;
  return (<>
    <MicCalibrationPanel scope={micSel.scope} busy={state !== 'idle' || opening} changed={micSel.changed} routeEpoch={micSel.epoch} />
    <Panel title={S.measure.clapTitle}>
      <p class="small">{S.measure.clapIntro} <Term id="rt60">RT60</Term>.</p>
      <ActionBar label="Замер хлопком"><button type="button" class="btn btn--primary" disabled={state !== 'idle' || opening || !micSel.state.setup} onClick={go}>
        {state === 'rec' ? S.measure.clapNow : state === 'busy' ? S.measure.analyzing : S.measure.clapStart}
      </button>
      {state === 'idle' && !opening && <MicStartHint block={micSel.state.block} />}</ActionBar>
      {msg && <Note tone="warn">{msg}</Note>}
      {res.length > 0 && (
        <>
          <table class="report-table">
            <thead><tr><th>{S.report.freq}</th><th>{S.measure.measured}</th><th>{S.measure.model}</th></tr></thead>
            <tbody>
              {RT_BANDS.map((b, k) => (
                <tr key={k}><td>{b >= 1000 ? `${b / 1000} кГц` : `${b} Гц`}</td><td>{avg[k] != null ? `${avgRT[k].approx ? '≈ ' : ''}${fmt(avg[k]!, 2)} с` : '—'}</td><td>{model(b) != null ? `${fmt(model(b)!, 2)} с` : '—'}</td></tr>
              ))}
            </tbody>
          </table>
          <p class="muted small">{S.measure.clapCount(res.length)}</p>
          {anyApprox && <p class="muted small">{S.measure.clapApprox}</p>}
          {mid != null && (
            <Note tone={Math.abs(mid - rev.tMid) / rev.tMid > 0.25 ? 'warn' : 'good'}>
              {mid > rev.tMid * 1.25 ? S.measure.clapMore(fmt(mid, 2), fmt(rev.tMid, 2)) : mid < rev.tMid * 0.75 ? S.measure.clapLess(fmt(mid, 2), fmt(rev.tMid, 2)) : S.measure.clapOk(fmt(mid, 2))}
            </Note>
          )}
          <button type="button" class="btn btn--ghost btn--small" onClick={() => setRes([])}>{S.measure.clear}</button>
        </>
      )}
      {series.ask && <ConfirmSheet tone="primary" title={S.mic.seriesTitle} text={S.mic.seriesText(res.length)} confirm={S.mic.seriesGo}
        onCancel={series.cancel} onConfirm={() => { series.confirm(); void go(); }} />}
    </Panel>
  </>);
}

// ---------- Анализатор ----------

function RtaTool({ project, legacy, active }: { project: Project; legacy: LegacyCal | null; active: boolean }) {
  const { room, sources, constraints: c, current } = project;
  const micSel = useMicScope('rta', project.id);
  const [on, setOn] = useState(false);
  useEffect(() => { if (!active) setOn(false); }, [active]);
  const [curve, setCurve] = useState<number[] | null>(null);
  // 054: у каждой кривой своя поправка; во время работы выбор закрыт
  const [curveMic, setCurveMic] = useState<{ label: string; legacy: boolean } | null>(null);
  const [snaps, setSnaps] = useState<{ name: string; db: number[]; mic: { label: string; legacy: boolean } | null }[]>([]);
  const [here, setHere] = useState<{ x: number; y: number } | null>(null);
  const [tone, setTone] = useState(getTone());
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => onTone(setTone), []);
  const mic = useRef<Mic | null>(null);
  const freqs = useMemo(() => logGrid(15, 250, 24), []);
  // прежнюю калибровку могут загрузить, пока анализатор работает: цикл берёт актуальную
  const legacyRef = useRef(legacy);
  useEffect(() => { legacyRef.current = legacy; });
  const pinned = useRef<{ setup: MicSetup; mic: AppliedMic } | null>(null);
  const { scope: rtaScope, interrupted } = micSel;
  // 057: при любой калибровке — стоп; запомненные кривые остаются, текущая сбрасывается: в ней мог смешаться сигнал двух входов
  const halted = useRef(false);
  useRouteChange(on, () => {
    halted.current = true;
    setMsg(S.noise.device + ' ' + S.mic.rtaDevice);
    setCurve(null);
    setCurveMic(null);
    setOn(false);
    if (pinned.current?.mic.mode === 'catalog') interrupted();
  });
  useEffect(() => {
    const run = pinned.current;
    if (!on || !run) return;
    halted.current = false;
    let raf = 0, stop = false, last = 0;
    let an: AnalyserNode | null = null;
    let buf: Float32Array | null = null;
    (async () => {
      try {
        if (!mic.current) {
          const opened = await openFor(deviceOf(run.setup));
          if (stop) { opened.close(); return; }
          mic.current = opened;
        }
        if (run.mic.mode === 'catalog') {
          await micCatalog.bindRoute(rtaScope, run.setup, mic.current.route);
          announceCatalogChange();
          if (stop) return;
        }
        an = mic.current.analyser(32768);
        buf = new Float32Array(an.frequencyBinCount);
        const fs = mic.current.sampleRate;
        const loop = (t: number) => {
          if (stop || halted.current) return;
          if (t - last > 200 && an && buf) {
            last = t;
            an.getFloatFrequencyData(buf as Float32Array<ArrayBuffer>);
            const bin = fs / an.fftSize;
            const db = freqs.map((f) => {
              const k = f / bin, k0 = Math.floor(k), tt = k - k0;
              const a = Number.isFinite(buf![k0]) ? buf![k0] : -140;
              const b = Number.isFinite(buf![k0 + 1]) ? buf![k0 + 1] : a;
              return a * (1 - tt) + b * tt;
            });
            const live: AppliedMic = run.mic.mode === 'legacy' ? { mode: 'legacy', legacy: legacyRef.current } : run.mic;
            setCurve(afterSmoothing(live, freqs, smoothOct(freqs, beforeSmoothing(live, freqs, db), 1 / 12)));
            setCurveMic((m) => m?.label === micLabel(live) ? m : { label: micLabel(live), legacy: live.mode === 'legacy' });
          }
          raf = requestAnimationFrame(loop);
        };
        raf = requestAnimationFrame(loop);
      } catch (e) {
        if (fromCatalog(e)) interrupted();
        setMsg(fromCatalog(e) ? (e as Error).message : S.measure.micError((e as Error).message));
        setOn(false);
      }
    })();
    return () => {
      stop = true;
      cancelAnimationFrame(raf);
      an?.disconnect();
      // выключили анализатор — отпускаем микрофон (на iPhone гаснет индикатор и звук возвращается в обычный режим)
      mic.current?.close();
      mic.current = null;
    };
  }, [on, freqs, rtaScope, interrupted]);
  useEffect(() => () => mic.current?.close(), []);
  // прогноз модели в точке, где стоит телефон
  const probeSetup = useMemo(() => (here ? { ...current, listener: { x: here.x, y: here.y, z: c.earHeight } } : null), [here, current, c.earHeight]);
  const { ev } = useSetupEval(room, sources, c, probeSetup, evalPpo(project.precision));
  const lines = [];
  for (const s of snaps) lines.push({ f: freqs, db: s.db, cls: 'is-take' });
  if (curve) lines.push({ f: freqs, db: curve, cls: 'is-room' });
  if (ev && curve) {
    // прогноз выравниваем по среднему уровню замера в 30–150 Гц
    const pred = freqs.map((f) => {
      const i = ev.response.f.findIndex((x) => x >= f);
      return i < 0 ? NaN : ev.response.db[i];
    });
    const idx = freqs.map((f, i) => (f >= 30 && f <= 150 && Number.isFinite(pred[i]) ? i : -1)).filter((i) => i >= 0);
    const off = idx.reduce((a, i) => a + curve[i] - pred[i], 0) / Math.max(1, idx.length);
    lines.push({ f: freqs.filter((_, i) => Number.isFinite(pred[i])), db: pred.filter((v) => Number.isFinite(v)).map((v) => v + off), cls: 'is-probe', dash: true });
  }
  const atTone = curve && tone.playing ? curve[freqs.findIndex((f) => f >= tone.f)] : null;
  const items: PlanItem[] = [
    ...sources.filter((s) => current.positions[s.id]).map((s) => ({ id: s.id, kind: (s.kind === 'sub' ? 'sub' : 'spk') as PlanItem['kind'], pos: current.positions[s.id] })),
    { id: 'listener', kind: 'listener', pos: current.listener },
  ];
  const toggle = () => {
    const setup = micSel.state.setup;
    if (!on) {
      if (!setup) return;
      setMsg(null);
      pinned.current = { setup, mic: appliedMic(setup, legacy) };
    }
    setOn(!on);
  };
  const shown = [...snaps.map((s) => s.mic), ...(curve ? [curveMic] : [])].filter((m): m is { label: string; legacy: boolean } => !!m);
  const mixed = shown.some((m) => !m.legacy) && new Set(shown.map((m) => m.label)).size > 1;
  return (<>
    <MicCalibrationPanel scope={micSel.scope} busy={on} changed={micSel.changed} routeEpoch={micSel.epoch} legacy={legacy} />
    <Panel title={S.measure.rtaTitle}>
      <p class="small">{S.measure.rtaIntro} <Term id="crawl">{S.measure.crawl}</Term>.</p>
      <ActionBar label="Живой анализатор"><div class="btn-row">
        <button type="button" class={`btn btn--primary${on ? ' is-rec' : ''}`} disabled={!on && !micSel.state.setup} onClick={toggle}>{on ? S.measure.rtaStop : S.measure.rtaStart}</button>
        {curve && <button type="button" class="btn btn--ghost" onClick={() => setSnaps((s) => [...s.slice(-3), { name: S.measure.point(s.length + 1), db: curve, mic: curveMic }])}>{S.measure.remember}</button>}
        {snaps.length > 0 && <button type="button" class="btn btn--ghost" onClick={() => setSnaps([])}>{S.measure.clear}</button>}
      </div>
      {!on && <MicStartHint block={micSel.state.block} />}</ActionBar>
      {msg && <Note tone="warn">{msg}</Note>}
      {atTone != null && <p class="rta-big"><strong>{fmt(atTone, 1)}</strong> дБ <span class="muted small">{S.measure.atTone(fmt(tone.f, 1))}</span></p>}
      {(curve || snaps.length > 0) && <ResponseChart fLo={15} fHi={250} lines={lines} />}
      {(curve || snaps.length > 0) && <p class="muted small">{S.measure.rtaLegend(snaps.length)}{ev ? ` ${S.measure.predLegend}` : ''}</p>}
      {curve && mixed && <Note>{S.mic.rtaMixed([...new Set(shown.map((m) => m.label))].join('; '))}</Note>}
      <h3 class="subhead">{S.measure.whereTitle}</h3>
      <p class="muted small">{S.measure.whereHint}</p>
      <PlanView depth={room.depth} width={room.width} items={items} zones={room.zones} extensions={room.extensions} openings={room.openings} features={room.features} treatments={shownTreatments(room)} slope={room.slope} marks={here ? [{ x: here.x, y: here.y, label: '', kind: 'probe' }] : []} onTap={setHere} showKey={false} />
    </Panel>
  </>);
}
