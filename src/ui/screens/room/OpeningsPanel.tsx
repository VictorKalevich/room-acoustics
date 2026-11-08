// Проёмы, коридор за аркой, окна и двери, скос потолка.
import { makeId } from '../../../state/project';
import type { Room, Opening, Extension, WallId, AcousticModel, WallFeature } from '../../../core/types';
import { validateExtension, validateSlope, wallLength } from '../../../core/geometry';
import { openingAsItem, toRoomItem, type WallItem, type WallItemKind } from '../../../core/wallItems';
import { NumberField, Panel, SelectField, Note } from '../../components/Fields';
import { S } from '../../strings';

const WALLS: WallId[] = ['front', 'back', 'left', 'right'];

export function OpeningsPanel({ room, onRoom }: { room: Room; onRoom: (r: Room) => void }) {
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
          <div key={e.id} class="zone-card">
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
        <div key={o.id} class="zone-card">
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
        <button type="button" class="btn" aria-label="Добавить коридор" onClick={addCorridor}>{S.openings.addCorridor}</button>
        <button type="button" class="btn" aria-label="Добавить проём" onClick={addOpening}>{S.openings.addOpening}</button>
        <button type="button" class="btn" aria-label="Добавить нишу" onClick={addNiche}>{S.shape.addNiche}</button>
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
        <div key={f.id} class="zone-card">
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
        <button type="button" class="btn" aria-label="Добавить окно" onClick={() => addFeature('window')}>{S.openings.addWindow}</button>
        <button type="button" class="btn" aria-label="Добавить дверь" onClick={() => addFeature('door')}>{S.openings.addDoor}</button>
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
