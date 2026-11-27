// Эксперимент и история (V2-026–V2-030): снимки, восстановление в эксперимент, применение предложений только к
// эксперименту, перечень различий двух конфигураций. Сравнение — просмотр двух конфигураций, третьей не создаётся.
import { FURNISHING_LABEL } from '../../core/materials';
import { SURFACES } from '../../core/types';
import type { MeasurementKind } from '../domain/measurement';
import type { ConfigSnapshot, Room, RoomConfiguration } from '../domain/model';
import { createExperiment, updateConfig, type IdFactory } from '../domain/operations';
import { SURFACE_LABEL, WALL_LABEL } from './editing';
import { surfaceName } from './profiles';

const clone = <T>(v: T): T => structuredClone(v);

/** Снимок конфигурации (по умолчанию текущей); для измерения — той, к которой относится замер. */
export function takeSnapshot(room: Room, newId: IdFactory, now: string, reason: ConfigSnapshot['reason'] = 'manual', config: RoomConfiguration = room.current): Room {
  const snapshot: ConfigSnapshot = { id: newId(), takenAt: now, reason, config: clone(config) };
  return { ...room, history: [snapshot, ...room.history], updatedAt: now };
}

/** Конфигурация из снимка — в эксперимент (новый или вместо прежнего); снимок не меняется. */
export function snapshotToExperiment(room: Room, snapshotId: string, newId: IdFactory, now: string): Room {
  const s = room.history.find((h) => h.id === snapshotId);
  if (!s) throw new Error('Снимок не найден.');
  const experimental: RoomConfiguration = {
    ...clone(s.config), id: newId(), role: 'experimental', revision: 1, basedOn: { configId: room.current.id, revision: room.current.revision },
  };
  return { ...room, experimental, updatedAt: now };
}

/** Начать эксперимент заново: копия текущей конфигурации вместо прежнего эксперимента. */
export const restartExperiment = (room: Room, newId: IdFactory, now: string): Room => createExperiment({ ...room, experimental: null }, newId, now);

/**
 * Предложение (рекомендация, результат подбора) применяется только к эксперименту: если его нет — он создаётся
 * копией текущей конфигурации. Текущая конфигурация не меняется. Вызывается после явного подтверждения пользователя.
 */
export function applyProposal(room: Room, op: (c: RoomConfiguration) => RoomConfiguration, newId: IdFactory, now: string): Room {
  return updateConfig(createExperiment(room, newId, now), 'experimental', op, now);
}

/** Эксперимент создан с ревизии текущей, которая потом менялась. */
export const experimentBehind = (room: Room) => !!room.experimental?.basedOn && room.experimental.basedOn.revision < room.current.revision;

// ---------- Различия ----------

export type DiffArea = 'geometry' | 'surfaces' | 'openings' | 'audio' | 'listening' | 'interior' | 'treatment' | 'simulation';
export const DIFF_AREA_LABEL: Record<DiffArea, string> = {
  geometry: 'Помещение', surfaces: 'Поверхности', openings: 'Двери, окна, проёмы', audio: 'Аудиосистема', listening: 'Слушатели',
  interior: 'Интерьер', treatment: 'Обработка', simulation: 'Параметры расчёта',
};
export interface ConfigChange { area: DiffArea; text: string }

const n2 = (v: number) => String(Math.round(v * 100) / 100).replace('.', ',');
const cmMove = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => Math.round(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) * 100);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const OPENING = { door: 'дверь', window: 'окно', passage: 'проём' } as const;
const TREAT = { panel: 'панель', corner: 'угловая ловушка', cloud: 'облако', diffuser: 'диффузор', resonator: 'резонатор' } as const;

/** Что во второй конфигурации (`b`) иначе, чем в первой (`a`): короткие фразы по областям, без служебных полей. */
export function diffConfigs(a: RoomConfiguration, b: RoomConfiguration): ConfigChange[] {
  const out: ConfigChange[] = [];
  const push = (area: DiffArea, text: string) => out.push({ area, text });

  const ga = a.geometry, gb = b.geometry;
  if (ga.kind === 'rect' && gb.kind === 'rect') {
    if (ga.depth !== gb.depth || ga.width !== gb.width || ga.height !== gb.height) {
      push('geometry', `Размеры: ${n2(ga.depth)} × ${n2(ga.width)} × ${n2(ga.height)} → ${n2(gb.depth)} × ${n2(gb.width)} × ${n2(gb.height)} м`);
    }
    if (!same(ga.slope, gb.slope)) push('geometry', gb.slope ? (ga.slope ? 'Скос потолка изменён' : 'Добавлен скос потолка') : 'Скос потолка убран');
  } else if (!same(ga, gb)) push('geometry', 'Форма помещения изменена');
  if (!same(a.zones, b.zones)) push('geometry', `Смежные зоны: ${a.zones.length} → ${b.zones.length}${a.zones.length === b.zones.length ? ' (изменены)' : ''}`);

  for (const s of SURFACES) {
    if (!same(a.surfaces[s], b.surfaces[s])) push('surfaces', `${SURFACE_LABEL[s]}: ${surfaceName(a.surfaces[s])} → ${surfaceName(b.surfaces[s])}`);
  }

  const byId = <T extends { id: string }>(xs: readonly T[]) => new Map(xs.map((x) => [x.id, x]));
  const oa = byId(a.openings), ob = byId(b.openings);
  for (const o of b.openings) {
    const p = oa.get(o.id);
    const name = `${OPENING[o.kind]} (${WALL_LABEL[o.wall]} стена)`;
    if (!p) push('openings', `Добавлено: ${name}`);
    else if (p.state !== o.state) push('openings', `${name[0].toUpperCase()}${name.slice(1)}: ${o.state === 'closed' ? 'закрыто' : o.state === 'open' ? 'открыто' : o.state === 'permanent' ? 'постоянный проём' : 'открыто в неописанное помещение'}`);
    else if (!same(p, o)) push('openings', `Изменено: ${name}`);
  }
  for (const o of a.openings) if (!ob.has(o.id)) push('openings', `Убрано: ${OPENING[o.kind]} (${WALL_LABEL[o.wall]} стена)`);

  if (a.audio.layout !== b.audio.layout) push('audio', `Схема: ${a.audio.layout} → ${b.audio.layout}`.replace(/mono/g, '1.0').replace(/custom/g, 'произвольная'));
  const sa = byId(a.audio.sources), sb = byId(b.audio.sources);
  for (const s of b.audio.sources) {
    const p = sa.get(s.id);
    if (!p) { push('audio', `Добавлен источник: ${s.name}`); continue; }
    const d = cmMove(p.position, s.position);
    if (d >= 1) push('audio', `${s.name}: перемещение на ${d} см`);
    if (p.rotationDeg !== s.rotationDeg) push('audio', `${s.name}: поворот ${p.rotationDeg}° → ${s.rotationDeg}°`);
    if (p.fLow !== s.fLow || p.fHigh !== s.fHigh) push('audio', `${s.name}: диапазон ${p.fLow}–${p.fHigh} → ${s.fLow}–${s.fHigh} Гц`);
    if (!same(p.settings, s.settings)) push('audio', `${s.name}: настройки канала (задержка, фаза, уровень, фильтры)`);
    if (!same(p.capabilities, s.capabilities) || !same(p.box, s.box) || !same(p.passport, s.passport)) push('audio', `${s.name}: характеристики`);
  }
  for (const s of a.audio.sources) if (!sb.has(s.id)) push('audio', `Убран источник: ${s.name}`);
  if (a.audio.crossoverHz !== b.audio.crossoverHz) push('audio', `Частота раздела: ${a.audio.crossoverHz ?? 'не задана'} → ${b.audio.crossoverHz ?? 'не задана'}${b.audio.crossoverHz ? ' Гц' : ''}`);
  if (!same(a.audio.crossover, b.audio.crossover)) push('audio', 'Пределы подбора частоты раздела');

  const la = byId(a.listening.listeners), lb = byId(b.listening.listeners);
  for (const l of b.listening.listeners) {
    const p = la.get(l.id);
    if (!p) { push('listening', `Добавлено место: ${l.name}`); continue; }
    const d = cmMove(p.position, l.position);
    if (d >= 1) push('listening', `${l.name}: перемещение на ${d} см`);
    if (p.primary !== l.primary && l.primary) push('listening', `Основное место: ${l.name}`);
    if (p.weight !== l.weight) push('listening', `${l.name}: вес ${n2(p.weight)} → ${n2(l.weight)}`);
  }
  for (const l of a.listening.listeners) if (!lb.has(l.id)) push('listening', `Убрано место: ${l.name}`);
  if (!same(a.listening.seats, b.listening.seats)) push('listening', `Ряд мест: ${a.listening.seats.count} → ${b.listening.seats.count}, шаг ${n2(a.listening.seats.spacing)} → ${n2(b.listening.seats.spacing)} м`);

  if (a.interior.furnishing !== b.interior.furnishing) push('interior', `Меблировка: ${FURNISHING_LABEL[a.interior.furnishing]} → ${FURNISHING_LABEL[b.interior.furnishing]}`);
  if (a.interior.furnitureList !== b.interior.furnitureList) push('interior', b.interior.furnitureList ? 'Учитывается список мебели и покрытий' : 'Список мебели не учитывается');
  const za = byId(a.interior.obstacles), zb = byId(b.interior.obstacles);
  for (const z of b.interior.obstacles) {
    const p = za.get(z.id);
    if (!p) push('interior', `Добавлено: ${z.name ?? 'предмет'}`);
    else if (!same({ ...p, locked: undefined }, { ...z, locked: undefined })) push('interior', `Изменено: ${z.name ?? 'предмет'}`);
  }
  for (const z of a.interior.obstacles) if (!zb.has(z.id)) push('interior', `Убрано: ${z.name ?? 'предмет'}`);
  if (!same(a.interior.coverings, b.interior.coverings)) push('interior', `Ковры и шторы: ${a.interior.coverings.length} → ${b.interior.coverings.length}${a.interior.coverings.length === b.interior.coverings.length ? ' (изменены)' : ''}`);

  if (a.treatment.enabled !== b.treatment.enabled) push('treatment', b.treatment.enabled ? 'Обработка учитывается в расчёте' : 'Обработка не учитывается в расчёте');
  const ta = byId(a.treatment.items), tb = byId(b.treatment.items);
  for (const t of b.treatment.items) {
    const p = ta.get(t.id);
    if (!p) push('treatment', `Добавлено: ${TREAT[t.kind]}`);
    else if (!same({ ...p, locked: undefined }, { ...t, locked: undefined })) push('treatment', `Изменено: ${TREAT[t.kind]}`);
  }
  for (const t of a.treatment.items) if (!tb.has(t.id)) push('treatment', `Убрано: ${TREAT[t.kind]}`);

  const pa = a.simulation, pb = b.simulation;
  if (pa.temperatureC !== pb.temperatureC) push('simulation', `Температура: ${n2(pa.temperatureC)} → ${n2(pb.temperatureC)} °C`);
  if (pa.leakage !== pb.leakage) push('simulation', 'Герметичность комнаты');
  if (pa.model !== pb.model) push('simulation', 'Модель расчёта баса');
  if ((pa.precision ?? 'standard') !== (pb.precision ?? 'standard')) push('simulation', 'Точность расчёта');
  if (!same(pa.calibration, pb.calibration)) push('simulation', pb.calibration ? 'Подстройка по замеру' : 'Подстройка по замеру сброшена');
  if (!same(a.dsp ?? null, b.dsp ?? null)) {
    const on = (d: RoomConfiguration['dsp']) => d?.filters.filter((f) => f.enabled).length ?? 0;
    push('audio', !b.dsp ? 'Коррекция комнаты убрана' : a.dsp ? `Коррекция комнаты изменена: фильтров ${on(a.dsp)} → ${on(b.dsp)}` : `Сохранена коррекция комнаты: фильтров ${on(b.dsp)}`);
  }
  if (!same(pa.placement, pb.placement)) push('simulation', 'Правила расстановки');
  if (!same(pa.objective, pb.objective) || pa.houseCurve !== pb.houseCurve) push('simulation', 'Цель подбора мест');
  return out;
}

export const MEASUREMENT_KIND: Record<MeasurementKind, string> = { 'frequency-response': 'АЧХ', 'impulse-response': 'Импульсная характеристика', rt60: 'Время реверберации', noise: 'Шум', spl: 'Уровень' };

/** К какой конфигурации комнаты относится запись (измерение, прогон подбора). */
export function configOf(room: Room, id: string | null): string {
  if (id && id === room.current.id) return 'текущая';
  if (id && id === room.experimental?.id) return 'эксперимент';
  if (id && room.history.some((s) => s.config.id === id)) return 'из истории';
  return 'неизвестна';
}
