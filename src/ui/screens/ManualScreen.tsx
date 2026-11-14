import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { shownTreatments } from '../../core/treatments';
import { MapModeHelp, type MapMode } from '../components/MapModeHelp';
import { ScoreBlock } from '../components/ScoreBlock';
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
import { SmoothedResponseChart } from '../components/SmoothedResponseChart';
import { NumberField, Panel, Segmented, Note, Details } from '../design-system';
import { S } from '../strings';
import { fmt } from '../format';
import { PlanLayers, usePlanLayers } from '../components/PlanLayers';
import { isFlat } from '../../core/objective';
import { useViewState } from '../useViewState';
import { evalPpo, gridPpo } from '../../core/precision';

interface Props {
  project: Project;
  onSetup: (s: Setup) => void;
  onSetups: (list: Setup[]) => void;
  /** Переключатель режима: стоит первым в карточке ручного режима, над его настройками. */
  header?: ComponentChildren;
}

type Mode = 'listener' | 'sub';

export function ManualScreen({ project, onSetup, onSetups, header }: Props) {
  const { room, sources, constraints: c, current, precision } = project;
  // 026: текущая расстановка, проба и сравнение — на сетке графика; карта — на сетке поиска
  const ppo = evalPpo(precision);
  const mapPpo = gridPpo(precision, c.objective);
  const layers = usePlanLayers();
  const flatGoal = isFlat(c.objective);
  const subs = sources.filter((s) => s.kind === 'sub');
  const [mode, setMode] = useViewState<Mode>(project.id, 'manual.mode', 'listener');
  const [subId, setSubId] = useViewState(project.id, 'manual.sub', subs[0]?.id ?? '');
  const [symmetric, setSymmetric] = useViewState(project.id, 'manual.symmetric', true);
  const [selected, setSelected] = useViewState<string | null>(project.id, 'manual.selected', null);
  const [heatRaw, setHeat] = useState<Heatmap | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [probe, setProbe] = useState<{ x: number; y: number } | null>(null);
  const [compareId, setCompareId] = useViewState<string | null>(project.id, 'manual.compare', null);
  const [layer, setLayer] = useViewState<'flat' | 'robust'>(project.id, 'manual.layer', 'flat');
  const [name, setName] = useViewState(project.id, 'manual.name', '');
  const job = useRef<ComputeJob<Heatmap> | null>(null);

  const effMode: Mode = mode === 'sub' && subs.length ? 'sub' : 'listener';
  const effSub = subs.some((s) => s.id === subId) ? subId : subs[0]?.id ?? '';
  // карта другого режима (место слушателя ↔ место сабвуфера, другой сабвуфер) не годится для нового: пока считается
  // новая, прежние «лучшие места» и окраска не показываются — иначе «Поставить сюда» ставило сабвуфер в место кресла
  const heat = heatRaw && heatRaw.kind === effMode && (effMode !== 'sub' || heatRaw.subId === effSub) ? heatRaw : null;
  const robustHeat = useMemo(() => (heat ? robustnessMap(heat, heat.kind === 'listener' ? ROBUST_LISTENER_SHIFT : ROBUST_SOURCE_SHIFT) : null), [heat]);

  const { ev: evalCurMaybe, busy: evalBusy, error: evalError } = useSetupEval(room, sources, c, current, ppo);
  const wave = isWave(room);

  // Пересчёт карты с задержкой (во время перетаскивания не дёргаем воркер)
  useEffect(() => {
    const t = setTimeout(() => {
      job.current?.cancel();
      setBusy(true);
      setError(null);
      const j = compute(effMode === 'sub' ? 'subMap' : 'listenerMap', { room, sources, constraints: c, setup: current, subId: effSub, ppo: mapPpo });
      job.current = j;
      j.promise
        .then((h) => { if (job.current === j) { setHeat(h); setBusy(false); } })
        .catch((e) => { if (job.current === j) { setError(e.message); setBusy(false); } });
    }, 350);
    return () => clearTimeout(t);
    // только то, что меняет карту (переименование варианта пересчёта не требует)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room, sources, c, current.positions, current.listener, current.subSettings, current.crossoverHz, effMode, effSub, mapPpo]);
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
  const { ev: probeEval } = useSetupEval(room, sources, c, probeSetup, ppo);

  const compareSetup = project.setups.find((s) => s.id === compareId) ?? null;
  // оценки сохранённых вариантов — на той же сетке, что и текущая расстановка (раньше — на сетке поиска: у той же
  // расстановки в списке было другое число), и не пересчитываются при каждой перерисовке
  const variantScores = useMemo(
    () => (isWave(room) ? null : Object.fromEntries(project.setups.map((s) => [s.id, evaluateSetup(room, sources, c, s, { ppo }).objScore]))),
    [room, sources, c, project.setups, ppo],
  );
  const { ev: compareEval } = useSetupEval(room, sources, c, compareSetup, ppo);

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
        {header}
        {!current.placed && (
          <>
            <Note>{S.manual.notPlaced}</Note>
            <div class="btn-row">
              <button type="button" class="btn btn--primary" onClick={() => onSetup({ ...current, placed: true })}>{S.manual.keepPlaces}</button>
            </div>
          </>
        )}
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
        <MapModeHelp mode={effMode as MapMode} where="manual" sub={effSub ? `С${effSub.slice(3)}` : undefined} />
        <PlanLayers {...layers} />
        <PlanView
          depth={room.depth}
          width={room.width}
          items={items}
          seats={evalCur?.seats ?? []}
          zones={room.zones} extensions={room.extensions} openings={room.openings} features={room.features} treatments={shownTreatments(room)} slope={room.slope}
          heatmap={layers.map ? (layer === 'robust' ? robustHeat : heat) : null}
          axes={layers.axes}
          marks={marks}
          selectedId={selected}
          onSelect={setSelected}
          onMove={move}
          onTap={(pos) => setProbe(pos)}
          keyNotes={effMode === 'sub' ? { best: S.manual.keyBestSub, probe: S.manual.keyProbeSub, heat: S.manual.keyHeatSub } : undefined}
          label="План комнаты с картой оценок"
        />
        {/* «Карта звука» прячет только окраску плана и её шкалу; выбор слоя и пояснение остаются (009) */}
        {layers.map && heat && <HeatLegend hm={layer === 'robust' ? robustHeat! : heat} />}
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
        <ScoreBlock
          objective={c.objective}
          objScore={evalCur ? evalCur.objScore : null}
          flatScore={evalCur ? evalCur.score : null}
          context={S.manual.current}
          flatDetail={evalCur?.angleDeg != null ? `${S.placement.angle}: ${fmt(evalCur.angleDeg, 0)}°.` : undefined}
        >
          <span class="model-tag">{wave ? S.model.waveTag : S.model.modalTag}</span>
        </ScoreBlock>
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
                    {d > 0.05 ? (flatGoal ? `, на ${fmt(d, 1)} дБ ровнее` : S.objective.betterHere(fmt(d, 1))) : ''}
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
              <strong>{S.manual.probe}:</strong> {fmt(probe.x, 2)} × {fmt(probe.y, 2)} м — {fmt(probeEval.objScore, 1)} дБ
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
            <SmoothedResponseChart screen="placement-manual"
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
        ) : evalError ? (
          <Note tone="warn">{evalError}</Note>
        ) : (
          <p class="progress-text small">{evalBusy && <span class="spinner" aria-hidden="true" />} {S.model.computing}</p>
        )}
      </Panel>

      {selItem && (
        <Panel title={`${S.manual.coords}: ${itemName(selItem.id)}`}>
          <div class="grid-2">
            <NumberField
              id="sel-x"
              key={`x-${selItem.id}`}
              label={S.manual.x}
              value={selItem.pos.x}
              unit="м"
              min={0.05}
              max={room.depth - 0.05}
              onChange={(v) => move(selItem.id, { x: v, y: selItem.pos.y })}
            />
            <NumberField
              id="sel-y"
              key={`y-${selItem.id}`}
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
                score={variantScores ? variantScores[s.id] ?? null : null}
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
            {S.manual.compared(compareSetup.name)}: {fmt(compareEval.objScore, 1)} дБ против {fmt(evalCur.objScore, 1)} дБ у текущей.
          </Note>
        )}
      </Panel>

      <Details summary="Как считается карта">
        <p class="small">
          Для каждой точки сетки с шагом 10 см считается неровность АЧХ так же, как в автоподборе. Для сабвуфера используется
          взаимность: отклик «сабвуфер → слушатель» равен отклику «слушатель → сабвуфер», поэтому карта — это цифровой аналог
          «ползания с сабвуфером». Блёклые клетки — места вне выбранной зоны сабвуфера.
        </p>
        <p class="small">{S.precision.mapNote}</p>
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
