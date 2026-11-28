// Автоматический подбор (V2-043): поиск мест ядра `optimizePlacement` и согласование сабвуферов `optimizeSubFilters`
// в фоновом воркере. Результат — лучший найденный вариант (глобальная оптимальность не доказана); он временный или
// сохраняется отчётом прогона и переносится только в эксперимент после подтверждения. Поиск ядра не знает о
// закреплённых объектах и ограничениях комнаты: вариант, который их нарушает, показывается, но не применяется (R44).
import type { Placement, PlacementResult, SubSetting } from '../../core/types';
import { CORE_VERSION, setupKey } from '../adapters/calculations';
import { toCore, type CoreInputs } from '../adapters/core';
import type { OptimizationRun } from '../domain/measurement';
import type { Goals, RoomConfiguration } from '../domain/model';
import { applyLayout } from '../domain/operations';
import { hashInputs } from '../domain/provenance';

/** Входы поиска: места источников и слушателя — результат, а не вход. */
export const searchKey = (i: CoreInputs) => hashInputs({ method: 'optimizePlacement', room: i.room, sources: i.sources, constraints: i.constraints, precision: i.precision });
export const subsKey = (method: 'optimizeSubs' | 'optimizeSubFilters', i: CoreInputs) => hashInputs({ method, input: setupKey(i) });

const moved = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y) > 0.01;

/** Что меняет вариант: сдвинутые источники и слушатель. */
export function variantMoves(c: RoomConfiguration, p: Placement): { sources: string[]; listener: boolean } {
  const sources = c.audio.sources.filter((s) => {
    const n = p.sources.find((x) => x.id === s.id);
    return n && moved(s.position, n.pos);
  }).map((s) => s.id);
  const l = c.listening.listeners.find((x) => x.primary);
  return { sources, listener: !!l && moved(l.position, p.listener) };
}

/** Нарушенные жёсткие ограничения: закреплённые объекты и запрет перемещать оборудование. */
export function variantConflicts(c: RoomConfiguration, p: Placement, goals: Goals): string[] {
  const m = variantMoves(c, p);
  const out: string[] = [];
  const name = (id: string) => c.audio.sources.find((s) => s.id === id)?.name ?? id;
  const locked = m.sources.filter((id) => c.audio.sources.find((s) => s.id === id)?.locked);
  if (locked.length) out.push(`Двигает закреплённые: ${locked.map(name).join(', ')}.`);
  if (m.listener && c.listening.listeners.find((x) => x.primary)?.locked) out.push('Двигает закреплённое место слушателя.');
  if (m.sources.length && !goals.constraints.canMoveEquipment) out.push('Оборудование перемещать нельзя (ограничение комнаты).');
  return out;
}

/** Мягкие ограничения варианта. */
export function variantNotes(c: RoomConfiguration, p: Placement, goals: Goals): string[] {
  const m = variantMoves(c, p);
  return m.listener && !goals.constraints.canMoveFurniture ? ['Мебель переставлять нельзя: новое место слушателя может требовать перестановки дивана.'] : [];
}

/** Вариант → операция над конфигурацией эксперимента: места и настройки сабвуферов варианта, раздел частот прежний. */
export function placementOp(p: Placement): (c: RoomConfiguration) => RoomConfiguration {
  return (c) => applyLayout(c, {
    listener: { ...p.listener },
    positions: Object.fromEntries(p.sources.map((s) => [s.id, { ...s.pos }])),
    subSettings: p.subSettings ? structuredClone(p.subSettings) : {},
    crossoverHz: c.audio.crossoverHz,
  });
}

/** Найденные настройки сабвуферов (и частота раздела, если её подбирали) → операция над конфигурацией эксперимента. */
export function subSettingsOp(r: { settings: Record<string, SubSetting>; crossoverHz?: number | null }): (c: RoomConfiguration) => RoomConfiguration {
  return (c) => ({
    ...c,
    audio: {
      ...c.audio, crossoverHz: r.crossoverHz === undefined ? c.audio.crossoverHz : r.crossoverHz,
      sources: c.audio.sources.map((s) => (r.settings[s.id] ? { ...s, settings: structuredClone(r.settings[s.id]) } : s)),
    },
  });
}

/** Отчёт прогона поиска для истории комнаты. */
export function runRecord(c: RoomConfiguration, roomId: string, result: PlacementResult, id: string, now: string): OptimizationRun {
  const conv = toCore(c);
  if (!conv.ok) throw new Error(conv.reason);
  return {
    id, roomId, configId: c.id, createdAt: now, result, stale: false,
    provenance: {
      kind: 'calculated', method: 'Поиск мест (перебор с уточнением, ядро placement.ts)', algorithmVersion: CORE_VERSION, configId: c.id, revision: c.revision,
      inputHash: searchKey(conv.inputs), createdAt: now, warnings: conv.warnings,
      limitations: ['Лучший найденный вариант: глобальная оптимальность не доказана.', 'Закреплённые объекты и ограничения комнаты поиск не учитывает — они проверяются при применении.', ...conv.limitations],
    },
  };
}

/** Прогон устарел: другая конфигурация или изменились входы поиска (а не только места). */
export function runStale(run: OptimizationRun, c: RoomConfiguration): boolean {
  if (run.stale || run.configId !== c.id) return true;
  const conv = toCore(c);
  return !conv.ok || run.provenance.inputHash !== searchKey(conv.inputs);
}
