// Конструктор комнаты (019): размеры и форма → стены (развёртка, окна, ковры, шторы) → пол и потолок →
// мебель сверху. Всё, что найдено в скане, правится здесь же.
// 021: правки копятся в черновике (ui/roomDraft) и попадают в проект только по «Сохранить». Пока комната
// не создана, это ручная настройка по шагам («Далее», на последнем шаге «Сохранить»); потом — правка с
// переходами между шагами, «Сохранить» внизу каждого шага и вопросом при уходе с несохранёнными изменениями.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Project } from '../../../state/project';
import { makeId, rotateRoom } from '../../../state/project';
import type { AcousticModel, Covering, FurnitureType, Leakage, ReverbResult, Room, WallId, Zone } from '../../../core/types';
import { SURFACES } from '../../../core/types';
import { FURNISHING_LABEL, MATERIALS } from '../../../core/materials';
import {
  FURNITURE, FURNITURE_ORDER, contribution, fitCovering, fitRect, furnitureAbsorption, furnitureType, isAcoustic,
  newCurtain, newFurniture, newRug, newWallCarpet, rotateFurniture,
} from '../../../core/furniture';
import { speedOfSound } from '../../../core/physics';
import { shownTreatments } from '../../../core/treatments';
import { computeReverb } from '../../../core/reverb';
import { fitRoomObjects, type FitItem } from '../../../core/fitRoom';
import { ActionMenu, ConfirmSheet, Details, Note, NumberField, Panel, SectionNav, Segmented, SelectField } from '../../design-system';
import { PlanView } from '../../components/PlanView';
import { WallView } from '../../components/WallView';
import { ShapePanel, SlopeBlock, WallItemsPanel } from './OpeningsPanel';
import { ZonesPanel } from './ZonesPanel';
import { ROOM_STEPS, setLeaveGuard, type RoomStep } from '../../navigation';
import { useViewState } from '../../useViewState';
import { DIMS, draftDiffers, dropRoomDraft, loadRoomDraft, saveRoomDraft, withOutside, type DimKey, type RoomDraft } from '../../roomDraft';
import { requestScanFix } from '../../scanFix';
import { RotateIcon } from './icons';
import { S } from '../../strings';
import { fmt } from '../../format';
import type { Furnishing } from '../../../core/types';

const WALLS: WallId[] = ['front', 'back', 'left', 'right'];
const materialOptions = MATERIALS.map((m) => ({ value: m.id, label: m.name }));
/** Размер без хвостов округления. */
const len = (a: number, b: number) => Math.round((b - a) * 1000) / 1000;

interface Props {
  project: Project;
  step: RoomStep;
  onStep: (s: RoomStep) => void;
  onRoom: (room: Room, extra?: Partial<Project>) => void;
  /** К обзору комнаты. */
  onBack: () => void;
}

type FitResult = ReturnType<typeof fitRoomObjects>;

export function RoomEditor({ project, step, onStep, onRoom, onBack }: Props) {
  const wizard = !project.roomReady;
  // 022: комната из скана проходит те же шаги; размеры у неё уже есть, при ручном вводе — пустые до ввода
  const isScan = !!project.scanInfo;
  const manualNew = wizard && !isScan;
  const [stored] = useState(() => loadRoomDraft(project.id));
  /** null — черновика нет, на экране сохранённая комната. */
  const [draft, setDraft] = useState<Room | null>(stored?.room ?? null);
  const [reached, setReached] = useState<RoomStep>(stored?.reached ?? 'size');
  const [entered, setEntered] = useState<DimKey[]>(stored?.entered ?? []);
  const [touched, setTouched] = useState<string[]>(stored?.touched ?? []);
  const [saved, setSaved] = useState(false);
  const [askReset, setAskReset] = useState(false);
  const [leave, setLeave] = useState<{ proceed: () => void } | null>(null);
  const [fitAsk, setFitAsk] = useState<{ fit: FitResult; after?: () => void } | null>(null);

  // поля, которые меняются вне конструктора (обработка, подстройка), всегда берутся из проекта
  const room = useMemo(() => (draft ? withOutside(draft, project.room) : project.room), [draft, project.room]);
  const reverb = useMemo(() => computeReverb(room), [room]);
  const outside = useMemo(() => { const f = fitRoomObjects(room); return f.removed.length + f.trimmed.length; }, [room]);
  const dirty = draft !== null && draftDiffers(draft, project.room);
  const dimsOk = !manualNew || DIMS.every((k) => entered.includes(k));
  /** Пометка «по умолчанию» у нетронутых материалов и обстановки — только в ручной настройке. */
  const isDefault = wizard ? (key: string) => !touched.includes(key) : undefined;

  const index = ROOM_STEPS.indexOf(step);
  const reachedIndex = ROOM_STEPS.indexOf(reached);
  // ручная настройка идёт по порядку: дальше достигнутого шага по адресу не попасть
  const shown = wizard && index > reachedIndex ? reached : step;
  useEffect(() => { if (shown !== step) onStep(shown); }, [shown, step]); // eslint-disable-line react-hooks/exhaustive-deps

  const persist = (r: Room, extra: Partial<RoomDraft> = {}) =>
    saveRoomDraft(project.id, { room: r, reached, entered, touched, ...extra });
  const edit = (r: Room) => {
    const prev = draft ?? project.room;
    const t = new Set(touched);
    for (const sf of SURFACES) if (r.materials[sf] !== prev.materials[sf]) t.add(`mat.${sf}`);
    if (r.furnishing !== prev.furnishing) t.add('furnishing');
    if (r.leakage !== prev.leakage) t.add('leakage');
    const nextTouched = [...t];
    setTouched(nextTouched);
    setDraft(r);
    setSaved(false);
    persist(r, { touched: nextTouched });
  };
  /** Размер, введённый при ручной настройке. */
  const enterDim = (k: DimKey, v: number) => {
    const r = { ...(draft ?? project.room), [k]: v };
    const e = entered.includes(k) ? entered : [...entered, k];
    setEntered(e);
    setDraft(r);
    setSaved(false);
    persist(r, { entered: e });
  };
  const forget = () => {
    dropRoomDraft(project.id);
    setDraft(null);
    setReached('size');
    setEntered([]);
    setTouched([]);
  };

  const commit = (r: Room, after?: () => void) => {
    onRoom(r, { roomReady: true });
    forget();
    setFitAsk(null);
    if (after) after();
    else if (wizard) onBack();
    else setSaved(true);
  };
  /** «Сохранить»: если после уменьшения комнаты что-то оказалось за стенами — сначала список и подтверждение. */
  const save = (after?: () => void) => {
    const fit = fitRoomObjects(room);
    if (fit.removed.length || fit.trimmed.length) setFitAsk({ fit, after });
    else commit(room, after);
  };
  const reset = () => {
    setAskReset(false);
    forget();
    setSaved(false);
    if (wizard) onStep('size');
  };
  const next = () => {
    if (!dimsOk) return;
    const to = ROOM_STEPS[index + 1];
    const far = ROOM_STEPS.indexOf(to) > reachedIndex ? to : reached;
    const r = draft ?? project.room;
    setDraft(r);
    setReached(far);
    persist(r, { reached: far });
    onStep(to);
  };
  /** Скан при ручной проверке: колонки у другой стены — поворот сразу в проекте (комната ещё не создана). */
  const rotate = () => {
    const r = rotateRoom(room);
    const info = project.scanInfo;
    onRoom(r, info ? { scanInfo: { ...info, rotation: ((info.rotation ?? 0) + 1) % 4 } } : {});
    setDraft(r);
    persist(r);
  };
  /** Поправить границы: введённое на шагах уходит в комнату проекта, блок поправки — на экране «Комната». */
  const fixBounds = () => {
    onRoom(room);
    forget();
    requestScanFix();
    onBack();
  };

  // уход из конструктора с несохранёнными изменениями: «Сохранить» / «Не сохранять» / «Остаться».
  // При ручной настройке не спрашиваем — черновик остаётся и продолжится с того же шага.
  const guard = useRef({ wizard, dirty });
  guard.current = { wizard, dirty };
  useEffect(() => {
    setLeaveGuard((nextRoute, proceed) => {
      if (nextRoute.tab === 'room' && nextRoute.room !== 'overview') return false;
      if (guard.current.wizard || !guard.current.dirty) return false;
      setLeave({ proceed });
      return true;
    });
    return () => setLeaveGuard(null);
  }, []);

  const steps = (
    <>
      {shown === 'size' && <SizeStep room={room} onRoom={edit} entered={manualNew ? entered : null} onDim={enterDim} />}
      {shown === 'walls' && <WallsStep pid={project.id} room={room} onRoom={edit} isDefault={isDefault} />}
      {shown === 'floor' && <FloorStep room={room} onRoom={edit} isDefault={isDefault} />}
      {shown === 'furniture' && <FurnitureStep pid={project.id} room={room} reverb={reverb} onRoom={edit} isDefault={isDefault} />}
    </>
  );
  const i = ROOM_STEPS.indexOf(shown);
  return (
    <div class="screen">
      <div class="btn-row">
        <button type="button" class="btn btn--ghost btn--small" onClick={onBack}>← {S.editor.back}</button>
      </div>
      {wizard ? (
        <Panel title={S.editor.wizardStep(i + 1, S.editor.stepLabels[shown])}>
          <p class="muted small">{!isScan ? S.editor.wizardIntro : shown === 'size' ? S.editor.scanIntro(project.scanInfo?.fileName ?? '') : S.editor.scanStepIntro}</p>
          {isScan && shown === 'size' && (
            <>
              <p class="small">{S.editor.scanWall}</p>
              <div class="btn-row">
                <button type="button" class="btn" onClick={rotate}><RotateIcon /> {S.room.rotate}</button>
                <button type="button" class="btn" onClick={fixBounds}>{S.scan.fix}</button>
              </div>
            </>
          )}
        </Panel>
      ) : (
        <>
          <SectionNav label={S.editor.steps} value={shown} onChange={onStep}
            options={ROOM_STEPS.map((s) => ({ value: s, label: S.editor.stepLabels[s], hint: S.editor.stepHints[s] }))} />
          {dirty && <Note>{S.editor.unsaved}</Note>}
        </>
      )}
      {steps}
      <Panel>
        {outside > 0 && <Note tone="warn">{S.editor.outside(outside)}</Note>}
        {!dimsOk && shown === 'size' && <Note>{S.editor.dimsNeeded}</Note>}
        {saved && !dirty && <p class="small" role="status">{S.editor.saved}</p>}
        {wizard ? (
          <>
            <div class="btn-row">
              {i > 0 && <button type="button" class="btn" onClick={() => onStep(ROOM_STEPS[i - 1])}>← {S.editor.prev}</button>}
              {i < ROOM_STEPS.length - 1
                ? <button type="button" class="btn btn--primary" disabled={!dimsOk} onClick={next}>{S.editor.next} →</button>
                : <button type="button" class="btn btn--primary" onClick={() => save()}>{S.editor.save}</button>}
            </div>
            <div class="btn-row">
              <button type="button" class="btn btn--ghost btn--small" onClick={() => setAskReset(true)}>{S.editor.resetDraft}</button>
            </div>
          </>
        ) : (
          <div class="btn-row">
            <button type="button" class="btn btn--primary" disabled={!dirty} onClick={() => save()}>{S.editor.save}</button>
            <button type="button" class="btn btn--ghost" disabled={!dirty} onClick={() => setAskReset(true)}>{S.editor.resetDraft}</button>
          </div>
        )}
      </Panel>

      {askReset && (
        <ConfirmSheet title={S.editor.resetTitle} text={S.editor.resetText(wizard)} confirm={S.editor.resetDraft}
          onCancel={() => setAskReset(false)} onConfirm={reset} />
      )}
      {leave && (
        <ConfirmSheet title={S.editor.leaveTitle} text={S.editor.leaveText} tone="primary"
          confirm={S.editor.save} cancel={S.editor.leaveStay}
          extra={{ label: S.editor.leaveDiscard, onClick: () => { const go = leave.proceed; setLeave(null); forget(); go(); } }}
          onCancel={() => setLeave(null)}
          onConfirm={() => { const go = leave.proceed; setLeave(null); save(go); }} />
      )}
      {fitAsk && (
        <ConfirmSheet title={S.editor.fitTitle} text={S.editor.fitText} confirm={S.editor.save} cancel={S.editor.fitBack}
          tone={fitAsk.fit.removed.length ? 'danger' : 'primary'}
          onCancel={() => setFitAsk(null)} onConfirm={() => commit(fitAsk.fit.room, fitAsk.after)}>
          <FitList title={S.editor.fitRemoved} items={fitAsk.fit.removed} />
          <FitList title={S.editor.fitTrimmed} items={fitAsk.fit.trimmed} />
        </ConfirmSheet>
      )}
    </div>
  );
}

/** Подпись объекта в списке удаляемого и обрезаемого. */
function fitLabel(f: FitItem): string {
  const wall = (w: WallId) => S.editor.neighbour[w];
  switch (f.kind) {
    case 'zone': return f.item.name || S.zones.kinds[f.item.kind];
    case 'opening': return `${S.editor.fitOpening}, ${wall(f.item.wall)}`;
    case 'feature': return `${S.layout.kinds[f.item.kind]}, ${wall(f.item.wall)}`;
    case 'covering': {
      const c = f.item;
      if (c.surface === 'floor') return `${S.coverings.carpet} ${S.editor.fitFloor}`;
      return `${c.kind === 'curtain' ? S.coverings.curtain : S.coverings.wallCarpet}, ${wall(c.surface)}`;
    }
    case 'extension': return `${f.item.name || S.openings.corridor}, ${wall(f.item.wall)}`;
    case 'slope': return S.shape.slopeTitle;
  }
}

function FitList({ title, items }: { title: string; items: FitItem[] }) {
  if (!items.length) return null;
  return (
    <>
      <p class="small"><strong>{title}</strong></p>
      <ul class="plain-list small">{items.map((f, ki) => <li key={ki}>{fitLabel(f)}</li>)}</ul>
    </>
  );
}

/**
 * Шаг «Размеры»: размеры, коридоры и ниши, модель; в «Дополнительно» — температура и модель расчёта (022).
 * entered — ручная настройка новой комнаты: поле пустое, пока размер не введён; план и форма — после всех трёх.
 */
function SizeStep({ room, onRoom, entered, onDim }: { room: Room; onRoom: (r: Room) => void; entered: DimKey[] | null; onDim: (k: DimKey, v: number) => void }) {
  const set = (patch: Partial<Room>) => onRoom({ ...room, ...patch });
  const val = (k: DimKey) => (entered && !entered.includes(k) ? NaN : room[k]);
  const dim = (k: DimKey) => (v: number) => (entered ? onDim(k, v) : set({ [k]: v }));
  const ready = !entered || DIMS.every((k) => entered.includes(k));
  return (
    <>
      <Panel class="panel--hero">
        {ready
          ? <PlanView depth={room.depth} width={room.width} zones={room.zones} extensions={room.extensions} openings={room.openings} features={room.features} treatments={shownTreatments(room)} slope={room.slope} />
          : <p class="muted small">{S.editor.planAfterDims}</p>}
        <div class="dims">
          <NumberField id="room-depth" label={S.room.depth} hint={S.room.depthHint} value={val('depth')} unit="м" min={1} max={50} onChange={dim('depth')} />
          <NumberField label={S.room.width} hint={S.room.widthHint} value={val('width')} unit="м" min={1} max={50} onChange={dim('width')} />
          <NumberField label={S.room.height} value={val('height')} unit="м" min={1} max={20} onChange={dim('height')} />
        </div>
        <Details summary={S.editor.advanced}>
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
          <SelectField
            label={S.model.title}
            value={room.model ?? 'auto'}
            options={(['auto', 'modal', 'wave'] as AcousticModel[]).map((m) => ({ value: m, label: S.model[m] }))}
            onChange={(v) => set({ model: v as AcousticModel })}
          />
          <p class="muted small">{S.model.hint}</p>
        </Details>
      </Panel>
      {ready && <ShapePanel room={room} onRoom={onRoom} />}
    </>
  );
}

function useCoverings(room: Room, onRoom: (r: Room) => void) {
  const all = room.coverings ?? [];
  return {
    add: (c: Covering) => onRoom({ ...room, coverings: [...all, c] }),
    set: (id: string, patch: Partial<Covering>) => onRoom({ ...room, coverings: all.map((c) => (c.id === id ? fitCovering(room, { ...c, ...patch }) : c)) }),
    remove: (id: string) => onRoom({ ...room, coverings: all.filter((c) => c.id !== id) }),
  };
}

/** Шаг «Стены»: выбор стены, развёртка, материал, окна/двери/проёмы, ковры и шторы этой стены. */
function WallsStep({ pid, room, onRoom, isDefault }: { pid: string; room: Room; onRoom: (r: Room) => void; isDefault?: (key: string) => boolean }) {
  const [wall, setWall] = useViewState<WallId>(pid, 'room.wall', 'front');
  const covers = (room.coverings ?? []).filter((c) => c.surface === wall);
  const edit = useCoverings(room, onRoom);
  return (
    <>
      <Panel class="panel--hero">
        <Segmented label={S.editor.wall} value={wall} options={WALLS.map((w) => ({ value: w, label: S.editor.wallShort[w] }))} onChange={setWall} />
        <WallView room={room} wall={wall} />
        <p class="muted small">{S.editor.wallView}</p>
        <SelectField label={S.editor.wallMaterial} value={room.materials[wall]} options={materialOptions}
          hint={isDefault?.(`mat.${wall}`) ? S.editor.byDefault : undefined}
          onChange={(v) => onRoom({ ...room, materials: { ...room.materials, [wall]: v } })} />
      </Panel>
      <WallItemsPanel room={room} onRoom={onRoom} wall={wall} />
      <Panel title={S.editor.coverings}>
        {!room.furnitureList && <p class="muted small">{S.editor.listOffNote}</p>}
        {covers.length === 0 && <p class="muted small">{S.editor.coveringsNone}</p>}
        <div class="wall-items">
          {covers.map((c, i) => <CoveringCard key={c.id} room={room} c={c} index={i} onChange={(p) => edit.set(c.id, p)} onRemove={() => edit.remove(c.id)} />)}
        </div>
        <ActionMenu label={S.editor.addOnWall} actions={[
          { label: S.coverings.wallCarpet, onSelect: () => edit.add(newWallCarpet(room, wall, makeId())) },
          { label: S.coverings.curtain, onSelect: () => edit.add(newCurtain(room, wall, makeId())) },
        ]} />
      </Panel>
      <LeakagePanel room={room} onRoom={onRoom} isDefault={isDefault} />
    </>
  );
}

/** Герметичность комнаты (022: с шага «Мебель» перенесена сюда, к дверям и проёмам). */
function LeakagePanel({ room, onRoom, isDefault }: { room: Room; onRoom: (r: Room) => void; isDefault?: (key: string) => boolean }) {
  const cal = room.calibration;
  return (
    <Panel title={S.editor.leakageTitle}>
      <SelectField
        label={S.zones.leakage}
        value={room.leakage ?? 'typical'}
        options={(['sealed', 'typical', 'door', 'open'] as Leakage[]).map((k) => ({ value: k, label: S.zones.leakages[k] }))}
        hint={isDefault?.('leakage') ? S.editor.byDefault : undefined}
        onChange={(v) => onRoom({ ...room, leakage: v as Leakage })}
      />
      <p class="muted small">{S.zones.leakageHint}</p>
      {cal?.source && cal.leakageBefore && <Note>{S.editor.leakageCalibrated(cal.source, S.zones.leakages[cal.leakageBefore])}</Note>}
    </Panel>
  );
}

/** Карточка ковра или штор: на стене — отступ, ширина, низ и верх; на полу — положение и размеры. */
function CoveringCard({ room, c, index, onChange, onRemove }: { room: Room; c: Covering; index: number; onChange: (p: Partial<Covering>) => void; onRemove: () => void }) {
  const floor = c.surface === 'floor';
  const grades: Covering['grade'][] = c.kind === 'curtain' ? ['light', 'heavy'] : ['thin', 'thick'];
  const title = c.kind === 'curtain' ? S.coverings.curtain : floor ? S.coverings.carpet : S.coverings.wallCarpet;
  const U = floor ? room.depth : c.surface === 'front' || c.surface === 'back' ? room.width : room.depth;
  const V = floor ? room.width : room.height;
  return (
    <div class="zone-card">
      <div class="zone-card__head">
        <SelectField label={`${title} ${index + 1}: ${S.coverings.grade.toLowerCase()}`} value={c.grade}
          options={grades.map((g) => ({ value: g, label: S.coverings.grades[g] }))} onChange={(v) => onChange({ grade: v as Covering['grade'] })} />
        <button type="button" class="btn btn--small btn--ghost" onClick={onRemove}>{S.coverings.remove}</button>
      </div>
      {floor ? (
        <div class="grid-2">
          <NumberField compact id={`${c.id}-u0`} label={S.coverings.fromFront} value={c.u0} unit="м" min={0} max={U} onChange={(v) => onChange({ u0: v, u1: v + (c.u1 - c.u0) })} />
          <NumberField compact id={`${c.id}-v0`} label={S.coverings.fromLeft} value={c.v0} unit="м" min={0} max={V} onChange={(v) => onChange({ v0: v, v1: v + (c.v1 - c.v0) })} />
          <NumberField compact id={`${c.id}-du`} label={S.coverings.lengthDeep} value={len(c.u0, c.u1)} unit="м" min={0.1} max={U} onChange={(v) => onChange({ u1: c.u0 + v })} />
          <NumberField compact id={`${c.id}-dv`} label={S.coverings.widthAlong} value={len(c.v0, c.v1)} unit="м" min={0.1} max={V} onChange={(v) => onChange({ v1: c.v0 + v })} />
        </div>
      ) : (
        <>
          <p class="muted small">{S.openings.offsetLine(c.surface, c.kind === 'curtain' ? 'штор' : 'ковра')}</p>
          <div class="grid-2">
            <NumberField compact id={`${c.id}-u0`} label={S.openings.offset} value={c.u0} unit="м" min={0} max={U} onChange={(v) => onChange({ u0: v, u1: v + (c.u1 - c.u0) })} />
            <NumberField compact id={`${c.id}-du`} label={S.openings.widthAlong} value={len(c.u0, c.u1)} unit="м" min={0.1} max={U} onChange={(v) => onChange({ u1: c.u0 + v })} />
            <NumberField compact id={`${c.id}-v0`} label={S.coverings.bottom} value={c.v0} unit="м" min={0} max={V} onChange={(v) => onChange({ v0: v })} />
            <NumberField compact id={`${c.id}-v1`} label={S.coverings.top} value={c.v1} unit="м" min={0.1} max={V} onChange={(v) => onChange({ v1: v })} />
          </div>
        </>
      )}
      {c.kind === 'curtain' && c.grade === 'light' && <p class="muted small">{S.coverings.lightNote}</p>}
    </div>
  );
}

/** Шаг «Пол и потолок»: материал пола, ковры на плане (мебель — контуром), потолок и скос. */
function FloorStep({ room, onRoom, isDefault }: { room: Room; onRoom: (r: Room) => void; isDefault?: (key: string) => boolean }) {
  const rugs = (room.coverings ?? []).filter((c) => c.surface === 'floor');
  const edit = useCoverings(room, onRoom);
  return (
    <>
      <Panel class="panel--hero" title={S.editor.floor}>
        <PlanView depth={room.depth} width={room.width} zones={room.zones} rugs={rugs} extensions={room.extensions} openings={room.openings} features={room.features} slope={room.slope} label={S.editor.floorPlan} />
        <SelectField label={S.editor.floorMaterial} value={room.materials.floor} options={materialOptions}
          hint={isDefault?.('mat.floor') ? S.editor.byDefault : undefined}
          onChange={(v) => onRoom({ ...room, materials: { ...room.materials, floor: v } })} />
      </Panel>
      <Panel title={S.editor.rugs}>
        {!room.furnitureList && <p class="muted small">{S.editor.listOffNote}</p>}
        {rugs.length === 0 && <p class="muted small">{S.editor.rugsNone}</p>}
        <div class="wall-items">
          {rugs.map((c, i) => <CoveringCard key={c.id} room={room} c={c} index={i} onChange={(p) => edit.set(c.id, p)} onRemove={() => edit.remove(c.id)} />)}
        </div>
        <button type="button" class="btn" onClick={() => edit.add(newRug(room, makeId()))}>{S.editor.addRug}</button>
      </Panel>
      <Panel title={S.editor.ceiling}>
        <SelectField label={S.editor.ceilingMaterial} value={room.materials.ceiling} options={materialOptions}
          hint={isDefault?.('mat.ceiling') ? S.editor.byDefault : undefined}
          onChange={(v) => onRoom({ ...room, materials: { ...room.materials, ceiling: v } })} />
        <SlopeBlock room={room} onRoom={onRoom} />
      </Panel>
    </>
  );
}

/** Шаг «Мебель»: план сверху, обстановка (общая оценка и список), предметы, прочие зоны. */
function FurnitureStep({ pid, room, reverb, onRoom, isDefault }: { pid: string; room: Room; reverb: ReverbResult; onRoom: (r: Room) => void; isDefault?: (key: string) => boolean }) {
  const zones = room.zones ?? [];
  const items = zones.filter((z) => z.kind === 'furniture');
  const [selected, setSelected] = useViewState<string | null>(pid, 'room.furniture', null);
  const setItem = (id: string, patch: Partial<Zone>) => onRoom({ ...room, zones: zones.map((z) => (z.id === id ? { ...z, ...patch } : z)) });
  /** Положение и размеры: предмет остаётся в комнате, размер по возможности сохраняется. */
  const place = (z: Zone, x0: number, y0: number, dx: number, dy: number) => setItem(z.id, fitRect(room, x0 + dx / 2, y0 + dy / 2, dx, dy));
  const add = (t: FurnitureType) => {
    const z = newFurniture(room, t, makeId(), S.furniture.types[t]);
    onRoom({ ...room, zones: [...zones, z] });
    setSelected(z.id);
  };
  const retype = (z: Zone, t: FurnitureType) => setItem(z.id, {
    furniture: t, name: S.furniture.types[t], canSit: FURNITURE[t].canSit,
    // размеры из скана — настоящие; у добавленного вручную предмета высота берётся из заготовки нового типа
    ...(z.fromScan ? {} : { height: Math.min(FURNITURE[t].height, room.height) }),
  });
  const pick = (id: string) => {
    setSelected(id);
    requestAnimationFrame(() => document.getElementById(`furn-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  };
  const list = !!room.furnitureList;
  const furnitureList = (
    <>
        {items.length === 0 && <p class="muted small">{S.furniture.none}</p>}
        <div class="wall-items">
          {items.map((z, i) => {
            const t = furnitureType(z) ?? 'other';
            const dx = z.x1 - z.x0, dy = z.y1 - z.y0;
            const effect = !isAcoustic(t)
              ? S.furniture.effect.none
              : list ? S.furniture.effect[contribution(furnitureAbsorption(z), reverb.absorptionArea)] : S.furniture.listOff;
            return (
              <div key={z.id} id={`furn-${z.id}`} class={`zone-card${selected === z.id ? ' is-selected' : ''}`}>
                <div class="zone-card__head">
                  <SelectField label={`${S.furniture.type} ${i + 1}`} value={t}
                    options={FURNITURE_ORDER.map((k) => ({ value: k, label: S.furniture.types[k] }))} onChange={(v) => retype(z, v as FurnitureType)} />
                  <button type="button" class="btn btn--small btn--ghost" onClick={() => onRoom({ ...room, zones: zones.filter((x) => x.id !== z.id) })}>
                    {S.furniture.remove}
                  </button>
                </div>
                <div class="grid-2">
                  <NumberField compact id={`${z.id}-x0`} label={S.furniture.fromFront} value={z.x0} unit="м" min={0} max={room.depth} onChange={(v) => place(z, v, z.y0, dx, dy)} />
                  <NumberField compact id={`${z.id}-y0`} label={S.furniture.fromLeft} value={z.y0} unit="м" min={0} max={room.width} onChange={(v) => place(z, z.x0, v, dx, dy)} />
                  <NumberField compact id={`${z.id}-dy`} label={S.furniture.along} value={len(z.y0, z.y1)} unit="м" min={0.1} max={room.width} onChange={(v) => place(z, z.x0, z.y0, dx, v)} />
                  <NumberField compact id={`${z.id}-dx`} label={S.furniture.deep} value={len(z.x0, z.x1)} unit="м" min={0.1} max={room.depth} onChange={(v) => place(z, z.x0, z.y0, v, dy)} />
                  <NumberField compact id={`${z.id}-h`} label={S.furniture.height} value={z.height ?? FURNITURE[t].height} unit="м" min={0.1} max={room.height} onChange={(v) => setItem(z.id, { height: v })} />
                </div>
                <div class="btn-row">
                  <button type="button" class="btn btn--small" onClick={() => onRoom({ ...room, zones: zones.map((x) => (x.id === z.id ? rotateFurniture(room, x) : x)) })}>{S.furniture.rotate}</button>
                </div>
                <label class="check">
                  <input type="checkbox" checked={z.canSit} onChange={(e) => setItem(z.id, { canSit: (e.target as HTMLInputElement).checked })} />
                  <span>{S.furniture.canSit}</span>
                </label>
                <p class="muted small">{effect}</p>
              </div>
            );
          })}
        </div>
        <ActionMenu label={S.furniture.add} actions={FURNITURE_ORDER.map((t) => ({ label: S.furniture.types[t], onSelect: () => add(t) }))} />
    </>
  );
  return (
    <>
      <Panel class="panel--hero">
        <PlanView depth={room.depth} width={room.width} zones={zones} extensions={room.extensions} openings={room.openings} features={room.features} slope={room.slope}
          selectedZone={selected} onZoneSelect={pick} label={S.editor.furniturePlan} />
        <p class="muted small">{list ? S.furniture.intro : S.furniture.introGeneral}</p>
      </Panel>
      <Panel title={S.furniture.furnishing}>
        {/* 022: явный выбор способа вместо галочки «Указать мебель списком» */}
        <Segmented label={S.furniture.mode} value={room.furnitureList ? 'list' : 'general'}
          options={[{ value: 'general', label: S.furniture.modeGeneral }, { value: 'list', label: S.furniture.modeList }]}
          onChange={(v) => onRoom({ ...room, furnitureList: v === 'list' })} />
        <p class="muted small">{room.furnitureList ? S.furniture.listHint : S.furniture.generalHint}</p>
        {/* 027: при «Списком предметов» общая оценка остаётся только для баса — подпись говорит об этом прямо */}
        <SelectField label={list ? S.furniture.levelBassLabel : S.furniture.level} value={room.furnishing}
          options={(Object.keys(FURNISHING_LABEL) as Furnishing[]).map((k) => ({ value: k, label: FURNISHING_LABEL[k] }))}
          hint={isDefault?.('furnishing') ? S.editor.byDefault : undefined}
          onChange={(v) => onRoom({ ...room, furnishing: v as Furnishing })} />
        <p class="muted small">{list ? S.furniture.levelBass : S.furniture.furnishingHint}</p>
        {list && <p class="muted small">{S.furniture.listUses}</p>}
        <p class="small" role="status">{S.furniture.rtNow(fmt(reverb.tMid, 2))}</p>
        {/* пояснение относится к списку предметов: при общей оценке отдельные предметы не учитываются вовсе */}
        {list && (
          <Details summary={S.furniture.whyTitle}>
            {S.furniture.why.map((t, ki) => <p key={ki} class="small">{t}</p>)}
          </Details>
        )}
      </Panel>
      {list ? (
        <>
          <Panel title={S.furniture.title}>{furnitureList}</Panel>
          <ZonesPanel room={room} onRoom={onRoom} />
        </>
      ) : (
        // 027: при «Общей оценкой» мебель на звук не влияет — она и другие зоны собраны в один блок по назначению;
        // блок сворачивается и помнит состояние, как прежний блок зон
        <Panel title={S.zones.title} collapseKey="ra-room-zones" summary={`Мест: ${zones.length}`}>
          <p class="small">{S.furniture.placesIntro}</p>
          <h3 class="subhead">{S.furniture.subFurniture}</h3>
          {furnitureList}
          <h3 class="subhead">{S.furniture.subOther}</h3>
          <ZonesPanel room={room} onRoom={onRoom} bare />
        </Panel>
      )}
    </>
  );
}
