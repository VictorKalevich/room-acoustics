import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { FunctionComponent } from 'preact';
import type { Object3D } from 'three';
import type { Project } from '../../state/project';
import { defaultConstraints, makeId, rotateRoom, rotateSetup } from '../../state/project';
import type { Room, SurfaceId, ReverbResult, Furnishing, Zone, ZoneKind, Leakage, Opening, Extension, WallId, AcousticModel, WallFeature } from '../../core/types';
import { validateExtension, validateSlope, wallLength } from '../../core/geometry';
import { SURFACES } from '../../core/types';
import { MATERIALS, FURNISHING_LABEL } from '../../core/materials';
import { speedOfSound } from '../../core/physics';
import type { DetectResult, Units } from '../../scan/detect';
import type { LayoutResult, ScanLabels } from '../../scan/layout';
import { openingAsItem, toRoomItem, type WallItem, type WallItemKind } from '../../core/wallItems';
import { LayoutEditor, type Rect } from '../components/LayoutEditor';
import { NumberField, Panel, SelectField, Note, Details, Segmented } from '../components/Fields';
import { PlanView } from '../components/PlanView';
import { S } from '../strings';
import { fmt, fmtInt } from '../format';

interface Props {
  project: Project;
  reverb: ReverbResult;
  onRoom: (room: Room, extra?: Partial<Project>) => void;
}

type ScanState =
  | { phase: 'idle' }
  | { phase: 'loading' | 'detecting'; fileName: string }
  | { phase: 'error'; message: string }
  | { phase: 'done'; fileName: string };

interface Loaded {
  preview: Object3D;
  triangles: Float32Array;
  labels?: ScanLabels;
  format: string;
  count: number;
  decimated: boolean;
  fileName: string;
}

export function RoomScreen({ project, reverb, onRoom }: Props) {
  const room = project.room;
  const set = (patch: Partial<Room>) => onRoom({ ...room, ...patch });

  return (
    <div class="screen">
      <Panel class="panel--hero">
        <PlanView depth={room.depth} width={room.width} zones={room.zones} extensions={room.extensions} openings={room.openings} features={room.features} treatments={room.treatments} slope={room.slope} />
        <div class="dims">
          <NumberField label={S.room.depth} hint={S.room.depthHint} value={room.depth} unit="м" min={1} max={50} onChange={(v) => set({ depth: v })} />
          <NumberField label={S.room.width} hint={S.room.widthHint} value={room.width} unit="м" min={1} max={50} onChange={(v) => set({ width: v })} />
          <NumberField label={S.room.height} value={room.height} unit="м" min={1} max={20} onChange={(v) => set({ height: v })} />
        </div>
        <button
          type="button"
          class="btn btn--ghost"
          onClick={() => onRoom(rotateRoom(room), { current: rotateSetup(room, project.current), setups: project.setups.map((x) => rotateSetup(room, x)) })}
        >
          <RotateIcon /> {S.room.rotate}
        </button>
        <Details summary={S.room.temperature}>
          <NumberField
            label={S.room.temperature}
            value={room.temperatureC}
            unit="°C"
            min={-10}
            max={40}
            digits={0}
            hint={S.room.speed(fmt(speedOfSound(room.temperatureC), 1))}
            onChange={(v) => set({ temperatureC: v })}
          />
        </Details>
      </Panel>

      <ScanPanel project={project} onRoom={onRoom} />

      <OpeningsPanel room={room} onRoom={(r) => onRoom(r)} />

      <ZonesPanel room={room} onRoom={(r) => onRoom(r)} />

      <Panel title={S.room.materials}>
        <div class="grid-2">
          {SURFACES.map((s: SurfaceId) => (
            <SelectField
              label={S.room.surfaces[s]}
              value={room.materials[s]}
              options={MATERIALS.map((m) => ({ value: m.id, label: m.name }))}
              onChange={(v) => set({ materials: { ...room.materials, [s]: v } })}
            />
          ))}
        </div>
        <SelectField
          label={S.room.furnishing}
          value={room.furnishing}
          options={(Object.keys(FURNISHING_LABEL) as Furnishing[]).map((k) => ({ value: k, label: FURNISHING_LABEL[k] }))}
          onChange={(v) => set({ furnishing: v as Furnishing })}
        />
      </Panel>

      <Panel title={S.room.reverb}>
        <div class="stat-row">
          <div class="stat">
            <span class="stat__value">{fmt(reverb.tMid, 2)} <small>с</small></span>
            <span class="stat__label">RT60 на 500–1000 Гц</span>
          </div>
          <div class="stat">
            <span class="stat__value">{fmt(reverb.schroeder, 0)} <small>Гц</small></span>
            <span class="stat__label">{S.room.schroeder}</span>
          </div>
        </div>
        <p class="muted small">{S.room.schroederHint}.</p>
        <div class="table-scroll">
          <table class="rt-table">
            <thead>
              <tr>
                <th scope="row">{S.room.rtHeader}</th>
                {reverb.bands.map((b) => <th>{b >= 1000 ? `${b / 1000}к` : b}</th>)}
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">{S.room.rtRow}</th>
                {reverb.used.map((t) => <td>{fmt(t, 2)}</td>)}
              </tr>
            </tbody>
          </table>
        </div>
        <p class="muted small">{S.room.formulaNote(reverb.formula.includes('eyring'))}</p>
        <Details summary="Допущения">
          <p class="small">{S.room.reverbAssumptions}</p>
        </Details>
      </Panel>
    </div>
  );
}

const SIT = new Set(['sofa', 'couch', 'chair', 'armchair', 'bed']);

function ScanPanel({ project, onRoom }: { project: Project; onRoom: Props['onRoom'] }) {
  const [state, setState] = useState<ScanState>({ phase: 'idle' });
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [det, setDet] = useState<DetectResult | null>(null);
  const [units, setUnits] = useState<Units | 'auto'>('auto');
  const [applied, setApplied] = useState(false);
  const [Preview, setPreview] = useState<FunctionComponent<any> | null>(null);
  const [layout, setLayout] = useState<LayoutResult | null>(null);
  const [rect, setRect] = useState<Rect | null>(null);
  const [useLayout, setUseLayout] = useState(true);
  const [initial, setInitial] = useState<{ layout: LayoutResult; rect: Rect } | null>(null);
  // найденные элементы стен и что пользователь считает каждым из них
  const found = useMemo(() => (layout ? [
    ...layout.openings.map((o) => ({ wall: o.wall, a0: o.a0, a1: o.a1, bottom: 0, top: o.height, guess: (o.kind === 'door' ? 'door' : 'arch') as WallItemKind })),
    ...layout.windows.map((w) => ({ ...w, guess: 'window' as WallItemKind })),
  ] : []), [layout]);
  const [kinds, setKinds] = useState<WallItemKind[]>([]);
  useEffect(() => { setKinds(found.map((f) => f.guess)); }, [found]);
  // мебель из разметки: учитывать как препятствие и можно ли на ней сидеть
  const furn = layout?.furniture ?? [];
  const [furnUse, setFurnUse] = useState<{ on: boolean; sit: boolean }[]>([]);
  useEffect(() => { setFurnUse(furn.map((f) => ({ on: true, sit: SIT.has(f.name) }))); }, [layout]);
  const input = useRef<HTMLInputElement>(null);

  const runWorker = <T,>(msg: Record<string, unknown>, tri: Float32Array) =>
    new Promise<T>((resolve, reject) => {
      const w = new Worker(new URL('../../workers/detect.worker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (e) => {
        w.terminate();
        e.data.ok ? resolve(e.data as T) : reject(new Error(e.data.error));
      };
      w.onerror = (e) => { w.terminate(); reject(new Error(e.message || 'Ошибка анализа скана')); };
      const copy = tri.slice();
      w.postMessage({ ...msg, triangles: copy }, [copy.buffer]);
    });
  const detect = async (l: Loaded, u: Units | 'auto') => {
    const r = await runWorker<{ result: DetectResult; layout: LayoutResult }>({ units: u === 'auto' ? undefined : u, labels: l.labels }, l.triangles);
    const rc0 = { x0: 0, x1: r.result.depth, y0: 0, y1: r.result.width };
    setLayout(r.layout);
    setRect(rc0);
    setInitial({ layout: r.layout, rect: rc0 });
    return r.result;
  };
  /** Повторный поиск проёмов и коридора для выбранного прямоугольника (контур скана сохраняется). */
  const relayout = async (rc: Rect) => {
    if (!loaded || !det || !layout) return;
    const t = det.transform.slice();
    t[12] -= rc.x0;
    t[13] -= rc.y0;
    try {
      const r = await runWorker<{ layout: LayoutResult }>({ type: 'layout', labels: loaded.labels, transform: t, dims: { depth: rc.x1 - rc.x0, width: rc.y1 - rc.y0, height: det.height } }, loaded.triangles);
      setLayout({ ...layout, openings: r.layout.openings, windows: r.layout.windows, furniture: r.layout.furniture, extension: r.layout.extension });
    } catch { /* оставляем прежние */ }
  };

  const onFile = async (file: File) => {
    setApplied(false);
    setDet(null);
    setUnits('auto');
    setState({ phase: 'loading', fileName: file.name });
    try {
      const [{ loadScan }, preview] = await Promise.all([
        import('../../scan/load'),
        import('../components/ScanPreview'),
      ]);
      setPreview(() => preview.default);
      const s = await loadScan(file);
      const l: Loaded = { preview: s.preview, triangles: s.triangles, labels: s.labels, format: s.format, count: s.triangleCount, decimated: s.decimated, fileName: file.name };
      setLoaded(l);
      setState({ phase: 'detecting', fileName: file.name });
      setDet(await detect(l, 'auto'));
      setState({ phase: 'done', fileName: file.name });
    } catch (e) {
      setState({ phase: 'error', message: (e as Error).message || S.errors.generic });
    }
  };

  const changeUnits = async (u: Units | 'auto') => {
    if (!loaded) return;
    setUnits(u);
    setApplied(false);
    setState({ phase: 'detecting', fileName: loaded.fileName });
    try {
      setDet(await detect(loaded, u));
      setState({ phase: 'done', fileName: loaded.fileName });
    } catch (e) {
      setState({ phase: 'error', message: (e as Error).message });
    }
  };

  const apply = () => {
    if (!det || !loaded) return;
    const rc = rect ?? { x0: 0, x1: det.depth, y0: 0, y1: det.width };
    const depth = Math.round((rc.x1 - rc.x0) * 1000) / 1000;
    const width = Math.round((rc.y1 - rc.y0) * 1000) / 1000;
    // найденное в скане заменяет прежнее; если ничего не найдено — ручные проёмы, окна и коридор сохраняются
    const parts = found.map((f, i) => toRoomItem(f, kinds[i] ?? f.guess, makeId()));
    const ext = useLayout && layout?.extension ? layout.extension : null;
    const room: Room = {
      ...project.room,
      depth,
      width,
      height: det.height,
      source: 'scan',
      openings: found.length > 0 ? parts.flatMap((p) => (p.opening ? [p.opening] : [])) : project.room.openings,
      extensions: ext ? [{ ...ext, id: makeId(), name: S.openings.corridor }] : project.room.extensions,
      // окна и закрытые двери — для ориентира на плане
      features: found.length > 0 ? parts.flatMap((p) => (p.feature ? [p.feature] : [])) : project.room.features ?? [],
      // мебель из скана заменяет прежнюю мебель из скана; зоны, добавленные вручную, остаются
      zones: furn.length
        ? [
            ...project.room.zones.filter((z) => !z.fromScan),
            ...furn.flatMap((f, i) => (furnUse[i]?.on ?? true)
              ? [{ id: makeId(), kind: 'furniture' as const, x0: f.x0, x1: f.x1, y0: f.y0, y1: f.y1, canSit: furnUse[i]?.sit ?? SIT.has(f.name), name: S.layout.furnitureNames[f.name] ?? S.layout.furnitureOther, fromScan: true }]
              : []),
          ]
        : project.room.zones,
    };
    const { transform: _t, ...rest } = det;
    void _t;
    onRoom(room, {
      scanInfo: { ...rest, fileName: loaded.fileName, format: loaded.format },
      constraints: { ...project.constraints, ...zoneFor(room) },
    });
    setApplied(true);
  };

  const dims = useMemo(() => (det ? { depth: det.depth, width: det.width, height: det.height } : null), [det]);

  const busy = state.phase === 'loading' || state.phase === 'detecting';
  return (
    <Panel title={S.room.scan}>
      <p class="small">{S.room.scanIntro}</p>
      <input
        ref={input}
        type="file"
        accept=".obj,.glb,.gltf,.ply,.stl,model/gltf-binary,model/obj,model/stl"
        class="visually-hidden"
        id="scan-file"
        onChange={(e) => {
          const f = (e.target as HTMLInputElement).files?.[0];
          if (f) onFile(f);
          (e.target as HTMLInputElement).value = '';
        }}
      />
      <button type="button" class="btn" disabled={busy} onClick={() => input.current?.click()}>
        <FileIcon /> {S.room.chooseFile}
      </button>
      <Details summary={S.scanGuide.title}>
        <ol class="small scan-guide">
          {S.scanGuide.steps.map((t) => <li>{t}</li>)}
        </ol>
        <p class="muted small">{S.scanGuide.formats}</p>
      </Details>

      {busy && (
        <p class="progress-text" role="status">
          <span class="spinner" aria-hidden="true" /> {state.phase === 'loading' ? S.room.loading : S.room.detecting}
        </p>
      )}
      {state.phase === 'error' && <Note tone="warn">{state.message}</Note>}

      {loaded && Preview && (
        <div class="scan-result">
          <Preview object={loaded.preview} transform={det?.transform ?? null} dims={dims} />
          <p class="muted small">
            {loaded.fileName} — {S.room.triangles(fmtInt(loaded.count))}
          </p>
          {loaded.decimated && <Note>{S.room.decimated}</Note>}
        </div>
      )}

      {det && state.phase === 'done' && (
        <div class="scan-found">
          <h3 class="subhead">{S.room.found}</h3>
          <p class="scan-dims">
            {fmt(rect ? rect.x1 - rect.x0 : det.depth, 2)} × {fmt(rect ? rect.y1 - rect.y0 : det.width, 2)} × {fmt(det.height, 2)} <small>м</small>
          </p>
          {layout && rect && (
            <>
              <LayoutEditor
                layout={layout}
                marks={found.map((f, i) => ({ wall: f.wall, a0: f.a0, a1: f.a1, kind: kinds[i] ?? f.guess }))}
                rect={rect}
                height={det.height}
                onRect={(r) => { setRect(r); setApplied(false); }}
                onRectDone={relayout}
              />
              <div class="btn-row">
                <button
                  type="button"
                  class="btn btn--small btn--ghost"
                  disabled={!initial || (rect.x0 === initial.rect.x0 && rect.x1 === initial.rect.x1 && rect.y0 === initial.rect.y0 && rect.y1 === initial.rect.y1)}
                  onClick={() => { if (initial) { setRect(initial.rect); setLayout(initial.layout); setApplied(false); } }}
                >
                  {S.layout.reset}
                </button>
              </div>
              <p class="muted small">{S.layout.hint}</p>
              {layout.extension && (
                <>
                  <p class="small">
                    {S.layout.corridorFound(
                      S.openings.wallsShort[layout.extension.wall],
                      fmt(layout.extension.depth, 2),
                      fmt(layout.extension.a1 - layout.extension.a0, 2),
                      fmt(layout.extension.arch.a1 - layout.extension.arch.a0, 2),
                    )}
                  </p>
                  <label class="check">
                    <input type="checkbox" checked={useLayout} onChange={(e) => setUseLayout((e.target as HTMLInputElement).checked)} />
                    <span>{S.layout.useFound}</span>
                  </label>
                </>
              )}
              {found.length > 0 && (
                <div class="found-openings">
                  <h4 class="subhead">{S.layout.foundTitle}</h4>
                  {found.map((f, i) => {
                    const wall = S.openings.wallsShort[f.wall];
                    return (
                      <div class="found-opening">
                        <span class="small">
                          {S.layout.foundItem(S.layout.guess[f.guess], wall, fmt(f.a1 - f.a0, 2), fmt(f.top, 2), f.bottom > 0.05 ? fmt(f.bottom, 2) : null)}
                        </span>
                        <SelectField
                          label={S.layout.whatIsIt}
                          value={kinds[i] ?? f.guess}
                          options={(['arch', 'door', 'window'] as WallItemKind[]).map((k) => ({ value: k, label: S.layout.kinds[k] }))}
                          onChange={(v) => { setKinds((ks) => ks.map((x, j) => (j === i ? (v as WallItemKind) : x))); setApplied(false); }}
                        />
                      </div>
                    );
                  })}
                  <p class="muted small">{S.layout.kindsNote}</p>
                </div>
              )}
              {furn.length > 0 && (
                <div class="found-openings">
                  <h4 class="subhead">{S.layout.furnitureTitle}</h4>
                  {furn.map((f, i) => (
                    <div class="found-opening">
                      <span class="small">{S.layout.furnitureItem(S.layout.furnitureNames[f.name] ?? S.layout.furnitureOther, fmt(f.x1 - f.x0, 2), fmt(f.y1 - f.y0, 2), fmt(f.top, 2))}</span>
                      <label class="check">
                        <input type="checkbox" checked={furnUse[i]?.on ?? true} onChange={(e) => { const v = (e.target as HTMLInputElement).checked; setFurnUse((u) => u.map((x, j) => (j === i ? { ...x, on: v } : x))); setApplied(false); }} />
                        <span>{S.layout.furnitureUse}</span>
                      </label>
                      <label class="check">
                        <input type="checkbox" checked={furnUse[i]?.sit ?? false} disabled={!(furnUse[i]?.on ?? true)} onChange={(e) => { const v = (e.target as HTMLInputElement).checked; setFurnUse((u) => u.map((x, j) => (j === i ? { ...x, sit: v } : x))); setApplied(false); }} />
                        <span>{S.zones.canSit}</span>
                      </label>
                    </div>
                  ))}
                  <p class="muted small">{S.layout.furnitureNote}</p>
                </div>
              )}
            </>
          )}
          <div class="meter" aria-label={`${S.room.confidence} ${Math.round(det.confidence * 100)} %`}>
            <span class="meter__label">{S.room.confidence}</span>
            <span class="meter__track">
              <span class={`meter__fill ${det.confidence < 0.5 ? 'is-low' : ''}`} style={{ width: `${Math.round(det.confidence * 100)}%` }} />
            </span>
            <span class="meter__value">{Math.round(det.confidence * 100)} %</span>
          </div>
          {det.warnings.map((w) => <Note tone="warn">{w}</Note>)}
          {layout && !layout.labeled && <Note>{S.scanGuide.noLabels}</Note>}
          {layout && (Object.entries(layout.coverage ?? {}) as [WallId, number][])
            .filter(([, v]) => v < 0.45)
            .map(([w, v]) => <Note tone="warn">{S.scanGuide.lowCoverage(S.openings.walls[w], Math.round(v * 100))}</Note>)}
          {loaded && loaded.count < 300 && !layout?.labeled && <Note tone="warn">{S.scanGuide.coarse}</Note>}
          <Segmented
            label={S.room.unitsLabel}
            value={units}
            options={[
              { value: 'auto', label: `Авто (${det.units === 'm' ? 'м' : det.units === 'cm' ? 'см' : 'мм'})` },
              { value: 'm', label: 'м' },
              { value: 'cm', label: 'см' },
              { value: 'mm', label: 'мм' },
            ]}
            onChange={changeUnits}
          />
          <button type="button" class="btn btn--primary" onClick={apply} disabled={applied}>
            {applied ? S.room.applied : S.room.apply}
          </button>
        </div>
      )}
    </Panel>
  );
}

const WALLS: WallId[] = ['front', 'back', 'left', 'right'];

function OpeningsPanel({ room, onRoom }: { room: Room; onRoom: (r: Room) => void }) {
  const openings = room.openings ?? [];
  const exts = room.extensions ?? [];
  const setOpening = (id: string, patch: Partial<Opening>) => {
    onRoom({
      ...room,
      openings: openings.map((o) => {
        if (o.id !== id) return o;
        const n = { ...o, ...patch };
        const L = wallLength(room, n.wall);
        n.a0 = Math.max(0, Math.min(n.a0, L - 0.1));
        n.a1 = Math.min(L, Math.max(n.a1, n.a0 + 0.1));
        n.height = Math.min(room.height, Math.max(0.3, n.height));
        return n;
      }),
    });
  };
  const setExt = (id: string, patch: Partial<Extension>) => {
    onRoom({ ...room, extensions: exts.map((e) => (e.id === id ? { ...e, ...patch } : e)) });
  };
  const addOpening = () =>
    onRoom({ ...room, openings: [...openings, { id: makeId(), wall: 'right', a0: Math.min(1, room.depth - 1), a1: Math.min(2, room.depth), height: Math.min(2.1, room.height) }] });
  const addNiche = () =>
    onRoom({
      ...room,
      extensions: [...exts, {
        id: makeId(), name: S.shape.niche, wall: 'right', a0: Math.min(1, room.depth - 1.5), a1: Math.min(2.5, room.depth), depth: 1.2, height: room.height,
        arch: { a0: Math.min(1, room.depth - 1.5), a1: Math.min(2.5, room.depth), height: room.height },
        openStart: false, openEnd: false, openFar: false,
      }],
    });
  const addCorridor = () =>
    onRoom({
      ...room,
      extensions: [...exts, {
        id: makeId(), name: S.openings.corridor, wall: 'right', a0: 0, a1: room.depth, depth: 1.2, height: room.height,
        arch: { a0: Math.min(1, room.depth - 1.5), a1: Math.min(2.4, room.depth), height: Math.min(2.1, room.height) },
        openStart: false, openEnd: false, openFar: false,
      }],
    });
  const feats = room.features ?? [];
  const setFeature = (id: string, patch: Partial<WallFeature>) => {
    onRoom({
      ...room,
      features: feats.map((f) => {
        if (f.id !== id) return f;
        const n = { ...f, ...patch };
        const L = wallLength(room, n.wall);
        n.a0 = Math.max(0, Math.min(n.a0, L - 0.1));
        n.a1 = Math.min(L, Math.max(n.a1, n.a0 + 0.1));
        n.bottom = Math.max(0, Math.min(n.bottom, room.height - 0.1));
        n.top = Math.min(room.height, Math.max(n.top, n.bottom + 0.1));
        return n;
      }),
    });
  };
  const addFeature = (kind: WallFeature['kind']) => {
    const L = wallLength(room, 'left');
    const f: WallFeature = kind === 'window'
      ? { id: makeId(), kind, wall: 'left', a0: Math.max(0, L / 2 - 0.6), a1: Math.min(L, L / 2 + 0.6), bottom: 0.9, top: Math.min(room.height, 2.3) }
      : { id: makeId(), kind, wall: 'back', a0: 0.3, a1: Math.min(room.width, 1.2), bottom: 0, top: Math.min(room.height, 2.1) };
    onRoom({ ...room, features: [...feats, f] });
  };
  /** Смена вида элемента стены (если распознан неверно): арка ↔ дверь ↔ окно. */
  const retype = (id: string, item: WallItem, to: WallItemKind) => {
    const r = toRoomItem(item, to, id);
    onRoom({
      ...room,
      openings: [...openings.filter((x) => x.id !== id), ...(r.opening ? [r.opening] : [])],
      features: [...feats.filter((x) => x.id !== id), ...(r.feature ? [r.feature] : [])],
    });
  };
  const kindSelect = (id: string, item: WallItem, cur: WallItemKind) => (
    <SelectField
      label={S.openings.kind}
      value={cur}
      options={(['arch', 'door', 'window'] as WallItemKind[]).map((k) => ({ value: k, label: S.layout.kinds[k] }))}
      onChange={(v) => retype(id, item, v as WallItemKind)}
    />
  );
  const along = (w: WallId) => S.openings.along(w);
  return (
    <Panel title={S.openings.title}>
      <p class="small">{S.openings.intro}</p>
      {openings.length === 0 && exts.length === 0 && <p class="muted small">{S.openings.none}</p>}
      {exts.map((e, i) => {
        const err = validateExtension(room, e);
        return (
          <div class="zone-card">
            <div class="zone-card__head">
              <SelectField
                label={`${S.openings.corridor} ${i + 1}: ${S.openings.wall.toLowerCase()}`}
                value={e.wall}
                options={WALLS.map((w) => ({ value: w, label: S.openings.walls[w] }))}
                onChange={(v) => setExt(e.id, { wall: v as WallId })}
              />
              <button type="button" class="btn btn--small btn--ghost" onClick={() => onRoom({ ...room, extensions: exts.filter((x) => x.id !== e.id) })}>
                {S.openings.remove}
              </button>
            </div>
            <div class="grid-2">
              <NumberField compact id={`${e.id}-a0`} label={`${S.openings.from} (${along(e.wall)})`} value={e.a0} unit="м" min={-20} max={50} onChange={(v) => setExt(e.id, { a0: v })} />
              <NumberField compact id={`${e.id}-a1`} label={S.openings.to} value={e.a1} unit="м" min={-20} max={70} onChange={(v) => setExt(e.id, { a1: v })} />
              <NumberField compact id={`${e.id}-d`} label={S.openings.depth} value={e.depth} unit="м" min={0.3} max={20} onChange={(v) => setExt(e.id, { depth: v })} />
              <NumberField compact id={`${e.id}-h`} label={S.openings.height} value={e.height} unit="м" min={1} max={20} onChange={(v) => setExt(e.id, { height: v })} />
            </div>
            <span class="range-row__label">{S.openings.arch}</span>
            <div class="grid-3">
              <NumberField compact id={`${e.id}-aa0`} label={S.openings.archFrom} value={e.arch.a0} unit="м" min={-20} max={50} onChange={(v) => setExt(e.id, { arch: { ...e.arch, a0: v } })} />
              <NumberField compact id={`${e.id}-aa1`} label={S.openings.to} value={e.arch.a1} unit="м" min={-20} max={50} onChange={(v) => setExt(e.id, { arch: { ...e.arch, a1: v } })} />
              <NumberField compact id={`${e.id}-ah`} label={S.openings.height} value={e.arch.height} unit="м" min={0.5} max={20} onChange={(v) => setExt(e.id, { arch: { ...e.arch, height: v } })} />
            </div>
            <label class="check"><input type="checkbox" checked={e.openStart} onChange={(ev) => setExt(e.id, { openStart: (ev.target as HTMLInputElement).checked })} /><span>{S.openings.openStart}</span></label>
            <label class="check"><input type="checkbox" checked={e.openEnd} onChange={(ev) => setExt(e.id, { openEnd: (ev.target as HTMLInputElement).checked })} /><span>{S.openings.openEnd}</span></label>
            <label class="check"><input type="checkbox" checked={e.openFar} onChange={(ev) => setExt(e.id, { openFar: (ev.target as HTMLInputElement).checked })} /><span>{S.openings.openFar}</span></label>
            {err && <Note tone="warn">{err}</Note>}
          </div>
        );
      })}
      {openings.map((o, i) => (
        <div class="zone-card">
          <div class="zone-card__head">
            <SelectField
              label={`${S.openings.opening} ${i + 1}: ${S.openings.wall.toLowerCase()}`}
              value={o.wall}
              options={WALLS.map((w) => ({ value: w, label: S.openings.walls[w] }))}
              onChange={(v) => setOpening(o.id, { wall: v as WallId })}
            />
            <button type="button" class="btn btn--small btn--ghost" onClick={() => onRoom({ ...room, openings: openings.filter((x) => x.id !== o.id) })}>
              {S.openings.remove}
            </button>
          </div>
          <div class="grid-3">
            <NumberField compact id={`${o.id}-a0`} label={`${S.openings.from} (${along(o.wall)})`} value={o.a0} unit="м" min={0} max={50} onChange={(v) => setOpening(o.id, { a0: v })} />
            <NumberField compact id={`${o.id}-a1`} label={S.openings.to} value={o.a1} unit="м" min={0} max={50} onChange={(v) => setOpening(o.id, { a1: v })} />
            <NumberField compact id={`${o.id}-h`} label={S.openings.height} value={o.height} unit="м" min={0.3} max={20} onChange={(v) => setOpening(o.id, { height: v })} />
          </div>
          {kindSelect(o.id, openingAsItem(o), 'arch')}
        </div>
      ))}
      <div class="btn-row">
        <button type="button" class="btn" onClick={addCorridor}>{S.openings.addCorridor}</button>
        <button type="button" class="btn" onClick={addOpening}>{S.openings.addOpening}</button>
        <button type="button" class="btn" onClick={addNiche}>{S.shape.addNiche}</button>
      </div>
      <p class="muted small">{S.shape.nicheHint}</p>

      <h3 class="subhead">{S.shape.slopeTitle}</h3>
      <label class="check">
        <input type="checkbox" checked={!!room.slope} onChange={(e) => onRoom({ ...room, slope: (e.target as HTMLInputElement).checked ? { wall: 'front', low: Math.max(0.6, Math.round(room.height * 0.5 * 10) / 10), run: Math.min(1.5, room.depth / 2) } : null })} />
        <span>{S.shape.slopeOn}</span>
      </label>
      {room.slope && (
        <div class="zone-card">
          <SelectField label={S.shape.slopeWall} value={room.slope.wall} options={WALLS.map((w) => ({ value: w, label: S.openings.walls[w] }))} onChange={(v) => onRoom({ ...room, slope: { ...room.slope!, wall: v as WallId } })} />
          <div class="grid-2">
            <NumberField compact id="slope-low" label={S.shape.slopeLow} value={room.slope.low} unit="м" min={0.5} max={room.height} onChange={(v) => onRoom({ ...room, slope: { ...room.slope!, low: v } })} />
            <NumberField compact id="slope-run" label={S.shape.slopeRun} value={room.slope.run} unit="м" min={0.2} max={50} onChange={(v) => onRoom({ ...room, slope: { ...room.slope!, run: v } })} />
          </div>
          {validateSlope(room) && <Note tone="warn">{validateSlope(room)}</Note>}
          <p class="muted small">{S.shape.slopeHint}</p>
        </div>
      )}

      <h3 class="subhead">{S.openings.featuresTitle}</h3>
      <p class="muted small">{S.openings.featuresIntro}</p>
      {feats.map((f, i) => (
        <div class="zone-card">
          <div class="zone-card__head">
            <SelectField
              label={`${f.kind === 'window' ? S.openings.window : S.openings.door} ${i + 1}: ${S.openings.wall.toLowerCase()}`}
              value={f.wall}
              options={WALLS.map((w) => ({ value: w, label: S.openings.walls[w] }))}
              onChange={(v) => setFeature(f.id, { wall: v as WallId })}
            />
            <button type="button" class="btn btn--small btn--ghost" onClick={() => onRoom({ ...room, features: feats.filter((x) => x.id !== f.id) })}>
              {S.openings.remove}
            </button>
          </div>
          <div class="grid-2">
            <NumberField compact id={`${f.id}-a0`} label={`${S.openings.from} (${along(f.wall)})`} value={f.a0} unit="м" min={0} max={50} onChange={(v) => setFeature(f.id, { a0: v })} />
            <NumberField compact id={`${f.id}-a1`} label={S.openings.to} value={f.a1} unit="м" min={0} max={50} onChange={(v) => setFeature(f.id, { a1: v })} />
            {f.kind === 'window' && <NumberField compact id={`${f.id}-b`} label={S.openings.bottom} value={f.bottom} unit="м" min={0} max={10} onChange={(v) => setFeature(f.id, { bottom: v })} />}
            <NumberField compact id={`${f.id}-t`} label={f.kind === 'window' ? S.openings.top : S.openings.height} value={f.top} unit="м" min={0.3} max={20} onChange={(v) => setFeature(f.id, { top: v })} />
          </div>
          {kindSelect(f.id, f, f.kind)}
        </div>
      ))}
      <div class="btn-row">
        <button type="button" class="btn" onClick={() => addFeature('window')}>{S.openings.addWindow}</button>
        <button type="button" class="btn" onClick={() => addFeature('door')}>{S.openings.addDoor}</button>
      </div>
      <SelectField
        label={S.model.title}
        value={room.model ?? 'auto'}
        options={(['auto', 'modal', 'wave'] as AcousticModel[]).map((m) => ({ value: m, label: S.model[m] }))}
        onChange={(v) => onRoom({ ...room, model: v as AcousticModel })}
      />
      <p class="muted small">{S.model.hint}</p>
    </Panel>
  );
}

function ZonesPanel({ room, onRoom }: { room: Room; onRoom: (r: Room) => void }) {
  const zones = room.zones ?? [];
  const setZone = (id: string, patch: Partial<Zone>) => {
    const next = zones.map((z) => {
      if (z.id !== id) return z;
      const n = { ...z, ...patch };
      // держим границы внутри комнаты и в правильном порядке
      n.x0 = Math.max(0, Math.min(n.x0, room.depth - 0.1));
      n.x1 = Math.min(room.depth, Math.max(n.x1, n.x0 + 0.1));
      n.y0 = Math.max(0, Math.min(n.y0, room.width - 0.1));
      n.y1 = Math.min(room.width, Math.max(n.y1, n.y0 + 0.1));
      return n;
    });
    onRoom({ ...room, zones: next });
  };
  const add = () => {
    const z: Zone = { id: makeId(), kind: 'door', x0: Math.max(0, room.depth - 1), x1: room.depth, y0: 0, y1: Math.min(1, room.width), canSit: false };
    onRoom({ ...room, zones: [...zones, z] });
  };
  return (
    <Panel title={S.zones.title}>
      <p class="small">{S.zones.intro}</p>
      {zones.length === 0 && <p class="muted small">{S.zones.none}</p>}
      {zones.map((z, i) => (
        <div class="zone-card">
          <div class="zone-card__head">
            <SelectField
              label={`${S.zones.kind} ${i + 1}`}
              value={z.kind}
              options={(['door', 'window', 'furniture', 'other'] as ZoneKind[]).map((k) => ({ value: k, label: S.zones.kinds[k] }))}
              onChange={(v) => setZone(z.id, { kind: v as ZoneKind })}
            />
            <button type="button" class="btn btn--small btn--ghost" onClick={() => onRoom({ ...room, zones: zones.filter((x) => x.id !== z.id) })}>
              {S.zones.remove}
            </button>
          </div>
          <div class="grid-2">
            <NumberField compact id={`${z.id}-x0`} label={S.zones.x0} value={z.x0} unit="м" min={0} max={room.depth} onChange={(v) => setZone(z.id, { x0: v })} />
            <NumberField compact id={`${z.id}-x1`} label={S.zones.x1} value={z.x1} unit="м" min={0} max={room.depth} onChange={(v) => setZone(z.id, { x1: v })} />
            <NumberField compact id={`${z.id}-y0`} label={S.zones.y0} value={z.y0} unit="м" min={0} max={room.width} onChange={(v) => setZone(z.id, { y0: v })} />
            <NumberField compact id={`${z.id}-y1`} label={S.zones.y1} value={z.y1} unit="м" min={0} max={room.width} onChange={(v) => setZone(z.id, { y1: v })} />
          </div>
          <label class="check">
            <input type="checkbox" checked={z.canSit} onChange={(e) => setZone(z.id, { canSit: (e.target as HTMLInputElement).checked })} />
            <span>{S.zones.canSit}</span>
          </label>
        </div>
      ))}
      <button type="button" class="btn" onClick={add}>{S.zones.add}</button>
      <SelectField
        label={S.zones.leakage}
        value={room.leakage ?? 'typical'}
        options={(['sealed', 'typical', 'door', 'open'] as Leakage[]).map((k) => ({ value: k, label: S.zones.leakages[k] }))}
        onChange={(v) => onRoom({ ...room, leakage: v as Leakage })}
      />
      <p class="muted small">{S.zones.leakageHint}</p>
    </Panel>
  );
}

function zoneFor(room: Room) {
  const d = defaultConstraints(room);
  return { listenerMinX: d.listenerMinX, listenerMaxX: d.listenerMaxX };
}

const RotateIcon = () => (
  <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M4 12a8 8 0 0 1 13.7-5.6M20 12a8 8 0 0 1-13.7 5.6" />
    <path d="M18 3v4h-4M6 21v-4h4" />
  </svg>
);
const FileIcon = () => (
  <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" />
    <path d="M12 12l8-4.5M12 12v9M12 12L4 7.5" />
  </svg>
);
