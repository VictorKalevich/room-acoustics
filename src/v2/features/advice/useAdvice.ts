// Данные вкладки «Советы» (V2-041–V2-045): расчёт выбранной конфигурации (общий кэш анализа), замеры и прогоны
// комнаты, последний замер АЧХ этой конфигурации на сетке расчёта, рекомендации правил и план работ комнаты.
import { useEffect, useState } from 'preact/hooks';
import { measurementAt } from '../../../core/measure';
import type { SetupEval } from '../../../core/system';
import { toCore } from '../../adapters/core';
import { buildAdvice, measuredOnGrid } from '../../application/advice';
import type { ActionPlan, Recommendation } from '../../domain/advice';
import type { MeasurementData, MeasurementRecord } from '../../domain/measurement';
import { useApp } from '../../shared/context';
import { measurementData, roomRecords, type RoomRecords } from '../../storage/history';
import { getPlan, planId, putPlan } from '../../storage/plans';
import { useAnalysis, type AnalysisState } from '../analysis/useAnalysis';
import type { ConfigEdit } from '../model/useConfig';
import type { RoomHandle } from '../rooms/useRoom';

export interface AdviceData {
  h: RoomHandle;
  edit: ConfigEdit;
  label: string;
  state: AnalysisState;
  records: RoomRecords | null;
  reloadRecords: () => void;
  /** Последний замер АЧХ этой конфигурации и его данные; null — нет. */
  latest: { m: MeasurementRecord; data: MeasurementData } | null;
  measured: { name: string; response: SetupEval['response'] } | null;
  /** null — расчёт ещё идёт (правила модели ждут его). */
  recs: Recommendation[] | null;
  plan: ActionPlan;
  /** Изменить план и сохранить; ошибка сообщается вызывающему. */
  savePlan: (fn: (p: ActionPlan) => ActionPlan) => Promise<void>;
}

export function useAdvice(h: RoomHandle, edit: ConfigEdit): AdviceData {
  const { db } = useApp();
  const room = h.room!;
  const c = edit.config;
  const state = useAnalysis(c);
  const [records, setRecords] = useState<RoomRecords | null>(null);
  const [tick, setTick] = useState(0);
  const [latest, setLatest] = useState<AdviceData['latest']>(null);
  const [plan, setPlan] = useState<ActionPlan>({ id: planId(room.id), roomId: room.id, updatedAt: '', items: [] });

  useEffect(() => {
    let alive = true;
    void roomRecords(db, room.id).then((r) => alive && setRecords(r), () => alive && setRecords({ measurements: [], optimizations: [] }));
    void getPlan(db, room.id).then((p) => alive && setPlan(p), () => undefined);
    return () => { alive = false; };
  }, [db, room.id, tick]);

  const last = records?.measurements.find((m) => m.configId === c.id && m.kind === 'frequency-response') ?? null;
  useEffect(() => {
    let alive = true;
    if (!last) { setLatest(null); return; }
    void measurementData(db, last.id).then((d) => alive && setLatest(d && d.f.length ? { m: last, data: d } : null), () => alive && setLatest(null));
    return () => { alive = false; };
  }, [db, last]);

  const ev = state.status === 'ready' ? state.value.ev : null;
  const grid = ev && latest ? measuredOnGrid(ev.response, measurementAt({ name: latest.m.name, importedAt: '', f: latest.data.f, db: latest.data.db }, ev.response.f)) : null;
  const measured = grid && latest ? { name: latest.m.name, response: grid } : null;
  const conv = toCore(c);
  const ready = !conv.ok || state.status === 'ready' || state.status === 'error' || state.status === 'unavailable';
  const recs = records && ready ? buildAdvice({
    config: c, goals: room.goals, measurements: records.measurements, measured, warnings: conv.ok ? conv.warnings : [],
    analysis: state.status === 'ready' ? { ev: state.value.ev, overview: state.value.overview, reverb: state.value.reverb } : null,
  }) : null;

  return {
    h, edit, label: edit.role === 'experimental' ? 'Эксперимент' : 'Текущая', state, records, reloadRecords: () => setTick((t) => t + 1), latest, measured, recs, plan,
    savePlan: async (fn) => {
      const fresh = await getPlan(db, room.id);
      const next = fn(fresh);
      await putPlan(db, next);
      setPlan(next);
    },
  };
}
