// Страница комнаты (V2-018, V2-020): вкладки «Модель», «Анализ», «Советы» — хеш-адреса; открытая комната
// становится активной и восстанавливается при следующем запуске.
import { useEffect } from 'preact/hooks';
import { EmptyState, ErrorState, LoadingState, Notice, TabPanel, Tabs, buttonClass } from '../../design-system';
import { useApp } from '../../shared/context';
import { ROOM_TABS, href, navigate, roomHref, type RoomTab } from '../../shared/router';
import { Screen } from '../../shared/Screen';
import { AnalysisTab } from '../analysis/AnalysisTab';
import { ConfigBar } from '../experiment/ConfigBar';
import { ModelTab } from '../model/ModelTab';
import { useRoom, type RoomHandle } from './useRoom';

export const TAB_LABEL: Record<RoomTab, string> = { model: 'Модель', analysis: 'Анализ', advice: 'Советы' };

export function RoomPage({ id, tab, section }: { id: string; tab: RoomTab; section?: string }) {
  const { rooms } = useApp();
  const h = useRoom(id);
  useEffect(() => { if (h.load.status === 'ready') void rooms.setActive(id); }, [h.load.status, id, rooms]);

  if (h.load.status === 'loading') return <Screen title="Комната" backHref={href({ name: 'rooms' })}><LoadingState /></Screen>;
  if (h.load.status === 'error') return <Screen title="Комната" backHref={href({ name: 'rooms' })}><ErrorState text={h.load.message} onRetry={h.reload} /></Screen>;
  if (h.load.status === 'missing' || !h.room) {
    return (
      <Screen title="Комната не найдена" backHref={href({ name: 'rooms' })}>
        <EmptyState icon="rooms" title="Комната не найдена" text="Возможно, она удалена на этом устройстве или в другой вкладке." action={<a class={buttonClass('primary')} href={href({ name: 'rooms' })}>К списку комнат</a>} />
      </Screen>
    );
  }
  const room = h.room;
  return (
    <Screen title={room.name} context={h.role === 'experimental' ? 'Эксперимент' : 'Текущая конфигурация'} backHref={href({ name: 'rooms' })}>
      <div class="al-stack al-stack--16">
        <Tabs idPrefix="room" label="Разделы комнаты" value={tab} onChange={(t) => navigate(roomHref(id, t))} tabs={ROOM_TABS.map((t) => ({ id: t, label: TAB_LABEL[t] }))} />
        <ConfigBar h={h} />
        {h.error && <Notice tone="danger" title="Изменение не сохранено">{h.error}</Notice>}
        <TabPanel idPrefix="room" active={tab}>
          <RoomTabContent h={h} tab={tab} section={section} />
        </TabPanel>
      </div>
    </Screen>
  );
}

function RoomTabContent({ h, tab, section }: { h: RoomHandle; tab: RoomTab; section?: string }) {
  if (tab === 'model') return <ModelTab h={h} section={section} />;
  if (tab === 'analysis') return <AnalysisTab h={h} section={section} />;
  return <EmptyState icon="advice" title={TAB_LABEL[tab]} text="Раздел подключается на следующих этапах редизайна." />;
}
