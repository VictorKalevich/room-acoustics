import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Project } from '../../state/project';
import { makeId } from '../../state/project';
import type { Setup, Vec3 } from '../../core/types';
import { robustnessMap, type Heatmap } from '../../core/field';
import { ROBUST_LISTENER_SHIFT, ROBUST_SOURCE_SHIFT } from '../../core/metric';
import { evaluateSetup } from '../../core/system';
import { isWave } from '../../core/geometry';
import { useSetupEval } from '../useEval';
import { compute, type ComputeJob } from '../compute';
import { PlanView, HeatLegend, type PlanItem, type PlanMark } from '../components/PlanView';
import { ResponseChart } from '../components/Charts';
import { NumberField, Panel, Segmented, Note, Details } from '../components/Fields';
import { S } from '../strings';
import { fmt } from '../format';

interface Props {
  project: Project;
  onSetup: (s: Setup) => void;
  onSetups: (list: Setup[]) => void;
}

type Mode = 'listener' | 'sub';

export function ManualScreen({ project, onSetup, onSetups }: Props) {
  const { room, sources, constraints: c, current } = project;
  const subs = sources.filter((s) => s.kind === 'sub');
  const [mode, setMode] = useState<Mode>('listener');
  const [subId, setSubId] = useState<string>(subs[0]?.id ?? '');
  const [symmetric, setSymmetric] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [heat, setHeat] = useState<Heatmap | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [probe, setProbe] = useState<{ x: number; y: number } | null>(null);
  const [compareId, setCompareId] = useState<string | null>(null);
  const [layer, setLayer] = useState<'flat' | 'robust'>('flat');
  const robustHeat = useMemo(() => (heat ? robustnessMap(heat, heat.kind === 'listener' ? ROBUST_LISTENER_SHIFT : ROBUST_SOURCE_SHIFT) : null), [heat]);
  const [name, setName] = useState('');
  const job = useRef<ComputeJob<Heatmap> | null>(null);

  const effMode: Mode = mode === 'sub' && subs.length ? 'sub' : 'listener';
  const effSub = subs.some((s) => s.id === subId) ? subId : subs[0]?.id ?? '';

  const { ev: evalCurMaybe, busy: evalBusy } = useSetupEval(room, sources, c, current);
  const wave = isWave(room);

  // Пересчёт карты с задержкой (во время перетаскивания не дёргаем воркер)
  useEffect(() => {
    const t = setTimeout(() => {
      job.current?.cancel();
      setBusy(true);
      setError(null);
      const j = compute<Heatmap>(effMode === 'sub' ? 'subMap' : 'listenerMap', { room, sources, constraints: c, setup: current, subId: effSub });
      job.current = j;
      j.promise
        .then((h) => { if (job.current === j) { setHeat(h); setBusy(false); } })
        .catch((e) => { if (job.current === j) { setError(e.message); setBusy(false); } });
    }, 350);
    return () => clearTimeout(t);
    // только то, что меняет карту (переименование варианта пересчёта не требует)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room, sources, c, current.positions, current.listener, current.subSettings, current.crossoverHz, effMode, effSub]);
  useEffect(() => () => job.current?.cancel(), []);
  useEffect(() => setProbe(null), [effMode, effSub]);

  const move = (id: string, pos: { x: number; y: number }) => {
    if (id === 'listener') {
      onSetup({ ...current, listener: { x: pos.x, y: pos.y, z: c.earHeight } });
      return;
    }
    const spec = sources.find((s) => s.id === id);
    if (!spec) return;
    const positions: Record<string, Vec3> = { ...current.positions, [id]: { x: pos.x, y: pos.y, z: spec.height } };
    const mirror = id === 'spkL' ? 'spkR' : id === 'spkR' ? 'spkL' : null;
    if (symmetric && mirror && positions[mirror]) positions[mirror] = { x: pos.x, y: room.width - pos.y, z: positions[mirror].z };
    onSetup({ ...current, positions });
  };

  const placeSearched = (pos: { x: number; y: number }) => move(effMode === 'sub' ? effSub : 'listener', pos);

  const probeSetup = useMemo(() => {
    if (!probe) return null;
    return effMode === 'sub'
      ? { ...current, positions: { ...current.positions, [effSub]: { x: probe.x, y: probe.y, z: current.positions[effSub]?.z ?? 0.3 } } }
      : { ...current, listener: { x: probe.x, y: probe.y, z: c.earHeight } };
  }, [probe, current, effMode, effSub, c.earHeight]);
  const { ev: probeEval } = useSetupEval(room, sources, c, probeSetup);

  const compareSetup = project.setups.find((s) => s.id === compareId) ?? null;
  const { ev: compareEval } = useSetupEval(room, sources, c, compareSetup);

  const items: PlanItem[] = [
    ...sources.filter((s) => current.positions[s.id]).map((s) => ({
      id: s.id, kind: (s.kind === 'sub' ? 'sub' : 'spk') as PlanItem['kind'], pos: current.positions[s.id],
    })),
    { id: 'listener', kind: 'listener', pos: current.listener },
  ];
  const marks: PlanMark[] = [
    ...(heat?.best ?? []).map((b, i) => ({ x: b.pos.x, y: b.pos.y, label: String(i + 1), kind: 'best' as const })),
    ...(probe ? [{ x: probe.x, y: probe.y, label: '', kind: 'probe' as const }] : []),
  ];

  const selItem = items.find((i) => i.id === selected) ?? null;
  const evalCur = evalCurMaybe;
  const itemName = (id: string) => (id === 'listener' ? S.placement.listener : S.placement.sourceName(id));

  const saveVariant = () => {
    const n = name.trim() || `Вариант ${project.setups.length + 1}`;
    onSetups([...project.setups, { ...JSON.parse(JSON.stringify(current)), id: makeId(), name: n }]);
    setName('');
  };

  return (
    <div class="screen">
      <Panel class="panel--hero">
        <Segmented
          label={S.manual.find}
          value={effMode}
          options={[
            { value: 'listener', label: S.manual.findListener },
            ...(subs.length ? [{ value: 'sub' as Mode, label: S.manual.findSub }] : []),
          ]}
          onChange={setMode}
        />
        {effMode === 'sub' && subs.length > 1 && (
          <Segmented label={S.manual.whichSub} value={effSub} options={subs.map((s) => ({ value: s.id, label: `С${s.id.slice(3)}` }))} onChange={setSubId} />
        )}
        <PlanView
          depth={room.depth}
          width={room.width}
          items={items}
          seats={evalCur?.seats ?? []}
          zones={room.zones} extensions={room.extensions} openings={room.openings} features={room.features} treatments={room.treatments} slope={room.slope}
          heatmap={layer === 'robust' ? robustHeat : heat}
          marks={marks}
          selectedId={selected}
          onSelect={setSelected}
          onMove={move}
          onTap={(pos) => setProbe(pos)}
          keyNotes={effMode === 'sub' ? { best: S.manual.keyBestSub, probe: S.manual.keyProbeSub, heat: S.manual.keyHeatSub } : undefined}
          label="План комнаты с картой оценок"
        />
        {heat && <HeatLegend hm={layer === 'robust' ? robustHeat! : heat} />}
        <Segmented label={S.robust.layer} value={layer} options={[{ value: 'flat' as const, label: S.robust.layers.flat }, { value: 'robust' as const, label: S.robust.layers.robust }]} onChange={setLayer} />
        {layer === 'robust' && <p class="muted small">{S.robust.layerHint}</p>}
        <p class="progress-text small" role="status" aria-live="polite">
          {busy ? <><span class="spinner" aria-hidden="true" /> {S.manual.computing}</> : <span class="muted">{S.manual.hint}</span>}
        </p>
        {error && <Note tone="warn">{error}</Note>}
        {spkPair(sources) && (
          <label class="check">
            <input type="checkbox" checked={symmetric} onChange={(e) => setSymmetric((e.target as HTMLInputElement).checked)} />
            <span>{S.manual.symmetric}</span>
          </label>
        )}
      </Panel>

      <Panel title={S.manual.best}>
        <div class="score">
          <div class="score__main">
            <span class="score__value">{evalCur ? fmt(evalCur.score, 1) : '…'}</span>
            <span class="score__unit">дБ</span>
          </div>
          <div class="score__text">
            <span class="score__label">{S.manual.current}</span>
            <span class="muted small">{S.placement.scoreHint}</span>
            {evalCur?.angleDeg != null && <span class="muted small">{S.placement.angle}: {fmt(evalCur.angleDeg, 0)}°</span>}
            <span class="model-tag">{wave ? S.model.waveTag : S.model.modalTag}</span>
          </div>
        </div>
        {heat && heat.best.length === 0 && <Note tone="warn">{S.manual.noBest}</Note>}
        <ul class="best-list">
          {(heat?.best ?? []).map((b, i) => {
            const d = heat!.current - b.score;
            return (
              <li key={i}>
                <span class="best-list__n">{i + 1}</span>
                <span class="best-list__text">
                  <strong>{fmt(b.score, 1)} дБ</strong>
                  <span class="muted small">
                    {fmt(b.pos.x, 2)} м от передней, {fmt(b.pos.y, 2)} м от левой
                    {d > 0.05 ? `, на ${fmt(d, 1)} дБ ровнее` : ''}
                  </span>
                </span>
                <button type="button" class="btn btn--small" onClick={() => placeSearched(b.pos)}>
                  {effMode === 'sub' ? S.manual.putHere : S.manual.sitHere}
                </button>
              </li>
            );
          })}
        </ul>
        {probe && probeEval && (
          <div class="probe">
            <span>
              <strong>{S.manual.probe}:</strong> {fmt(probe.x, 2)} × {fmt(probe.y, 2)} м — {fmt(probeEval.score, 1)} дБ
            </span>
            <span class="btn-row">
              <button type="button" class="btn btn--small" onClick={() => { placeSearched(probe); setProbe(null); }}>
                {effMode === 'sub' ? S.manual.putHere : S.manual.sitHere}
              </button>
              <button type="button" class="btn btn--small btn--ghost" onClick={() => setProbe(null)}>{S.manual.removeProbe}</button>
            </span>
          </div>
        )}
        <h3 class="subhead">{S.manual.responseHere}</h3>
        {evalCur ? (
          <>
            <ResponseChart
              fLo={evalCur.fLo}
              fHi={evalCur.fHi}
              lines={[
                { f: evalCur.response.f, db: evalCur.response.target, cls: 'is-target', dash: true },
                ...(compareEval ? [{ f: compareEval.response.f, db: compareEval.response.db, cls: 'is-compare' }] : []),
                ...(probeEval ? [{ f: probeEval.response.f, db: probeEval.response.db, cls: 'is-probe' }] : []),
                { f: evalCur.response.f, db: evalCur.response.db, cls: 'is-room' },
              ]}
            />
            <div class="legend">
              <span class="legend__item legend__item--room">{S.manual.legendCurrent}</span>
              {probeEval && <span class="legend__item legend__item--probe">{S.manual.legendProbe}</span>}
              {compareEval && <span class="legend__item legend__item--compare">{S.manual.legendCompare}</span>}
              <span class="legend__item legend__item--target">{S.placement.legendTarget}</span>
            </div>
            {evalCur.penalties.length > 0 && <ul class="plain-list small">{evalCur.penalties.map((p, ki) => <li key={ki}>{p.name}</li>)}</ul>}
          </>
        ) : (
          <p class="progress-text small">{evalBusy && <span class="spinner" aria-hidden="true" />} {S.model.computing}</p>
        )}
      </Panel>

      {selItem && (
        <Panel title={`${S.manual.coords}: ${itemName(selItem.id)}`}>
          <div class="grid-2">
            <NumberField
              id="sel-x"
              label={S.manual.x}
              value={selItem.pos.x}
              unit="м"
              min={0.05}
              max={room.depth - 0.05}
              onChange={(v) => move(selItem.id, { x: v, y: selItem.pos.y })}
            />
            <NumberField
              id="sel-y"
              label={S.manual.y}
              value={selItem.pos.y}
              unit="м"
              min={0.05}
              max={room.width - 0.05}
              onChange={(v) => move(selItem.id, { x: selItem.pos.x, y: v })}
            />
          </div>
        </Panel>
      )}

      <Panel title={S.manual.variants}>
        <div class="inline-form">
          <div class="field">
            <label for="variant-name">{S.manual.variantName}</label>
            <div class="field__box">
              <input id="variant-name" value={name} placeholder={`Вариант ${project.setups.length + 1}`} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
            </div>
          </div>
          <button type="button" class="btn" onClick={saveVariant}>{S.manual.saveAs}</button>
        </div>
        {project.setups.length === 0 ? (
          <p class="muted small">{S.manual.noVariants}</p>
        ) : (
          <ul class="project-list">
            {project.setups.map((s) => (
              <VariantRow
                key={s.id}
                setup={s}
                score={wave ? null : evaluateSetup(room, sources, c, s, { ppo: 12 }).score}
                comparing={compareId === s.id}
                onLoad={() => onSetup({ ...JSON.parse(JSON.stringify(s)), id: current.id, name: current.name })}
                onCompare={() => setCompareId(compareId === s.id ? null : s.id)}
                onDelete={() => { onSetups(project.setups.filter((x) => x.id !== s.id)); if (compareId === s.id) setCompareId(null); }}
              />
            ))}
          </ul>
        )}
        {compareEval && compareSetup && evalCur && (
          <Note>
            {S.manual.compared(compareSetup.name)}: {fmt(compareEval.score, 1)} дБ против {fmt(evalCur.score, 1)} дБ у текущей.
          </Note>
        )}
      </Panel>

      <Details summary="Как считается карта">
        <p class="small">
          Для каждой точки сетки с шагом 10 см считается неровность АЧХ так же, как в автоподборе. Для сабвуфера используется
          взаимность: отклик «сабвуфер → слушатель» равен отклику «слушатель → сабвуфер», поэтому карта — это цифровой аналог
          «ползания с сабвуфером». Блёклые клетки — места вне выбранной зоны сабвуфера.
        </p>
      </Details>
    </div>
  );
}

const spkPair = (sources: Project['sources']) => sources.filter((s) => s.kind === 'speaker').length === 2;

function VariantRow(p: { setup: Setup; score: number | null; comparing: boolean; onLoad: () => void; onCompare: () => void; onDelete: () => void; key?: string }) {
  return (
    <li>
      <div>
        <strong>{p.setup.name}</strong>
        {p.score != null && <span class="muted small">{fmt(p.score, 1)} дБ</span>}
      </div>
      <div class="btn-row btn-row--tight">
        <button type="button" class="btn btn--small" onClick={p.onLoad}>{S.manual.load}</button>
        <button type="button" class={`btn btn--small${p.comparing ? ' btn--primary' : ''}`} onClick={p.onCompare}>
          {p.comparing ? S.manual.stopCompare : S.manual.compare}
        </button>
        <button type="button" class="btn btn--small btn--ghost" onClick={p.onDelete} aria-label={`${S.manual.remove} ${p.setup.name}`}>×</button>
      </div>
    </li>
  );
}
