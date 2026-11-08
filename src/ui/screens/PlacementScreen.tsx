import { useEffect, useRef, useState } from 'preact/hooks';
import type { Project } from '../../state/project';
import { defaultSources, validateSources } from '../../state/project';
import type { Constraints, PlacementResult, SourceSpec, SubZone, Placement, Setup, PhaseMode } from '../../core/types';
import { NumberField, Panel, Segmented, Note, Details, SelectField } from '../components/Fields';
import { compute, type ComputeJob } from '../compute';
import { ManualScreen } from './ManualScreen';
import { PlanView } from '../components/PlanView';
import { ResponseChart } from '../components/Charts';
import { S } from '../strings';
import { fmt, fmtInt } from '../format';

interface Props {
  project: Project;
  onSources: (s: SourceSpec[]) => void;
  onConstraints: (c: Constraints) => void;
  onResult: (r: PlacementResult, selected: number) => void;
  onSelect: (i: number) => void;
  mode: 'auto' | 'manual';
  onMode: (m: 'auto' | 'manual') => void;
  onSetup: (s: Setup) => void;
  onSetups: (list: Setup[]) => void;
}

export function PlacementScreen({ project, onSources, onConstraints, onResult, onSelect, mode, onMode, onSetup, onSetups }: Props) {
  const { room, sources, constraints: c, result } = project;
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const job = useRef<ComputeJob<PlacementResult> | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  useEffect(() => () => job.current?.cancel(), []);

  const spk = sources.filter((s) => s.kind === 'speaker');
  const subs = sources.filter((s) => s.kind === 'sub');
  const srcErrors = validateSources(sources);

  const setCounts = (nSpk: number, nSub: number) => {
    const next = defaultSources(nSpk, nSub);
    // сохраняем введённые пользователем диапазоны и высоты
    const firstSpk = spk[0];
    for (const s of next) {
      const old = sources.find((o) => o.id === s.id) ?? (s.kind === 'speaker' ? firstSpk : subs[0]);
      if (old && old.kind === s.kind) {
        const { id: _id, ...rest } = old;
        void _id;
        Object.assign(s, rest);
      }
    }
    // при появлении/исчезновении сабвуфера меняем нижнюю границу колонок по умолчанию
    if (nSub > 0 && subs.length === 0) next.forEach((s) => s.kind === 'speaker' && s.fLow < 80 && (s.fLow = 80));
    if (nSub === 0 && subs.length > 0) next.forEach((s) => s.kind === 'speaker' && s.fLow === 80 && (s.fLow = 50));
    onSources(next);
  };

  const updateSpeakers = (patch: Partial<SourceSpec>) =>
    onSources(sources.map((s) => (s.kind === 'speaker' ? { ...s, ...patch } : s)));
  const updateSource = (id: string, patch: Partial<SourceSpec>) =>
    onSources(sources.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  const updateSubs = (patch: Partial<SourceSpec>) =>
    onSources(sources.map((s) => (s.kind === 'sub' ? { ...s, ...patch } : s)));
  const setC = (patch: Partial<Constraints>) => onConstraints({ ...c, ...patch });

  const run = () => {
    setError(null);
    setRunning(true);
    setProgress(0);
    job.current?.cancel();
    const j = compute<PlacementResult>('optimize', { room, sources, constraints: c }, setProgress);
    job.current = j;
    j.promise
      .then((r) => {
        setRunning(false);
        onResult(r, 0);
        requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
      })
      .catch((e) => { setRunning(false); setError(e.message || S.errors.generic); });
  };

  const openManual = (p: Placement) => {
    const positions = Object.fromEntries(p.sources.filter((s) => s.pos).map((s) => [s.id, s.pos]));
    onSetup({ ...project.current, listener: p.listener, positions, subSettings: {}, crossoverHz: null });
    onMode('manual');
    scrollTo({ top: 0 });
  };

  const variants: Placement[] = result ? [...result.best, result.baseline] : [];
  const sel = Math.min(project.selectedIndex, Math.max(0, variants.length - 1));
  const current = variants[sel] ?? null;

  const settingsPanels = (
    <>
      <Panel title={S.placement.system}>
        <Segmented
          label={S.placement.speakers}
          value={spk.length}
          options={[{ value: 1, label: S.placement.speakersMono }, { value: 2, label: S.placement.speakersStereo }]}
          onChange={(n) => setCounts(n, subs.length)}
        />
        <Segmented
          label={S.placement.subs}
          value={subs.length}
          options={[0, 1, 2, 3, 4].map((n) => ({ value: n, label: n === 0 ? 'Нет' : String(n) }))}
          onChange={(n) => setCounts(spk.length, n)}
        />
        <h3 class="subhead">{S.placement.range}</h3>
        <RangeRow
          label={S.placement.speakerRange}
          lo={spk[0]?.fLow ?? 80}
          hi={spk[0]?.fHigh ?? 20000}
          onLo={(v) => updateSpeakers({ fLow: v })}
          onHi={(v) => updateSpeakers({ fHigh: v })}
        />
        {subs.map((s, i) => (
          <RangeRow
            label={S.placement.subRange(i + 1)}
            lo={s.fLow}
            hi={s.fHigh}
            onLo={(v) => updateSource(s.id, { fLow: v })}
            onHi={(v) => updateSource(s.id, { fHigh: v })}
          />
        ))}
        {srcErrors.map((e) => <Note tone="warn">{e.message}</Note>)}
        {subs.length > 0 && (
          <Details summary={S.sub.caps}>
            {subs.map((s, i) => (
              <div class="sub-caps">
                <span class="range-row__label">{S.placement.subRange(i + 1)}</span>
                <Segmented
                  label={S.sub.delay}
                  value={s.delayMode ?? 'none'}
                  options={[{ value: 'none', label: S.sub.delayModes.none }, { value: 'adjustable', label: S.sub.delayModes.adjustable }]}
                  onChange={(v) => updateSource(s.id, { delayMode: v as SourceSpec['delayMode'] })}
                />
                {s.delayMode === 'adjustable' && (
                  <NumberField id={`${s.id}-maxd`} label={S.sub.maxDelay} value={s.maxDelayMs ?? 20} unit="мс" min={1} max={50} digits={0} onChange={(v) => updateSource(s.id, { maxDelayMs: v })} />
                )}
                <SelectField
                  label={`${S.sub.phase} (${S.placement.subRange(i + 1).toLowerCase()})`}
                  value={s.phaseMode ?? 'none'}
                  options={(['none', 'polarity', 'continuous', 'full'] as PhaseMode[]).map((m) => ({ value: m, label: S.sub.phaseModes[m] }))}
                  onChange={(v) => updateSource(s.id, { phaseMode: v as PhaseMode })}
                />
                <label class="check">
                  <input type="checkbox" checked={!!s.levelAdjustable} onChange={(e) => updateSource(s.id, { levelAdjustable: (e.target as HTMLInputElement).checked })} />
                  <span>{S.sub.level}</span>
                </label>
              </div>
            ))}
            {spk.length > 0 && (
              <>
                <label class="check">
                  <input type="checkbox" checked={c.crossover.adjustable} onChange={(e) => setC({ crossover: { ...c.crossover, adjustable: (e.target as HTMLInputElement).checked } })} />
                  <span>{S.sub.crossover}</span>
                </label>
                {c.crossover.adjustable && (
                  <div class="grid-2">
                    <NumberField id="xo-min" label={S.sub.xoMin} value={c.crossover.min} unit="Гц" min={30} max={c.crossover.max - 10} digits={0} onChange={(v) => setC({ crossover: { ...c.crossover, min: v } })} />
                    <NumberField id="xo-max" label={S.sub.xoMax} value={c.crossover.max} unit="Гц" min={c.crossover.min + 10} max={250} digits={0} onChange={(v) => setC({ crossover: { ...c.crossover, max: v } })} />
                  </div>
                )}
              </>
            )}
          </Details>
        )}
        <Details summary={S.placement.heights}>
          <div class="grid-2">
            <NumberField label={S.placement.speakerHeight} value={spk[0]?.height ?? 1} unit="м" min={0} max={3} onChange={(v) => updateSpeakers({ height: v })} />
            {subs.length > 0 && (
              <NumberField label={S.placement.subHeight} value={subs[0].height} unit="м" min={0} max={3} onChange={(v) => updateSubs({ height: v })} />
            )}
          </div>
        </Details>
      </Panel>

      <Panel title={S.placement.limits}>
        <div class="grid-2">
          <NumberField label={`Слушатель: ${S.placement.from}`} value={c.listenerMinX} unit="м" min={0.3} max={room.depth - 0.2} onChange={(v) => setC({ listenerMinX: v })} />
          <NumberField label={S.placement.to} value={c.listenerMaxX} unit="м" min={0.4} max={room.depth - 0.1} onChange={(v) => setC({ listenerMaxX: v })} />
        </div>
        <p class="muted small">{S.placement.listenerZone}.</p>
        <div class="grid-2">
          <NumberField label={S.placement.speakerFront} value={c.speakerMinFront} unit="м" min={0.05} max={room.depth / 2} onChange={(v) => setC({ speakerMinFront: v })} />
          <NumberField label={S.placement.speakerSide} value={c.speakerMinSide} unit="м" min={0.05} max={room.width / 2 - 0.2} onChange={(v) => setC({ speakerMinSide: v })} />
        </div>
        {subs.length > 0 && (
          <Segmented
            label={S.placement.subZone}
            value={c.subZone}
            options={(['corners', 'walls', 'anywhere'] as SubZone[]).map((z) => ({ value: z, label: S.placement.zones[z] }))}
            onChange={(z) => setC({ subZone: z })}
          />
        )}
        <Segmented
          label={S.seats.count}
          value={c.seats.count}
          options={[1, 2, 3, 4, 5].map((n) => ({ value: n, label: String(n) }))}
          onChange={(n) => setC({ seats: { ...c.seats, count: n } })}
        />
        {c.seats.count > 1 && (
          <NumberField id="seat-spacing" label={S.seats.spacing} value={c.seats.spacing} unit="м" min={0.4} max={1.2} onChange={(v) => setC({ seats: { ...c.seats, spacing: v } })} />
        )}
        <p class="muted small">{S.seats.hint}</p>
        <Details summary={S.placement.earHeight}>
          <NumberField label={S.placement.earHeight} value={c.earHeight} unit="м" min={0.5} max={2} onChange={(v) => setC({ earHeight: v })} />
        </Details>
      </Panel>

    </>
  );

  if (mode === 'manual') {
    return (
      <div class="screen">
      <div class="mode-switch">
        <Segmented
          label="Режим"
          value={mode}
          options={[{ value: 'auto', label: S.manual.modeAuto }, { value: 'manual', label: S.manual.modeManual }]}
          onChange={onMode}
        />
      </div>
        <ManualScreen project={project} onSetup={onSetup} onSetups={onSetups} />
        <Details summary={`${S.placement.system} и ${S.placement.limits.toLowerCase()}`}>
          <div class="screen">{settingsPanels}</div>
        </Details>
      </div>
    );
  }

  return (
    <div class="screen">
      <div class="mode-switch">
        <Segmented
          label="Режим"
          value={mode}
          options={[{ value: 'auto', label: S.manual.modeAuto }, { value: 'manual', label: S.manual.modeManual }]}
          onChange={onMode}
        />
      </div>
      {settingsPanels}
      <div class="run-bar">
        <button type="button" class="btn btn--primary btn--wide" onClick={run} disabled={running || srcErrors.length > 0}>
          {running ? S.placement.running : result ? S.placement.rerun : S.placement.run}
        </button>
        {running && (
          <div class="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
            <span style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        )}
        {error && <Note tone="warn">{error}</Note>}
      </div>

      <div ref={resultRef}>
        {!result && !running && (
          <Panel>
            <PlanView depth={room.depth} width={room.width} zones={room.zones} extensions={room.extensions} openings={room.openings} features={room.features} listenerZone={[c.listenerMinX, c.listenerMaxX]} />
            <p class="small">{S.placement.empty}</p>
          </Panel>
        )}
        {result && current && (
          <Panel class="panel--hero">
            {result.stale && <Note tone="warn">{S.placement.stale}</Note>}
            <div class="tabs" role="tablist">
              {variants.map((_, i) => (
                <button
                  type="button"
                  role="tab"
                  aria-selected={i === sel}
                  class={i === sel ? 'is-on' : ''}
                  onClick={() => onSelect(i)}
                >
                  {i < result.best.length ? S.placement.variant(i + 1) : S.placement.baseline}
                </button>
              ))}
            </div>
            <ScoreLine p={current} baseline={result.baseline} isBaseline={sel === variants.length - 1} />
            <PlanView depth={room.depth} width={room.width} placement={current} zones={room.zones} extensions={room.extensions} openings={room.openings} features={room.features} />
            <button type="button" class="btn" onClick={() => openManual(current)}>{S.manual.openManual}</button>
            <Positions p={current} />
            <h3 class="subhead">{S.placement.response}</h3>
            <ResponseChart
              fLo={result.fLo}
              fHi={result.fHi}
              lines={[
                { f: current.response.f, db: current.response.target, cls: 'is-target', dash: true },
                ...(sel !== variants.length - 1
                  ? [{ f: result.baseline.response.f, db: result.baseline.response.db, cls: 'is-baseline' }]
                  : []),
                { f: current.response.f, db: current.response.db, cls: 'is-room' },
              ]}
            />
            <div class="legend">
              <span class="legend__item legend__item--room">{S.placement.legendRoom}</span>
              <span class="legend__item legend__item--target">{S.placement.legendTarget}</span>
              {sel !== variants.length - 1 && <span class="legend__item legend__item--baseline">{S.placement.legendBaseline}</span>}
            </div>
            {current.penalties.length > 0 && (
              <>
                <h3 class="subhead">{S.placement.penalties}</h3>
                <ul class="plain-list small">{current.penalties.map((p) => <li>{p.name}</li>)}</ul>
              </>
            )}
            {result.notes.map((n) => <Note>{n}</Note>)}
            <p class="muted small">
              {S.placement.evaluated(fmtInt(result.evaluated), fmt(result.elapsedMs / 1000, 1))} Оценка по полосе {fmt(result.fLo, 0)}–{fmt(result.fHi, 0)} Гц.
            </p>
            <Details summary="Как считается">
              <p class="small">{S.placement.assumptions}</p>
            </Details>
          </Panel>
        )}
      </div>
    </div>
  );
}

function RangeRow(p: { label: string; lo: number; hi: number; onLo: (v: number) => void; onHi: (v: number) => void }) {
  return (
    <div class="range-row">
      <span class="range-row__label">{p.label}</span>
      <NumberField compact label={S.placement.from} value={p.lo} unit="Гц" min={10} max={23999} digits={0} onChange={p.onLo} id={`${p.label}-lo`} />
      <NumberField compact label={S.placement.to} value={p.hi} unit="Гц" min={11} max={24000} digits={0} onChange={p.onHi} id={`${p.label}-hi`} />
    </div>
  );
}

function ScoreLine({ p, baseline, isBaseline }: { p: Placement; baseline: Placement; isBaseline: boolean }) {
  const d = baseline.score - p.score;
  return (
    <div class="score">
      <div class="score__main">
        <span class="score__value">{fmt(p.score, 1)}</span>
        <span class="score__unit">дБ</span>
      </div>
      <div class="score__text">
        <span class="score__label">{S.placement.score}</span>
        {!isBaseline && (
          <span class={`score__delta ${d > 0.05 ? 'is-good' : d < -0.05 ? 'is-bad' : ''}`}>
            {d > 0.05 ? S.placement.better(fmt(d, 1)) : d < -0.05 ? S.placement.worse(fmt(-d, 1)) : S.placement.same}
          </span>
        )}
        <span class="muted small">
          {fmt(p.scoreCenter, 1)} дБ {S.placement.center}, {fmt(p.scoreSeats, 1)} дБ {S.placement.seats}
          {p.angleDeg != null ? `; ${S.placement.angle.toLowerCase()} ${fmt(p.angleDeg, 0)}°` : ''}
        </span>
      </div>
    </div>
  );
}

function Positions({ p }: { p: Placement }) {
  const rows = [
    ...p.sources.map((s) => ({ name: S.placement.sourceName(s.id), pos: s.pos })),
    { name: S.placement.listener, pos: p.listener },
  ];
  return (
    <div class="table-scroll">
      <table class="pos-table">
        <caption class="muted small">{S.placement.positions}, м</caption>
        <thead>
          <tr>
            <th />
            <th>от передней стены</th>
            <th>от левой стены</th>
            <th>высота</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr>
              <th scope="row">{r.name}</th>
              <td class="num">{fmt(r.pos.x, 2)}</td>
              <td class="num">{fmt(r.pos.y, 2)}</td>
              <td class="num">{fmt(r.pos.z, 2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
