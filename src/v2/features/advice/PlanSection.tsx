// План работ (V2-044): пункты из советов по группам приоритета, состояние и история, мягкие зависимости (сначала
// более ранние группы), пересмотр устаревших и подтверждение проверочным замером. Выполненное — ещё не улучшение.
import { useState } from 'preact/hooks';
import { Badge, Button, EmptyState, NumberField, SelectField, buttonClass, useToast, type BadgeTone } from '../../design-system';
import { GROUP_LABEL } from '../../application/advice';
import { PLAN_STATUS_LABEL, blockers, doneAt, freshness, planCost, refreshItem, removeFromPlan, setCost, setStatus, sortPlan, verifies } from '../../application/plan';
import { isKnown } from '../../domain/units';
import type { PlanItem, PlanStatus } from '../../domain/advice';
import { useApp } from '../../shared/context';
import { dateTime } from '../../shared/format';
import { href, roomHref } from '../../shared/router';
import { Block } from '../analysis/common';
import type { AdviceData } from './useAdvice';

const STATUS_TONE: Record<PlanStatus, BadgeTone> = { planned: 'neutral', experiment: 'experimental', done: 'warning', verified: 'success', deferred: 'neutral' };

export function PlanSection({ d }: { d: AdviceData }) {
  const room = d.h.room!;
  if (!d.plan.items.length) {
    return <EmptyState icon="layers" title="План пуст" text="Добавьте советы в план кнопкой «В план» в обзоре советов: здесь появятся этапы, их порядок и проверка результата."
      action={<a class={buttonClass('secondary')} href={roomHref(room.id, 'advice')}>Советы: обзор</a>} />;
  }
  const items = sortPlan(d.plan.items);
  const open = items.filter((x) => x.status !== 'verified' && x.status !== 'deferred');
  const rest = items.filter((x) => x.status === 'verified' || x.status === 'deferred');
  const cost = planCost(d.plan);
  const budget = room.goals.budget;
  return (
    <div class="al-stack al-stack--24">
      <p class="al-text-secondary">План общий для комнаты. Порядок — по группам советов: от проверки данных и бесплатных перестановок к покупкам; он подсказка, а не запрет.</p>
      <p class={cost.known > 0 && isKnown(budget) && cost.known > budget ? 'al-text-warning' : 'al-text-secondary'}>
        {`Стоимость указанных этапов: ${cost.known.toLocaleString('ru-RU')} ₽${isKnown(budget) ? ` из бюджета ${budget.toLocaleString('ru-RU')} ₽` : ', бюджет не задан'}${cost.unknown ? `; у ${cost.unknown} без стоимости — сумма неполная` : ''}.`}
      </p>
      <Block title={`Этапы (${open.length})`}>
        {open.length ? <ul role="list" class="al-list" aria-label="Этапы плана">{open.map((x) => <Item key={x.id} x={x} d={d} />)}</ul> : <p class="al-text-secondary">Открытых этапов нет.</p>}
      </Block>
      {rest.length > 0 && (
        <Block title={`Подтверждённые и отложенные (${rest.length})`}>
          <ul role="list" class="al-list" aria-label="Подтверждённые и отложенные">{rest.map((x) => <Item key={x.id} x={x} d={d} />)}</ul>
        </Block>
      )}
    </div>
  );
}

function Item({ x, d }: { x: PlanItem; d: AdviceData }) {
  const { clock } = useApp();
  const toast = useToast();
  const [history, setHistory] = useState(false);
  const [pick, setPick] = useState('');
  const measurements = d.records?.measurements ?? [];
  const change = (fn: Parameters<AdviceData['savePlan']>[0], done: string) =>
    void d.savePlan(fn).then(() => toast.show(done), (e: unknown) => toast.show(e instanceof Error ? e.message : 'Не удалось сохранить план', { tone: 'error' }));
  const to = (status: PlanStatus, text: string) => change((p) => setStatus(p, x.id, status, clock.now()), text);
  const before = blockers(d.plan, x);
  const fresh = d.recs && (x.status === 'planned' || x.status === 'deferred' || x.status === 'experiment') ? freshness(x, d.recs) : 'actual';
  const rec = d.recs?.find((r) => r.id === x.recId);
  const candidates = x.status === 'done' ? measurements.filter((m) => verifies(x, m)) : [];
  const by = x.verifiedBy ? measurements.find((m) => m.id === x.verifiedBy) : null;
  const at = doneAt(x);
  return (
    <li class="al-list__item al-list__item--wrap">
      <div class="al-stack al-stack--8">
        <div class="al-row al-row--12">
          <Badge tone={STATUS_TONE[x.status]} icon={x.status === 'verified'}>{PLAN_STATUS_LABEL[x.status]}</Badge>
          <span class="al-text-lead">{x.title}</span>
        </div>
        <span class="al-text-small al-text-secondary">{`${GROUP_LABEL[x.group]} · добавлено ${dateTime(x.addedAt)}`}</span>
        {fresh === 'gone' && <span class="al-text-small al-text-warning">Совет больше не выдаётся для этой конфигурации: проблема могла уйти или изменились данные. Пересмотрите пункт.</span>}
        {fresh === 'changed' && <span class="al-text-small al-text-warning">Совет изменился после добавления в план.</span>}
        {before.length > 0 && x.status === 'planned' && <span class="al-text-small al-text-secondary">{`Сначала: ${before.map((y) => y.title).join('; ')}.`}</span>}
        <ol class="al-steps" aria-label="Действия">{x.actions.map((a) => <li key={a}>{a}</li>)}</ol>
        <span class="al-text-small">{`Проверка: ${x.verify}`}</span>
        {x.status !== 'verified' && (
          <div class="al-grid al-grid--metrics">
            <NumberField label="Стоимость этапа" unit="₽" optional placeholder="неизвестна" value={x.cost ?? null} min={0} max={100_000_000} decimals={0}
              onCommit={(v) => change((p) => setCost(p, x.id, v, clock.now()), 'Стоимость сохранена')} />
          </div>
        )}
        {x.status === 'done' && (
          <span class="al-text-small al-text-secondary">{`Выполнено ${at ? dateTime(at) : ''} — это ещё не подтверждённое улучшение. Сделайте проверочный замер АЧХ после выполнения и привяжите его.`}</span>
        )}
        {by && <span class="al-text-small">{`Подтверждено замером «${by.name}»${by.recordedAt ? ` от ${dateTime(by.recordedAt)}` : ''}.`}</span>}
        {x.status === 'done' && candidates.length > 0 && (
          <div class="al-row al-row--bottom">
            <SelectField label="Проверочный замер" value={pick} options={[{ value: '', label: 'Выберите замер' }, ...candidates.map((m) => ({ value: m.id, label: `${m.name}${m.recordedAt ? `, ${dateTime(m.recordedAt)}` : ''}` }))]} onChange={setPick} />
            <Button small variant="primary" disabled={!pick} onClick={() => change((p) => setStatus(p, x.id, 'verified', clock.now(), { measurement: candidates.find((m) => m.id === pick) }), 'Результат подтверждён замером')}>Подтвердить</Button>
          </div>
        )}
        <div class="al-row">
          {(x.status === 'planned' || x.status === 'experiment') && <Button small variant="primary" icon="check" onClick={() => to('done', 'Отмечено выполненным; нужен проверочный замер')}>Выполнено</Button>}
          {x.status === 'planned' && <Button small onClick={() => to('experiment', 'Отмечено: проверено в эксперименте')}>Проверено в эксперименте</Button>}
          {(x.status === 'planned' || x.status === 'experiment') && <Button small variant="ghost" onClick={() => to('deferred', 'Отложено')}>Отложить</Button>}
          {(x.status === 'deferred' || x.status === 'done') && <Button small variant="ghost" onClick={() => to('planned', 'Возвращено в план')}>Вернуть в план</Button>}
          {fresh === 'changed' && rec && <Button small onClick={() => change((p) => refreshItem(p, x.id, rec, clock.now()), 'Пункт обновлён по текущему совету')}>Обновить по совету</Button>}
          {x.status !== 'verified' && <Button small variant="danger-ghost" icon="trash" onClick={() => change((p) => removeFromPlan(p, x.id, clock.now()), 'Удалено из плана')}>Удалить</Button>}
          {x.status === 'done' && <a class={buttonClass('ghost', true)} href={href({ name: 'tool', toolId: 'sweep' })}>Измерение АЧХ свипом</a>}
          <Button small variant="ghost" aria-expanded={history} onClick={() => setHistory(!history)}>{history ? 'Скрыть историю' : 'История'}</Button>
        </div>
        {history && (
          <ul class="al-steps" aria-label="История пункта">
            {x.history.map((h, k) => <li key={k}>{`${dateTime(h.at)} — ${PLAN_STATUS_LABEL[h.status]}${h.note ? ` (${h.note})` : ''}`}</li>)}
          </ul>
        )}
      </div>
    </li>
  );
}
