// Расчёты v2 через ядро (V2-007): результат — значение ядра без пересчёта плюс происхождение (метод, версия модели
// затухания, конфигурация и ревизия, хеш входа ядра, предупреждения адаптера). Тяжёлые задачи — через воркер (V2-010).
import { computeModes, modeIssues, type ModeIssues } from '../../core/modes';
import { computeReverb } from '../../core/reverb';
import { buildOverview, type Overview } from '../../core/overview';
import { evaluateSetup, type SetupEval } from '../../core/system';
import { effectiveModel } from '../../core/geometry';
import { evalPpo } from '../../core/precision';
import { DAMPING_MODEL, type Mode, type ReverbResult } from '../../core/types';
import type { RoomConfiguration } from '../domain/model';
import { hashInputs, type CalculationResult } from '../domain/provenance';
import { toCore, type CoreInputs } from './core';

export const CORE_VERSION = `core-damping-${DAMPING_MODEL}`;

export type Calc<T> = { ok: true; result: CalculationResult<T> } | { ok: false; reason: string };

function run<T>(c: RoomConfiguration, method: string, fn: (i: CoreInputs) => T, key: (i: CoreInputs) => unknown, now: string, extra: string[] = []): Calc<T> {
  const conv = toCore(c);
  if (!conv.ok) return conv;
  const value = fn(conv.inputs);
  return {
    ok: true,
    result: {
      value,
      provenance: {
        kind: 'calculated', method, algorithmVersion: CORE_VERSION, configId: c.id, revision: c.revision,
        inputHash: hashInputs({ method, input: key(conv.inputs) }), createdAt: now,
        warnings: conv.warnings, limitations: [...conv.limitations, ...extra],
      },
    },
  };
}

/** Значимые для акустики комнаты входы: без мест источников и слушателя. */
export const roomKey = (i: CoreInputs) => i.room;
export const setupKey = (i: CoreInputs) => ({ room: i.room, sources: i.sources, constraints: i.constraints, setup: { ...i.setup, id: '', name: '' }, precision: i.precision });

export interface ModesValue { modes: Mode[]; issues: ModeIssues; fMax: number }

/** Верх списка мод — как у legacy: частота Шрёдера в пределах 200–500 Гц. */
export const modesFMax = (rev: ReverbResult) => Math.min(500, Math.max(200, rev.schroeder));

export function calcModes(c: RoomConfiguration, now: string): Calc<ModesValue> {
  return run(c, 'Аналитические моды прямоугольной комнаты', (i) => {
    const fMax = modesFMax(computeReverb(i.room));
    const modes = computeModes(i.room, fMax);
    return { modes, issues: modeIssues(modes), fMax };
  }, roomKey, now, ['Моды — для прямоугольной оболочки; скос, проёмы и смежные зоны сдвигают их (волновая модель).']);
}

export function calcReverb(c: RoomConfiguration, now: string): Calc<ReverbResult> {
  return run(c, 'Реверберация по Сабину и Эйрингу', (i) => computeReverb(i.room), roomKey, now, ['Статистическая оценка диффузного поля: ниже частоты Шрёдера время спада определяют моды.']);
}

export function calcSetup(c: RoomConfiguration, now: string): Calc<SetupEval> {
  return run(c, 'Отклик системы в комнате', (i) => evaluateSetup(i.room, i.sources, i.constraints, i.setup, { ppo: evalPpo(i.precision), chart: true }), setupKey, now);
}

export interface OverviewValue { overview: Overview; model: 'modal' | 'wave'; evaluated: boolean }

/** Обзор как в legacy: та же оценка расстановки и тот же список мод. `ev` — готовая оценка, null — без неё. */
export function calcOverview(c: RoomConfiguration, now: string, ev?: SetupEval | null): Calc<OverviewValue> {
  return run(c, 'Сводка по комнате', (i) => {
    const rev = computeReverb(i.room);
    const modes = computeModes(i.room, modesFMax(rev));
    const e = ev === undefined ? evaluateSetup(i.room, i.sources, i.constraints, i.setup, { ppo: evalPpo(i.precision) }) : ev;
    return { overview: buildOverview(i.room, i.sources, i.setup, e, modes, rev), model: effectiveModel(i.room), evaluated: !!e };
  }, setupKey, now);
}
