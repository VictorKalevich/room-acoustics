// Темы Acoustic Lab (V2-012): системная, светлая, тёмная. Выбор хранится в localStorage (R12), чтобы применить его
// до первой отрисовки без мигания; остальные настройки v2 — в IndexedDB.
export type ThemeChoice = 'system' | 'light' | 'dark';
export const THEME_KEY = 'ra2.theme';
export const THEME_LABEL: Record<ThemeChoice, string> = { system: 'Как в системе', light: 'Светлая', dark: 'Тёмная' };

export function readTheme(storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): ThemeChoice {
  try {
    const v = storage?.getItem(THEME_KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

export function applyTheme(choice: ThemeChoice, root: HTMLElement = document.documentElement): void {
  if (choice === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', choice);
}

/** Сохранить выбор. Системная тема — удаление ключа, а не запись: без выбора хранилище не используется. */
export function saveTheme(choice: ThemeChoice, storage: Pick<Storage, 'setItem' | 'removeItem'> | undefined = globalThis.localStorage): void {
  try {
    if (choice === 'system') storage?.removeItem(THEME_KEY);
    else storage?.setItem(THEME_KEY, choice);
  } catch { /* хранилище недоступно: тема действует до перезагрузки */ }
}

export function resolvedTheme(choice: ThemeChoice, media: Pick<MediaQueryList, 'matches'> | undefined = globalThis.matchMedia?.('(prefers-color-scheme: dark)')): 'light' | 'dark' {
  if (choice !== 'system') return choice;
  return media?.matches ? 'dark' : 'light';
}
