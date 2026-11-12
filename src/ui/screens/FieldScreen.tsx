// Экран «3D»: где выбранные частоты гудят и проваливаются — в объёме и в горизонтальном слое.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { FunctionComponent } from 'preact';
import type { Project } from '../../state/project';
import type { Mode, Setup, Vec3 } from '../../core/types';
import type { SystemMode } from '../../core/fdtd';
import { bandFreqs, combineEnergy, sliceField, type FieldKind, type FieldResult } from '../../core/field3d';
import { isWave } from '../../core/geometry';
import { computeReverb } from '../../core/reverb';
import { compute, type ComputeJob } from '../compute';
import { PlanKey, PlanView, keysFor, type PlanItem, type PlanProps } from '../components/PlanView';
import { HeightRange } from '../components/HeightRange';
import { NumberField, Note, Panel, Segmented } from '../design-system';
import { SPAN } from '../fieldColors';
import { S } from '../strings';
import { PlayButton } from '../components/MiniPlayer';
import { fmt } from '../format';
import { modeWhere } from '../../core/modes';
import { shownTreatments } from '../../core/treatments';

type View = 'single' | 'band';
interface Pick { f: number; n?: [number, number, number] }

// состояние экрана живёт между переключениями вкладок
const saved: {
  kind: FieldKind; pick: Pick | null; view: View; band: [number, number]; threshold: number; sliceZ: number | null; roomKey?: string;
} = { kind: 'excited', pick: null, view: 'single', band: [40, 60], threshold: 6, sliceZ: null };

/** Открыть экран 3D сразу на этой частоте (переход из «Обзора»). */
export function setFieldFocus(f: number) {
  saved.pick = { f: Math.round(f * 10) / 10 };
  saved.view = 'single';
  // частота выбрана для нынешней комнаты: сброс выбора «комната изменилась» к ней не относится
  saved.roomKey = undefined;
}

/**
 * Посчитанные поля: переключение между уже просмотренными частотами — без пересчёта и мигания.
 * Ключ — всё, от чего зависит поле (комната, источники, их места и настройки, вид, частоты).
 */
const fieldCache = new Map<string, FieldResult>();
const CACHE_MAX = 16;

/** Ползунок частоты — по логарифмической шкале: низкие моды стоят густо. */
const SLIDER_STEPS = 1000;
const toSlider = (f: number, lo: number, hi: number) => Math.round((Math.log(f / lo) / Math.log(hi / lo)) * SLIDER_STEPS);
const fromSlider = (v: number, lo: number, hi: number) => Math.round(lo * Math.pow(hi / lo, v / SLIDER_STEPS) * 10) / 10;
/** Ползунок «прилипает» к моде ближе 1,5 % по частоте. */
const SNAP = 0.015;

interface Props {
  project: Project;
  modes: Mode[];
  onSetup: (s: Setup) => void;
}

const THRESHOLDS = [3, 6, 9, 12];

/** Сколько частот-кнопок видно сразу (остальные — по «Ещё»): первые моды — самые важные. */
const QUICK_SHOWN = 12;

/** Ближайшая к частоте мода (без нулевой). */
function nearestOf(modes: Mode[], f: number): Mode {
  return modes.filter((m) => m.f > 0).reduce((a, b) => (Math.abs(b.f - f) < Math.abs(a.f - f) ? b : a), modes[1] ?? modes[0]);
}

export function FieldScreen({ project, modes, onSetup }: Props) {
  const { room, sources, constraints: c, current } = project;
  const wave = isWave(room);
  const fTop = useMemo(() => Math.min(300, Math.max(120, computeReverb(room).schroeder)), [room]);

  const [kind, setKind] = useState<FieldKind>(saved.kind);
  const [pick, setPick] = useState<Pick | null>(saved.pick);
  const [view, setView] = useState<View>(saved.view);
  const [allChips, setAllChips] = useState(false);
  const [band, setBand] = useState<[number, number]>(saved.band);
  const [threshold, setThreshold] = useState(saved.threshold);
  // высота среза: по умолчанию — высота ушей
  const [sliceZ, setSliceZ] = useState<number>(saved.sliceZ ?? Math.min(room.height, c.earHeight));
  const [sysModes, setSysModes] = useState<SystemMode[] | null>(null);
  const [field, setField] = useState<FieldResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [probe, setProbe] = useState<{ x: number; y: number } | null>(null);
  const [View3D, setView3D] = useState<FunctionComponent<any> | null>(null);
  const job = useRef<ComputeJob<FieldResult> | null>(null);

  useEffect(() => { Object.assign(saved, { kind, pick, view, band, threshold, sliceZ }); }, [kind, pick, view, band, threshold, sliceZ]);
  useEffect(() => { import('../components/Field3D').then((m) => setView3D(() => m.default)).catch(() => undefined); }, []);
  // срез — в пределах высоты комнаты
  useEffect(() => {
    const h = room.height;
    setSliceZ((z) => Math.min(z, h));
  }, [room.height]);

  // моды для быстрого выбора: прямоугольная модель — расчётные, волновая — моды системы
  useEffect(() => {
    // прежние моды другой комнаты не показываем, пока считаются новые
    setSysModes(null);
    if (!wave) return;
    const j = compute<SystemMode[]>('modes', { room, fMax: Math.min(200, fTop) });
    j.promise.then(setSysModes).catch(() => setSysModes([]));
    return () => j.cancel();
  }, [room, wave, fTop]);
  const quick: Pick[] = useMemo(() => {
    if (wave) return (sysModes ?? []).filter((m) => m.f <= fTop).slice(0, 24).map((m) => ({ f: Math.round(m.f * 10) / 10 }));
    return modes.filter((m) => m.f > 0 && m.f <= fTop).slice(0, 24).map((m) => ({ f: Math.round(m.f * 10) / 10, n: m.n }));
  }, [wave, sysModes, modes, fTop]);
  // по умолчанию — самая низкая мода
  // другая комната — моды другие: прежний выбор частот (и номера мод) не годится
  const roomKey = `${room.depth}|${room.width}|${room.height}|${(room.extensions ?? []).length}|${room.slope ? 1 : 0}`;
  useEffect(() => {
    // сбрасываем выбор; самую низкую моду подставит следующий эффект, когда моды новой комнаты будут готовы
    if (saved.roomKey && saved.roomKey !== roomKey) setPick(null);
    saved.roomKey = roomKey;
  }, [roomKey]);
  useEffect(() => { if (quick.length) setPick((p) => p ?? quick[0]); }, [quick]);

  // одна частота: кнопка моды или ползунок (только для «Ваша система»)
  // у слившихся мод одна частота: выбранной считается та, чьи номера совпадают
  const isPicked = (p: Pick) => !!pick && Math.abs(pick.f - p.f) < 0.05 && (!pick.n || !p.n || pick.n.join() === p.n.join());
  const fLo = 15, fHi = fTop;
  const onSlider = (v: number) => {
    const f = fromSlider(v, fLo, fHi);
    const near = quick.reduce<Pick | null>((a, q) => (Math.abs(q.f - f) / q.f < SNAP && (!a || Math.abs(q.f - f) < Math.abs(a.f - f)) ? q : a), null);
    setPick(near ?? { f });
  };

  // что считать
  const request = useMemo(() => {
    const shapeModal = kind === 'shape' && !wave;
    if (view === 'band') {
      if (shapeModal) {
        const inBand = modes.filter((m) => m.f > 0 && m.f >= Math.min(...band) && m.f <= Math.max(...band));
        const list = inBand.length ? inBand : [nearestOf(modes, (band[0] + band[1]) / 2)];
        return { freqs: list.map((m) => m.f), modes: list.map((m) => m.n) };
      }
      return { freqs: bandFreqs(band[0], band[1]) };
    }
    if (!pick) return null;
    if (shapeModal) {
      const m = pick.n ? { f: pick.f, n: pick.n } : nearestOf(modes, pick.f);
      return { freqs: [m.f], modes: [m.n] };
    }
    return { freqs: [pick.f] };
  }, [kind, wave, view, band, pick, modes]);

  useEffect(() => {
    if (!request) { setField(null); return; }
    const key = JSON.stringify([room, sources, current.positions, current.subSettings, current.crossoverHz, kind, request]);
    const hit = fieldCache.get(key);
    // уже считали — сразу; иначе прежняя картинка остаётся на экране, пока считается новая
    if (hit) { job.current?.cancel(); setField(hit); setBusy(false); setError(null); return; }
    const t = setTimeout(() => {
      job.current?.cancel();
      setBusy(true);
      setError(null);
      setProgress(0);
      const j = compute<FieldResult>('field', { room, sources, setup: current, kind, ...request }, setProgress);
      job.current = j;
      j.promise
        .then((r) => {
          if (fieldCache.size >= CACHE_MAX) fieldCache.delete(fieldCache.keys().next().value!);
          fieldCache.set(key, r);
          if (job.current === j) { setField(r); setBusy(false); }
        })
        .catch((e) => { if (job.current === j) { setError(e.message); setBusy(false); } });
    }, 300);
    return () => clearTimeout(t);
    // положение слушателя на поле не влияет — не пересчитываем, когда его двигают
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room, sources, current.positions, current.subSettings, current.crossoverHz, kind, request]);
  useEffect(() => () => job.current?.cancel(), []);

  // показываем то, что посчитано (пока считается новая частота — прежнюю, с подписью, какая она)
  const energy = useMemo(() => (field ? combineEnergy(field, field.freqs.map((_, i) => i)) : null), [field]);
  const shown = field
    ? field.freqs.length === 1 ? S.field.shown(fmt(field.freqs[0], 1)) : S.field.shownBand(fmt(Math.min(...field.freqs), 0), fmt(Math.max(...field.freqs), 0))
    : null;
  const shapeOf = kind === 'shape' && !wave && pick && !pick.n ? nearestOf(modes, pick.f) : null;
  const sl = useMemo(() => (field && energy ? sliceField(field, energy, sliceZ) : null), [field, energy, sliceZ]);

  const items = useMemo<PlanItem[]>(() => [
    ...sources.filter((s) => current.positions[s.id]).map((s) => ({
      id: s.id, kind: (s.kind === 'sub' ? 'sub' : 'spk') as PlanItem['kind'], pos: current.positions[s.id],
    })),
    { id: 'listener', kind: 'listener', pos: current.listener },
  ], [current, sources]);
  const items3d = useMemo(() => items.map((i) => ({ id: i.id, kind: i.kind, pos: i.pos as Vec3 })), [items]);
  const move = (id: string, pos: { x: number; y: number }) => {
    if (id === 'listener') { onSetup({ ...current, listener: { x: pos.x, y: pos.y, z: c.earHeight } }); return; }
    const spec = sources.find((s) => s.id === id);
    if (!spec) return;
    onSetup({ ...current, positions: { ...current.positions, [id]: { x: pos.x, y: pos.y, z: spec.height } } });
  };
  const probeDb = (() => {
    if (!probe || !sl) return null;
    const i = Math.round((probe.x - sl.x0) / sl.sx), j = Math.round((probe.y - sl.y0) / sl.sy);
    if (i < 0 || j < 0 || i >= sl.nx || j >= sl.ny) return null;
    const v = sl.db[i * sl.ny + j];
    return Number.isFinite(v) ? v : null;
  })();
  const planProps: PlanProps = {
    depth: room.depth,
    width: room.width,
    items,
    zones: room.zones,
    extensions: room.extensions,
    openings: room.openings,
    features: room.features,
    treatments: shownTreatments(room),
    slope: room.slope,
    field: sl ? { slice: sl, threshold } : null,
    marks: probe ? [{ x: probe.x, y: probe.y, label: '', kind: 'probe' }] : [],
    onMove: move,
    onTap: setProbe,
    label: 'Срез поля сверху',
  };

  return (
    <div class="screen">
      <Panel class="panel--hero">
        <p class="small">{S.field.intro}</p>
        <div class="field3d-wrap">
          {View3D ? <View3D room={room} field={field} energy={energy} threshold={threshold} items={items3d} sliceZ={sliceZ} /> : <div class="field3d field3d--loading" />}
          {busy && (
            <div class="field3d__busy" role="status">
              <span class="spinner" aria-hidden="true" /> {S.field.computing} {progress > 0.01 ? `${Math.round(progress * 100)} %` : ''}
            </div>
          )}
        </div>
        {shown && <p class="field-shown small">{shown}{busy ? ` · ${S.field.computingNew}` : ''}</p>}
        <p class="muted small">{S.field.rotateHint}</p>
        <Segmented
          label={S.field.kindLabel}
          value={kind}
          options={[{ value: 'excited' as FieldKind, label: S.field.kinds.excited }, { value: 'shape' as FieldKind, label: S.field.kinds.shape }]}
          onChange={setKind}
        />
        <p class="muted small">{kind === 'excited' ? S.field.kindHint.excited : S.field.kindHint.shape}</p>

        <Segmented
          label={S.field.viewLabel}
          value={view}
          options={[
            { value: 'single' as View, label: S.field.views.single },
            { value: 'band' as View, label: S.field.views.band },
          ]}
          onChange={setView}
        />
        {view === 'single' && (
          <div class="field">
            <span class="field__label" id="field-freqs">{S.field.freqs}</span>
            <div class="segmented segmented--wrap freq-picks" role="radiogroup" aria-labelledby="field-freqs">
              {(allChips ? quick : quick.filter((p, i) => i < QUICK_SHOWN || isPicked(p))).map((p) => (
                <button key={p.n ? p.n.join('-') : p.f} type="button" role="radio" aria-checked={isPicked(p)} class={isPicked(p) ? 'is-on' : ''} onClick={() => setPick(p)}>
                  {fmt(p.f, 1)}{p.n && <small>{modeWhere(p.n, true)}</small>}
                </button>
              ))}
            </div>
            {quick.length > QUICK_SHOWN && (
              <button type="button" class="btn btn--small btn--ghost" aria-expanded={allChips} onClick={() => setAllChips(!allChips)}>
                {allChips ? S.field.fewer : S.field.more(quick.length - QUICK_SHOWN)}
              </button>
            )}
            {kind === 'excited' && (
              <div class="freq-slider">
                <label class="field__label" for="field-slider">{S.field.slider}: <strong>{pick ? `${fmt(pick.f, 1)} Гц` : '—'}</strong>{pick?.n ? ` · ${modeWhere(pick.n, true)}` : ''}</label>
                <input
                  id="field-slider"
                  type="range"
                  min={0}
                  max={SLIDER_STEPS}
                  step={1}
                  value={pick ? toSlider(Math.min(fHi, Math.max(fLo, pick.f)), fLo, fHi) : 0}
                  onInput={(e) => onSlider(+(e.target as HTMLInputElement).value)}
                />
                <div class="freq-slider__ticks" aria-hidden="true">
                  {quick.filter((q) => q.f >= fLo && q.f <= fHi).map((q) => (
                    <span key={q.f} style={{ left: `${(toSlider(q.f, fLo, fHi) / SLIDER_STEPS) * 100}%` }} />
                  ))}
                </div>
                <div class="freq-slider__scale muted small" aria-hidden="true"><span>{fLo} Гц</span><span>{fmt(fHi, 0)} Гц</span></div>
              </div>
            )}
            {shapeOf && <p class="muted small">{S.field.nearestShape(fmt(shapeOf.f, 1), modeWhere(shapeOf.n, true))}</p>}
            <p class="muted small">{kind === 'excited' ? (wave ? S.field.quickWave : S.field.quickModal) : S.field.quickShape}</p>
          </div>
        )}
        {view === 'single' && pick && (
          <div class="play-row">
            <PlayButton f={pick.f} />
            <span class="small">{S.field.playHint(fmt(pick.f, 1))}</span>
          </div>
        )}
        {view === 'band' && (
          <div class="grid-2">
            <NumberField compact id="band-lo" label={S.field.bandFrom} value={band[0]} unit="Гц" min={10} max={300} digits={0} onChange={(v) => setBand([v, band[1]])} />
            <NumberField compact id="band-hi" label={S.field.bandTo} value={band[1]} unit="Гц" min={10} max={300} digits={0} onChange={(v) => setBand([band[0], v])} />
          </div>
        )}
        <Segmented
          label={S.field.threshold}
          value={threshold}
          options={THRESHOLDS.map((t) => ({ value: t, label: `±${t}` }))}
          onChange={setThreshold}
        />
        <div class="field-legend" aria-hidden="true">
          <span>−{threshold + SPAN}</span>
          <span class="field-legend__bar" />
          <span>+{threshold + SPAN} дБ</span>
        </div>
        <p class="muted small">{S.field.legend(threshold)}</p>
        {field && <span class="model-tag">{field.model === 'wave' ? S.model.waveTag : S.model.modalTag}</span>}
        {field && field.skipped.length > 0 && <Note tone="warn">{S.field.skipped(field.skipped.map((f) => fmt(f, 0)).join(', '))}</Note>}
        {error && <Note tone="warn">{error}</Note>}
        {!request && <Note>{S.field.pickSome}</Note>}
      </Panel>

      <Panel title={S.field.sliceTitle}>
        <p class="small">{S.field.sliceIntro}</p>
        <div class="slice-row">
          <div class="slice-row__plan">
            <PlanView {...planProps} showKey={false} />
          </div>
          <HeightRange max={room.height} value={sliceZ} onChange={setSliceZ} />
        </div>
        <p class="small"><strong>{S.field.sliceAt(Math.round(sliceZ * 100))}</strong>{Math.abs(sliceZ - c.earHeight) < 0.026 ? ` · ${S.field.sliceEars}` : ''}</p>
        <PlanKey keys={keysFor(planProps)} notes={{ probe: S.field.probeKey }} />
        {probe && (
          <div class="probe">
            <span>
              <strong>{S.manual.probe}:</strong> {fmt(probe.x, 2)} × {fmt(probe.y, 2)} м — {probeDb == null ? '—' : `${probeDb > 0 ? '+' : ''}${fmt(probeDb, 1)} дБ`}
            </span>
            <button type="button" class="btn btn--small btn--ghost" onClick={() => setProbe(null)}>{S.manual.removeProbe}</button>
          </div>
        )}
      </Panel>
    </div>
  );
}
