// Конструктор комнаты (019): размеры и форма → стены (развёртка, окна, ковры, шторы) → пол и потолок →
// мебель сверху. Всё, что найдено в скане, правится здесь же. Данные — общий Project, как и раньше.
import type { Project } from '../../../state/project';
import { makeId } from '../../../state/project';
import type { Covering, FurnitureType, ReverbResult, Room, WallId, Zone } from '../../../core/types';
import { FURNISHING_LABEL, MATERIALS } from '../../../core/materials';
import {
  FURNITURE, FURNITURE_ORDER, contribution, fitCovering, fitRect, furnitureAbsorption, furnitureType, isAcoustic,
  newCurtain, newFurniture, newRug, newWallCarpet, rotateFurniture,
} from '../../../core/furniture';
import { speedOfSound } from '../../../core/physics';
import { shownTreatments } from '../../../core/treatments';
import { ActionMenu, Details, NumberField, Panel, SectionNav, Segmented, SelectField } from '../../design-system';
import { PlanView } from '../../components/PlanView';
import { WallView } from '../../components/WallView';
import { ShapePanel, SlopeBlock, WallItemsPanel } from './OpeningsPanel';
import { ZonesPanel } from './ZonesPanel';
import { ROOM_STEPS, type RoomStep } from '../../navigation';
import { useViewState } from '../../useViewState';
import { S } from '../../strings';
import { fmt } from '../../format';
import type { Furnishing } from '../../../core/types';

const WALLS: WallId[] = ['front', 'back', 'left', 'right'];
const materialOptions = MATERIALS.map((m) => ({ value: m.id, label: m.name }));
/** Размер без хвостов округления. */
const len = (a: number, b: number) => Math.round((b - a) * 1000) / 1000;

interface Props {
  project: Project;
  reverb: ReverbResult;
  step: RoomStep;
  onStep: (s: RoomStep) => void;
  onRoom: (room: Room) => void;
  onBack: () => void;
}

export function RoomEditor({ project, reverb, step, onStep, onRoom, onBack }: Props) {
  const room = project.room;
  return (
    <div class="screen">
      <div class="btn-row">
        <button type="button" class="btn btn--ghost btn--small" onClick={onBack}>← {S.editor.back}</button>
      </div>
      <SectionNav label={S.editor.steps} value={step} onChange={onStep}
        options={ROOM_STEPS.map((s) => ({ value: s, label: S.editor.stepLabels[s], hint: S.editor.stepHints[s] }))} />
      {step === 'size' && <SizeStep room={room} onRoom={onRoom} />}
      {step === 'walls' && <WallsStep project={project} onRoom={onRoom} />}
      {step === 'floor' && <FloorStep room={room} onRoom={onRoom} />}
      {step === 'furniture' && <FurnitureStep project={project} reverb={reverb} onRoom={onRoom} />}
    </div>
  );
}

/** Шаг «Размеры»: размеры, температура, коридоры и ниши, модель (поля перенесены без изменений). */
function SizeStep({ room, onRoom }: { room: Room; onRoom: (r: Room) => void }) {
  const set = (patch: Partial<Room>) => onRoom({ ...room, ...patch });
  return (
    <>
      <Panel class="panel--hero">
        <PlanView depth={room.depth} width={room.width} zones={room.zones} extensions={room.extensions} openings={room.openings} features={room.features} treatments={shownTreatments(room)} slope={room.slope} />
        <div class="dims">
          <NumberField id="room-depth" label={S.room.depth} hint={S.room.depthHint} value={room.depth} unit="м" min={1} max={50} onChange={(v) => set({ depth: v })} />
          <NumberField label={S.room.width} hint={S.room.widthHint} value={room.width} unit="м" min={1} max={50} onChange={(v) => set({ width: v })} />
          <NumberField label={S.room.height} value={room.height} unit="м" min={1} max={20} onChange={(v) => set({ height: v })} />
        </div>
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
      <ShapePanel room={room} onRoom={onRoom} />
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
function WallsStep({ project, onRoom }: { project: Project; onRoom: (r: Room) => void }) {
  const room = project.room;
  const [wall, setWall] = useViewState<WallId>(project.id, 'room.wall', 'front');
  const covers = (room.coverings ?? []).filter((c) => c.surface === wall);
  const edit = useCoverings(room, onRoom);
  return (
    <>
      <Panel class="panel--hero">
        <Segmented label={S.editor.wall} value={wall} options={WALLS.map((w) => ({ value: w, label: S.editor.wallShort[w] }))} onChange={setWall} />
        <WallView room={room} wall={wall} />
        <p class="muted small">{S.editor.wallView}</p>
        <SelectField label={S.editor.wallMaterial} value={room.materials[wall]} options={materialOptions}
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
    </>
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
function FloorStep({ room, onRoom }: { room: Room; onRoom: (r: Room) => void }) {
  const rugs = (room.coverings ?? []).filter((c) => c.surface === 'floor');
  const edit = useCoverings(room, onRoom);
  return (
    <>
      <Panel class="panel--hero" title={S.editor.floor}>
        <PlanView depth={room.depth} width={room.width} zones={room.zones} rugs={rugs} extensions={room.extensions} openings={room.openings} features={room.features} slope={room.slope} label={S.editor.floorPlan} />
        <SelectField label={S.editor.floorMaterial} value={room.materials.floor} options={materialOptions}
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
          onChange={(v) => onRoom({ ...room, materials: { ...room.materials, ceiling: v } })} />
        <SlopeBlock room={room} onRoom={onRoom} />
      </Panel>
    </>
  );
}

/** Шаг «Мебель»: план сверху, обстановка (общая оценка и список), предметы, прочие зоны. */
function FurnitureStep({ project, reverb, onRoom }: { project: Project; reverb: ReverbResult; onRoom: (r: Room) => void }) {
  const room = project.room;
  const zones = room.zones ?? [];
  const items = zones.filter((z) => z.kind === 'furniture');
  const [selected, setSelected] = useViewState<string | null>(project.id, 'room.furniture', null);
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
  return (
    <>
      <Panel class="panel--hero">
        <PlanView depth={room.depth} width={room.width} zones={zones} extensions={room.extensions} openings={room.openings} features={room.features} slope={room.slope}
          selectedZone={selected} onZoneSelect={pick} label={S.editor.furniturePlan} />
        <p class="muted small">{S.furniture.intro}</p>
      </Panel>
      <Panel title={S.furniture.furnishing}>
        <SelectField label={S.furniture.level} value={room.furnishing}
          options={(Object.keys(FURNISHING_LABEL) as Furnishing[]).map((k) => ({ value: k, label: FURNISHING_LABEL[k] }))}
          onChange={(v) => onRoom({ ...room, furnishing: v as Furnishing })} />
        <p class="muted small">{S.furniture.furnishingHint}</p>
        <label class="check">
          <input type="checkbox" checked={!!room.furnitureList} onChange={(e) => onRoom({ ...room, furnitureList: (e.target as HTMLInputElement).checked })} />
          <span>{S.furniture.list}</span>
        </label>
        <p class="muted small">{S.furniture.listHint}</p>
        <p class="small" role="status">{S.furniture.rtNow(fmt(reverb.tMid, 2))}</p>
        <Details summary={S.furniture.whyTitle}>
          {S.furniture.why.map((t, ki) => <p key={ki} class="small">{t}</p>)}
        </Details>
      </Panel>
      <Panel title={S.furniture.title}>
        {items.length === 0 && <p class="muted small">{S.furniture.none}</p>}
        <div class="wall-items">
          {items.map((z, i) => {
            const t = furnitureType(z) ?? 'other';
            const dx = z.x1 - z.x0, dy = z.y1 - z.y0;
            const effect = !isAcoustic(t)
              ? S.furniture.effect.none
              : room.furnitureList ? S.furniture.effect[contribution(furnitureAbsorption(z), reverb.absorptionArea)] : S.furniture.listOff;
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
      </Panel>
      <ZonesPanel room={room} onRoom={onRoom} />
    </>
  );
}
