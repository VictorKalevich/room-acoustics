// Оценка расстановки: прямоугольная модель — сразу в основном потоке, волновая — в воркере (выбор — inMainThread).
// 034: через общий хук useComputed; прежняя оценка остаётся, пока считается новая.
import type { Constraints, Room, Setup, SourceSpec } from '../core/types';
import { evaluateSetup, type SetupEval } from '../core/system';
import { useComputed } from './useCompute';

type SetupLike = Pick<Setup, 'listener' | 'positions' | 'subSettings' | 'crossoverHz'>;

/** chart — посчитать и кривую графика «Расстановки» ниже полосы оценки (045); другие экраны её не запрашивают. */
export function useSetupEval(
  room: Room, sources: SourceSpec[], c: Constraints, setup: SetupLike | null, ppo = 24, chart = false,
): { ev: SetupEval | null; busy: boolean; error: string | null } {
  // расстановки нет (проба убрана, сравнение выключено) — прежний результат не показываем
  const r = useComputed('evaluate', setup ? { room, sources, constraints: c, setup, ppo, ...(chart ? { chart } : {}) } : null, {
    deps: [room, sources, c, setup, ppo, chart],
    previous: 'keep',
    local: { room, compute: () => evaluateSetup(room, sources, c, setup!, { ppo, ...(chart ? { chart } : {}) }) },
  });
  return { ev: r.value, busy: r.busy, error: r.error };
}
