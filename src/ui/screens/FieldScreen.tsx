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
import { NumberField, Note, Panel, Segmented } from '../components/Fields';
import { SPAN } from '../fieldColors';
import { S } from '../strings';
import { PlayButton } from '../components/MiniPlayer';
import { fmt } from '../format';

type View = 'single' | 'average' | 'band';
interface Pick { f: number; n?: [number, number, number] }

// состояние экрана живёт между переключениями вкладок
const saved: {
  kind: FieldKind; picks: Pick[]; view: View; active: number; band: [number, number]; threshold: number; slice: [number, number] | null; roomKey?: string;
} = { kind: 'excited', picks: [], view: 'single', active: 0, band: [40, 60], threshold: 6, slice: null };

/** Открыть экран 3D сразу на этой частоте (переход из «Обзора»). */
export function setFieldFocus(f: number) {
  const p = { f: Math.round(f * 10) / 10 };
  if (!saved.picks.some((q) => Math.abs(q.f - p.f) < 0.05)) saved.picks = [...saved.picks, p].sort((a, b) => a.f - b.f);
  saved.view = 'single';
  saved.active = saved.picks.findIndex((q) => Math.abs(q.f - p.f) < 0.05);
}

interface Props {
  project: Project;
  modes: Mode[];
  onSetup: (s: Setup) => void;
}

const THRESHOLDS = [3, 6, 9, 12];

export function FieldScreen({ project, modes, onSetup }: Props) {
  const { room, sources, constraints: c, current } = project;
  const wave = isWave(room);
  const fTop = useMemo(() => Math.min(300, Math.max(120, computeReverb(room).schroeder)), [room]);

  const [kind, setKind] = useState<FieldKind>(saved.kind);
  const [picks, setPicks] = useState<Pick[]>(saved.picks);
  const [view, setView] = useState<View>(saved.view);
  const [active, setActive] = useState(saved.active);
  const [band, setBand] = useState<[number, number]>(saved.band);
  const [threshold, setThreshold] = useState(saved.threshold);
  const [slice, setSlice] = useState<[number, number]>(saved.slice ?? [Math.max(0, c.earHeight - 0.1), Math.min(room.height, c.earHeight + 0.1)]);
  const [custom, setCustom] = useState(50);
  const [sysModes, setSysModes] = useState<SystemMode[] | null>(null);
  const [field, setField] = useState<FieldResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [probe, setProbe] = useState<{ x: number; y: number } | null>(null);
  const [View3D, setView3D] = useState<FunctionComponent<any> | null>(null);
  const job = useRef<ComputeJob<FieldResult> | null>(null);

  useEffect(() => { Object.assign(saved, { kind, picks, view, active, band, threshold, slice }); }, [kind, picks, view, active, band, threshold, slice]);
  useEffect(() => { import('../components/Field3D').then((m) => setView3D(() => m.default)).catch(() => undefined); }, []);
  // срез — в пределах высоты комнаты
  useEffect(() => {
    if (slice[1] > room.height || slice[0] > room.height) setSlice([Math.min(slice[0], room.height), Math.min(slice[1], room.height)]);
  }, [room.height]);

  // моды для быстрого выбора: прямоугольная модель — расчётные, волновая — моды системы
  useEffect(() => {
    if (!wave) { setSysModes(null); return; }
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
    if (saved.roomKey && saved.roomKey !== roomKey) { setPicks(quick.length ? [quick[0]] : []); setActive(0); }
    saved.roomKey = roomKey;
  }, [roomKey]);
  useEffect(() => { if (!picks.length && quick.length) setPicks([quick[0]]); }, [quick]);

  const nearestMode = (f: number) => modes.filter((m) => m.f > 0).reduce((a, b) => (Math.abs(b.f - f) < Math.abs(a.f - f) ? b : a), modes[1] ?? modes[0]);
  const isPicked = (p: Pick) => picks.some((q) => Math.abs(q.f - p.f) < 0.05);
  const toggle = (p: Pick) => {
    setPicks((ps) => (isPicked(p) ? ps.filter((q) => Math.abs(q.f - p.f) >= 0.05) : [...ps, p].sort((a, b) => a.f - b.f)));
  };
  const addCustom = () => {
    if (!(custom >= 10 && custom <= 300)) return;
    const p: Pick = { f: Math.round(custom * 10) / 10 };
    if (!isPicked(p)) setPicks((ps) => [...ps, p].sort((a, b) => a.f - b.f));
  };

  // что считать
  const request = useMemo(() => {
    const shapeModal = kind === 'shape' && !wave;
    if (view === 'band') {
      if (shapeModal) {
        const inBand = modes.filter((m) => m.f > 0 && m.f >= Math.min(...band) && m.f <= Math.max(...band));
        const list = inBand.length ? inBand : [nearestMode((band[0] + band[1]) / 2)];
        return { freqs: list.map((m) => m.f), modes: list.map((m) => m.n) };
      }
      return { freqs: bandFreqs(band[0], band[1]) };
    }
    if (!picks.length) return null;
    if (shapeModal) {
      const ms = picks.map((p) => (p.n ? { f: p.f, n: p.n } : { f: nearestMode(p.f).f, n: nearestMode(p.f).n }));
      return { freqs: ms.map((m) => m.f), modes: ms.map((m) => m.n) };
    }
    return { freqs: picks.map((p) => p.f) };
  }, [kind, wave, view, band, picks, modes]);

  useEffect(() => {
    if (!request) { setField(null); return; }
    const t = setTimeout(() => {
      job.current?.cancel();
      setBusy(true);
      setError(null);
      setProgress(0);
      const j = compute<FieldResult>('field', { room, sources, setup: current, kind, ...request }, setProgress);
      job.current = j;
      j.promise
        .then((r) => { if (job.current === j) { setField(r); setBusy(false); } })
        .catch((e) => { if (job.current === j) { setError(e.message); setBusy(false); } });
    }, 300);
    return () => clearTimeout(t);
  }, [room, sources, current.positions, current.subSettings, current.crossoverHz, kind, request]);
  useEffect(() => () => job.current?.cancel(), []);

  // какие частоты сводим
  const activeIdx = Math.min(active, Math.max(0, picks.length - 1));
  const energy = useMemo(() => {
    if (!field) return null;
    if (view === 'single') {
      const want = request?.freqs[activeIdx];
      if (want == null) return null;
      let best = -1, d = Infinity;
      field.freqs.forEach((f, i) => { if (Math.abs(f - want) < d) { d = Math.abs(f - want); best = i; } });
      return best >= 0 && d < 0.5 ? combineEnergy(field, [best]) : null;
    }
    return combineEnergy(field, field.freqs.map((_, i) => i));
  }, [field, view, activeIdx, request]);
  const sl = useMemo(() => (field && energy ? sliceField(field, energy, slice[0], slice[1]) : null), [field, energy, slice]);

  const items: PlanItem[] = [
    ...sources.filter((s) => current.positions[s.id]).map((s) => ({
      id: s.id, kind: (s.kind === 'sub' ? 'sub' : 'spk') as PlanItem['kind'], pos: current.positions[s.id],
    })),
    { id: 'listener', kind: 'listener', pos: current.listener },
  ];
  const items3d = useMemo(() => items.map((i) => ({ id: i.id, kind: i.kind, pos: i.pos as Vec3 })), [current, sources]);
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
  const thick = Math.round(Math.abs(slice[1] - slice[0]) * 100);
  const planProps: PlanProps = {
    depth: room.depth,
    width: room.width,
    items,
    zones: room.zones,
    extensions: room.extensions,
    openings: room.openings,
    features: room.features,
    treatments: room.treatments,
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
        <Segmented
          label={S.field.kindLabel}
          value={kind}
          options={[{ value: 'excited' as FieldKind, label: S.field.kinds.excited }, { value: 'shape' as FieldKind, label: S.field.kinds.shape }]}
          onChange={setKind}
        />
        <p class="muted small">{kind === 'excited' ? S.field.kindHint.excited : S.field.kindHint.shape}</p>

        {view !== 'band' && (
          <div class="field">
            <span class="field__label">{S.field.freqs}</span>
            <div class="chips" role="group" aria-label={S.field.freqs}>
              {quick.map((p) => (
                <button type="button" class={`chip${isPicked(p) ? ' is-on' : ''}`} aria-pressed={isPicked(p)} onClick={() => toggle(p)}>
                  {fmt(p.f, 1)}{p.n && <small> {p.n.join('')}</small>}
                </button>
              ))}
              {picks.filter((p) => !quick.some((q) => Math.abs(q.f - p.f) < 0.05)).map((p) => (
                <button type="button" class="chip is-on is-custom" aria-pressed="true" onClick={() => toggle(p)}>{fmt(p.f, 1)} ×</button>
              ))}
            </div>
            <div class="custom-freq">
              <NumberField compact id="field-custom" label={S.field.custom} value={custom} unit="Гц" min={10} max={300} digits={1} onChange={setCustom} />
              <button type="button" class="btn btn--small" onClick={addCustom}>{S.field.add}</button>
            </div>
            <p class="muted small">{wave ? S.field.quickWave : S.field.quickModal}</p>
          </div>
        )}

        <div class="field3d-wrap">
          {View3D ? <View3D room={room} field={field} energy={energy} threshold={threshold} items={items3d} slice={slice} /> : <div class="field3d field3d--loading" />}
          {busy && (
            <div class="field3d__busy" role="status">
              <span class="spinner" aria-hidden="true" /> {S.field.computing} {progress > 0.01 ? `${Math.round(progress * 100)} %` : ''}
            </div>
          )}
        </div>
        <p class="muted small">{S.field.rotateHint}</p>

        <Segmented
          label={S.field.viewLabel}
          value={view}
          options={[
            { value: 'single' as View, label: S.field.views.single },
            { value: 'average' as View, label: S.field.views.average },
            { value: 'band' as View, label: S.field.views.band },
          ]}
          onChange={setView}
        />
        {view === 'single' && picks[activeIdx] && (
          <div class="play-row">
            <PlayButton f={picks[activeIdx].f} />
            <span class="small">{S.field.playHint(fmt(picks[activeIdx].f, 1))}</span>
          </div>
        )}
        {view === 'single' && picks.length > 1 && (
          <div class="chips" role="radiogroup" aria-label={S.field.which}>
            {picks.map((p, i) => (
              <button type="button" role="radio" aria-checked={i === activeIdx} class={`chip${i === activeIdx ? ' is-on' : ''}`} onClick={() => setActive(i)}>
                {fmt(p.f, 1)} Гц
              </button>
            ))}
          </div>
        )}
        {view === 'average' && <p class="muted small">{S.field.averageHint(picks.map((p) => fmt(p.f, 1)).join(', '))}</p>}
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
          <HeightRange max={room.height} value={slice} onChange={setSlice} />
        </div>
        <div class="grid-2">
          <NumberField compact id="slice-lo" label={S.field.sliceFrom} value={slice[0]} unit="м" min={0} max={room.height} digits={2} onChange={(v) => setSlice([Math.min(v, slice[1]), slice[1]])} />
          <NumberField compact id="slice-hi" label={S.field.sliceTo} value={slice[1]} unit="м" min={0} max={room.height} digits={2} onChange={(v) => setSlice([slice[0], Math.max(v, slice[0])])} />
        </div>
        <p class="muted small">{thick > 0 ? S.field.thickness(thick) : S.field.thin}</p>
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
