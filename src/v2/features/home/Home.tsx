// Главная (V2-017, макеты M02/D02 и M04/D04): два основных направления — «Мои комнаты» и «Инструменты»;
// с активной комнатой — её сводка и переходы в «Модель», «Анализ», «Советы».
import { useEffect, useState } from 'preact/hooks';
import { Badge, Card, Icon, KeyValue, LoadingState, Section, buttonClass } from '../../design-system';
import type { Room } from '../../domain/model';
import { useApp } from '../../shared/context';
import { dateTime, dimsText, roomOriginText, systemText, volumeText } from '../../shared/format';
import { href, roomHref } from '../../shared/router';
import { APP_TITLE, Screen } from '../../shared/Screen';
import { toolById } from '../tools/catalog';
import { ToolTile } from '../tools/ToolTile';

export function Home() {
  const { rooms, settings } = useApp();
  const [state, setState] = useState<{ active: Room | null; others: Room[]; total: number } | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.all([rooms.active(), rooms.list()]).then(([active, list]) => {
      if (!alive) return;
      const sorted = [...list.rooms].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      setState({ active: active ?? null, others: sorted.filter((r) => r.id !== active?.id).slice(0, 3), total: list.rooms.length });
    }, () => alive && setState({ active: null, others: [], total: 0 }));
    return () => { alive = false; };
  }, [rooms]);

  const quick = [...new Set([...settings.favorites, ...settings.recentTools])].map(toolById).filter((t) => !!t).slice(0, 6);

  return (
    <Screen title={APP_TITLE}>
      {!state ? <LoadingState /> : (
        <div class="al-stack al-stack--32">
          {state.active ? <ActiveRoom room={state.active} /> : (
            <div class="al-stack al-stack--8">
              <h1 class="al-text-headline">Акустика вашей комнаты</h1>
              <p class="al-text-secondary">Опишите комнату, чтобы увидеть моды, отражения и реверберацию и подобрать расстановку. Инструменты работают и без комнаты.</p>
            </div>
          )}
          <div class="al-tiles al-tiles--2">
            <div class="al-tile al-tile--feature">
              <div class="al-tile__head"><span class="al-tile__icon"><Icon name="rooms" /></span><a class="al-tile__link al-tile__title al-text-title" href={href({ name: 'rooms' })}>Мои комнаты</a></div>
              <p class="al-tile__text">{state.total ? `Комнат: ${state.total}. Модель, анализ и советы для каждой.` : 'Пока ни одной комнаты. Для начала нужны только размеры.'}</p>
              <div class="al-tile__aside al-row"><a class={buttonClass('primary')} href={href({ name: 'room-new' })}><Icon name="plus" />Создать комнату</a></div>
            </div>
            <div class="al-tile al-tile--feature">
              <div class="al-tile__head"><span class="al-tile__icon"><Icon name="tools" /></span><a class="al-tile__link al-tile__title al-text-title" href={href({ name: 'tools' })}>Инструменты</a></div>
              <p class="al-tile__text">23 инструмента: измерения, генераторы, калькуляторы, конструкции и настройка системы. Без создания комнаты.</p>
            </div>
          </div>
          {state.others.length > 0 && (
            <Section title="Другие комнаты" actions={<a class={buttonClass('ghost', true)} href={href({ name: 'rooms' })}>Все комнаты</a>}>
              <div class="al-list">
                {state.others.map((r) => (
                  <a key={r.id} class="al-list__item" href={roomHref(r.id)}>
                    <Icon name="rooms" />
                    <span class="al-list__text"><span class="al-list__title">{r.name}</span><span class="al-list__meta">{dimsText(r.current)} · изменена {dateTime(r.updatedAt)}</span></span>
                    <Icon name="forward" />
                  </a>
                ))}
              </div>
            </Section>
          )}
          {quick.length > 0 && (
            <Section title="Избранные и недавние инструменты">
              <div class="al-tiles">{quick.map((t) => <ToolTile key={t.id} tool={t} />)}</div>
            </Section>
          )}
          <div class="al-row al-row--12">
            <a class={buttonClass('secondary')} href={href({ name: 'library' })}><Icon name="library" />Мои данные</a>
            <a class={buttonClass('secondary')} href={href({ name: 'settings' })}><Icon name="settings" />Настройки</a>
          </div>
        </div>
      )}
    </Screen>
  );
}

function ActiveRoom({ room }: { room: Room }) {
  const c = room.current;
  const origin = roomOriginText(room);
  return (
    <Card title={<>{room.name}</>} subtitle="Активная комната" actions={<>{room.experimental && <Badge tone="experimental">Есть эксперимент</Badge>}{origin && <Badge tone="imported">{origin}</Badge>}</>}>
      <div class="al-stack al-stack--12">
        <KeyValue items={[
          ['Размеры', dimsText(c)],
          ['Объём', volumeText(c) ?? '—'],
          ['Аудиосистема', systemText(c)],
          ['Слушатели', String(c.listening.listeners.length)],
          ['Изменена', dateTime(room.updatedAt)],
        ]} />
        <div class="al-row al-row--12">
          <a class={buttonClass('primary')} href={roomHref(room.id, 'model')}><Icon name="model" />Модель</a>
          <a class={buttonClass('secondary')} href={roomHref(room.id, 'analysis')}><Icon name="analysis" />Анализ</a>
          <a class={buttonClass('secondary')} href={roomHref(room.id, 'advice')}><Icon name="advice" />Советы</a>
        </div>
      </div>
    </Card>
  );
}

