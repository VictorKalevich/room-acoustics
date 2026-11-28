// Уровни сложности (059, spec §2): один набор данных для всех уровней. Уровень только скрывает параметры — не удаляет
// и не сбрасывает их; скрытые параметры, отличные от значения по умолчанию, перечисляются и сбрасываются явно.
import type { Complexity, RoomConfiguration } from './model';

const RANK: Record<Complexity, number> = { simple: 0, advanced: 1, expert: 2 };

export const visibleAt = (param: Complexity, level: Complexity) => RANK[level] >= RANK[param];

export interface ParamSpec {
  id: string;
  label: string;
  level: Complexity;
  isDefault: (c: RoomConfiguration) => boolean;
  reset: (c: RoomConfiguration) => RoomConfiguration;
}

const sim = (c: RoomConfiguration, patch: Partial<RoomConfiguration['simulation']>): RoomConfiguration => ({ ...c, simulation: { ...c.simulation, ...patch } });

export const PARAMS: readonly ParamSpec[] = [
  { id: 'temperature', label: 'Температура воздуха', level: 'advanced', isDefault: (c) => c.simulation.temperatureC === 20, reset: (c) => sim(c, { temperatureC: 20 }) },
  { id: 'leakage', label: 'Герметичность', level: 'advanced', isDefault: (c) => c.simulation.leakage === 'typical', reset: (c) => sim(c, { leakage: 'typical' }) },
  { id: 'objective', label: 'Цель подбора мест', level: 'advanced', isDefault: (c) => !c.simulation.objective || c.simulation.objective.id === 'flat', reset: (c) => sim(c, { objective: undefined }) },
  { id: 'houseCurve', label: 'Подъём низа цели', level: 'advanced', isDefault: (c) => c.simulation.houseCurve === undefined, reset: (c) => sim(c, { houseCurve: undefined }) },
  { id: 'dba', label: 'Схема DBA', level: 'advanced', isDefault: (c) => !c.simulation.placement.dba, reset: (c) => sim(c, { placement: { ...c.simulation.placement, dba: false } }) },
  { id: 'precision', label: 'Точность расчёта', level: 'expert', isDefault: (c) => !c.simulation.precision || c.simulation.precision === 'standard', reset: (c) => sim(c, { precision: undefined }) },
  { id: 'model', label: 'Модель расчёта баса', level: 'expert', isDefault: (c) => c.simulation.model === 'auto', reset: (c) => sim(c, { model: 'auto' }) },
  { id: 'calibration', label: 'Подстройка модели по замеру', level: 'expert', isDefault: (c) => c.simulation.calibration === null, reset: (c) => sim(c, { calibration: null }) },
];

/** Параметры выше уровня `level`, значения которых отличаются от значений по умолчанию: о них нужно уведомить. */
export const hiddenOverrides = (c: RoomConfiguration, level: Complexity): ParamSpec[] =>
  PARAMS.filter((p) => !visibleAt(p.level, level) && !p.isDefault(c));

/** Явный сброс выбранных параметров к значениям по умолчанию. */
export const resetParams = (c: RoomConfiguration, ids: readonly string[]): RoomConfiguration =>
  PARAMS.filter((p) => ids.includes(p.id)).reduce((acc, p) => p.reset(acc), c);
