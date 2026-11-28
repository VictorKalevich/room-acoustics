// Конфигурация → объекты плана (V2-024). Идентификатор объекта плана — «вид:id», по нему находится объект модели.
// Облако: ширина — поперёк комнаты (по y), «высота» — вдоль (по x), как в ядре; угловая ловушка — катет width/√2.
import type { PlanAnnex, PlanItem, PlanOpening } from '../../design-system';
import type { EditRef } from '../../application/editing';
import type { RoomConfiguration } from '../../domain/model';

export type Layer = 'audio' | 'listeners' | 'interior' | 'treatment' | 'openings';
export const LAYERS: readonly Layer[] = ['audio', 'listeners', 'interior', 'treatment', 'openings'];
export const LAYER_LABEL: Record<Layer, string> = { audio: 'Аудиосистема', listeners: 'Слушатели', interior: 'Интерьер', treatment: 'Обработка', openings: 'Двери, окна, проёмы' };

export const planId = (ref: EditRef) => `${ref.type}:${ref.id}`;

export function refOf(planItemId: string): EditRef | null {
  const i = planItemId.indexOf(':');
  if (i < 0) return null;
  const type = planItemId.slice(0, i) as EditRef['type'];
  if (!['source', 'listener', 'obstacle', 'treatment', 'covering', 'opening'].includes(type)) return null;
  return { type, id: planItemId.slice(i + 1) } as EditRef;
}

const OPENING_LABEL = { door: 'Дверь', window: 'Окно', passage: 'Проём' } as const;

/** Смежные зоны и части сложной формы (V2-046) — коробки за стенами; у части проход во всю её ширину. */
export function planAnnexes(c: RoomConfiguration): PlanAnnex[] {
  if (c.geometry.kind !== 'rect') return [];
  const { depth: D, width: W } = c.geometry;
  const part = new Set(c.shape?.zoneIds ?? []);
  return c.zones.map((z) => {
    const [x0, x1, y0, y1] = z.wall === 'right' ? [z.a0, z.a1, W, W + z.depth] : z.wall === 'left' ? [z.a0, z.a1, -z.depth, 0]
      : z.wall === 'front' ? [-z.depth, 0, z.a0, z.a1] : [D, D + z.depth, z.a0, z.a1];
    return { id: z.id, x0, x1, y0, y1, height: z.height, wall: z.wall, a0: z.arch.a0, a1: z.arch.a1, label: z.name, part: part.has(z.id) };
  });
}

export function planItems(c: RoomConfiguration, layers: ReadonlySet<Layer>): { items: PlanItem[]; openings: PlanOpening[]; annexes: PlanAnnex[] } {
  if (c.geometry.kind !== 'rect') return { items: [], openings: [], annexes: [] };
  const { depth: D, width: W, height: H } = c.geometry;
  const items: PlanItem[] = [];
  if (layers.has('audio')) {
    for (const s of c.audio.sources) {
      const box = s.box && !('missing' in s.box) ? s.box : null;
      items.push({
        id: planId({ type: 'source', id: s.id }), type: s.kind === 'sub' ? 'sub' : 'source', label: s.channel && s.kind !== 'sub' ? s.channel : s.name,
        x: s.position.x, y: s.position.y, z: s.position.z, ...(box ? { dx: box.d, dy: box.w, dz: box.h } : {}), locked: s.locked,
      });
    }
  }
  if (layers.has('listeners')) {
    for (const l of c.listening.listeners) {
      items.push({ id: planId({ type: 'listener', id: l.id }), type: 'listener', label: l.name, x: l.position.x, y: l.position.y, z: l.position.z, locked: l.locked });
    }
  }
  if (layers.has('interior')) {
    for (const z of c.interior.obstacles) {
      const h = z.height ?? 1;
      items.push({ id: planId({ type: 'obstacle', id: z.id }), type: 'obstacle', label: z.name ?? 'Предмет', x: (z.x0 + z.x1) / 2, y: (z.y0 + z.y1) / 2, z: h / 2, dx: z.x1 - z.x0, dy: z.y1 - z.y0, dz: h, locked: z.locked });
    }
    for (const cv of c.interior.coverings) {
      if (cv.surface !== 'floor') continue;
      items.push({ id: planId({ type: 'covering', id: cv.id }), type: 'zone', label: 'Ковёр', x: (cv.u0 + cv.u1) / 2, y: (cv.v0 + cv.v1) / 2, z: 0.01, dx: cv.u1 - cv.u0, dy: cv.v1 - cv.v0, dz: 0.02 });
    }
  }
  if (layers.has('treatment')) {
    for (const t of c.treatment.items) {
      const off = !c.treatment.enabled || t.enabled === false;
      const id = planId({ type: 'treatment', id: t.id });
      if (t.kind === 'cloud') {
        items.push({ id, type: 'absorber', label: 'Облако', x: t.x ?? D / 2, y: t.y ?? W / 2, z: H - (t.thickness + (t.gap ?? 0)) / 2, dx: t.height, dy: t.width, dz: t.thickness + (t.gap ?? 0), disabled: off, locked: t.locked });
        continue;
      }
      if (t.kind === 'corner') {
        const leg = t.width / Math.SQRT2;
        const [fb, lr] = (t.corner ?? 'front-left').split('-');
        items.push({ id, type: 'bass-trap', label: 'Ловушка', x: fb === 'front' ? leg / 2 : D - leg / 2, y: lr === 'left' ? leg / 2 : W - leg / 2, z: t.height / 2, dx: leg, dy: leg, dz: t.height, disabled: off, locked: t.locked });
        continue;
      }
      const thick = t.kind === 'diffuser' || t.kind === 'resonator' ? t.depth : t.thickness + (t.gap ?? 0);
      const at = t.at ?? 0, wall = t.wall!;
      const [x, y, dx, dy] = wall === 'front' ? [thick / 2, at, thick, t.width] : wall === 'back' ? [D - thick / 2, at, thick, t.width]
        : wall === 'left' ? [at, thick / 2, t.width, thick] : [at, W - thick / 2, t.width, thick];
      const type = t.kind === 'diffuser' ? 'diffuser' : t.kind === 'resonator' ? 'bass-trap' : 'absorber';
      const label = t.kind === 'diffuser' ? 'Диффузор' : t.kind === 'resonator' ? 'Резонатор' : 'Панель';
      items.push({ id, type, label, x, y, z: t.z ?? H / 2, dx, dy, dz: t.height, disabled: off, locked: t.locked });
    }
  }
  const openings: PlanOpening[] = layers.has('openings')
    ? c.openings.map((o) => ({ id: planId({ type: 'opening', id: o.id }), wall: o.wall, a0: o.a0, a1: o.a1, bottom: o.bottom, top: o.top, closed: o.state === 'closed', label: OPENING_LABEL[o.kind] }))
    : [];
  return { items, openings, annexes: planAnnexes(c) };
}
