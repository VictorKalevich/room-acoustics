// Навигация Acoustic Lab: боковая панель на широком экране, нижняя панель на узком, верхняя панель раздела.
// Пункты — ссылки на хеш-адреса: работают «Назад» и «Вперёд» браузера, открытие в новой вкладке и чтение с экрана.
import type { ComponentChildren } from 'preact';
import { IconButton } from './Button';
import { Icon, type IconName } from './Icon';

/** `short` — подпись в нижней панели на узком экране, если полная не помещается. */
export interface NavItem { id: string; label: string; short?: string; icon: IconName; href: string }

export function Sidebar({ items, current, brand, footer }: { items: readonly NavItem[]; current: string; brand: string; footer?: ComponentChildren }) {
  return (
    <nav class="al-sidebar" aria-label="Основная навигация">
      <div class="al-sidebar__brand"><Icon name="logo" class="al-sidebar__brand-mark" />{brand}</div>
      {items.map((it) => (
        <a key={it.id} class="al-navlink" href={it.href} aria-current={it.id === current ? 'page' : undefined}>
          <Icon name={it.icon} />
          {it.label}
        </a>
      ))}
      {footer}
    </nav>
  );
}

export function TabBar({ items, current }: { items: readonly NavItem[]; current: string }) {
  return (
    <nav class="al-tabbar" aria-label="Основная навигация">
      {items.map((it) => (
        <a key={it.id} class="al-tabbar__item" href={it.href} aria-current={it.id === current ? 'page' : undefined}>
          <Icon name={it.icon} />
          <span>{it.short ?? it.label}</span>
        </a>
      ))}
    </nav>
  );
}

export function TopBar({ title, context, backHref, onBack, actions }: { title: string; context?: string; backHref?: string; onBack?: () => void; actions?: ComponentChildren }) {
  return (
    <header class="al-topbar">
      {backHref ? <a class="al-btn al-btn--ghost al-btn--icon" href={backHref} aria-label="Назад" title="Назад"><Icon name="back" /></a>
        : onBack && <IconButton icon="back" label="Назад" onClick={onBack} />}
      <div class="al-grow">
        <div class="al-topbar__title">{title}</div>
        {context && <div class="al-topbar__context">{context}</div>}
      </div>
      {actions && <div class="al-row al-row--nowrap">{actions}</div>}
    </header>
  );
}
