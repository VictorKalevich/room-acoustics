// Приложение v2 (V2-016–V2-020): первый запуск, основная навигация (боковая панель или нижняя), хеш-маршруты.
import { useEffect, useRef } from 'preact/hooks';
import { EmptyState, Sidebar, TabBar, ToastHost, buttonClass, type NavItem } from '../design-system';
import { Catalog } from '../features/catalog/Catalog';
import { Home } from '../features/home/Home';
import { Library } from '../features/library/Library';
import { FirstRun } from '../features/onboarding/FirstRun';
import { CreateRoom } from '../features/rooms/CreateRoom';
import { RoomPage } from '../features/rooms/RoomPage';
import { RoomsList } from '../features/rooms/RoomsList';
import { Settings } from '../features/settings/Settings';
import { ToolPage } from '../features/tools/ToolPage';
import { ToolsCatalog } from '../features/tools/ToolsCatalog';
import { AppProvider, useApp } from '../shared/context';
import { href, navSection, useRoute, type Route } from '../shared/router';
import { Screen } from '../shared/Screen';

const NAV: readonly NavItem[] = [
  { id: 'home', label: 'Главная', icon: 'home', href: '#/' },
  { id: 'rooms', label: 'Комнаты', icon: 'rooms', href: '#/rooms' },
  { id: 'tools', label: 'Инструменты', icon: 'tools', href: '#/tools' },
  { id: 'library', label: 'Мои данные', short: 'Данные', icon: 'library', href: '#/library' },
  { id: 'settings', label: 'Настройки', icon: 'settings', href: '#/settings' },
];

export function App() {
  return (
    <ToastHost>
      <AppProvider>
        <Shell />
      </AppProvider>
    </ToastHost>
  );
}

function Shell() {
  const { settings } = useApp();
  const route = useRoute();
  const first = useRef(true);
  const key = href(route);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    scrollTo(0, 0);
    document.getElementById('main')?.focus({ preventScroll: true });
  }, [key]);

  if (settings.complexity === null && route.name !== 'catalog') return <div class="al-app"><a class="al-skip-link" href="#main">К содержимому</a><main class="al-main"><FirstRun /></main></div>;
  const current = navSection(route);
  return (
    <div class="al-app">
      <a class="al-skip-link" href="#main">К содержимому</a>
      <Sidebar items={NAV} current={current} brand="Room Acoustics" />
      <main class="al-main">{screen(route)}</main>
      <TabBar items={NAV} current={current} />
    </div>
  );
}

function screen(r: Route) {
  switch (r.name) {
    case 'home': return <Home />;
    case 'rooms': return <RoomsList />;
    case 'room-new': return <CreateRoom />;
    case 'room': return <RoomPage key={r.id} id={r.id} tab={r.tab} section={r.section} />;
    case 'tools': return <ToolsCatalog />;
    case 'tool': return <ToolPage key={r.toolId} toolId={r.toolId} />;
    case 'library': return <Library key={r.category ?? ''} category={r.category} />;
    case 'settings': return <Settings />;
    case 'catalog': return <Screen title="Каталог дизайн-системы" backHref={href({ name: 'settings' })}><Catalog /></Screen>;
    case 'not-found': return (
      <Screen title="Страница не найдена">
        <EmptyState icon="search" title="Такой страницы нет" text={`Адрес «${r.path}» не найден. Возможно, ссылка устарела.`} action={<a class={buttonClass('primary')} href="#/">На главную</a>} />
      </Screen>
    );
  }
}
