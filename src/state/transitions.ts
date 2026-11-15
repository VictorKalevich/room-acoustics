// Изменения проекта и правила, которые держат его согласованным (031): расстановки вписаны в комнату, результат
// подбора помечен устаревшим, когда изменились исходные данные, места выбраны после правки пользователем.
// Чистые функции: без хуков, DOM, хранилищ и системного времени — время изменения передаётся параметром.
import type { Project } from './project';
import { defaultConstraints, syncSetup } from './project';
import { markPlaced } from './variant';
import type { Constraints, PlacementResult, Room, Setup, SourceSpec } from '../core/types';
import type { VoiceSettings } from '../core/voice';
import type { Precision } from '../core/precision';
import { clampToRoom } from '../core/system';
import { baselinePositions } from '../core/placement';

/** Переход проекта: по прежнему проекту и времени изменения (ISO-строка) — новый проект. Прежний не меняется. */
export type Transition = (prev: Project, now: string) => Project;

/**
 * Приводит расстановку к текущим источникам и размерам комнаты. 022: пока места текущей расстановки не выбраны,
 * они — места по умолчанию для этой комнаты (а не места комнаты нового проекта, сдвинутые внутрь стен).
 */
export function fitSetup(s: Setup, p: Project, current = false): Setup {
  const base = current && !s.placed ? { ...s, ...baselinePositions(p.room, p.sources, p.constraints) } : s;
  const synced = syncSetup(base, p.room, p.sources, p.constraints);
  return {
    ...synced,
    listener: clampToRoom(p.room, synced.listener, 0.1),
    positions: Object.fromEntries(Object.entries(synced.positions).map(([k, v]) => [k, clampToRoom(p.room, v)])),
  };
}

/** Держит зону слушателя внутри комнаты после изменения размеров. */
export function fitConstraints(c: Constraints, room: Room): Constraints {
  const d = defaultConstraints(room);
  const bad = c.listenerMaxX >= room.depth - 0.05 || c.listenerMinX >= c.listenerMaxX || c.listenerMinX <= 0;
  return bad ? { ...c, listenerMinX: d.listenerMinX, listenerMaxX: d.listenerMaxX } : c;
}

/**
 * Общее правило изменения полей проекта: время изменения, пометка «результат устарел» (если `invalidate`) и
 * вписывание расстановок, когда изменились комната, источники, ограничения или текущая расстановка.
 */
export function applyPatch(prev: Project, patch: Partial<Project> | ((prev: Project) => Partial<Project>), now: string, invalidate = true): Project {
  const p = typeof patch === 'function' ? patch(prev) : patch;
  const next: Project = {
    ...prev,
    ...p,
    updatedAt: now,
    // явно переданный результат (в том числе null после очистки комнаты) важнее пометки «устарел»
    result: p.result !== undefined ? p.result : invalidate && prev.result ? { ...prev.result, stale: true } : prev.result,
  };
  if (p.room || p.sources || p.constraints || p.current) {
    next.current = fitSetup(next.current, next, true);
    if (p.room || p.sources) next.setups = next.setups.map((x) => fitSetup(x, next));
  }
  return next;
}

/** Переход по общему правилу (`applyPatch`). */
const change = (patch: Partial<Project> | ((prev: Project) => Partial<Project>), invalidate = true): Transition =>
  (prev, now) => applyPatch(prev, patch, now, invalidate);

/**
 * Комната и поля, которые экран комнаты меняет вместе с ней (`extra`: признак «создана», скан, расстановки, результат).
 * Зона слушателя вписывается в новую комнату. Ограничения — из `extra`, иначе `shown`: те, что видны в отрисовке,
 * из которой пришло изменение (а не из предыдущего состояния, если до отрисовки было ещё одно изменение).
 */
export const changeRoom = (room: Room, extra: Partial<Project>, shown: Constraints): Transition =>
  change({ ...extra, room, constraints: fitConstraints(extra.constraints ?? shown, room) });

export const changeSources = (sources: SourceSpec[]): Transition => change({ sources });

export const changeConstraints = (constraints: Constraints): Transition => change({ constraints });

/** Изменение мест пользователем — места выбраны (022). Результат подбора не устаревает. */
export const changeSetup = (current: Setup): Transition =>
  change((prev) => ({ current: markPlaced(prev.current, current) }), false);

/** Сохранённые варианты: не вписываются и не делают результат устаревшим. */
export const changeSetups = (setups: Setup[]): Transition => change({ setups }, false);

export const changeVoice = (voice: VoiceSettings): Transition => change({ voice }, false);

/** 026: другая точность — другие числа; результат подбора помечается устаревшим. Стандартная в проект не пишется. */
export const changePrecision = (precision: Precision): Transition =>
  change({ precision: precision === 'standard' ? undefined : precision });

/** Результат автоподбора и выбранный вариант — как пришли (пометку «устарел» ставит экран). */
export const setResult = (result: PlacementResult & { stale?: boolean }, selectedIndex: number): Transition =>
  change({ result, selectedIndex }, false);

export const renameProject = (name: string): Transition => change({ name }, false);

/** Выбор варианта подбора: время изменения прежнее, результат не устаревает, расстановки не трогаются. */
export const selectVariant = (selectedIndex: number): Transition => (prev) => ({ ...prev, selectedIndex });

/** Проект целиком (открытие, импорт, «Новый проект», черновик при запуске): как есть, без вписывания. */
export const replaceProject = (project: Project): Transition => () => project;
