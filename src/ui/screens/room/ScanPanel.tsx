// Скан комнаты (020). Выбор файла → разбор и распознавание → сразу применение к комнате, как если бы
// нажали «Применить размеры». Исходный скан хранится на устройстве и виден только в «Поправить границы
// комнаты»; в остальное время здесь показывается модель комнаты проекта — та же, по которой идут расчёты.
// 021: пока комната не создана, блок появляется только на время разбора файла (выбор — в «С чего начать»);
// у комнаты, настроенной вручную, это просто «3D-модель» без упоминаний скана.
// 022: применённый скан ведёт в те же шаги, что и ручной ввод («Сохранить» в конце создаёт комнату);
// при уверенности ниже 50 % сначала открывается «Поправить границы комнаты»; сама кнопка поправки —
// в группе «Изменить комнату» и на шаге «Размеры», здесь — блок поправки (по просьбе requestScanFix).
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { FunctionComponent } from 'preact';
import type { Object3D } from 'three';
import type { Project } from '../../../state/project';
import { clearedRoom, defaultConstraints, makeId } from '../../../state/project';
import type { Room, WallId } from '../../../core/types';
import type { DetectResult, Units } from '../../../scan/detect';
import type { LayoutResult, ScanLabels } from '../../../scan/layout';
import type { WallItemKind } from '../../../core/wallItems';
import { SIT_DEFAULT, defaultChoice, fixScan, foundWallItems, scanProblem, scanRoom, type ScanChoice, type ScanNames } from '../../../scan/apply';
import { loadStoredScan, saveScan, thinScan } from '../../../state/storage';
import { LayoutEditor, type Rect } from '../../components/LayoutEditor';
import { Panel, SelectField, Note, Segmented } from '../../design-system';
import { S } from '../../strings';
import { fmt, fmtInt } from '../../format';
import { logError } from '../../../state/errlog';
import { dropRoomDraft } from '../../roomDraft';
import { onScanFixRequest } from '../../scanFix';
import type { Destination } from '../../navigation';

type ScanState =
  | { phase: 'idle' }
  | { phase: 'loading' | 'detecting'; fileName: string }
  | { phase: 'error'; message: string }
  | { phase: 'done'; fileName: string };

/** Исходный скан в памяти: из выбранного файла (preview — его сцена) или из хранилища (preview нет). */
interface Loaded {
  preview: Object3D | null;
  triangles: Float32Array;
  labels?: ScanLabels;
  format: string;
  count: number;
  decimated: boolean;
  dropped: number;
  thinned?: boolean;
  fileName: string;
}

const NAMES: ScanNames = {
  furniture: (n) => S.layout.furnitureNames[n] ?? S.layout.furnitureOther,
  corridor: S.openings.corridor,
  id: makeId,
};

export function ScanPanel({ project, onRoom, onGo }: { project: Project; onRoom: (room: Room, extra?: Partial<Project>) => void; onGo?: (t: Destination) => void }) {
  const [state, setState] = useState<ScanState>({ phase: 'idle' });
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [det, setDet] = useState<DetectResult | null>(null);
  const [units, setUnits] = useState<Units | 'auto'>('auto');
  const [Preview, setPreview] = useState<FunctionComponent<any> | null>(null);
  const [layout, setLayout] = useState<LayoutResult | null>(null);
  const [rect, setRect] = useState<Rect | null>(null);
  const [takeLayout, setTakeLayout] = useState(true);
  const [initial, setInitial] = useState<{ layout: LayoutResult; rect: Rect } | null>(null);
  const [kinds, setKinds] = useState<WallItemKind[]>([]);
  const [furnUse, setFurnUse] = useState<{ on: boolean; sit: boolean }[]>([]);
  /** Открыта «Поправить границы комнаты»; problem — новый скан распознан с ошибкой и не применён. */
  const [editing, setEditing] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [justApplied, setJustApplied] = useState(false);
  const [missing, setMissing] = useState(false);
  /** Выбор, применённый к комнате сейчас: от его границ считается сдвиг при поправке. */
  const applied = useRef<{ choice: ScanChoice; units: Units } | null>(null);
  const found = useMemo(() => (layout ? foundWallItems(layout) : []), [layout]);
  const furn = useMemo(() => layout?.furniture ?? [], [layout]);
  const input = useRef<HTMLInputElement>(null);
  const hasScan = !!project.scanInfo;

  // модель комнаты проекта; three.js грузится, когда блок близко к экрану
  const [RoomModel, setRoomModel] = useState<FunctionComponent<{ room: Room }> | null>(null);
  const modelSlot = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = modelSlot.current;
    if (RoomModel || !el) return;
    const load = () => import('../../components/RoomPreview').then((m) => setRoomModel(() => m.default)).catch(() => undefined);
    if (typeof IntersectionObserver === 'undefined') { void load(); return; }
    const io = new IntersectionObserver((es) => {
      if (es.some((e) => e.isIntersecting)) { io.disconnect(); void load(); }
    }, { rootMargin: '300px' });
    io.observe(el);
    return () => io.disconnect();
    // место под модель появляется и после поправки, и когда комната создана (021)
  }, [editing, RoomModel, project.roomReady]);

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
  const detect = (l: Loaded, u: Units | 'auto') =>
    runWorker<{ result: DetectResult; layout: LayoutResult }>({ units: u === 'auto' ? undefined : u, labels: l.labels }, l.triangles);

  /** Показать выбор в блоке поправки. */
  const showChoice = (c: ScanChoice) => {
    setLayout(c.layout);
    setRect(c.rect);
    setKinds(c.kinds);
    setFurnUse(c.furniture);
    setTakeLayout(c.takeCorridor);
  };
  const defaultsFor = (l: LayoutResult) => {
    setKinds(foundWallItems(l).map((f) => f.guess));
    setFurnUse(l.furniture.map((f) => ({ on: true, sit: SIT_DEFAULT.has(f.name) })));
  };
  /** Распознавание с нуля (новый файл или другие единицы): границы — вся найденная комната. */
  const detectAll = async (l: Loaded, u: Units | 'auto') => {
    const r = await detect(l, u);
    const rc0 = { x0: 0, x1: r.result.depth, y0: 0, y1: r.result.width };
    setDet(r.result);
    setInitial({ layout: r.layout, rect: rc0 });
    const c = defaultChoice(r.layout, r.result.height, rc0);
    showChoice(c);
    return { det: r.result, initial: { layout: r.layout, rect: rc0 }, choice: c };
  };

  /** Повторный поиск проёмов и коридора для выбранного прямоугольника (контур скана сохраняется). */
  const relayout = async (rc: Rect) => {
    if (!loaded || !det || !layout) return;
    const t = det.transform.slice();
    t[12] -= rc.x0;
    t[13] -= rc.y0;
    try {
      const r = await runWorker<{ layout: LayoutResult }>({ type: 'layout', labels: loaded.labels, transform: t, dims: { depth: rc.x1 - rc.x0, width: rc.y1 - rc.y0, height: det.height } }, loaded.triangles);
      const next = { ...layout, openings: r.layout.openings, windows: r.layout.windows, furniture: r.layout.furniture, extension: r.layout.extension };
      setLayout(next);
      defaultsFor(next);
    } catch { /* оставляем прежние */ }
  };
  const resetToInitial = () => {
    if (!initial) return;
    setRect(initial.rect);
    setLayout(initial.layout);
    defaultsFor(initial.layout);
  };

  /** Сохранить скан проекта на устройстве вместе с применённым выбором. */
  const persist = (l: Loaded, d: DetectResult, init: { layout: LayoutResult; rect: Rect }, c: ScanChoice, u: Units | 'auto') => {
    const t = thinScan(l.triangles, l.labels);
    saveScan({
      projectId: project.id, fileName: l.fileName, format: l.format, count: l.count, decimated: l.decimated, dropped: l.dropped,
      thinned: t.thinned || !!l.thinned, triangles: t.triangles, labels: t.labels, units: u, det: d, initial: init, applied: c,
    }).catch((e) => logError('scan', e, 'сохранение скана на устройстве'));
  };

  const summaryOf = (d: DetectResult, l: Loaded) => {
    const { transform: _t, ...rest } = d;
    void _t;
    return { ...rest, fileName: l.fileName, format: l.format };
  };

  /**
   * Первое применение скана — как «Применить размеры». Новый скан поверх уже применённого
   * сбрасывает комнату так же, как «Очистить».
   */
  const applyFirst = (l: Loaded, d: DetectResult, init: { layout: LayoutResult; rect: Rect }, c: ScanChoice, u: Units | 'auto') => {
    const reset = project.scanInfo ? clearedRoom(project) : null;
    const room = scanRoom(reset?.room ?? project.room, c, 'first', NAMES);
    onRoom(room, {
      ...reset,
      scanInfo: { ...summaryOf(d, l), rotation: 0 },
      constraints: { ...(reset?.constraints ?? project.constraints), ...zoneFor(room) },
      // 022: комната ещё не создана — её проверяют по тем же шагам, что и при ручном вводе, и сохраняют
      roomReady: false,
    });
    dropRoomDraft(project.id);
    onGo?.('room/size');
    applied.current = { choice: c, units: d.units };
    persist(l, d, init, c, u);
  };

  /** Поправка границ того же скана: найденное пересоздаётся, ручное остаётся на своих местах. */
  const applyFix = (l: Loaded, d: DetectResult, init: { layout: LayoutResult; rect: Rect }, c: ScanChoice, u: Units | 'auto') => {
    const prev = applied.current && applied.current.units === d.units ? applied.current.choice.rect : c.rect;
    const fixed = fixScan(project, c, prev, project.scanInfo?.rotation ?? 0, NAMES);
    onRoom(fixed.room, {
      current: fixed.current,
      setups: fixed.setups,
      scanInfo: { ...summaryOf(d, l), rotation: project.scanInfo?.rotation ?? 0 },
      constraints: { ...project.constraints, ...zoneFor(fixed.room) },
    });
    applied.current = { choice: c, units: d.units };
    persist(l, d, init, c, u);
    // поправка во время проверки по шагам — назад к шагам
    if (!project.roomReady) onGo?.('room/size');
  };

  const onFile = async (file: File) => {
    setEditing(false);
    setProblem(null);
    setJustApplied(false);
    setMissing(false);
    setDet(null);
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
      const r = await detectAll(l, 'auto');
      setState({ phase: 'done', fileName: file.name });
      if (scanProblem(r.det)) {
        // явно неверное распознавание: комнату не трогаем, сразу открываем поправку
        setProblem(S.scan.problem);
        setEditing(true);
        return;
      }
      if (r.det.confidence < 0.5) {
        // 022: неуверенное распознавание — сначала проверить границы, потом применить
        setProblem(S.scan.lowFirst(Math.round(r.det.confidence * 100)));
        setEditing(true);
        return;
      }
      applyFirst(l, r.det, r.initial, r.choice, 'auto');
    } catch (e) {
      logError('scan', e, `${file.name}, ${Math.round(file.size / 1024)} КБ`);
      setState({ phase: 'error', message: (e as Error).message || S.errors.generic });
    }
  };

  const changeUnits = async (u: Units | 'auto') => {
    if (!loaded) return;
    setUnits(u);
    setState({ phase: 'detecting', fileName: loaded.fileName });
    try {
      await detectAll(loaded, u);
      setState({ phase: 'done', fileName: loaded.fileName });
    } catch (e) {
      setState({ phase: 'error', message: (e as Error).message });
    }
  };

  /** «Поправить границы комнаты»: скан из памяти (этот сеанс) или из хранилища устройства. */
  const openEditor = async () => {
    setMissing(false);
    setJustApplied(false);
    if (loaded && det && initial && applied.current) {
      showChoice(applied.current.choice);
      setEditing(true);
      return;
    }
    setState({ phase: 'loading', fileName: project.scanInfo?.fileName ?? '' });
    try {
      const [stored, preview] = await Promise.all([
        loadStoredScan(project.id).catch(() => undefined),
        import('../../components/ScanPreview'),
      ]);
      setPreview(() => preview.default);
      setState({ phase: 'idle' });
      if (!stored) { setMissing(true); return; }
      setLoaded({ preview: null, triangles: stored.triangles, labels: stored.labels, format: stored.format, count: stored.count, decimated: stored.decimated, dropped: stored.dropped, thinned: stored.thinned, fileName: stored.fileName });
      setDet(stored.det);
      setUnits(stored.units);
      setInitial(stored.initial);
      applied.current = { choice: stored.applied, units: stored.det.units };
      showChoice(stored.applied);
      setEditing(true);
    } catch (e) {
      setState({ phase: 'error', message: (e as Error).message || S.errors.generic });
    }
  };

  const choice = (): ScanChoice | null => (det && layout && rect
    ? { height: det.height, rect, layout, kinds, furniture: furnUse, takeCorridor: takeLayout }
    : null);
  const rectProblem = det && rect ? scanProblem({ depth: rect.x1 - rect.x0, width: rect.y1 - rect.y0, height: det.height }) : null;

  const apply = () => {
    const c = choice();
    if (!c || !loaded || !det || !initial || rectProblem) return;
    const first = !!problem || !hasScan;
    if (first) applyFirst(loaded, det, initial, c, units);
    else applyFix(loaded, det, initial, c, units);
    setProblem(null);
    setEditing(false);
    setJustApplied(!first && project.roomReady);
  };

  /** «Отмена»: новый скан с ошибкой — забыть; поправка — закрыть без изменений (применённое не трогается). */
  const cancel = () => {
    setEditing(false);
    if (problem) {
      setProblem(null);
      setLoaded(null);
      setDet(null);
      setLayout(null);
      setState({ phase: 'idle' });
    } else if (applied.current) {
      showChoice(applied.current.choice);
    }
  };

  // просьба открыть поправку (группа «Изменить комнату», шаг «Размеры»)
  useEffect(() => onScanFixRequest(() => {
    void openEditor();
    requestAnimationFrame(() => document.getElementById('scan-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }));

  const busy = state.phase === 'loading' || state.phase === 'detecting';
  const model = project.room;
  const count = (kind: 'window' | 'door') => (model.features ?? []).filter((f) => f.kind === kind).length;
  const ready = project.roomReady;
  const fileInput = (
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
  );
  // комнаты ещё нет и файл не разбирается — выбор файла в «С чего начать», здесь только поле выбора
  if (!ready && !busy && !editing && !missing && state.phase !== 'error') return fileInput;
  return (
    <Panel title={hasScan || !ready ? S.room.scan : S.room.model3d} id="scan-panel">
      {fileInput}

      {busy && (
        <p class="progress-text" role="status">
          <span class="spinner" aria-hidden="true" /> {state.phase === 'loading' ? S.room.loading : S.room.detecting}
        </p>
      )}
      {state.phase === 'error' && <Note tone="warn">{state.message}</Note>}
      {missing && <Note>{S.scan.missing}</Note>}

      {ready && !editing && (
        <div class="scan-result" ref={modelSlot}>
          {RoomModel ? <RoomModel room={project.room} /> : <div class="scan-preview" aria-hidden="true" />}
          <p class="muted small">{hasScan ? S.scan.modelNote : S.room.modelNote}</p>
        </div>
      )}

      {hasScan && !editing && (
        <>
          <p class="small" data-testid="scan-summary">
            {S.scan.summary(project.scanInfo!.fileName, `${fmt(model.depth, 2)} × ${fmt(model.width, 2)} × ${fmt(model.height, 2)}`,
              count('window'), count('door'), (model.openings ?? []).length, (model.zones ?? []).filter((z) => z.kind === 'furniture').length, (model.extensions ?? []).length)}
          </p>
          {project.scanInfo!.confidence < 0.5 && <Note tone="warn">{S.scan.lowConfidence}</Note>}
          {/* 022: после первого скана — шаги проверки и «Что дальше» на обзоре; здесь — только итог поправки */}
          {justApplied && <Note tone="good">{S.room.applied}</Note>}
        </>
      )}

      {editing && det && loaded && layout && rect && (
        <div class="scan-found">
          <h3 class="subhead">{S.scan.fixTitle}</h3>
          {problem && <Note tone="warn">{problem}</Note>}
          <p class="small">{S.scan.fixIntro}</p>
          <div class="scan-result">
            <span><span class="tag">{S.scan.rawTag}</span></span>
            {Preview && (
              <Preview object={loaded.preview} triangles={loaded.triangles} transform={det.transform}
                box={{ x0: rect.x0, y0: rect.y0, depth: rect.x1 - rect.x0, width: rect.y1 - rect.y0, height: det.height }} />
            )}
            <p class="muted small">
              {loaded.fileName} — {S.room.triangles(fmtInt(loaded.count))}{loaded.thinned ? S.scan.thinned : ''}
            </p>
            {loaded.decimated && <Note>{S.room.decimated}</Note>}
            {loaded.dropped > 0 && <Note tone="warn">{S.room.dropped(loaded.dropped)}</Note>}
          </div>
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
                onRect={(r) => { setRect(r); }}
                onRectDone={relayout}
              />
              <div class="btn-row">
                <button
                  type="button"
                  class="btn btn--small btn--ghost"
                  disabled={!initial || (rect.x0 === initial.rect.x0 && rect.x1 === initial.rect.x1 && rect.y0 === initial.rect.y0 && rect.y1 === initial.rect.y1)}
                  onClick={resetToInitial}
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
                          onChange={(v) => { setKinds((ks) => ks.map((x, j) => (j === i ? (v as WallItemKind) : x))); }}
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
                        <input type="checkbox" checked={furnUse[i]?.on ?? true} onChange={(e) => { const v = (e.target as HTMLInputElement).checked; setFurnUse((u) => u.map((x, j) => (j === i ? { ...x, on: v } : x))); }} />
                        <span>{S.layout.furnitureUse}</span>
                      </label>
                      <label class="check">
                        <input type="checkbox" checked={furnUse[i]?.sit ?? false} disabled={!(furnUse[i]?.on ?? true)} onChange={(e) => { const v = (e.target as HTMLInputElement).checked; setFurnUse((u) => u.map((x, j) => (j === i ? { ...x, sit: v } : x))); }} />
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
          {!problem && <Note>{S.scan.recreateNote}</Note>}
          {rectProblem && <Note tone="warn">{S.scan.rectProblem}</Note>}
          <div class="btn-row">
            <button type="button" class="btn btn--primary" onClick={apply} disabled={!!rectProblem || busy}>{S.room.apply}</button>
            <button type="button" class="btn" onClick={cancel}>{S.scan.cancel}</button>
          </div>
        </div>
      )}
    </Panel>
  );
}

function zoneFor(room: Room) {
  const d = defaultConstraints(room);
  return { listenerMinX: d.listenerMinX, listenerMaxX: d.listenerMaxX };
}
