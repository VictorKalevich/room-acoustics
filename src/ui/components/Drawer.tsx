// Выдвижное меню слева: новые и редкие разделы. Открывается кнопкой ☰, закрывается касанием мимо или свайпом влево.
import { useRef } from 'preact/hooks';
import { S } from '../strings';

export type DrawerItem = 'measure' | 'report' | 'sync' | 'help' | 'about';
const ITEMS: DrawerItem[] = ['measure', 'report', 'sync', 'help', 'about'];
const ICONS: Record<DrawerItem, string> = {
  measure: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z M5 11a7 7 0 0 0 14 0 M12 18v3',
  report: 'M6 3h9l4 4v14H6z M14 3v5h5 M9 13h7 M9 17h7',
  sync: 'M4 12a8 8 0 0 1 14-5l2 2 M20 4v5h-5 M20 12a8 8 0 0 1-14 5l-2-2 M4 20v-5h5',
  help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14 M12 17.5v.01',
  about: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 11v6 M12 7.5v.01',
};

export function Drawer({ open, current, onClose, onPick }: { open: boolean; current: string; onClose: () => void; onPick: (i: DrawerItem) => void }) {
  const x0 = useRef<number | null>(null);
  return (
    <div class={`drawer${open ? ' is-open' : ''}`} aria-hidden={!open}>
      <div class="drawer__backdrop" onClick={onClose} />
      <nav
        class="drawer__panel"
        aria-label={S.drawer.title}
        onTouchStart={(e) => { x0.current = e.touches[0].clientX; }}
        onTouchMove={(e) => { if (x0.current !== null && x0.current - e.touches[0].clientX > 60) { x0.current = null; onClose(); } }}
      >
        <div class="drawer__head">
          <strong>{S.drawer.title}</strong>
          <button type="button" class="sheet__close" aria-label="Закрыть меню" onClick={onClose}>×</button>
        </div>
        <ul class="drawer__list">
          {ITEMS.map((i) => (
            <li>
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
      </nav>
    </div>
  );
}
