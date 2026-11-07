import { useEffect, useRef, useState } from 'preact/hooks';
import type { Project } from '../../state/project';
import { defaultSources, validateSources } from '../../state/project';
import type { Constraints, PlacementResult, SourceSpec, SubZone, Placement } from '../../core/types';
import { NumberField, Panel, Segmented, Note, Details } from '../components/Fields';
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
}

export function PlacementScreen({ project, onSources, onConstraints, onResult, onSelect }: Props) {
  const { room, sources, constraints: c, result } = project;
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const worker = useRef<Worker | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  useEffect(() => () => worker.current?.terminate(), []);

  const spk = sources.filter((s) => s.kind === 'speaker');
  const subs = sources.filter((s) => s.kind === 'sub');
  const srcErrors = validateSources(sources);

  const setCounts = (nSpk: number, nSub: number) => {
    const next = defaultSources(nSpk, nSub);
    // сохраняем введённые пользователем диапазоны и высоты
    const firstSpk = spk[0];
    for (const s of next) {
      const old = sources.find((o) => o.id === s.id) ?? (s.kind === 'speaker' ? firstSpk : subs[0]);
      if (old && old.kind === s.kind) Object.assign(s, { fLow: old.fLow, fHigh: old.fHigh, height: old.height });
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
    worker.current?.terminate();
    const w = new Worker(new URL('../../workers/placement.worker.ts', import.meta.url), { type: 'module' });
    worker.current = w;
    w.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'progress') setProgress(m.value);
      else {
        setRunning(false);
        w.terminate();
        worker.current = null;
        if (m.type === 'done') {
          onResult(m.result, 0);
          requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
        } else setError(m.error);
      }
    };
    w.onerror = (e) => {
      setRunning(false);
      setError(e.message || S.errors.generic);
    };
    w.postMessage(JSON.parse(JSON.stringify({ room, sources, constraints: c })));
  };

  const variants: Placement[] = result ? [...result.best, result.baseline] : [];
  const sel = Math.min(project.selectedIndex, Math.max(0, variants.length - 1));
  const current = variants[sel] ?? null;

  return (
    <div class="screen">
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
        <Details summary={S.placement.earHeight}>
          <NumberField label={S.placement.earHeight} value={c.earHeight} unit="м" min={0.5} max={2} onChange={(v) => setC({ earHeight: v })} />
        </Details>
      </Panel>

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
            <PlanView depth={room.depth} width={room.width} zone={[c.listenerMinX, c.listenerMaxX]} />
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
            <PlanView depth={room.depth} width={room.width} placement={current} />
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
