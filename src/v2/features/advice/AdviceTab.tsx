// Вкладка «Советы» (V2-041–V2-045): одна система рекомендаций поверх всех разделов анализа — по группам приоритета,
// с происхождением (измерение, модель, предположение, требует проверки), целями и ограничениями. Разделы — цели,
// подбор, DSP, план работ, отчёты: свой адрес `#/rooms/<id>/advice/<раздел>`. Предложение применяется только к
// эксперименту после подтверждения (applyProposal).
import type { ComponentType } from 'preact';
import { useState } from 'preact/hooks';
import { Badge, Button, ConfirmDialog, Icon, Section, buttonClass, useToast, type BadgeTone, type IconName } from '../../design-system';
import { EFFORT_LABEL, EVIDENCE_LABEL, GOAL_LABEL, GROUP_LABEL, proposalOp, proposalText, sortAdvice } from '../../application/advice';
import { applyProposal } from '../../application/experiment';
import { addToPlan, setStatus } from '../../application/plan';
import { ADVICE_GROUPS, type Evidence, type Recommendation } from '../../domain/advice';
import { useApp } from '../../shared/context';
import { ROOM_SECTIONS, href, roomHref, type RoomSection } from '../../shared/router';
import { analysisStatus } from '../analysis/common';
import { useConfig } from '../model/useConfig';
import type { RoomHandle } from '../rooms/useRoom';
import { DspSection } from './DspSection';
import { GoalsSection } from './GoalsSection';
import { OptimizeSection } from './OptimizeSection';
import { PlanSection } from './PlanSection';
import { ReportsSection } from './ReportsSection';
import { useAdvice, type AdviceData } from './useAdvice';

type AdviceSection = RoomSection<'advice'>;

export const ADVICE_SECTION: Record<AdviceSection, { title: string; icon: IconName; view: ComponentType<{ d: AdviceData }>; text: string }> = {
  goals: { title: 'Цели и ограничения', icon: 'advice', view: GoalsSection, text: 'Главная цель, назначение, бюджет, что можно двигать, сверлить и какой глубины конструкции' },
  optimize: { title: 'Подбор', icon: 'listener', view: OptimizeSection, text: 'Поиск мест колонок, сабвуферов и слушателя, согласование сабвуферов' },
  dsp: { title: 'DSP', icon: 'wave', view: DspSection, text: 'Автоматическая эквализация по модели или замеру, пределы, экспорт фильтров' },
  plan: { title: 'План работ', icon: 'layers', view: PlanSection, text: 'Этапы и их порядок, состояние, проверка измерением, пересмотр устаревших' },
  reports: { title: 'Проверка и отчёты', icon: 'measure', view: ReportsSection, text: 'Замеры до и после, отчёт по комнате' },
};

const isSection = (s: string | undefined): s is AdviceSection => !!s && (ROOM_SECTIONS.advice as readonly string[]).includes(s);

export const EVIDENCE_TONE: Record<Evidence, BadgeTone> = { measured: 'measured', predicted: 'calculated', assumption: 'estimated', 'needs-check': 'warning' };
const SEVERITY: Record<Recommendation['severity'], { tone: BadgeTone; text: string }> = {
  high: { tone: 'danger', text: 'Серьёзно' }, medium: { tone: 'warning', text: 'Заметно' }, low: { tone: 'neutral', text: 'Слабо' },
};

export function AdviceTab({ h, section }: { h: RoomHandle; section?: string }) {
  const edit = useConfig(h);
  const d = useAdvice(h, edit);
  const room = h.room!;
  if (isSection(section)) {
    const s = ADVICE_SECTION[section];
    const View = s.view;
    return (
      <div class="al-stack al-stack--16">
        <div class="al-row"><a class={buttonClass('ghost', true)} href={roomHref(room.id, 'advice')}><Icon name="back" small />Советы: обзор</a></div>
        <Section title={s.title}>
          <View d={d} />
        </Section>
      </div>
    );
  }
  return (
    <div class="al-stack al-stack--24">
      <Section title="Что сделать">
        <Overview d={d} />
      </Section>
      <Section title="Разделы советов">
        <nav class="al-tiles" aria-label="Разделы советов">
          {ROOM_SECTIONS.advice.map((id) => {
            const s = ADVICE_SECTION[id];
            return (
              <div key={id} class="al-tile">
                <div class="al-tile__head"><span class="al-tile__icon"><Icon name={s.icon} /></span><a class="al-tile__link al-tile__title al-text-title" href={roomHref(room.id, 'advice', id)}>{s.title}</a></div>
                <p class="al-tile__text">{s.text}</p>
              </div>
            );
          })}
        </nav>
      </Section>
    </div>
  );
}

function Overview({ d }: { d: AdviceData }) {
  const room = d.h.room!;
  const [show, setShow] = useState<{ off: boolean; blocked: boolean }>({ off: false, blocked: false });
  if (!d.recs) return analysisStatus(d.state.status === 'ready' ? { status: 'running' } : d.state);
  const s = sortAdvice(d.recs);
  return (
    <div class="al-stack al-stack--16">
      <p class="al-text-secondary">
        {`${d.label} конфигурация. Цель — ${GOAL_LABEL[room.goals.primary].toLowerCase()}. Порядок — от проверки данных и бесплатных перестановок к покупкам; он не жёсткий. `}
        <a class="al-list__link" href={roomHref(room.id, 'advice', 'goals')}>Цели и ограничения</a>
      </p>
      {d.state.status === 'error' && <p class="al-text-small al-text-secondary">{`Расчёт модели не удался (${d.state.message}): советы по модели не показаны.`}</p>}
      {!s.active.length && <p class="al-text-secondary">Правила не нашли, что улучшить для этой цели. Проверьте результат измерением.</p>}
      {ADVICE_GROUPS.map((g) => {
        const list = s.active.filter((r) => r.group === g);
        if (!list.length) return null;
        return <RecGroup key={g} title={GROUP_LABEL[g]} list={list} d={d} />;
      })}
      {s.offGoal.length > 0 && (
        <div class="al-stack al-stack--8">
          <Button variant="ghost" small aria-expanded={show.off} onClick={() => setShow({ ...show, off: !show.off })}>{show.off ? 'Скрыть неактуальные для цели' : `Неактуально для цели (${s.offGoal.length})`}</Button>
          {show.off && <RecGroup title="Неактуально для цели" list={s.offGoal} d={d} />}
        </div>
      )}
      {s.blocked.length > 0 && (
        <div class="al-stack al-stack--8">
          <Button variant="ghost" small aria-expanded={show.blocked} onClick={() => setShow({ ...show, blocked: !show.blocked })}>{show.blocked ? 'Скрыть противоречащие ограничениям' : `Противоречит ограничениям (${s.blocked.length})`}</Button>
          {show.blocked && <RecGroup title="Противоречит ограничениям" list={s.blocked} d={d} />}
        </div>
      )}
      <p class="al-text-small al-text-secondary">{`Правила советов — детерминированные, версия ${d.recs[0]?.ruleVersion ?? '—'}. Совет по модели — предсказание: подтверждает его только измерение.`}</p>
    </div>
  );
}

function RecGroup({ title, list, d }: { title: string; list: Recommendation[]; d: AdviceData }) {
  return (
    <div class="al-stack al-stack--8">
      <h3 class="al-text-title">{title}</h3>
      <ul role="list" class="al-list" aria-label={title}>
        {list.map((r) => <RecItem key={r.id} r={r} d={d} />)}
      </ul>
    </div>
  );
}

export const costText = (r: Recommendation) => (r.cost.kind === 'free' ? 'Бесплатно' : `Покупка: ${r.cost.what}; стоимость неизвестна`);

function RecItem({ r, d }: { r: Recommendation; d: AdviceData }) {
  const { clock } = useApp();
  const toast = useToast();
  const room = d.h.room!;
  const [open, setOpen] = useState(false);
  const [ask, setAsk] = useState(false);
  const planned = d.plan.items.find((x) => x.recId === r.id && x.status !== 'verified');
  const toPlan = () => d.savePlan((p) => addToPlan(p, r, clock.newId, clock.now())).then(
    () => toast.show('Добавлено в план работ', { action: { label: 'Открыть план', run: () => { location.hash = roomHref(room.id, 'advice', 'plan'); } } }),
    () => toast.show('Не удалось сохранить план', { tone: 'error' }),
  );
  const apply = async () => {
    if (!r.proposal) return;
    const p = r.proposal;
    const ok = await d.h.edit((x) => applyProposal(x, proposalOp(p, clock.newId), clock.newId, clock.now()), `Совет: ${r.title}`);
    setAsk(false);
    if (!ok) return;
    if (planned && planned.status === 'planned') await d.savePlan((x) => setStatus(x, planned.id, 'experiment', clock.now())).catch(() => undefined);
    d.h.setRole('experimental');
    toast.show('Применено в эксперименте; текущая конфигурация не изменилась');
  };
  const link = r.link && (r.link.kind === 'room' ? roomHref(room.id, r.link.tab, r.link.section) : href({ name: 'tool', toolId: r.link.toolId }));
  return (
    <li class="al-list__item al-list__item--wrap">
      <div class="al-stack al-stack--8">
        <div class="al-row al-row--12">
          <Badge tone={SEVERITY[r.severity].tone}>{SEVERITY[r.severity].text}</Badge>
          <Badge tone={EVIDENCE_TONE[r.evidence]} icon={false}>{EVIDENCE_LABEL[r.evidence]}</Badge>
          {r.relevance === 'goal' && <Badge tone="success" icon={false}>По цели</Badge>}
          <span class="al-text-lead">{r.title}</span>
        </div>
        <span class="al-text-small al-text-secondary">{r.cause}</span>
        <span class="al-text-small">{`${costText(r)} · трудоёмкость: ${EFFORT_LABEL[r.effort]}`}</span>
        {r.conflicts.map((x) => <span key={x} class="al-text-small al-text-danger">{x}</span>)}
        {open && (
          <div class="al-stack al-stack--8">
            {([
              ['Источник данных', r.source], ['Метод', r.method], ['Применимость', r.applicability], ['Ожидаемый эффект', r.effect],
              ['Побочные последствия', r.sideEffects], ['Проверка результата', r.verify],
            ] as const).map(([k, v]) => <p key={k} class="al-text-small"><span class="al-text-secondary">{`${k}: `}</span>{v}</p>)}
            <ol class="al-steps" aria-label="Действия">{r.actions.map((a) => <li key={a}>{a}</li>)}</ol>
            {r.notes.map((x) => <span key={x} class="al-text-small al-text-secondary">{x}</span>)}
          </div>
        )}
        <div class="al-row">
          <Button small variant="ghost" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Свернуть' : 'Подробнее'}</Button>
          <Button small icon={planned ? undefined : 'plus'} disabled={!!planned} onClick={() => void toPlan()}>{planned ? 'В плане' : 'В план'}</Button>
          {r.proposal && !r.conflicts.length && <Button small variant="secondary" icon="flask" onClick={() => setAsk(true)}>Применить в эксперименте</Button>}
          {link && <a class={buttonClass('ghost', true)} href={link}>{r.link!.label}</a>}
        </div>
      </div>
      {ask && r.proposal && (
        <ConfirmDialog title="Применить в эксперименте?" confirmLabel="Применить" onCancel={() => setAsk(false)} onConfirm={() => void apply()}
          text={<>
            <p>{proposalText(r.proposal)}.</p>
            <p>{room.experimental ? 'Изменение добавится в существующий эксперимент.' : 'Будет создан эксперимент — копия текущей конфигурации.'} Текущая конфигурация не изменится; отмена — «Отменить» в модели.</p>
            {d.edit.role === 'current' && room.experimental && <p>Совет рассчитан по текущей конфигурации, а эксперимент уже отличается от неё: проверьте результат.</p>}
          </>} />
      )}
    </li>
  );
}
