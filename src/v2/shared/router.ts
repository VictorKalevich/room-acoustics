// Хеш-маршруты v2 (V2-020, architecture §11): «Назад» и «Вперёд» браузера, ссылки в новой вкладке, неизвестный адрес.
import { useEffect, useState } from 'preact/hooks';
import { LIBRARY_CATEGORIES, type LibraryCategory } from '../storage/library';

export const ROOM_TABS = ['model', 'analysis', 'advice'] as const;
export type RoomTab = (typeof ROOM_TABS)[number];

/** Подразделы вкладок комнаты; пустой подраздел — обзор вкладки. */
export const ROOM_SECTIONS = {
  model: ['geometry', 'audio', 'listening', 'interior', 'treatment', 'simulation', 'compare', 'history'],
  analysis: ['bass', 'speakers', 'subwoofers', 'listeners', 'reflections', 'reverb', 'treatment', 'measurements'],
  advice: ['goals', 'optimize', 'dsp', 'plan', 'reports'],
} as const satisfies Record<RoomTab, readonly string[]>;
export type RoomSection<T extends RoomTab = RoomTab> = (typeof ROOM_SECTIONS)[T][number];

/** Способ задать новую комнату (D61): по скану или вручную — первый шаг создания. */
export const NEW_ROOM_MODES = ['scan', 'manual'] as const;
export type NewRoomMode = (typeof NEW_ROOM_MODES)[number];

export type Route =
  | { name: 'home' }
  | { name: 'rooms' }
  | { name: 'room-new'; mode?: NewRoomMode }
  | { name: 'room'; id: string; tab: RoomTab; section?: string }
  | { name: 'tools' }
  | { name: 'tool'; toolId: string }
  | { name: 'library'; category?: LibraryCategory }
  | { name: 'settings' }
  | { name: 'catalog' }
  | { name: 'not-found'; path: string };

const has = <T extends string>(list: readonly T[], v: string | undefined): v is T => v !== undefined && (list as readonly string[]).includes(v);

export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#/, '').replace(/\?.*$/, '') || '/';
  const parts = path.split('/').filter(Boolean).map((p) => { try { return decodeURIComponent(p); } catch { return '\u0000'; } });
  const nf: Route = { name: 'not-found', path };
  const [a, b, c, d, ...rest] = parts;
  if (rest.length) return nf;
  if (!a) return { name: 'home' };
  if (a === 'rooms') {
    if (!b) return { name: 'rooms' };
    if (b === 'new') return !c ? { name: 'room-new' } : has(NEW_ROOM_MODES, c) && d === undefined ? { name: 'room-new', mode: c } : nf;
    if (b.includes('\u0000')) return nf;
    const tab = c ?? 'model';
    if (!has(ROOM_TABS, tab)) return nf;
    if (d === undefined) return { name: 'room', id: b, tab };
    return has(ROOM_SECTIONS[tab] as readonly string[], d) ? { name: 'room', id: b, tab, section: d } : nf;
  }
  if (c !== undefined) return nf;
  if (a === 'tools') return b ? { name: 'tool', toolId: b } : { name: 'tools' };
  if (a === 'library') return !b ? { name: 'library' } : has(LIBRARY_CATEGORIES, b) ? { name: 'library', category: b } : nf;
  if (b !== undefined) return nf;
  if (a === 'settings') return { name: 'settings' };
  if (a === 'catalog') return { name: 'catalog' };
  return nf;
}

export function href(r: Route): string {
  switch (r.name) {
    case 'home': return '#/';
    case 'rooms': return '#/rooms';
    case 'room-new': return r.mode ? `#/rooms/new/${r.mode}` : '#/rooms/new';
    case 'room': return `#/rooms/${encodeURIComponent(r.id)}/${r.tab}${r.section ? `/${r.section}` : ''}`;
    case 'tools': return '#/tools';
    case 'tool': return `#/tools/${encodeURIComponent(r.toolId)}`;
    case 'library': return r.category ? `#/library/${r.category}` : '#/library';
    case 'settings': return '#/settings';
    case 'catalog': return '#/catalog';
    case 'not-found': return `#${r.path}`;
  }
}

export const roomHref = (id: string, tab: RoomTab = 'model', section?: string) => href({ name: 'room', id, tab, section });

export function navigate(to: Route | string, replace = false): void {
  const h = typeof to === 'string' ? to : href(to);
  if (replace) history.replaceState(history.state, '', h); else location.hash = h;
  if (replace) dispatchEvent(new HashChangeEvent('hashchange'));
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(location.hash));
  useEffect(() => {
    const on = () => setRoute(parseRoute(location.hash));
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return route;
}

/** Раздел основной навигации, к которому относится маршрут. */
export function navSection(r: Route): 'home' | 'rooms' | 'tools' | 'library' | 'settings' | '' {
  switch (r.name) {
    case 'home': return 'home';
    case 'rooms': case 'room-new': case 'room': return 'rooms';
    case 'tools': case 'tool': return 'tools';
    case 'library': return 'library';
    case 'settings': case 'catalog': return 'settings';
    default: return '';
  }
}
