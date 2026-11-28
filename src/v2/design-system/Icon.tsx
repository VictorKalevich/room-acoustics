// Значки Acoustic Lab: контурные, 24×24, цвет — currentColor. Декоративные скрыты от чтения с экрана.
import type { JSX } from 'preact';

const PATHS = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z',
  rooms: 'M4 4h16v16H4zM4 12h7M11 4v16',
  tools: 'M14.7 6.3a4 4 0 0 0-5.4 5.2L3 17.8V21h3.2l6.3-6.3a4 4 0 0 0 5.2-5.4l-2.6 2.6-2.5-.6-.6-2.5z',
  library: 'M4 4h4v16H4zM10 4h4v16h-4zM16.5 4.5l3.8 1-3.9 14.5-3.8-1',
  settings: 'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM19.4 13a7.6 7.6 0 0 0 0-2l2-1.6-2-3.4-2.4 1a7.3 7.3 0 0 0-1.7-1L15 3.5h-4l-.4 2.5a7.3 7.3 0 0 0-1.7 1l-2.4-1-2 3.4 2 1.6a7.6 7.6 0 0 0 0 2l-2 1.6 2 3.4 2.4-1c.5.4 1.1.8 1.7 1l.4 2.5h4l.4-2.5c.6-.2 1.2-.6 1.7-1l2.4 1 2-3.4z',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  back: 'M15 5l-7 7 7 7',
  forward: 'M9 5l7 7-7 7',
  chevronDown: 'M6 9l6 6 6-6',
  close: 'M6 6l12 12M18 6 6 18',
  check: 'M5 12.5l4.5 4.5L19 7',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v6M12 7.5v.01',
  warning: 'M12 3 2 20h20zM12 10v4.5M12 17.5v.01',
  error: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9 9l6 6M15 9l-6 6',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4',
  star: 'M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z',
  menu: 'M4 7h16M4 12h16M4 17h16',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  speaker: 'M7 3h10v18H7zM12 16.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM12 7.5v.01',
  sub: 'M4 5h16v14H4zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  listener: 'M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  measure: 'M12 3v4M12 17v4M5 12H3M21 12h-2M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  analysis: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  advice: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z',
  model: 'M3 7l9-4 9 4-9 4zM3 7v10l9 4 9-4V7M12 11v10',
  edit: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  copy: 'M8 8h12v12H8zM4 16V4h12',
  download: 'M12 3v12M7 10l5 5 5-5M4 19h16',
  upload: 'M12 21V9M7 14l5-5 5 5M4 5h16',
  lock: 'M6 11h12v10H6zM8 11V7a4 4 0 0 1 8 0v4',
  unlock: 'M6 11h12v10H6zM8 11V7a4 4 0 0 1 7.5-2',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  undo: 'M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
  redo: 'M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3',
  flask: 'M9 3h6M10 3v6L4.5 19a1.5 1.5 0 0 0 1.3 2h12.4a1.5 1.5 0 0 0 1.3-2L14 9V3',
  compare: 'M8 3v18M16 3v18M3 8h5M16 16h5',
  play: 'M7 4v16l13-8z',
  stop: 'M6 6h12v12H6z',
  mic: 'M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zM5 11a7 7 0 0 0 14 0M12 18v3',
  wave: 'M2 12c2-6 4-6 6 0s4 6 6 0 4-6 6 0',
  panel: 'M5 3h14v18H5zM9 7h6M9 11h6M9 15h6',
  door: 'M5 21V3h11v18M16 21h3M12 12h.01',
  window: 'M4 4h16v16H4zM12 4v16M4 12h16',
  layers: 'M12 3 3 8l9 5 9-5zM3 13l9 5 9-5',
  history: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2',
  sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z',
  device: 'M7 2h10v20H7zM11 18h2',
  logo: 'M3 12c1.5-4 3-4 4.5 0s3 4 4.5 0 3-4 4.5 0 3 4 4.5 0M3 12h0',
} as const;

export type IconName = keyof typeof PATHS;
export const ICON_NAMES = Object.keys(PATHS) as IconName[];

export function Icon({ name, small, label, class: cls }: { name: IconName; small?: boolean; label?: string; class?: string }): JSX.Element {
  return (
    <svg
      class={['al-icon', small && 'al-icon--small', cls].filter(Boolean).join(' ')}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': 'true', focusable: 'false' })}
    >
      {label && <title>{label}</title>}
      <path d={PATHS[name]} />
    </svg>
  );
}
