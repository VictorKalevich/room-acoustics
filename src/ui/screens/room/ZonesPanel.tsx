// Зоны, где нельзя ставить колонки и слушателя (двери, окна, мебель).
import { makeId } from '../../../state/project';
import type { Room, Zone, ZoneKind, Leakage } from '../../../core/types';
import { NumberField, Panel, SelectField } from '../../components/Fields';
import { S } from '../../strings';

export function ZonesPanel({ room, onRoom }: { room: Room; onRoom: (r: Room) => void }) {
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
    <Panel title={S.zones.title} collapseKey="ra-room-zones" summary={`Зон: ${zones.length} · ${S.zones.leakages[room.leakage ?? 'typical']}`}>
      <p class="small">{S.zones.intro}</p>
      {zones.length === 0 && <p class="muted small">{S.zones.none}</p>}
      {zones.map((z, i) => (
        <div key={z.id} class="zone-card">
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
