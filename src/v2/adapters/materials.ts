// Свой материал поверхности в ядре (V2-047): ядро знает только справочник `src/core/materials.ts`, поэтому в его
// расчёт идёт ближайший справочный материал — это приближение, и адаптер о нём сообщает.
import { MATERIALS } from '../../core/materials';
import type { SurfaceId } from '../../core/types';
import type { RoomConfiguration } from '../domain/model';

const ON_SURFACE: Record<SurfaceId, string> = { floor: 'Пол', ceiling: 'Потолок', front: 'Передняя стена', back: 'Задняя стена', left: 'Левая стена', right: 'Правая стена' };

/** Ближайший справочный материал: наименьшее СКО разности α по октавам; наибольшая разность — для сообщения. */
export function nearestBuiltin(alpha: readonly number[]): { id: string; name: string; maxDiff: number } {
  let best = MATERIALS[0], bestE = Infinity;
  for (const m of MATERIALS) {
    const e = m.alpha.reduce((s, a, i) => s + (a - alpha[i]) ** 2, 0);
    if (e < bestE) { best = m; bestE = e; }
  }
  return { id: best.id, name: best.name, maxDiff: Math.max(...best.alpha.map((a, i) => Math.abs(a - alpha[i]))) };
}

export function materialLimitations(c: RoomConfiguration): string[] {
  return (Object.keys(c.surfaces) as SurfaceId[]).flatMap((s) => {
    const p = c.surfaces[s].profile;
    if (!p) return [];
    const near = nearestBuiltin(p.alpha);
    return [`${ON_SURFACE[s]}: свой материал «${p.name}» ядро не знает — в расчёте ядра ближайший справочный «${near.name}» (α расходится до ${near.maxDiff.toFixed(2).replace('.', ',')}).`];
  });
}
