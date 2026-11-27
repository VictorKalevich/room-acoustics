// План работ (V2-044): пункты из рекомендаций, состояния и их история, зависимости по порядку групп, пересмотр
// устаревших и проверка результата измерением. Выполненное действие не равно подтверждённому улучшению.
import { ADVICE_GROUPS, type ActionPlan, type PlanItem, type PlanStatus, type Recommendation } from '../domain/advice';
import type { MeasurementRecord } from '../domain/measurement';

export const PLAN_STATUS_LABEL: Record<PlanStatus, string> = {
  planned: 'В плане', experiment: 'Проверено в эксперименте', done: 'Выполнено, ждёт проверки', verified: 'Подтверждено измерением', deferred: 'Отложено',
};

export function addToPlan(plan: ActionPlan, r: Recommendation, newId: () => string, now: string): ActionPlan {
  if (plan.items.some((x) => x.recId === r.id && x.status !== 'verified')) return plan;
  const item: PlanItem = {
    id: newId(), recId: r.id, ruleVersion: r.ruleVersion, group: r.group, title: r.title, actions: [...r.actions], verify: r.verify,
    addedAt: now, status: 'planned', history: [{ status: 'planned', at: now }],
  };
  return { ...plan, updatedAt: now, items: [...plan.items, item] };
}

/** Сменить состояние. «Подтверждено» — только с измерением АЧХ, записанным после выполнения. */
export function setStatus(plan: ActionPlan, id: string, status: PlanStatus, now: string, o: { measurement?: MeasurementRecord; note?: string } = {}): ActionPlan {
  return {
    ...plan, updatedAt: now,
    items: plan.items.map((x) => {
      if (x.id !== id || x.status === status) return x;
      if (status === 'verified' && (!o.measurement || !verifies(x, o.measurement))) throw new Error('Подтверждает только замер АЧХ, сделанный после выполнения.');
      return { ...x, status, verifiedBy: status === 'verified' ? o.measurement!.id : undefined, history: [...x.history, { status, at: now, note: o.note }] };
    }),
  };
}

export const removeFromPlan = (plan: ActionPlan, id: string, now: string): ActionPlan => ({ ...plan, updatedAt: now, items: plan.items.filter((x) => x.id !== id) });

/** Стоимость этапа; NaN или отрицательное — неизвестна. */
export const setCost = (plan: ActionPlan, id: string, cost: number, now: string): ActionPlan =>
  ({ ...plan, updatedAt: now, items: plan.items.map((x) => (x.id === id ? { ...x, cost: Number.isFinite(cost) && cost >= 0 ? cost : undefined } : x)) });

/** Сумма известных стоимостей открытых этапов (не отложенных) и сколько этапов без стоимости. Неизвестное не считается нулём. */
export function planCost(plan: ActionPlan): { known: number; unknown: number } {
  const open = plan.items.filter((x) => x.status !== 'deferred');
  return { known: open.reduce((s, x) => s + (x.cost ?? 0), 0), unknown: open.filter((x) => x.cost === undefined).length };
}

/** Когда пункт отмечен выполненным (последний раз); null — не выполнялся. */
export function doneAt(x: PlanItem): string | null {
  for (let k = x.history.length - 1; k >= 0; k--) if (x.history[k].status === 'done') return x.history[k].at;
  return null;
}

/** Измерение подтверждает пункт: АЧХ, записана после отметки «выполнено». */
export function verifies(x: PlanItem, m: MeasurementRecord): boolean {
  const at = doneAt(x);
  return !!at && m.kind === 'frequency-response' && !!m.recordedAt && m.recordedAt > at;
}

/** Пункты более ранних групп, ещё не выполненные: сначала они (порядок приоритетов не жёсткий — только подсказка). */
export function blockers(plan: ActionPlan, x: PlanItem): PlanItem[] {
  const g = ADVICE_GROUPS.indexOf(x.group);
  return plan.items.filter((y) => ADVICE_GROUPS.indexOf(y.group) < g && (y.status === 'planned' || y.status === 'experiment'));
}

export type Freshness = 'actual' | 'changed' | 'gone';

/**
 * Пересмотр: рекомендация больше не выдаётся для этой конфигурации (проблема ушла или изменились данные) или её
 * правило обновилось. Для выполненных и подтверждённых пунктов «ушла» — ожидаемый итог, а не устаревание.
 */
export function freshness(x: PlanItem, recs: readonly Recommendation[]): Freshness {
  const r = recs.find((y) => y.id === x.recId);
  if (!r) return 'gone';
  return r.ruleVersion !== x.ruleVersion || r.title !== x.title ? 'changed' : 'actual';
}

/** Обновить пункт по текущей рекомендации (после пересмотра). */
export function refreshItem(plan: ActionPlan, id: string, r: Recommendation, now: string): ActionPlan {
  return { ...plan, updatedAt: now, items: plan.items.map((x) => (x.id === id ? { ...x, ruleVersion: r.ruleVersion, title: r.title, actions: [...r.actions], verify: r.verify, history: [...x.history, { status: x.status, at: now, note: 'Пересмотрено' }] } : x)) };
}

const ORDER: Record<PlanStatus, number> = { planned: 0, experiment: 1, done: 2, deferred: 3, verified: 4 };
/** Порядок списка: по группам приоритета, внутри — по состоянию и времени добавления. */
export function sortPlan(items: readonly PlanItem[]): PlanItem[] {
  return [...items].sort((a, b) => ADVICE_GROUPS.indexOf(a.group) - ADVICE_GROUPS.indexOf(b.group) || ORDER[a.status] - ORDER[b.status] || a.addedAt.localeCompare(b.addedAt));
}
