// Главная оценка расстановки — одна и та же на «Расстановке» (автоподбор, вручную) и в «Настройке».
// Крупно — оценка по цели подбора (по ней упорядочены варианты) с пояснением, что значит число, и словесной
// оценкой. Если цель — не ровность, отдельной строкой ниже — неровность всей АЧХ: это другая величина
// (считает и пики, и провалы на всех частотах), поэтому она почти всегда больше оценки по провалам.
import type { ComponentChildren } from 'preact';
import type { BassObjective } from '../../core/types';
import { isFlat } from '../../core/objective';
import { S } from '../strings';
import { fmt } from '../format';

type Grade = 'good' | 'mid' | 'bad';

/**
 * Словесная оценка. Провалы (среднеквадратичная глубина ниже обычного уровня сверх 1 дБ допуска): до 1 дБ —
 * почти нет, до 3 дБ — заметные (одна мода в глубоком провале из трёх даёт ≈ 3,5 дБ), дальше — глубокие.
 * Неровность: до 4 дБ — ровно, до 6 — средне (так у хороших расстановок до эквалайзера), дальше — неровно.
 */
export function scoreGrade(v: number, flat: boolean): Grade {
  return flat ? (v < 4 ? 'good' : v < 6 ? 'mid' : 'bad') : (v < 1 ? 'good' : v < 3 ? 'mid' : 'bad');
}

interface Props {
  objective?: BassObjective;
  /** оценка по цели подбора (для ровности — та же неровность) */
  objScore: number | null;
  /** неровность всей АЧХ */
  flatScore: number | null;
  /** надпись над названием: «Сейчас», «Без обработки» … */
  context?: string;
  /** сравнение с базовой расстановкой: насколько лучше (> 0) или хуже по главной оценке */
  delta?: number | null;
  /** подробности под неровностью (в центре / при сдвиге головы, угол раскрытия) */
  flatDetail?: string;
  children?: ComponentChildren;
}

export function ScoreBlock({ objective, objScore, flatScore, context, delta, flatDetail, children }: Props) {
  const flat = isFlat(objective);
  const id = objective?.id ?? 'flat';
  const main = flat ? flatScore : objScore;
  const t = S.scoreBlock;
  const g = main != null ? scoreGrade(main, flat) : null;
  return (
    <div class="score score--key score-block">
      <div class="score__main">
        <span class="score__value">{main != null ? fmt(main, 1) : '…'}</span>
        <span class="score__unit">дБ</span>
      </div>
      <div class="score__text">
        {context && <span class="score__context">{context}</span>}
        <span class="score__label">{flat ? S.placement.score : S.objective.short[id]}</span>
        <span class="small">{main != null ? t.explain[id](fmt(main, 1)) : ''}</span>
        {g && <span class={`score__grade is-${g}`}>{flat ? t.gradeFlat[g] : t.gradeDips[g]}</span>}
        {delta != null && (
          <span class={`score__delta ${delta > 0.05 ? 'is-good' : delta < -0.05 ? 'is-bad' : ''}`}>
            {delta > 0.05 ? (flat ? S.placement.better(fmt(delta, 1)) : t.better(fmt(delta, 1))) : delta < -0.05 ? (flat ? S.placement.worse(fmt(-delta, 1)) : t.worse(fmt(-delta, 1))) : S.placement.same}
          </span>
        )}
        {flat && flatDetail && <span class="muted small">{flatDetail}</span>}
      </div>
      {!flat && (
        <div class="score__second">
          <span>{t.flatRow} <strong>{flatScore != null ? `${fmt(flatScore, 1)} дБ` : '…'}</strong></span>
          <span class="muted small">{t.flatRowHint}{flatDetail ? ` ${flatDetail}` : ''}</span>
        </div>
      )}
      {children && <div class="score__extra">{children}</div>}
    </div>
  );
}
