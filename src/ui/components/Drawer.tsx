// Выдвижное меню слева: новые и редкие разделы. Открывается кнопкой ☰, закрывается касанием мимо или свайпом влево.
import { useEffect, useRef } from 'preact/hooks';
import { useSheetLock } from '../sheetLock';
import { S } from '../strings';

export type DrawerItem = 'measure' | 'voice' | 'report' | 'sync' | 'help' | 'about';
const GROUPS: { title: string; items: DrawerItem[] }[] = [
  { title: 'Работа со звуком', items: ['measure', 'voice'] },
  { title: 'Проект', items: ['report', 'sync'] },
  { title: 'Справка', items: ['help', 'about'] },
];
const ICONS: Record<DrawerItem, string> = {
  measure: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z M5 11a7 7 0 0 0 14 0 M12 18v3',
  voice: 'M10 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z M3.5 21v-1.5a6.5 6.5 0 0 1 13 0V21 M18.2 5.5a1.5 1.5 0 0 1 3 0v3a1.5 1.5 0 0 1-3 0z M19.7 10v3.5',
  report: 'M6 3h9l4 4v14H6z M14 3v5h5 M9 13h7 M9 17h7',
  sync: 'M4 12a8 8 0 0 1 14-5l2 2 M20 4v5h-5 M20 12a8 8 0 0 1-14 5l-2-2 M4 20v-5h5',
  help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14 M12 17.5v.01',
  about: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 11v6 M12 7.5v.01',
};

export function Drawer({ open, current, onClose, onPick }: { open: boolean; current: string; onClose: () => void; onPick: (i: DrawerItem) => void }) {
  const x0 = useRef<number | null>(null);
  const panel = useRef<HTMLElement>(null);
  const root = useRef<HTMLDivElement>(null);
  // пока меню открыто, страница под ним не прокручивается и не реагирует на касания
  useSheetLock(root, panel, open);
  // свежий обработчик без перезапуска эффекта (иначе фокус прыгал бы на первый пункт при каждой перерисовке)
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; });
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') close.current(); };
    addEventListener('keydown', k);
    panel.current?.querySelector<HTMLButtonElement>('.drawer__item')?.focus({ preventScroll: true });
    return () => removeEventListener('keydown', k);
  }, [open]);
  return (
    <div ref={root} class={`drawer${open ? ' is-open' : ''}`} aria-hidden={!open}>
      <div class="drawer__backdrop" onClick={onClose} />
      <nav
        ref={panel}
        class="drawer__panel"
        aria-label={S.drawer.title}
        onTouchStart={(e) => { x0.current = e.touches[0].clientX; }}
        onTouchMove={(e) => { if (x0.current !== null && x0.current - e.touches[0].clientX > 60) { x0.current = null; onClose(); } }}
      >
        <div class="drawer__head">
          <strong>{S.drawer.title}</strong>
          <button type="button" class="sheet__close" aria-label="Закрыть меню" onClick={onClose}>×</button>
        </div>
        {GROUPS.map((group) => <div key={group.title} class="drawer__group">
        <h2 class="drawer__group-title">{group.title}</h2>
        <ul class="drawer__list">
          {group.items.map((i) => (
            <li key={i}>
              <button type="button" class={`drawer__item${current === i ? ' is-on' : ''}`} tabIndex={open ? 0 : -1} onClick={() => onPick(i)}>
                <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d={ICONS[i]} /></svg>
                <span>
                  <span class="drawer__label">{S.drawer.items[i]}</span>
                  <span class="drawer__hint">{S.drawer.hints[i]}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        </div>)}
      </nav>
    </div>
  );
}
