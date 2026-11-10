import { useEffect, useRef, useState } from 'preact/hooks';
import { shownTreatments } from '../../core/treatments';
import { MapModeHelp } from '../components/MapModeHelp';
import { ScoreBlock } from '../components/ScoreBlock';
import type { Project } from '../../state/project';
import { defaultSetup, validateSources } from '../../state/project';
import type { BassObjective, Constraints, PlacementResult, SourceSpec, Placement, Setup } from '../../core/types';
import { NumberField, Panel, Segmented, Note, Details } from '../components/Fields';
import { SystemSettings } from './placement/SystemSettings';
import { compute, type ComputeJob } from '../compute';
import { ManualScreen } from './ManualScreen';
import { PlanView, HeatLegend } from '../components/PlanView';
import { PlanLayers, usePlanLayers } from '../components/PlanLayers';
import type { Heatmap } from '../../core/field';
import { isFlat } from '../../core/objective';
import { ResponseChart } from '../components/Charts';
import { S } from '../strings';
import { Term } from '../components/Term';
import { fmt, fmtInt } from '../format';
import { ROBUST_GOOD, ROBUST_MID } from '../../core/metric';
import { placementLayout, sameLayout, setupFromPlacement, shouldAdoptBest } from '../../state/variant';
import { CalculationStatus } from '../components/CalculationStatus';

interface Props {
  project: Project;
  onSources: (s: SourceSpec[]) => void;
  onConstraints: (c: Constraints) => void;
  onResult: (r: PlacementResult, selected: number) => void;
  onSelect: (i: number) => void;
  mode: 'auto' | 'manual';
  onMode: (m: 'auto' | 'manual') => void;
  onSetup: (s: Setup) => void;
  /** Переход на другой раздел (после выбора варианта — «Настройка»). */
  onGo?: (t: 'tuning') => void;
  onSetups: (list: Setup[]) => void;
}

export function PlacementScreen({ project, onSources, onConstraints, onResult, onSelect, mode, onMode, onSetup, onSetups, onGo }: Props) {
  const { room, sources, constraints: c, result } = project;
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const job = useRef<ComputeJob<PlacementResult> | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  useEffect(() => () => job.current?.cancel(), []);
  const layers = usePlanLayers();

  const subs = sources.filter((s) => s.kind === 'sub');
  const srcErrors = validateSources(sources);

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
        // своей расстановки ещё нет (стоит исходная) — лучший вариант сразу становится текущим:
        // по нему считаются «Настройка», «Обзор», 3D и замер
        if (shouldAdoptBest(project.current, defaultSetup(room, sources, c), r.best[0])) applyVariant(r.best[0]);
        requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
      })
      .catch((e) => { setRunning(false); setError(e.message || S.errors.generic); });
  };

  /** Вариант становится текущей расстановкой (её используют настройка, обзор, 3D и замер). */
  const applyVariant = (p: Placement) => {
    onSetup(setupFromPlacement(project.current, p));
  };
  const openManual = (p: Placement) => {
    applyVariant(p);
    onMode('manual');
    scrollTo({ top: 0 });
  };

  const isCurrent = (p: Placement) => sameLayout(project.current, placementLayout(p));
  const variants: Placement[] = result ? [...result.best, result.baseline] : [];
  const sel = Math.min(project.selectedIndex, Math.max(0, variants.length - 1));
  const current = variants[sel] ?? null;

  // карта звука для выбранного варианта (как в ручном режиме): место слушателя или сабвуфера
  const [mapKind, setMapKind] = useState<'listener' | 'sub'>('listener');
  const [mapSub, setMapSub] = useState(subs[0]?.id ?? '');
  const effKind = mapKind === 'sub' && subs.length ? 'sub' : 'listener';
  const effSub = subs.some((s) => s.id === mapSub) ? mapSub : subs[0]?.id ?? '';
  const [heat, setHeat] = useState<Heatmap | null>(null);
  const [heatBusy, setHeatBusy] = useState(false);
  const heatJob = useRef<ComputeJob<Heatmap> | null>(null);
  const heatCache = useRef<{ owner: unknown; map: Map<string, Heatmap> }>({ owner: null, map: new Map() });
  useEffect(() => {
    if (!layers.map || !current) { heatJob.current?.cancel(); setHeatBusy(false); return; }
    // кэш карт на результат подбора и ограничения: переключение туда-обратно — мгновенно
    const owner = [result, room, sources, c];
    const cache = heatCache.current;
    if (cache.owner === null || (cache.owner as unknown[]).some((v, i) => v !== owner[i])) { cache.owner = owner; cache.map.clear(); }
    const key = `${sel}|${effKind}|${effSub}`;
    const hit = cache.map.get(key);
    if (hit) { heatJob.current?.cancel(); setHeat(hit); setHeatBusy(false); return; }
    setHeat(null);
    setHeatBusy(true);
    const t = setTimeout(() => {
      heatJob.current?.cancel();
      const setup = { ...placementLayout(current), subSettings: current.subSettings ?? {}, crossoverHz: null };
      const j = compute<Heatmap>(effKind === 'sub' ? 'subMap' : 'listenerMap', { room, sources, constraints: c, setup, subId: effSub });
      heatJob.current = j;
      j.promise
        .then((h) => { cache.map.set(key, h); if (heatJob.current === j) { setHeat(h); setHeatBusy(false); } })
        .catch(() => { if (heatJob.current === j) setHeatBusy(false); });
    }, 120);
    return () => clearTimeout(t);
  }, [layers.map, current, sel, effKind, effSub, result, room, sources, c]);
  useEffect(() => () => heatJob.current?.cancel(), []);

  const sharedCard = <SystemSettings project={project} onSources={onSources} onConstraints={onConstraints} />;
  // переключатель режима — как остальные переключатели, в карточке вместе с настройками своего режима
  const modeSwitch = (
    <Segmented
      label={S.setup.mode}
      value={mode}
      options={[{ value: 'auto', label: S.manual.modeAuto }, { value: 'manual', label: S.manual.modeManual }]}
      onChange={onMode}
    />
  );
  // только для автоподбора: где искать кресло, отступы колонок, схема DBA
  const autoOnly = (
    <>
      <h3 class="subhead">{S.setup.autoOnly}</h3>
      <p class="muted small">{S.setup.autoOnlyHint}</p>
        <div class="grid-2">
          <NumberField label={`Слушатель: ${S.placement.from}`} value={c.listenerMinX} unit="м" min={0.3} max={room.depth - 0.2} onChange={(v) => setC({ listenerMinX: v })} />
          <NumberField label={S.placement.to} value={c.listenerMaxX} unit="м" min={0.4} max={room.depth - 0.1} onChange={(v) => setC({ listenerMaxX: v })} />
        </div>
        <p class="muted small">{S.placement.listenerZone}.</p>
        <div class="grid-2">
          <NumberField label={S.placement.speakerFront} value={c.speakerMinFront} unit="м" min={0.05} max={room.depth / 2} onChange={(v) => setC({ speakerMinFront: v })} />
          <NumberField label={S.placement.speakerSide} value={c.speakerMinSide} unit="м" min={0.05} max={room.width / 2 - 0.2} onChange={(v) => setC({ speakerMinSide: v })} />
        </div>
      {subs.length >= 2 && (
        <label class="check">
          <input type="checkbox" checked={!!c.dba} onChange={(e) => setC({ dba: (e.target as HTMLInputElement).checked })} />
          <span>{S.robust.dbaToggle} <Term id="dba">DBA</Term></span>
        </label>
      )}
    </>
  );

  if (mode === 'manual') {
    return (
      <div class="screen">
        {sharedCard}
        <ManualScreen project={project} onSetup={onSetup} onSetups={onSetups} header={modeSwitch} />
      </div>
    );
  }

  return (
    <div class="screen">
      {sharedCard}
      <Panel class="mode-panel">
        {modeSwitch}
        {autoOnly}
      </Panel>
      {/* главное действие видно, пока заполняются настройки выше */}
      <div class="run-bar is-sticky">
        <button type="button" class="btn btn--primary btn--wide" onClick={run} disabled={running || srcErrors.length > 0}>
          {running ? S.placement.running : result ? S.placement.rerun : S.placement.run}
        </button>
        {running && (
          <div class="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
            <span style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        )}
        <CalculationStatus error={error} />
      </div>

      <div ref={resultRef}>
        {!result && !running && (
          <Panel>
            <PlanView depth={room.depth} width={room.width} zones={room.zones} extensions={room.extensions} openings={room.openings} features={room.features} treatments={shownTreatments(room)} slope={room.slope} listenerZone={[c.listenerMinX, c.listenerMaxX]} />
            <p class="small">{S.placement.empty}</p>
          </Panel>
        )}
        {result && current && (
          <Panel class="panel--hero">
            <CalculationStatus stale={result.stale ? S.placement.stale : undefined} />
            <div class="tabs" role="tablist">
              {variants.map((_, i) => (
                <button key={i}
                  type="button"
                  role="tab"
                  aria-selected={i === sel}
                  class={i === sel ? 'is-on' : ''}
                  onClick={() => onSelect(i)}
                >
                  {i < result.best.length ? (variants[i].scheme === 'dba' ? 'DBA' : S.placement.variant(i + 1)) : S.placement.baseline}
                </button>
              ))}
            </div>
            <ScoreLine p={current} baseline={result.baseline} isBaseline={sel === variants.length - 1} objective={c.objective} />
            {current.robust != null && (
              <p class="small">
                <span class={`robust-tag ${current.robust <= ROBUST_GOOD ? 'is-good' : current.robust <= ROBUST_MID ? 'is-mid' : 'is-bad'}`}>
                  {current.robust <= ROBUST_GOOD ? S.robust.good : current.robust <= ROBUST_MID ? S.robust.mid : S.robust.bad}
                </span>{' '}
                <span class="muted">{S.robust.detail(fmt(current.robust, 1))} <Term id="robust">?</Term></span>
              </p>
            )}
            {current.scheme === 'dba' && <Note>{S.robust.dbaNote}</Note>}
            <PlanLayers {...layers} />
            {layers.map && subs.length > 0 && (
              <Segmented label={S.layers.mapFor} value={effKind} options={[{ value: 'listener' as const, label: S.manual.findListener }, { value: 'sub' as const, label: S.manual.findSub }]} onChange={setMapKind} />
            )}
            {layers.map && effKind === 'sub' && subs.length > 1 && (
              <Segmented label={S.manual.whichSub} value={effSub} options={subs.map((s) => ({ value: s.id, label: `С${s.id.slice(3)}` }))} onChange={setMapSub} />
            )}
            {layers.map && <MapModeHelp mode={effKind} where="auto" />}
            <PlanView
              depth={room.depth} width={room.width} placement={current}
              zones={room.zones} extensions={room.extensions} openings={room.openings} features={room.features} treatments={shownTreatments(room)} slope={room.slope}
              heatmap={layers.map ? heat : null}
              axes={layers.axes}
              keyNotes={effKind === 'sub' ? { heat: S.manual.keyHeatSub } : undefined}
              label="План комнаты: выбранный вариант и карта звука"
            />
            {layers.map && heat && <HeatLegend hm={heat} />}
            <CalculationStatus busy={layers.map && heatBusy} label={S.layers.computing} />
            {isCurrent(current) ? (
              <>
                <Note tone="good">{S.placement.inUse}</Note>
                {onGo && <button type="button" class="btn btn--primary" onClick={() => onGo('tuning')}>{S.placement.toTuning}</button>}
              </>
            ) : (
              <>
                <button type="button" class="btn btn--primary" onClick={() => applyVariant(current)}>{S.placement.use}</button>
                <p class="muted small">{S.placement.notInUse}</p>
              </>
            )}
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
                <ul class="plain-list small">{current.penalties.map((p, ki) => <li key={ki}>{p.name}</li>)}</ul>
              </>
            )}
            {result.notes.map((n, ki) => <Note key={ki}>{n}</Note>)}
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

function ScoreLine({ p, baseline, isBaseline, objective }: { p: Placement; baseline: Placement; isBaseline: boolean; objective?: BassObjective }) {
  // главное число — оценка по цели подбора (по ней и упорядочены варианты)
  const val = (q: Placement) => (isFlat(objective) ? q.score : q.objScore ?? q.score);
  const detail = `${fmt(p.scoreCenter, 1)} дБ ${S.placement.center}, ${fmt(p.scoreSeats, 1)} дБ ${S.placement.seats}${p.angleDeg != null ? `; ${S.placement.angle.toLowerCase()} ${fmt(p.angleDeg, 0)}°` : ''}.`;
  return (
    <ScoreBlock
      objective={objective}
      objScore={val(p)}
      flatScore={p.score}
      delta={isBaseline ? null : val(baseline) - val(p)}
      flatDetail={detail}
    />
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
          {rows.map((r, ki) => (
            <tr key={ki}>
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
