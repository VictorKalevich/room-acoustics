// Журнал ошибок на устройстве: последние сбои (необработанные исключения, отказы промисов, ошибки
// расчётов в воркерах) копятся в localStorage, чтобы пользователь мог приложить их к отчёту о проблеме.
// Никуда сам не отправляется.

export type ErrKind = 'error' | 'rejection' | 'worker' | 'scan';

export interface ErrEntry {
  /** Время, ISO. */
  t: string;
  kind: ErrKind;
  msg: string;
  stack?: string;
  /** Экран (хеш адреса) в момент ошибки. */
  at?: string;
  /** Тип расчёта, имя файла и т. п. */
  ctx?: string;
}

export const ERRLOG_KEY = 'ra-errors';
export const ERRLOG_MAX = 40;
const STACK_MAX = 1500;
const MSG_MAX = 500;

function store(): Storage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}

export function readErrors(): ErrEntry[] {
  const s = store();
  if (!s) return [];
  try {
    const v = JSON.parse(s.getItem(ERRLOG_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((e) => e && typeof e.msg === 'string') : [];
  } catch {
    return [];
  }
}

export function clearErrors() {
  try { store()?.removeItem(ERRLOG_KEY); } catch { /* недоступно — нечего чистить */ }
  notify();
}

const listeners = new Set<() => void>();
function notify() { for (const f of listeners) f(); }
/** Подписка на изменения журнала; возвращает отписку. */
export function onErrors(f: () => void): () => void {
  listeners.add(f);
  return () => { listeners.delete(f); };
}

function text(v: unknown): { msg: string; stack?: string } {
  if (v instanceof Error) return { msg: `${v.name && v.name !== 'Error' ? v.name + ': ' : ''}${v.message}`, stack: v.stack };
  if (typeof v === 'string') return { msg: v };
  try { return { msg: JSON.stringify(v) ?? String(v) }; } catch { return { msg: String(v) }; }
}

/** Записывает ошибку. Подряд одинаковые не дублируются (счётчик в тексте не ведём — хватает времени последней). */
export function logError(kind: ErrKind, err: unknown, ctx?: string) {
  const s = store();
  if (!s) return;
  const { msg, stack } = text(err);
  const e: ErrEntry = {
    t: new Date().toISOString(),
    kind,
    msg: msg.slice(0, MSG_MAX),
    ...(stack ? { stack: stack.slice(0, STACK_MAX) } : {}),
    ...(typeof location !== 'undefined' && location.hash ? { at: location.hash.slice(0, 40) } : {}),
    ...(ctx ? { ctx: ctx.slice(0, 120) } : {}),
  };
  const list = readErrors();
  const last = list[list.length - 1];
  if (last && last.msg === e.msg && last.kind === e.kind && last.ctx === e.ctx) list[list.length - 1] = e;
  else list.push(e);
  const trimmed = list.slice(-ERRLOG_MAX);
  try {
    s.setItem(ERRLOG_KEY, JSON.stringify(trimmed));
  } catch {
    // хранилище переполнено — оставляем последние несколько
    try { s.setItem(ERRLOG_KEY, JSON.stringify(trimmed.slice(-5))); } catch { /* сдаёмся молча */ }
  }
  notify();
}

let installed = false;
/** Ловит необработанные ошибки и отказы промисов страницы. */
export function installErrorLog(w: Window = window) {
  if (installed) return;
  installed = true;
  w.addEventListener('error', (ev) => {
    // ошибка загрузки ресурса (картинка, скрипт) приходит без error и message — пишем адрес
    const target = ev.target as HTMLElement | null;
    if (!ev.error && !ev.message && target && target !== (w as unknown as HTMLElement)) {
      const src = (target as HTMLImageElement).src || (target as HTMLLinkElement).href || target.tagName;
      logError('error', `Не загрузился ресурс: ${src}`);
      return;
    }
    logError('error', ev.error ?? ev.message, ev.filename ? `${ev.filename.split('/').pop()}:${ev.lineno}:${ev.colno}` : undefined);
  }, true);
  w.addEventListener('unhandledrejection', (ev) => {
    const r = ev.reason;
    // отмена пользователем (закрыл окно «Поделиться», остановил запись) — не ошибка
    if (r && typeof r === 'object' && (r as Error).name === 'AbortError') return;
    logError('rejection', r);
  });
}

export interface DeviceInfo {
  userAgent: string;
  platform?: string;
  language: string;
  screen: string;
  viewport: string;
  dpr: number;
  standalone: boolean;
  online: boolean;
  memoryGb?: number;
  cores?: number;
}

export function deviceInfo(): DeviceInfo {
  const n = navigator as Navigator & { deviceMemory?: number; standalone?: boolean };
  const standalone = n.standalone === true || (typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches);
  return {
    userAgent: n.userAgent,
    platform: (n as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? n.platform,
    language: n.language,
    screen: `${screen.width}×${screen.height}`,
    viewport: `${innerWidth}×${innerHeight}`,
    dpr: devicePixelRatio,
    standalone,
    online: n.onLine,
    ...(n.deviceMemory ? { memoryGb: n.deviceMemory } : {}),
    ...(n.hardwareConcurrency ? { cores: n.hardwareConcurrency } : {}),
  };
}

export interface ProblemReport {
  kind: 'room-acoustics-report';
  created: string;
  app: { build: string; sha: string };
  device: DeviceInfo;
  screen?: string;
  note?: string;
  errors: ErrEntry[];
  project?: unknown;
}

/** Отчёт о проблеме: версия, устройство, журнал ошибок и (по желанию) проект. */
export function buildReport(o: { build: { time: string; sha: string }; device: DeviceInfo; errors: ErrEntry[]; note?: string; project?: unknown; screen?: string }): ProblemReport {
  return {
    kind: 'room-acoustics-report',
    created: new Date().toISOString(),
    app: { build: o.build.time, sha: o.build.sha },
    device: o.device,
    ...(o.screen ? { screen: o.screen } : {}),
    ...(o.note?.trim() ? { note: o.note.trim().slice(0, 4000) } : {}),
    errors: o.errors,
    ...(o.project !== undefined ? { project: o.project } : {}),
  };
}

/** Имя файла отчёта: room-acoustics-report-2026-11-08-1712.json */
export function reportFileName(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `room-acoustics-report-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.json`;
}
