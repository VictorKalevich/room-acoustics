// Акустическая обработка: басовые ловушки, панели, потолочные облака — поглощение по октавам и площадь.
import type { OctaveValues, Room, SurfaceId, Treatment, WallId } from './types';

/** Пористый поглотитель (минвата 40–60 кг/м³ или войлок) на жёсткой стене: α по октавам 63…4000 Гц. */
const POROUS: Record<string, OctaveValues> = {
  '0.05': [0.05, 0.15, 0.55, 0.95, 1, 1, 1],
  '0.1': [0.12, 0.42, 0.95, 1, 1, 1, 1],
  '0.15': [0.22, 0.65, 1, 1, 1, 1, 1],
  '0.2': [0.32, 0.85, 1, 1, 1, 1, 1],
  '0.3': [0.5, 1, 1, 1, 1, 1, 1],
};
export const THICKNESSES = [0.05, 0.1, 0.15, 0.2, 0.3];

/** α поглотителя толщины d (+ воздушный зазор, который работает примерно как половина толщины). */
export function porousAlpha(d: number, gap = 0): OctaveValues {
  const eff = d + gap / 2;
  const keys = THICKNESSES;
  if (eff <= keys[0]) return POROUS['0.05'];
  if (eff >= keys[keys.length - 1]) return POROUS['0.3'];
  let i = 0;
  while (keys[i + 1] < eff) i++;
  const t = (eff - keys[i]) / (keys[i + 1] - keys[i]);
  const a = POROUS[String(keys[i])], b = POROUS[String(keys[i + 1])];
  return a.map((v, k) => v + (b[k] - v) * t) as OctaveValues;
}

/** α элемента обработки: угловая ловушка на низах работает сильнее (давление в углу максимально). */
export function treatmentAlpha(t: Treatment): OctaveValues {
  const a = porousAlpha(t.thickness, t.gap ?? 0);
  if (t.kind !== 'corner') return a;
  return a.map((v, k) => (k <= 1 ? Math.min(1.25, v * 1.3) : v)) as OctaveValues;
}

export function treatmentArea(t: Treatment): number {
  return t.width * t.height;
}

/** Поверхности, на которые приходится элемент, с долями площади. */
export function treatmentSurfaces(t: Treatment): { s: SurfaceId; share: number }[] {
  if (t.kind === 'cloud') return [{ s: 'ceiling', share: 1 }];
  if (t.kind === 'panel') return [{ s: t.wall as WallId, share: 1 }];
  const [fb, lr] = (t.corner ?? 'front-left').split('-') as [WallId, WallId];
  return [{ s: fb, share: 0.5 }, { s: lr, share: 0.5 }];
}

export function activeTreatments(room: Room): Treatment[] {
  return room.treatmentsOn ? (room.treatments ?? []).filter((t) => t.enabled !== false) : [];
}

/** Короткое описание для списка и отчёта. */
export function treatmentKey(room: Room): string {
  return JSON.stringify(activeTreatments(room).map((t) => [t.kind, t.thickness, t.gap ?? 0, t.width, t.height, t.corner, t.wall]));
}

/** План по умолчанию: ловушки в четырёх вертикальных углах, панели на точках боковых отражений, облако над слушателем. */
export function suggestTreatments(
  room: Room,
  reflections: { surface: 'left' | 'right' | 'ceiling'; point: { x: number; y: number; z: number } }[],
  makeId: () => string,
): Treatment[] {
  const out: Treatment[] = [];
  for (const corner of ['front-left', 'front-right', 'back-left', 'back-right'] as const) {
    out.push({ id: makeId(), kind: 'corner', corner, thickness: 0.3, width: 0.6, height: Math.min(room.height, 2.4), enabled: true });
  }
  for (const r of reflections) {
    if (r.surface === 'ceiling') continue;
    out.push({ id: makeId(), kind: 'panel', wall: r.surface, at: r.point.x, z: Math.max(0.7, Math.min(room.height - 0.7, r.point.z)), thickness: 0.1, gap: 0.05, width: 0.6, height: 1.2, enabled: true });
  }
  const ceil = reflections.filter((r) => r.surface === 'ceiling');
  if (ceil.length) {
    const x = ceil.reduce((a, r) => a + r.point.x, 0) / ceil.length;
    const y = ceil.reduce((a, r) => a + r.point.y, 0) / ceil.length;
    out.push({ id: makeId(), kind: 'cloud', x, y, thickness: 0.1, gap: 0.1, width: 1.2, height: 1.2, enabled: true });
  }
  return out;
}
