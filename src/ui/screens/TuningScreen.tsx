import { useMemo, useRef, useState } from 'preact/hooks';
import type { Project } from '../../state/project';
import type { Leakage, Mode, Room, Setup, SubSetting, Treatment } from '../../core/types';
import { makeId } from '../../state/project';
import { computeReverb } from '../../core/reverb';
import { modeDecays, type ModeDecay } from '../../core/overview';
import { THICKNESSES, suggestTreatments } from '../../core/treatments';
import { evaluateSetup, type SetupEval } from '../../core/system';
import { isWave } from '../../core/geometry';
import { useSetupEval } from '../useEval';
import { useEffect } from 'preact/hooks';
import { hasAdjustments, optionsFor, type IntegrationResult } from '../../core/integration';
import { biquad, designEq, exportEqualizerAPO, exportMiniDSP, exportREW, type EqResult } from '../../core/eq';
import { allpassBiquad, type SubFilterResult } from '../../core/subfilters';
import { bassAdvice, porousLowLimit, reflectionPoints } from '../../core/treatment';
import { compareMeasurement, measurementAt, parseRew, type CalibrationResult, type Comparison } from '../../core/measure';
import { speedOfSound } from '../../core/physics';
import { compute } from '../compute';
import { PlanView, type PlanMark, type WallMark } from '../components/PlanView';
import { ResponseChart } from '../components/Charts';
import { NumberField, Panel, Segmented, Note, Details, SelectField } from '../components/Fields';
import { S } from '../strings';
import { Term } from '../components/Term';
import { Auralize } from '../components/Auralize';
import { shareFile } from '../audio/mic';
import { firLinearPhase, firMinPhase, wavFloat32 } from '../../core/dsp';
import { fmt } from '../format';

interface Props {
  project: Project;
  modes: Mode[];
  onSetup: (s: Setup) => void;
  onRoom: (r: Room) => void;
}

export function TuningScreen({ project, modes, onSetup, onRoom }: Props) {
  const { room, sources, constraints: c, current } = project;
  const { ev } = useSetupEval(room, sources, c, current);
  const subs = sources.filter((s) => s.kind === 'sub' && current.positions[s.id]);
  return (
    <div class="screen">
      <Panel title={S.tuning.setup}>
        <PlanView depth={room.depth} width={room.width} items={itemsOf(project)} seats={ev?.seats ?? []} zones={room.zones} extensions={room.extensions} openings={room.openings} features={room.features} treatments={room.treatments} slope={room.slope} showDims={false} />
        <div class="score">
          <div class="score__main">
            <span class="score__value">{ev ? fmt(ev.score, 1) : '…'}</span>
            <span class="score__unit">дБ</span>
          </div>
          <div class="score__text">
            <span class="score__label">{S.placement.score}</span>
            <span class="muted small">{S.tuning.setupHint}</span>
            <span class="model-tag">{isWave(room) ? S.model.waveTag : S.model.modalTag}</span>
          </div>
        </div>
      </Panel>
      {subs.length ? <SubPanel project={project} onSetup={onSetup} /> : <Panel title={S.tuning.subTitle}><p class="muted small">{S.tuning.noSub}</p></Panel>}
      <EqPanel project={project} />
      <MeasurePanel project={project} onRoom={onRoom} onSetup={onSetup} />
      <TreatmentPanel project={project} modes={modes} onRoom={onRoom} />
    </div>
  );
}

function itemsOf(p: Project) {
  return [
    ...p.sources.filter((s) => p.current.positions[s.id]).map((s) => ({
      id: s.id, kind: (s.kind === 'sub' ? 'sub' : 'spk') as 'sub' | 'spk', pos: p.current.positions[s.id],
    })),
    { id: 'listener', kind: 'listener' as const, pos: p.current.listener },
  ];
}

// ---------- Сабвуфер ----------

function SubPanel({ project, onSetup }: { project: Project; onSetup: (s: Setup) => void }) {
  const { room, sources, constraints: c, current } = project;
  const subs = sources.filter((s) => s.kind === 'sub' && current.positions[s.id]);
  const [res, setRes] = useState<IntegrationResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState(false);

  const run = () => {
    setBusy(true);
    setError(null);
    setApplied(false);
    compute<IntegrationResult>('integrate', { room, sources, constraints: c, setup: current }).promise
      .then((r) => { setRes(r); setBusy(false); })
      .catch((e) => { setError(e.message); setBusy(false); });
  };
  const setOne = (id: string, patch: Partial<SubSetting>) => {
    const prev = current.subSettings[id] ?? { delayMs: 0, phaseDeg: 0, gainDb: 0 };
    onSetup({ ...current, subSettings: { ...current.subSettings, [id]: { ...prev, ...patch } } });
    setApplied(false);
  };
  const xoAdj = c.crossover.adjustable && sources.some((s) => s.kind === 'speaker');
  const [filtersReset, setFiltersReset] = useState(false);

  return (
    <Panel title={S.tuning.subTitle}>
      <p class="small">{S.tuning.subIntro}</p>
      {!hasAdjustments(sources, c) && <Note tone="warn">{S.sub.caps}: нет ни задержки, ни фазы, ни уровня. Укажите регулировки в «Расстановка → Система».</Note>}
      <button type="button" class="btn btn--primary" onClick={run} disabled={busy}>{busy ? S.tuning.running : S.tuning.run}</button>
      {error && <Note tone="warn">{error}</Note>}
      {res && (
        <div class="tuning-result">
          <div class="stat-row">
            <div class="stat"><span class="stat__value">{fmt(res.before, 1)} <small>дБ</small></span><span class="stat__label">{S.tuning.before}</span></div>
            <div class="stat"><span class="stat__value">{fmt(res.after, 1)} <small>дБ</small></span><span class="stat__label">{S.tuning.after}</span></div>
          </div>
          <table class="pos-table">
            <thead><tr><th /><th>{S.tuning.delay}</th><th>{S.tuning.phase}</th><th>{S.tuning.gain}</th></tr></thead>
            <tbody>
              {subs.map((s) => {
                const v = res.settings[s.id];
                return (
                  <tr>
                    <th scope="row">{S.placement.sourceName(s.id)}</th>
                    <td class="num">{s.delayMode === 'adjustable' ? `${fmt(v.delayMs, 1)} мс` : '—'}</td>
                    <td class="num">{s.phaseMode && s.phaseMode !== 'none' ? `${fmt(v.phaseDeg, 0)}°` : '—'}</td>
                    <td class="num">{s.levelAdjustable ? `${v.gainDb > 0 ? '+' : ''}${fmt(v.gainDb, 1)} дБ` : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {xoAdj && res.crossoverHz && <p class="small"><strong>{S.tuning.xo}:</strong> {fmt(res.crossoverHz, 0)} Гц</p>}
          <ResponseChart
            fLo={res.responseAfter.f[0]}
            fHi={res.responseAfter.f[res.responseAfter.f.length - 1]}
            lines={[
              { f: res.responseAfter.f, db: res.responseAfter.target, cls: 'is-target', dash: true },
              { f: res.responseBefore.f, db: res.responseBefore.db, cls: 'is-baseline' },
              { f: res.responseAfter.f, db: res.responseAfter.db, cls: 'is-room' },
            ]}
          />
          <div class="legend">
            <span class="legend__item legend__item--room">{S.tuning.after}</span>
            <span class="legend__item legend__item--baseline">{S.tuning.before}</span>
          </div>
          {res.notes.map((n) => <Note>{n}</Note>)}
          <button
            type="button"
            class="btn"
            disabled={applied}
            onClick={() => {
              const hadFilters = Object.values(current.subSettings).some((v) => (v.peq?.length ?? 0) + (v.allpass?.length ?? 0) > 0);
              onSetup({ ...current, subSettings: res.settings, crossoverHz: res.crossoverHz });
              setApplied(true);
              setFiltersReset(hadFilters);
            }}
          >
            {applied ? S.tuning.applied : S.tuning.apply}
          </button>
          {applied && filtersReset && <Note tone="warn">{S.subf.resetNote}</Note>}
        </div>
      )}
      <Details summary={S.tuning.manualSettings}>
        {subs.map((s) => {
          const v = current.subSettings[s.id] ?? { delayMs: 0, phaseDeg: 0, gainDb: 0 };
          const o = optionsFor(s);
          return (
            <div class="sub-settings">
              <span class="range-row__label">{S.placement.sourceName(s.id)}</span>
              <div class="grid-3">
                {o.delays.length > 1 && <NumberField compact id={`${s.id}-d`} label={S.tuning.delay} unit="мс" value={v.delayMs} min={0} max={s.maxDelayMs ?? 20} digits={1} onChange={(x) => setOne(s.id, { delayMs: x })} />}
                {s.phaseMode === 'polarity' && (
                  <Segmented label={S.tuning.phase} value={v.phaseDeg >= 90 ? 180 : 0} options={[{ value: 0, label: '0°' }, { value: 180, label: '180°' }]} onChange={(x) => setOne(s.id, { phaseDeg: x })} />
                )}
                {(s.phaseMode === 'continuous' || s.phaseMode === 'full') && (
                  <NumberField compact id={`${s.id}-p`} label={S.tuning.phase} unit="°" value={v.phaseDeg} min={0} max={s.phaseMode === 'full' ? 359 : 180} digits={0} onChange={(x) => setOne(s.id, { phaseDeg: x })} />
                )}
                {s.levelAdjustable && <NumberField compact id={`${s.id}-g`} label={S.tuning.gain} unit="дБ" value={v.gainDb} min={-6} max={6} digits={1} onChange={(x) => setOne(s.id, { gainDb: x })} />}
              </div>
            </div>
          );
        })}
        {xoAdj && (
          <NumberField id="xo" label={S.tuning.xo} unit="Гц" value={current.crossoverHz ?? Math.max(...sources.filter((s) => s.kind === 'sub').map((s) => s.fHigh))} min={c.crossover.min} max={c.crossover.max} digits={0} onChange={(x) => onSetup({ ...current, crossoverHz: x })} />
        )}
      </Details>
      <Details summary={S.subf.title}>
        <SubFiltersBlock project={project} onSetup={onSetup} />
      </Details>
    </Panel>
  );
}

// ---------- Эквалайзер ----------

function EqPanel({ project }: { project: Project }) {
  const { room, sources, constraints: c, current } = project;
  const m = current.measurement;
  const [source, setSource] = useState<'model' | 'measured'>('model');
  const [res, setRes] = useState<{ eq: EqResult; f: number[]; before: number[]; target: number[] } | null>(null);
  const [fs, setFs] = useState<48000 | 96000>(96000);

  const [eqBusy, setEqBusy] = useState(false);
  const run = () => {
    if (isWave(room)) {
      setEqBusy(true);
      compute<SetupEval>('evaluate', { room, sources, constraints: c, setup: current, ppo: 48 }).promise
        .then((e) => { setEqBusy(false); finish(e); })
        .catch(() => setEqBusy(false));
    } else finish(evaluateSetup(room, sources, c, current, { ppo: 48 }));
  };
  const finish = (e: SetupEval) => {
    let f = e.response.f;
    let db = e.response.db;
    let target = e.response.target;
    if (source === 'measured' && m) {
      const meas = measurementAt(m, f);
      const idx = meas.map((v, i) => (v == null ? -1 : i)).filter((i) => i >= 0);
      f = idx.map((i) => e.response.f[i]);
      target = idx.map((i) => e.response.target[i]);
      const raw = idx.map((i) => meas[i] as number);
      const mean = raw.reduce((a, b) => a + b, 0) / raw.length - target.reduce((a, b) => a + b, 0) / target.length;
      db = raw.map((v) => v - mean);
    }
    setRes({ eq: designEq(f, db, target), f, before: db, target });
  };

  return (
    <Panel title={S.tuning.eqTitle}>
      <p class="small">{S.tuning.eqIntro}</p>
      {m && (
        <Segmented label={S.tuning.eqSource} value={source} options={[{ value: 'model', label: S.tuning.eqModel }, { value: 'measured', label: S.tuning.eqMeasured }]} onChange={(v) => { setSource(v); setRes(null); }} />
      )}
      <button type="button" class="btn btn--primary" onClick={run} disabled={eqBusy}>{eqBusy ? S.model.computing : S.tuning.eqRun}</button>
      {res && res.eq.filters.length === 0 && <Note tone="good">{S.tuning.eqNone}</Note>}
      {res && res.eq.filters.length > 0 && (
        <>
          <p class="small"><strong>{S.tuning.eqImprove(fmt(res.eq.stdBefore, 1), fmt(res.eq.stdAfter, 1))}</strong></p>
          <table class="pos-table">
            <thead><tr><th>№</th><th>{S.tuning.eqColF}</th><th>{S.tuning.eqColG}</th><th>{S.tuning.eqColQ}</th></tr></thead>
            <tbody>
              {res.eq.filters.map((p, i) => (
                <tr><th scope="row">{i + 1}</th><td class="num">{fmt(p.f, 1)} Гц</td><td class="num">{fmt(p.gainDb, 1)} дБ</td><td class="num">{fmt(p.q, 2)}</td></tr>
              ))}
            </tbody>
          </table>
          <ResponseChart
            fLo={res.f[0]}
            fHi={res.f[res.f.length - 1]}
            lines={[
              { f: res.f, db: res.target, cls: 'is-target', dash: true },
              { f: res.f, db: res.before, cls: 'is-baseline' },
              { f: res.f, db: res.eq.after, cls: 'is-room' },
            ]}
          />
          <div class="legend">
            <span class="legend__item legend__item--room">{S.tuning.legendAfter}</span>
            <span class="legend__item legend__item--baseline">{S.tuning.legendBefore}</span>
          </div>
          <Note>{S.tuning.eqWhere}</Note>
          <h3 class="subhead">{S.tuning.eqExport}</h3>
          <ExportBlock id="eq-apo" title="Equalizer APO" text={exportEqualizerAPO(res.eq.filters)} file="eq-equalizer-apo.txt" />
          <ExportBlock id="eq-rew" title="REW" text={exportREW(res.eq.filters)} file="eq-rew.txt" />
          <Segmented label="miniDSP, частота дискретизации" value={fs} options={[{ value: 48000, label: '48 кГц' }, { value: 96000, label: '96 кГц' }]} onChange={setFs} />
          <ExportBlock id="eq-minidsp" title={`miniDSP biquad, ${fs / 1000} кГц`} text={exportMiniDSP(res.eq.filters, fs)} file={`eq-minidsp-${fs / 1000}k.txt`} />
          <h4 class="subhead">{S.fir.title}</h4>
          <p class="muted small">{S.fir.intro} <Term id="fir">FIR</Term>.</p>
          <div class="btn-row">
            <button type="button" class="btn btn--small" onClick={() => shareFile(wavFloat32([firMinPhase(res.eq.filters, fs)], fs), `eq-fir-minphase-${fs / 1000}k.wav`, 'audio/wav')}>{S.fir.min(fs / 1000)}</button>
            <button type="button" class="btn btn--small" onClick={() => shareFile(wavFloat32([firLinearPhase(res.eq.filters, fs)], fs), `eq-fir-linphase-${fs / 1000}k.wav`, 'audio/wav')}>{S.fir.lin(fs / 1000)}</button>
          </div>
          <p class="muted small">{S.fir.note(fs / 1000)}</p>
          <Details summary={S.aural.title}>
            <Auralize response={{ f: res.f, db: res.before, target: res.target }} filters={res.eq.filters} />
          </Details>
        </>
      )}
      {res && res.eq.dips.length > 0 && (
        <>
          <h3 class="subhead">{S.tuning.eqDips}</h3>
          <ul class="plain-list small">{res.eq.dips.map((d) => <li>{fmt(d.f, 0)} Гц: {fmt(d.depth, 1)} дБ</li>)}</ul>
        </>
      )}
    </Panel>
  );
}

function ExportBlock({ id, title, text, file }: { id: string; title: string; text: string; file: string }) {
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const copy = () => {
    const done = () => { setCopied(true); setTimeout(() => setCopied(false), 1500); };
    try {
      navigator.clipboard.writeText(text).then(done, () => { ref.current?.select(); });
    } catch {
      ref.current?.select();
    }
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = file;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };
  return (
    <div class="export">
      <label for={id} class="export__title">{title}</label>
      <textarea id={id} ref={ref} readOnly rows={Math.min(8, text.split('\n').length)} value={text} />
      <div class="btn-row btn-row--tight">
        <button type="button" class="btn btn--small" onClick={copy}>{copied ? S.tuning.copied : S.tuning.copy}</button>
        <button type="button" class="btn btn--small btn--ghost" onClick={download}>{S.tuning.download}</button>
      </div>
    </div>
  );
}

// ---------- Замер REW ----------

function MeasurePanel({ project, onRoom, onSetup }: { project: Project; onRoom: (r: Room) => void; onSetup: (s: Setup) => void }) {
  const { room, sources, constraints: c, current } = project;
  const m = current.measurement;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cal, setCal] = useState<CalibrationResult | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const wave = isWave(room);
  const cmpSync = useMemo(() => {
    if (!m || wave) return null;
    try { return compareMeasurement(room, sources, c, current, m); } catch (e) { return { error: (e as Error).message }; }
  }, [m, room, sources, c, current, wave]);
  const [cmpAsync, setCmpAsync] = useState<Comparison | { error: string } | null>(null);
  useEffect(() => {
    if (!m || !wave) { setCmpAsync(null); return; }
    const j = compute<Comparison>('compare', { room, sources, constraints: c, setup: current, measurement: m });
    j.promise.then(setCmpAsync).catch((e) => setCmpAsync({ error: e.message }));
    return () => j.cancel();
  }, [m, room, sources, c, current, wave]);
  const cmp = wave ? cmpAsync : cmpSync;

  const load = async (f: File) => {
    setError(null);
    setCal(null);
    try {
      onSetup({ ...current, measurement: parseRew(await f.text(), f.name) });
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const runCal = () => {
    if (!m) return;
    setBusy(true);
    compute<CalibrationResult>('calibrate', { room, sources, constraints: c, setup: current, measurement: m }).promise
      .then((r) => { setCal(r); setBusy(false); onRoom({ ...room, leakage: r.leakage, calibration: { dampingScale: r.dampingScale } }); })
      .catch((e) => { setError(e.message); setBusy(false); });
  };

  return (
    <Panel title={S.tuning.measureTitle}>
      <p class="small">{S.tuning.measureIntro}</p>
      <input
        ref={input}
        id="rew-file"
        type="file"
        accept=".txt,.csv,text/plain"
        class="visually-hidden"
        onChange={(e) => {
          const f = (e.target as HTMLInputElement).files?.[0];
          if (f) load(f);
          (e.target as HTMLInputElement).value = '';
        }}
      />
      <div class="btn-row">
        <button type="button" class="btn" onClick={() => input.current?.click()}>{S.tuning.measureLoad}</button>
        {m && <button type="button" class="btn btn--ghost" onClick={() => { onSetup({ ...current, measurement: null }); setCal(null); }}>{S.tuning.measureRemove}</button>}
      </div>
      {error && <Note tone="warn">{error}</Note>}
      {m && cmp && 'error' in cmp && <Note tone="warn">{cmp.error}</Note>}
      {m && cmp && !('error' in cmp) && (
        <>
          <p class="muted small">{m.name}</p>
          <ResponseChart
            fLo={cmp.f[0]}
            fHi={cmp.f[cmp.f.length - 1]}
            lines={[
              { f: cmp.f, db: cmp.model, cls: 'is-baseline' },
              { f: cmp.f, db: cmp.measured, cls: 'is-measured' },
            ]}
          />
          <div class="legend">
            <span class="legend__item legend__item--measured">{S.tuning.legendMeasured}</span>
            <span class="legend__item legend__item--baseline">{S.tuning.legendModel}</span>
          </div>
          <p class="small"><strong>{S.tuning.measureRms(fmt(cmp.rms, 1))}</strong></p>
          <div class="btn-row">
            <button type="button" class="btn btn--primary" onClick={runCal} disabled={busy}>{busy ? S.tuning.calibrating : S.tuning.calibrate}</button>
            {room.calibration && (
              <button type="button" class="btn btn--ghost" onClick={() => { onRoom({ ...room, calibration: null }); setCal(null); }}>{S.tuning.resetCalibration}</button>
            )}
          </div>
          {cal && (
            <Note tone="good">
              {S.tuning.calibrated(fmt(cal.dampingScale, 2), S.zones.leakages[cal.leakage as Leakage].toLowerCase(), fmt(cal.rmsBefore, 1), fmt(cal.rmsAfter, 1))}
            </Note>
          )}
        </>
      )}
    </Panel>
  );
}

// ---------- Обработка ----------

function TreatmentPanel({ project, modes, onRoom }: { project: Project; modes: Mode[]; onRoom: (r: Room) => void }) {
  const { room, sources, constraints: c, current } = project;
  const spk = sources.filter((s) => s.kind === 'speaker' && current.positions[s.id]).map((s) => ({ id: s.id, pos: current.positions[s.id] }));
  const refl = reflectionPoints(room, spk, current.listener);
  const { ev } = useSetupEval(room, sources, c, current, 48);
  const advice = ev ? bassAdvice(ev.response, modes) : [];
  const wallMarks: WallMark[] = refl.filter((r) => r.surface !== 'ceiling').map((r) => ({ surface: r.surface as 'left' | 'right', at: r.point.x }));
  const ceilMarks: PlanMark[] = refl.filter((r) => r.surface === 'ceiling').map((r) => ({ x: r.point.x, y: r.point.y, label: '', kind: 'trap' }));
  return (
    <Panel title={S.tuning.treatTitle}>
      <h3 class="subhead">{S.tuning.reflections}</h3>
      <PlanView depth={room.depth} width={room.width} items={itemsOf(project)} zones={room.zones} extensions={room.extensions} openings={room.openings} features={room.features} treatments={room.treatments} slope={room.slope} wallMarks={wallMarks} marks={ceilMarks} showDims={false} />
      <p class="muted small">{S.tuning.reflectionsHint} Кружки на стенах — боковые отражения, кольца внутри — точки на потолке.</p>
      <ul class="plain-list small">
        {refl.map((r) => (
          <li>
            {S.tuning.reflRow(
              S.placement.sourceName(r.speakerId),
              S.tuning.surfaces[r.surface],
              fmt(r.point.x, 2),
              r.surface === 'ceiling' ? `${fmt(r.point.y, 2)} м от левой стены` : `высота ${fmt(r.point.z, 2)} м`,
            )}
          </li>
        ))}
      </ul>
      <h3 class="subhead">{S.tuning.bass}</h3>
      {advice.length === 0 ? <p class="muted small">{S.tuning.bassNone}</p> : (
        <ul class="advice-list">
          {advice.map((a) => (
            <li>
              <strong>+{fmt(a.excessDb, 1)} дБ на {fmt(a.f, 0)} Гц</strong>
              <span class="small">{a.text}</span>
            </li>
          ))}
        </ul>
      )}
      <p class="muted small">{S.tuning.porous(fmt(porousLowLimit(0.1, 0.1, speedOfSound(room.temperatureC)), 0))}</p>
      <TreatmentPlan project={project} modes={modes} onRoom={onRoom} reflections={refl} />
    </Panel>
  );
}

// ---------- План обработки и «что если» ----------

function TreatmentPlan({ project, modes, onRoom, reflections }: { project: Project; modes: Mode[]; onRoom: (r: Room) => void; reflections: ReturnType<typeof reflectionPoints> }) {
  const { room, sources, constraints: c, current } = project;
  const list = room.treatments ?? [];
  const set = (treatments: Treatment[]) => onRoom({ ...room, treatments });
  const patch = (id: string, p: Partial<Treatment>) => set(list.map((t) => (t.id === id ? { ...t, ...p } : t)));
  const add = (kind: Treatment['kind']) => {
    const t: Treatment = kind === 'corner'
      ? { id: makeId(), kind, corner: 'front-left', thickness: 0.3, width: 0.6, height: Math.min(room.height, 2.4), enabled: true }
      : kind === 'panel'
        ? { id: makeId(), kind, wall: 'left', at: room.depth / 3, z: 1.2, thickness: 0.1, gap: 0.05, width: 0.6, height: 1.2, enabled: true }
        : { id: makeId(), kind, x: room.depth / 3, y: room.width / 2, thickness: 0.1, gap: 0.1, width: 1.2, height: 1.2, enabled: true };
    set([...list, t]);
  };
  // «что если»: сравнение без обработки и с ней
  const bare = useMemo(() => ({ ...room, treatmentsOn: false }), [room]);
  const withT = useMemo(() => ({ ...room, treatmentsOn: true }), [room]);
  const dBare = useMemo(() => modeDecays(bare, modes, computeReverb(bare), 150), [bare, modes]);
  const dWith = useMemo(() => modeDecays(withT, modes, computeReverb(withT), 150), [withT, modes]);
  const { ev: evBare } = useSetupEval(bare, sources, c, list.length ? current : null);
  const { ev: evWith } = useSetupEval(withT, sources, c, list.length ? current : null);
  const longCount = (d: ModeDecay[]) => d.filter((x) => x.kind !== 'oblique' && x.t60 > x.limit).length;
  const meanAx = (d: ModeDecay[]) => { const a = d.filter((x) => x.kind === 'axial'); return a.length ? a.reduce((s, x) => s + x.t60, 0) / a.length : 0; };
  const area: Record<string, number> = {};
  for (const t of list.filter((t) => t.enabled !== false)) area[t.thickness] = (area[t.thickness] ?? 0) + t.width * t.height;
  return (
    <>
      <h3 class="subhead">{S.treat.title}</h3>
      <p class="small">{S.treat.intro}</p>
      {list.length === 0 && (
        <button type="button" class="btn btn--primary" onClick={() => onRoom({ ...room, treatments: suggestTreatments(room, reflections, makeId), treatmentsOn: true })}>{S.treat.suggest}</button>
      )}
      {list.length > 0 && (
        <>
          <label class="check">
            <input type="checkbox" checked={!!room.treatmentsOn} onChange={(e) => onRoom({ ...room, treatmentsOn: (e.target as HTMLInputElement).checked })} />
            <span>{S.treat.apply}</span>
          </label>
          <div class="treat-compare">
            <div><span class="muted small">{S.treat.longModes}</span><strong>{longCount(dBare)} → {longCount(dWith)}</strong></div>
            <div><span class="muted small">{S.treat.axialT60}</span><strong>{fmt(meanAx(dBare), 1)} → {fmt(meanAx(dWith), 1)} с</strong></div>
            <div><span class="muted small">{S.treat.flatness}</span><strong>{evBare ? fmt(evBare.score, 1) : '…'} → {evWith ? fmt(evWith.score, 1) : '…'} дБ</strong></div>
            <div><span class="muted small">RT60</span><strong>{fmt(computeReverb(bare).tMid, 2)} → {fmt(computeReverb(withT).tMid, 2)} с</strong></div>
          </div>
          <p class="muted small">{room.treatmentsOn ? S.treat.onNote : S.treat.offNote}</p>
          <PlanView depth={room.depth} width={room.width} items={itemsOf(project)} zones={room.zones} extensions={room.extensions} openings={room.openings} features={room.features} treatments={list} showDims={false} />
          {list.map((t, i) => (
            <div class="zone-card">
              <div class="zone-card__head">
                <label class="check">
                  <input type="checkbox" checked={t.enabled !== false} onChange={(e) => patch(t.id, { enabled: (e.target as HTMLInputElement).checked })} />
                  <span><strong>{S.treat.kinds[t.kind]} {i + 1}</strong></span>
                </label>
                <button type="button" class="btn btn--small btn--ghost" onClick={() => set(list.filter((x) => x.id !== t.id))}>{S.openings.remove}</button>
              </div>
              {t.kind === 'corner' && (
                <SelectField label={S.treat.corner} value={t.corner ?? 'front-left'} options={(['front-left', 'front-right', 'back-left', 'back-right'] as const).map((k) => ({ value: k, label: S.treat.corners[k] }))} onChange={(v) => patch(t.id, { corner: v as Treatment['corner'] })} />
              )}
              {t.kind === 'panel' && (
                <div class="grid-2">
                  <SelectField label={S.openings.wall} value={t.wall ?? 'left'} options={(['front', 'back', 'left', 'right'] as const).map((w) => ({ value: w, label: S.openings.walls[w] }))} onChange={(v) => patch(t.id, { wall: v as Treatment['wall'] })} />
                  <NumberField compact id={`${t.id}-at`} label={S.treat.center} value={t.at ?? 0} unit="м" min={0} max={30} onChange={(v) => patch(t.id, { at: v })} />
                </div>
              )}
              {t.kind === 'cloud' && (
                <div class="grid-2">
                  <NumberField compact id={`${t.id}-x`} label={S.treat.cx} value={t.x ?? 0} unit="м" min={0} max={30} onChange={(v) => patch(t.id, { x: v })} />
                  <NumberField compact id={`${t.id}-y`} label={S.treat.cy} value={t.y ?? 0} unit="м" min={0} max={30} onChange={(v) => patch(t.id, { y: v })} />
                </div>
              )}
              <div class="grid-3">
                <SelectField label={S.treat.thickness} value={String(t.thickness)} options={THICKNESSES.map((d) => ({ value: String(d), label: `${Math.round(d * 100)} см` }))} onChange={(v) => patch(t.id, { thickness: +v })} />
                <NumberField compact id={`${t.id}-w`} label={t.kind === 'cloud' ? S.treat.sizeY : S.treat.width} value={t.width} unit="м" min={0.1} max={10} onChange={(v) => patch(t.id, { width: v })} />
                <NumberField compact id={`${t.id}-h`} label={t.kind === 'cloud' ? S.treat.sizeX : S.treat.height} value={t.height} unit="м" min={0.1} max={10} onChange={(v) => patch(t.id, { height: v })} />
              </div>
              {t.kind !== 'corner' && (
                <NumberField compact id={`${t.id}-g`} label={S.treat.gap} value={t.gap ?? 0} unit="м" min={0} max={0.5} onChange={(v) => patch(t.id, { gap: v })} />
              )}
            </div>
          ))}
          <div class="btn-row">
            <button type="button" class="btn btn--small" onClick={() => add('corner')}>{S.treat.addCorner}</button>
            <button type="button" class="btn btn--small" onClick={() => add('panel')}>{S.treat.addPanel}</button>
            <button type="button" class="btn btn--small" onClick={() => add('cloud')}>{S.treat.addCloud}</button>
          </div>
          <h4 class="subhead">{S.treat.shopping}</h4>
          <ul class="plain-list small">
            {Object.entries(area).sort((a, b) => +a[0] - +b[0]).map(([d, a]) => <li>{S.treat.material(Math.round(+d * 100), fmt(a, 1))}</li>)}
          </ul>
          <p class="muted small">{S.treat.materialNote}</p>
        </>
      )}
    </>
  );
}

// ---------- Свои фильтры сабвуферов (PEQ и all-pass) ----------

function SubFiltersBlock({ project, onSetup }: { project: Project; onSetup: (s: Setup) => void }) {
  const { room, sources, constraints: c, current } = project;
  const subs = sources.filter((s) => s.kind === 'sub' && current.positions[s.id]);
  const capable = subs.filter((s) => (s.peqBands ?? 0) > 0 || s.allpass);
  const [res, setRes] = useState<SubFilterResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [applied, setApplied] = useState(false);
  const [fs, setFs] = useState(48000);
  const run = () => {
    setBusy(true);
    setApplied(false);
    compute<SubFilterResult>('subFilters', { room, sources, constraints: c, setup: current })
      .promise.then((r) => { setRes(r); setBusy(false); })
      .catch(() => setBusy(false));
  };
  const textFor = (id: string, set?: SubSetting) => {
    const lines = [`# ${S.placement.sourceName(id)}`];
    (set?.peq ?? []).forEach((p) => lines.push(`Filter: ON PK Fc ${p.f.toFixed(1)} Hz Gain ${p.gainDb.toFixed(1)} dB Q ${p.q.toFixed(2)}`));
    (set?.allpass ?? []).forEach((p) => lines.push(`Filter: ON AP Fc ${p.f.toFixed(1)} Hz Q ${p.q.toFixed(2)}`));
    return lines.join('\n');
  };
  const dspFor = (set?: SubSetting) => {
    const out: string[] = [];
    let i = 1;
    for (const p of set?.peq ?? []) {
      const b = biquad(p, fs);
      out.push(`biquad${i++},`, `b0=${b.b0.toFixed(15)},`, `b1=${b.b1.toFixed(15)},`, `b2=${b.b2.toFixed(15)},`, `a1=${(-b.a1).toFixed(15)},`, `a2=${(-b.a2).toFixed(15)},`);
    }
    for (const p of set?.allpass ?? []) {
      const b = allpassBiquad(p, fs);
      out.push(`biquad${i++},`, `b0=${b.b0.toFixed(15)},`, `b1=${b.b1.toFixed(15)},`, `b2=${b.b2.toFixed(15)},`, `a1=${(-b.a1).toFixed(15)},`, `a2=${(-b.a2).toFixed(15)},`);
    }
    return out.join('\n');
  };
  return (
    <div class="subf">
      <p class="small">{S.subf.intro} <Term id="peq">PEQ</Term>, <Term id="allpass">all-pass</Term>.</p>
      {capable.length === 0 ? <Note>{S.subf.noCaps}</Note> : (
        <button type="button" class="btn btn--primary" disabled={busy} onClick={run}>{busy ? S.tuning.running : S.subf.run}</button>
      )}
      {res && (
        <>
          <div class="stat-row">
            <div class="stat"><span class="stat__value">{fmt(res.before, 1)} <small>дБ</small></span><span class="stat__label">{S.tuning.before}</span></div>
            <div class="stat"><span class="stat__value">{fmt(res.after, 1)} <small>дБ</small></span><span class="stat__label">{S.tuning.after}</span></div>
          </div>
          {subs.map((s) => {
            const set = res.settings[s.id];
            const n = (set?.peq?.length ?? 0) + (set?.allpass?.length ?? 0);
            return (
              <div class="sub-settings">
                <span class="range-row__label">{S.placement.sourceName(s.id)}</span>
                {n === 0 ? <p class="muted small">{S.subf.none}</p> : (
                  <ul class="plain-list small">
                    {(set?.peq ?? []).map((p) => <li>PEQ {fmt(p.f, 1)} Гц, {p.gainDb > 0 ? '+' : ''}{fmt(p.gainDb, 1)} дБ, Q {fmt(p.q, 1)}</li>)}
                    {(set?.allpass ?? []).map((p) => <li>All-pass {fmt(p.f, 1)} Гц, Q {fmt(p.q, 2)}</li>)}
                  </ul>
                )}
              </div>
            );
          })}
          <ResponseChart
            fLo={res.responseAfter.f[0]}
            fHi={res.responseAfter.f[res.responseAfter.f.length - 1]}
            lines={[
              { f: res.responseAfter.f, db: res.responseAfter.target, cls: 'is-target', dash: true },
              { f: res.responseBefore.f, db: res.responseBefore.db, cls: 'is-baseline' },
              { f: res.responseAfter.f, db: res.responseAfter.db, cls: 'is-room' },
            ]}
          />
          {res.notes.map((t) => <Note>{t}</Note>)}
          <button type="button" class="btn" disabled={applied} onClick={() => { onSetup({ ...current, subSettings: res.settings }); setApplied(true); }}>
            {applied ? S.tuning.applied : S.tuning.apply}
          </button>
          <h4 class="subhead">{S.tuning.eqExport}</h4>
          <ExportBlock id="subf-apo" title="Equalizer APO" text={subs.map((s) => textFor(s.id, res.settings[s.id])).join('\n\n')} file="sub-filters-apo.txt" />
          <Segmented label="miniDSP, частота дискретизации" value={fs} options={[{ value: 48000, label: '48 кГц' }, { value: 96000, label: '96 кГц' }]} onChange={setFs} />
          {subs.map((s) => (
            <ExportBlock id={`subf-${s.id}`} title={`miniDSP: ${S.placement.sourceName(s.id)}`} text={dspFor(res.settings[s.id])} file={`sub-filters-${s.id}-${fs / 1000}k.txt`} />
          ))}
        </>
      )}
    </div>
  );
}
