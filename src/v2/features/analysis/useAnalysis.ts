// Расчёт конфигурации для анализа и сравнения (V2-028, V2-031): отклик системы — в фоновом воркере ядра, сводка,
// реверберация и моды — в основном потоке по готовому отклику. Один расчёт на набор значимых входов (кэш в памяти);
// расчёт начинается, когда конфигурация не меняется 250 мс (перетаскивание не ставит задачу на каждый шаг); начатый
// расчёт доводится до конца и попадает в кэш, даже если результат уже не нужен этому экрану — его может ждать другой.
import { useEffect, useState } from 'preact/hooks';
import { evalPpo } from '../../../core/precision';
import type { Overview } from '../../../core/overview';
import type { SetupEval } from '../../../core/system';
import type { ReverbResult } from '../../../core/types';
import { toCore } from '../../adapters/core';
import { calcOverview, calcReverb, setupKey } from '../../adapters/calculations';
import { lru, memoAsync } from '../../application/cache';
import { hashInputs, type Provenance } from '../../domain/provenance';
import type { RoomConfiguration } from '../../domain/model';
import { useApp } from '../../shared/context';

export interface Analysis {
  ev: SetupEval;
  overview: Overview;
  reverb: ReverbResult;
  model: 'modal' | 'wave';
  provenance: Provenance;
}

export type AnalysisState =
  | { status: 'running'; progress?: number }
  | { status: 'ready'; value: Analysis }
  | { status: 'unavailable'; reason: string }
  | { status: 'error'; message: string };

const cache = lru<Promise<Analysis>>(16);

export const analysisKey = (c: RoomConfiguration): string | null => {
  const conv = toCore(c);
  return conv.ok ? hashInputs({ method: 'analysis', input: setupKey(conv.inputs) }) : null;
};

export function useAnalysis(c: RoomConfiguration | null): AnalysisState {
  const { compute, clock } = useApp();
  const [state, setState] = useState<AnalysisState>({ status: 'running' });
  const key = c ? analysisKey(c) : null;
  useEffect(() => {
    if (!c) return;
    const conv = toCore(c);
    if (!conv.ok) { setState({ status: 'unavailable', reason: conv.reason }); return; }
    let alive = true;
    setState({ status: 'running' });
    const i = conv.inputs;
    const start = () => memoAsync(cache, key!, async () => {
      const ev = await compute().run('evaluate', { room: i.room, sources: i.sources, constraints: i.constraints, setup: i.setup, ppo: evalPpo(i.precision), chart: true }, {
        onProgress: (p) => alive && setState({ status: 'running', progress: p }),
      });
      const now = clock.now();
      const ov = calcOverview(c, now, ev);
      const rev = calcReverb(c, now);
      if (!ov.ok || !rev.ok) throw new Error(ov.ok ? (rev as { reason: string }).reason : ov.reason);
      return { ev, overview: ov.result.value.overview, reverb: rev.result.value, model: ov.result.value.model, provenance: ov.result.provenance };
    }).then(
      (value) => alive && setState({ status: 'ready', value }),
      (e: unknown) => alive && setState({ status: 'error', message: e instanceof Error ? e.message : String(e) }),
    );
    const timer = cache.has(key!) ? (start(), null) : setTimeout(start, 250);
    return () => { alive = false; if (timer) clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return c ? state : { status: 'unavailable', reason: 'Нет конфигурации.' };
}
