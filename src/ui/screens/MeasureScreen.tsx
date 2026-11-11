// «Замер»: свип (АЧХ в нескольких точках → замер проекта), хлопок (RT60 по октавам), живой анализатор баса.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { shownTreatments } from '../../core/treatments';
import type { Project } from '../../state/project';
import type { Measurement, Room, Setup } from '../../core/types';
import { analyzeSweep, averageRT, calAt, clapRT60, logGrid, logSweep, parseCalibration, powerAverage, RT_BANDS, smoothOct, sweepSegment, wav16, type BandRT, type SweepResult } from '../../core/dsp';
import { setBusy } from '../updates';
import { computeReverb } from '../../core/reverb';
import { openMic, playBuffer, shareFile, type Mic } from '../audio/mic';
import { getTone, onTone } from '../audio/tone';
import { useSetupEval } from '../useEval';
import { ResponseChart } from '../components/Charts';
import { PlanView, type PlanItem } from '../components/PlanView';
import { Note, Panel } from '../design-system';
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

interface Props { project: Project; onSetup: (s: Setup) => void; onRoom: (r: Room) => void; onGo: (t: Destination) => void; view: MeasureView; active: boolean }

const F1 = 10, F2 = 1000, T = 6;
const CAL_KEY = 'ra-mic-cal';

function loadCal(): { name: string; f: number[]; db: number[] } | null {
  try { return JSON.parse(localStorage.getItem(CAL_KEY) ?? 'null'); } catch { return null; }
}

export function MeasureScreen({ project, onSetup, onRoom, onGo, view, active }: Props) {
  const [cal, setCal] = useState(loadCal());
  const [err, setErr] = useState<string | null>(null);
  const calInput = useRef<HTMLInputElement>(null);
  const applyCal = (f: number[], db: number[]) => (cal ? db.map((v, i) => v - calAt(cal, f[i])) : db);

  return (
    <div class="screen">
      <SectionNav label="Раздел измерений" value={view} onChange={(v) => onGo(`measure/${v}`)} options={[
        { value: 'sweep', label: 'Свип', hint: 'АЧХ в точках комнаты' },
        { value: 'clap', label: 'Хлопок', hint: 'Время реверберации' },
        { value: 'rta', label: 'Анализатор', hint: 'Спектр в реальном времени' },
        { value: 'compare', label: 'Сравнение и REW', hint: 'Импорт, история, модель' },
      ]} />
      <div hidden={view === 'compare'}>
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
      <RetainedSection active={view === 'sweep'}><SweepTool project={project} onSetup={onSetup} onGo={onGo} applyCal={applyCal} active={active && view === 'sweep'} /></RetainedSection>
      <RetainedSection active={view === 'clap'}><ClapTool project={project} active={active && view === 'clap'} /></RetainedSection>
      <RetainedSection active={view === 'rta'}><RtaTool project={project} applyCal={applyCal} active={active && view === 'rta'} /></RetainedSection>
      <RetainedSection active={view === 'compare'}>
        <MeasurePanel project={project} onSetup={onSetup} onRoom={onRoom} />
        <div class="btn-row"><button type="button" class="btn" onClick={() => onGo('tuning/eq')}>Открыть эквалайзер</button></div>
      </RetainedSection>
    </div>
  );
}

// ---------- Свип ----------

function SweepTool({ project, onSetup, onGo, applyCal, active }: { project: Project; onSetup: (s: Setup) => void; onGo: (t: Destination) => void; applyCal: (f: number[], db: number[]) => number[]; active: boolean }) {
  const activeView = useActiveView(active);
  const [playHere, setPlayHere] = useState(false);
  const [takes, setTakes] = useState<SweepResult[]>([]);
  // сеанс записи: повторное сохранение с добавленными точками уточняет замер; все точки убрали — новый сеанс
  const session = useRef(makeId());
  useEffect(() => { if (!takes.length) session.current = makeId(); }, [takes.length]);
  const [state, setState] = useState<'idle' | 'rec' | 'busy'>('idle');
  const [msg, setMsg] = useState<{ t: string; tone: 'warn' | 'good' } | null>(null);
  const mic = useRef<Mic | null>(null);
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
    if (!m) return;
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const rec = m.stop();
    setState('busy');
    setTimeout(() => {
      try {
        const sweep = logSweep(F1, F2, T, m.sampleRate);
        if (rec.length < sweep.length) throw new Error(S.measure.tooShort);
        const seg = sweepSegment(rec, sweep.length, m.sampleRate);
        if (!seg) throw new Error(S.measure.cutOff);
        const r = analyzeSweep(seg, sweep, F1, F2, m.sampleRate);
        const warn = r.peak > 0.98 ? S.measure.clip : r.peak < 0.01 ? S.measure.quiet : r.snrDb < 20 ? S.measure.noisy(Math.round(r.snrDb)) : null;
        setTakes((t) => [...t, { ...r, db: applyCal(r.f, r.db) }]);
        setMsg(warn ? { t: warn, tone: 'warn' } : { t: S.measure.takeOk(Math.round(r.snrDb)), tone: 'good' });
      } catch (e) {
        setMsg({ t: (e as Error).message, tone: 'warn' });
      }
      setState('idle');
    }, 30);
  };

  const record = async () => {
    setMsg(null);
    try {
      if (!mic.current) {
        const opened = await openMic();
        if (!activeView.current) { opened.close(); return; }
        mic.current = opened;
      }
      const m = mic.current;
      if (!m.running()) { setMsg({ t: S.measure.tapAgain, tone: 'warn' }); return; }
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
      setMsg({ t: S.measure.micError((e as Error).message), tone: 'warn' });
    }
  };

  const [savedN, setSavedN] = useState(0);
  // пока есть несохранённые точки, приложение не перезапускается на новую версию
  useEffect(() => { setBusy('takes', takes.length > 0 && takes.length !== savedN); return () => setBusy('takes', false); }, [takes.length, savedN]);
  const avg = takes.length ? powerAverage(takes.map((t) => t.db)) : null;
  const save = () => {
    if (!avg) return;
    setSavedN(takes.length);
    const f = takes[0].f;
    const m: Measurement = { name: S.measure.measName(takes.length), importedAt: new Date().toISOString(), f, db: avg, points: takes.length, session: session.current };
    onSetup(withMeasurement(project.current, m));
    setMsg({ t: S.measure.saved, tone: 'good' });
  };
  return (
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
      <div class="btn-row">
        {state !== 'rec' ? (
          <button type="button" class="btn btn--primary" disabled={state === 'busy'} onClick={record}>
            {state === 'busy' ? S.measure.analyzing : S.measure.recordPoint(takes.length + 1)}
          </button>
        ) : (
          <button type="button" class="btn btn--primary is-rec" onClick={finish} disabled={playHere}>
            <span class="rec-dot" aria-hidden="true" /> {playHere ? S.measure.playing : S.measure.stop}
          </button>
        )}
      </div>
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
          <div class="btn-row">
            <button type="button" class="btn btn--primary" onClick={save}>{S.measure.save}</button>
            <button type="button" class="btn btn--ghost" onClick={() => setTakes((t) => t.slice(0, -1))}>{S.measure.undo}</button>
            <button type="button" class="btn btn--ghost" onClick={() => onGo('measure/compare')}>Сравнить с моделью</button>
            <button type="button" class="btn btn--ghost" onClick={() => onGo('tuning/eq')}>{S.measure.toTuning}</button>
          </div>
        </>
      )}
      <MeasureCompare setup={project.current} onSetup={onSetup} />
    </Panel>
  );
}

// ---------- Хлопок ----------

function ClapTool({ project, active }: { project: Project; active: boolean }) {
  const activeView = useActiveView(active);
  const [state, setState] = useState<'idle' | 'rec' | 'busy'>('idle');
  const [res, setRes] = useState<BandRT[][]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const mic = useRef<Mic | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!active) { mic.current?.close(); mic.current = null; if (timer.current) clearTimeout(timer.current); setState('idle'); }
    return () => { mic.current?.close(); if (timer.current) clearTimeout(timer.current); };
  }, [active]);
  const rev = useMemo(() => computeReverb(project.room), [project.room]);
  const go = async () => {
    setMsg(null);
    try {
      if (!mic.current) {
        const opened = await openMic();
        if (!activeView.current) { opened.close(); return; }
        mic.current = opened;
      }
      const m = mic.current;
      if (!m.running()) { setMsg(S.measure.tapAgain); return; }
      m.start();
      setState('rec');
      timer.current = setTimeout(() => {
        const x = m.stop();
        setState('busy');
        timer.current = setTimeout(() => {
          let pk = 0;
          for (let i = 0; i < x.length; i++) pk = Math.max(pk, Math.abs(x[i]));
          if (pk < 0.05) { setMsg(S.measure.noClap); setState('idle'); return; }
          setRes((r) => [...r, clapRT60(x, m.sampleRate)]);
          setState('idle');
        }, 30);
      }, 3500);
    } catch (e) {
      setState('idle');
      setMsg(S.measure.micError((e as Error).message));
    }
  };
  const avgRT = averageRT(res);
  const avg = avgRT.map((r) => r.t60);
  const anyApprox = avgRT.some((r) => r.t60 != null && r.approx);
  const model = (band: number) => rev.used[rev.bands.indexOf(band)] ?? null;
  const midM = [avg[2], avg[3]].filter((x): x is number => x != null);
  const mid = midM.length ? midM.reduce((a, b) => a + b, 0) / midM.length : null;
  return (
    <Panel title={S.measure.clapTitle}>
      <p class="small">{S.measure.clapIntro} <Term id="rt60">RT60</Term>.</p>
      <button type="button" class="btn btn--primary" disabled={state !== 'idle'} onClick={go}>
        {state === 'rec' ? S.measure.clapNow : state === 'busy' ? S.measure.analyzing : S.measure.clapStart}
      </button>
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
    </Panel>
  );
}

// ---------- Анализатор ----------

function RtaTool({ project, applyCal, active }: { project: Project; applyCal: (f: number[], db: number[]) => number[]; active: boolean }) {
  const { room, sources, constraints: c, current } = project;
  const [on, setOn] = useState(false);
  useEffect(() => { if (!active) setOn(false); }, [active]);
  const [curve, setCurve] = useState<number[] | null>(null);
  const [snaps, setSnaps] = useState<{ name: string; db: number[] }[]>([]);
  const [here, setHere] = useState<{ x: number; y: number } | null>(null);
  const [tone, setTone] = useState(getTone());
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => onTone(setTone), []);
  const mic = useRef<Mic | null>(null);
  const freqs = useMemo(() => logGrid(15, 250, 24), []);
  // калибровку микрофона могут загрузить, пока анализатор работает: цикл берёт актуальную
  const calRef = useRef(applyCal);
  useEffect(() => { calRef.current = applyCal; });
  useEffect(() => {
    if (!on) return;
    let raf = 0, stop = false, last = 0;
    let an: AnalyserNode | null = null;
    let buf: Float32Array | null = null;
    (async () => {
      try {
        if (!mic.current) {
          const opened = await openMic();
          if (stop) { opened.close(); return; }
          mic.current = opened;
        }
        an = mic.current.analyser(32768);
        buf = new Float32Array(an.frequencyBinCount);
        const fs = mic.current.sampleRate;
        const loop = (t: number) => {
          if (stop) return;
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
            setCurve(calRef.current(freqs, smoothOct(freqs, db, 1 / 12)));
          }
          raf = requestAnimationFrame(loop);
        };
        raf = requestAnimationFrame(loop);
      } catch (e) {
        setMsg(S.measure.micError((e as Error).message));
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
  }, [on, freqs]);
  useEffect(() => () => mic.current?.close(), []);
  // прогноз модели в точке, где стоит телефон
  const probeSetup = useMemo(() => (here ? { ...current, listener: { x: here.x, y: here.y, z: c.earHeight } } : null), [here, current, c.earHeight]);
  const { ev } = useSetupEval(room, sources, c, probeSetup);
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
  return (
    <Panel title={S.measure.rtaTitle}>
      <p class="small">{S.measure.rtaIntro} <Term id="crawl">{S.measure.crawl}</Term>.</p>
      <div class="btn-row">
        <button type="button" class={`btn btn--primary${on ? ' is-rec' : ''}`} onClick={() => setOn(!on)}>{on ? S.measure.rtaStop : S.measure.rtaStart}</button>
        {curve && <button type="button" class="btn btn--ghost" onClick={() => setSnaps((s) => [...s.slice(-3), { name: S.measure.point(s.length + 1), db: curve }])}>{S.measure.remember}</button>}
        {snaps.length > 0 && <button type="button" class="btn btn--ghost" onClick={() => setSnaps([])}>{S.measure.clear}</button>}
      </div>
      {msg && <Note tone="warn">{msg}</Note>}
      {atTone != null && <p class="rta-big"><strong>{fmt(atTone, 1)}</strong> дБ <span class="muted small">{S.measure.atTone(fmt(tone.f, 1))}</span></p>}
      {curve && <ResponseChart fLo={15} fHi={250} lines={lines} />}
      {curve && <p class="muted small">{S.measure.rtaLegend(snaps.length)}{ev ? ` ${S.measure.predLegend}` : ''}</p>}
      <h3 class="subhead">{S.measure.whereTitle}</h3>
      <p class="muted small">{S.measure.whereHint}</p>
      <PlanView depth={room.depth} width={room.width} items={items} zones={room.zones} extensions={room.extensions} openings={room.openings} features={room.features} treatments={shownTreatments(room)} slope={room.slope} marks={here ? [{ x: here.x, y: here.y, label: '', kind: 'probe' }] : []} onTap={setHere} showKey={false} />
    </Panel>
  );
}
