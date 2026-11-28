// Рекомендации общей системы советов v2 (V2-041, tools-advice-library §1): одна система поверх всех разделов анализа.
// Рекомендация — вывод детерминированного правила с версией; применяется только к эксперименту после подтверждения.
import type { Treatment, Vec3 } from '../../core/types';

/** Группы в начальном порядке приоритетов: данные, бесплатная расстановка, настройка, обработка, DSP, покупка. */
export type AdviceGroup = 'data' | 'placement' | 'settings' | 'treatment' | 'dsp' | 'equipment';
export const ADVICE_GROUPS: readonly AdviceGroup[] = ['data', 'placement', 'settings', 'treatment', 'dsp', 'equipment'];

/** Откуда известна проблема: подтверждена измерением, предсказана моделью, предположение, требует проверки. */
export type Evidence = 'measured' | 'predicted' | 'assumption' | 'needs-check';

/** Стоимость: бесплатно или покупка; сумма неизвестна — не ноль (её не выдумывают). */
export type AdviceCost = { kind: 'free' } | { kind: 'purchase'; what: string };
export type Effort = 'minutes' | 'hours' | 'days';

/** Что меняет предложение в эксперименте. */
export type Proposal =
  | { kind: 'move-listener'; listenerId: string; to: Vec3 }
  /** Элементы плана обработки ядра (`suggestTreatments`); идентификаторы выдаются при применении. */
  | { kind: 'add-treatments'; what: 'panels' | 'corners'; items: Treatment[] };

export interface Recommendation {
  /** Устойчивый идентификатор: правило и предмет (частота, поверхность), чтобы план работ узнавал рекомендацию. */
  id: string;
  rule: string;
  ruleVersion: string;
  group: AdviceGroup;
  evidence: Evidence;
  severity: 'high' | 'medium' | 'low';
  title: string;
  /** Причина, источник данных, метод, условия применимости. */
  cause: string;
  source: string;
  method: string;
  applicability: string;
  /** Ожидаемый эффект и возможные побочные последствия. */
  effect: string;
  sideEffects: string;
  cost: AdviceCost;
  effort: Effort;
  actions: string[];
  /** Как проверить результат (выполненное действие — ещё не подтверждённое улучшение). */
  verify: string;
  /** Для выбранной цели: в приоритете, обычная или неактуальная. */
  relevance: 'goal' | 'normal' | 'off-goal';
  /** Нарушенные жёсткие ограничения: рекомендация не предлагается к применению. */
  conflicts: string[];
  /** Мягкие ограничения и оговорки. */
  notes: string[];
  /** Где подробности: раздел комнаты или инструмент. */
  link?: { kind: 'room'; tab: 'analysis' | 'advice' | 'model'; section: string; label: string } | { kind: 'tool'; toolId: string; label: string };
  proposal?: Proposal;
}

/**
 * Состояние пункта плана работ (V2-044). Выполнено — ещё не подтверждённое улучшение: подтверждает только
 * проверочное измерение, записанное после выполнения.
 */
export type PlanStatus = 'planned' | 'experiment' | 'done' | 'verified' | 'deferred';

export interface PlanItem {
  id: string;
  /** Рекомендация, из которой добавлен пункт, и версия её правила — для пересмотра устаревших. */
  recId: string;
  ruleVersion: string;
  group: AdviceGroup;
  title: string;
  actions: string[];
  verify: string;
  addedAt: string;
  status: PlanStatus;
  history: { status: PlanStatus; at: string; note?: string }[];
  /** Измерение, подтвердившее результат (вид АЧХ, записано после выполнения). */
  verifiedBy?: string;
  /** Стоимость этапа, введённая пользователем; нет — неизвестна (не ноль). */
  cost?: number;
}

/** План работ комнаты: одна запись на комнату в области `actionPlans`. */
export interface ActionPlan {
  id: string;
  roomId: string;
  updatedAt: string;
  items: PlanItem[];
}
