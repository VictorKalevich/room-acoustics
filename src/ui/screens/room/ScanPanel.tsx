// Загрузка скана: разбор файла, распознавание размеров, проёмов и мебели, применение к комнате.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { FunctionComponent } from 'preact';
import type { Object3D } from 'three';
import type { Project } from '../../../state/project';
import { defaultConstraints, makeId } from '../../../state/project';
import type { Room, WallId } from '../../../core/types';
import type { DetectResult, Units } from '../../../scan/detect';
import type { LayoutResult, ScanLabels } from '../../../scan/layout';
import { toRoomItem, type WallItemKind } from '../../../core/wallItems';
import { LayoutEditor, type Rect } from '../../components/LayoutEditor';
import { Panel, SelectField, Note, Details, Segmented } from '../../design-system';
import { S } from '../../strings';
import { fmt, fmtInt } from '../../format';
import { logError } from '../../../state/errlog';
import { FileIcon } from './icons';

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
  dropped: number;
  fileName: string;
}
const SIT = new Set(['sofa', 'couch', 'chair', 'armchair', 'bed']);

export function ScanPanel({ project, onRoom, onGo }: { project: Project; onRoom: (room: Room, extra?: Partial<Project>) => void; onGo?: (t: 'placement') => void }) {
  const [state, setState] = useState<ScanState>({ phase: 'idle' });
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [det, setDet] = useState<DetectResult | null>(null);
  const [units, setUnits] = useState<Units | 'auto'>('auto');
  const [applied, setApplied] = useState(false);
  const [Preview, setPreview] = useState<FunctionComponent<any> | null>(null);
  const [layout, setLayout] = useState<LayoutResult | null>(null);
  const [rect, setRect] = useState<Rect | null>(null);
  const [takeLayout, setTakeLayout] = useState(true);
  const [initial, setInitial] = useState<{ layout: LayoutResult; rect: Rect } | null>(null);
  // найденные элементы стен и что пользователь считает каждым из них
  const found = useMemo(() => (layout ? [
    ...layout.openings.map((o) => ({ wall: o.wall, a0: o.a0, a1: o.a1, bottom: 0, top: o.height, guess: (o.kind === 'door' ? 'door' : 'arch') as WallItemKind })),
    ...layout.windows.map((w) => ({ ...w, guess: 'window' as WallItemKind })),
  ] : []), [layout]);
  const [kinds, setKinds] = useState<WallItemKind[]>([]);
  useEffect(() => { setKinds(found.map((f) => f.guess)); }, [found]);
  // мебель из разметки: учитывать как препятствие и можно ли на ней сидеть
  const furn = useMemo(() => layout?.furniture ?? [], [layout]);
  const [furnUse, setFurnUse] = useState<{ on: boolean; sit: boolean }[]>([]);
  useEffect(() => { setFurnUse(furn.map((f) => ({ on: true, sit: SIT.has(f.name) }))); }, [furn]);
  const input = useRef<HTMLInputElement>(null);
  // модель комнаты по введённым данным — вместо превью, пока файла скана нет; three.js грузится, когда блок близко к экрану
  const [RoomModel, setRoomModel] = useState<FunctionComponent<{ room: Room }> | null>(null);
  const modelSlot = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = modelSlot.current;
    if (loaded || RoomModel || !el) return;
    const load = () => import('../../components/RoomPreview').then((m) => setRoomModel(() => m.default)).catch(() => undefined);
    if (typeof IntersectionObserver === 'undefined') { void load(); return; }
    const io = new IntersectionObserver((es) => {
      if (es.some((e) => e.isIntersecting)) { io.disconnect(); void load(); }
    }, { rootMargin: '300px' });
    io.observe(el);
    return () => io.disconnect();
  }, [loaded, RoomModel]);

  const runWorker = <T,>(msg: Record<string, unknown>, tri: Float32Array) =>
    new Promise<T>((resolve, reject) => {
      const w = new Worker(new URL('../../../workers/detect.worker.ts', import.meta.url), { type: 'module' });
      w.addEventListener('message', (e) => {
        w.terminate();
        if (e.data.ok) resolve(e.data as T);
        else reject(new Error(e.data.error));
      });
      w.addEventListener('error', (e) => { w.terminate(); reject(new Error(e.message || 'Ошибка анализа скана')); });
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
    // прежний скан не показываем рядом с новым файлом (и рядом с ошибкой о нём)
    setLoaded(null);
    setLayout(null);
    setRect(null);
    setInitial(null);
    setUnits('auto');
    setState({ phase: 'loading', fileName: file.name });
    // файл могли выбрать с карточки «С чего начать» вверху — показываем, где идёт разбор
    requestAnimationFrame(() => document.getElementById('scan-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    try {
      const [{ loadScan }, preview] = await Promise.all([
        import('../../../scan/load'),
        import('../../components/ScanPreview'),
      ]);
      setPreview(() => preview.default);
      const s = await loadScan(file);
      const l: Loaded = { preview: s.preview, triangles: s.triangles, labels: s.labels, format: s.format, count: s.triangleCount, decimated: s.decimated, dropped: s.dropped, fileName: file.name };
      setLoaded(l);
      setState({ phase: 'detecting', fileName: file.name });
      setDet(await detect(l, 'auto'));
      setState({ phase: 'done', fileName: file.name });
    } catch (e) {
      logError('scan', e, `${file.name}, ${Math.round(file.size / 1024)} КБ`);
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
    const ext = takeLayout && layout?.extension ? layout.extension : null;
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
    <Panel title={S.room.scan} id="scan-panel">
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
          {S.scanGuide.steps.map((t, ki) => <li key={ki}>{t}</li>)}
        </ol>
        <p class="muted small">{S.scanGuide.formats}</p>
      </Details>

      {busy && (
        <p class="progress-text" role="status">
          <span class="spinner" aria-hidden="true" /> {state.phase === 'loading' ? S.room.loading : S.room.detecting}
        </p>
      )}
      {state.phase === 'error' && <Note tone="warn">{state.message}</Note>}

      {!loaded && (
        <div class="scan-result" ref={modelSlot}>
          {RoomModel ? <RoomModel room={project.room} /> : <div class="scan-preview" aria-hidden="true" />}
          <p class="muted small">{S.room.modelNote}</p>
        </div>
      )}

      {loaded && Preview && (
        <div class="scan-result">
          <Preview object={loaded.preview} transform={det?.transform ?? null} dims={dims} />
          <p class="muted small">
            {loaded.fileName} — {S.room.triangles(fmtInt(loaded.count))}
          </p>
          {loaded.decimated && <Note>{S.room.decimated}</Note>}
          {loaded.dropped > 0 && <Note tone="warn">{S.room.dropped(loaded.dropped)}</Note>}
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
                    <input type="checkbox" checked={takeLayout} onChange={(e) => setTakeLayout((e.target as HTMLInputElement).checked)} />
                    <span>{S.layout.takeFound}</span>
                  </label>
                </>
              )}
              {found.length > 0 && (
                <div class="found-openings">
                  <h4 class="subhead">{S.layout.foundTitle}</h4>
                  {found.map((f, i) => {
                    const wall = S.openings.wallsShort[f.wall];
                    return (
                      <div key={i} class="found-opening">
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
                    <div key={i} class="found-opening">
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
          {det.warnings.map((w, ki) => <Note key={ki} tone="warn">{w}</Note>)}
          {layout && !layout.labeled && <Note>{S.scanGuide.noLabels}</Note>}
          {layout && (Object.entries(layout.coverage ?? {}) as [WallId, number][])
            .filter(([, v]) => v < 0.45)
            .map(([w, v], ki) => <Note key={ki} tone="warn">{S.scanGuide.lowCoverage(S.openings.walls[w], Math.round(v * 100))}</Note>)}
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
          {applied && (
            <>
              <Note tone="good">{S.room.appliedNext}</Note>
              <div class="btn-row">
                {onGo && <button type="button" class="btn btn--primary" onClick={() => onGo('placement')}>{S.room.toPlacement}</button>}
                <button type="button" class="btn" onClick={() => scrollTo({ top: 0, behavior: 'smooth' })}>{S.room.seePlan}</button>
              </div>
            </>
          )}
        </div>
      )}
    </Panel>
  );
}
function zoneFor(room: Room) {
  const d = defaultConstraints(room);
  return { listenerMinX: d.listenerMinX, listenerMaxX: d.listenerMaxX };
}
