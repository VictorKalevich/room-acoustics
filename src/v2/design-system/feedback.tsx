// Сообщения и состояния Acoustic Lab: метка вида результата, статус расчёта, сообщение, диалог подтверждения,
// шторка (панель свойств), уведомления, пустое состояние, загрузка, ошибка.
import type { ComponentChildren } from 'preact';
import { createContext } from 'preact';
import { useCallback, useContext, useEffect, useRef, useState } from 'preact/hooks';
import { Button, IconButton } from './Button';
import { Icon, type IconName } from './Icon';

export type BadgeTone = 'calculated' | 'measured' | 'estimated' | 'demo' | 'imported' | 'current' | 'experimental' | 'warning' | 'danger' | 'success' | 'neutral';

const BADGE_ICON: Partial<Record<BadgeTone, IconName>> = {
  calculated: 'analysis', measured: 'mic', estimated: 'info', demo: 'eye', imported: 'upload', current: 'home', experimental: 'flask',
  warning: 'warning', danger: 'error', success: 'check',
};

export function Badge({ tone = 'neutral', children, icon = true }: { tone?: BadgeTone; children: ComponentChildren; icon?: boolean }) {
  const name = BADGE_ICON[tone];
  return <span class={`al-badge al-badge--${tone}`}>{icon && name && <Icon name={name} small />}{children}</span>;
}

export type CalcState = 'idle' | 'queued' | 'running' | 'ready' | 'stale' | 'error' | 'unavailable';

const CALC_TEXT: Record<CalcState, string> = {
  idle: 'Не рассчитано', queued: 'В очереди', running: 'Считается', ready: 'Рассчитано', stale: 'Устарело — данные изменились',
  error: 'Ошибка расчёта', unavailable: 'Недоступно',
};

/** Статус расчёта: текст обязателен — состояние не передаётся одним цветом. */
export function CalcStatus({ state, progress, text, onRetry }: { state: CalcState; progress?: number; text?: string; onRetry?: () => void }) {
  return (
    <div class="al-stack al-stack--8" role="status" aria-live="polite">
      <span class={`al-status al-status--${state}`}>
        <span class="al-status__dot" aria-hidden="true" />
        <span>{text ?? CALC_TEXT[state]}{state === 'running' && progress !== undefined ? ` · ${Math.round(progress * 100)} %` : ''}</span>
        {onRetry && (state === 'error' || state === 'stale') && <Button small variant="ghost" icon="undo" onClick={onRetry}>{state === 'stale' ? 'Пересчитать' : 'Повторить'}</Button>}
      </span>
      {(state === 'running' || state === 'queued') && (
        <div class={['al-progress', progress === undefined && 'al-progress--indeterminate'].filter(Boolean).join(' ')} role="progressbar" aria-label={CALC_TEXT[state]} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress === undefined ? undefined : Math.round(progress * 100)}>
          <div class="al-progress__bar" style={progress === undefined ? undefined : { width: `${Math.round(progress * 100)}%` }} />
        </div>
      )}
    </div>
  );
}

export type NoticeTone = 'info' | 'warning' | 'danger' | 'success';
const NOTICE_ICON: Record<NoticeTone, IconName> = { info: 'info', warning: 'warning', danger: 'error', success: 'check' };

export function Notice({ tone = 'info', title, children, action }: { tone?: NoticeTone; title?: string; children?: ComponentChildren; action?: ComponentChildren }) {
  return (
    <div class={`al-notice al-notice--${tone}`} role={tone === 'danger' ? 'alert' : undefined}>
      <Icon name={NOTICE_ICON[tone]} />
      <div class="al-notice__body">
        {title && <span class="al-notice__title">{title}</span>}
        {children && <div>{children}</div>}
        {action && <div class="al-row">{action}</div>}
      </div>
    </div>
  );
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Модальный слой: фокус внутри, Esc закрывает, прокрутка страницы заблокирована, фокус возвращается после закрытия. */
function useModal(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current;
    const first = el?.querySelector<HTMLElement>('[data-autofocus]') ?? el?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); close.current(); return; }
      if (e.key !== 'Tab' || !el) return;
      const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (!items.length) return;
      const [a, b] = [items[0], items[items.length - 1]];
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); b.focus(); }
      else if (!e.shiftKey && document.activeElement === b) { e.preventDefault(); a.focus(); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = overflow;
      prev?.focus?.();
    };
  }, []);
  return ref;
}

export interface ConfirmProps {
  title: string;
  text?: ComponentChildren;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children?: ComponentChildren;
}

/** Диалог подтверждения: фокус сначала на отмене, чтобы Enter не выполнил опасное действие. */
export function ConfirmDialog({ title, text, confirmLabel, cancelLabel = 'Отмена', danger, busy, onConfirm, onCancel, children }: ConfirmProps) {
  const ref = useModal(onCancel);
  return (
    <div class="al-scrim" onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div ref={ref} class="al-dialog" role="alertdialog" aria-modal="true" aria-labelledby="v2-dialog-title" aria-describedby={text ? 'v2-dialog-text' : undefined}>
        <h2 class="al-dialog__title" id="v2-dialog-title">{title}</h2>
        {text && <div class="al-dialog__text" id="v2-dialog-text">{text}</div>}
        {children}
        <div class="al-dialog__actions">
          <Button data-autofocus onClick={onCancel}>{cancelLabel}</Button>
          <Button variant={danger ? 'danger' : 'primary'} busy={busy} onClick={onConfirm}>{confirmLabel}</Button>
        </div>
      </div>
    </div>
  );
}

export function Dialog({ title, onClose, children, actions }: { title: string; onClose: () => void; children: ComponentChildren; actions?: ComponentChildren }) {
  const ref = useModal(onClose);
  return (
    <div class="al-scrim" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} class="al-dialog" role="dialog" aria-modal="true" aria-labelledby="v2-dialog-title">
        <div class="al-row al-row--between al-row--nowrap">
          <h2 class="al-dialog__title" id="v2-dialog-title">{title}</h2>
          <IconButton icon="close" label="Закрыть" onClick={onClose} />
        </div>
        {children}
        {actions && <div class="al-dialog__actions">{actions}</div>}
      </div>
    </div>
  );
}

/** Шторка снизу на узком экране и панель справа на широком: свойства объекта, добавление объекта. */
export function Sheet({ title, onClose, children, modal = true }: { title: string; onClose: () => void; children: ComponentChildren; modal?: boolean }) {
  const ref = useModal(onClose);
  const body = (
    <div ref={ref} class="al-sheet" role="dialog" aria-modal={modal} aria-labelledby="v2-sheet-title">
      <div class="al-sheet__head">
        <h2 class="al-sheet__title" id="v2-sheet-title">{title}</h2>
        <IconButton icon="close" label="Закрыть" onClick={onClose} />
      </div>
      {children}
    </div>
  );
  return modal ? <div class="al-scrim" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>{body}</div> : body;
}

export interface ToastItem { id: number; text: string; action?: { label: string; run: () => void }; tone?: 'info' | 'error' }
interface ToastApi { show: (text: string, opts?: { action?: ToastItem['action']; tone?: ToastItem['tone']; ms?: number }) => void }
const ToastContext = createContext<ToastApi>({ show: () => undefined });
export const useToast = () => useContext(ToastContext);

export function ToastHost({ children }: { children: ComponentChildren }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const next = useRef(1);
  const show = useCallback<ToastApi['show']>((text, opts = {}) => {
    const id = next.current++;
    setItems((xs) => [...xs.slice(-2), { id, text, action: opts.action, tone: opts.tone }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), opts.ms ?? (opts.action ? 8000 : 4000));
  }, []);
  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <div class="al-toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div class="al-toast" key={t.id}>
            {t.tone === 'error' && <Icon name="error" />}
            <span class="al-toast__text">{t.text}</span>
            {t.action && <Button small variant="ghost" onClick={() => { t.action!.run(); setItems((xs) => xs.filter((x) => x.id !== t.id)); }}>{t.action.label}</Button>}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function EmptyState({ icon = 'info', title, text, action }: { icon?: IconName; title: string; text?: ComponentChildren; action?: ComponentChildren }) {
  return (
    <div class="al-state">
      <Icon name={icon} class="al-state__icon" />
      <p class="al-state__title">{title}</p>
      {text && <div class="al-state__text">{text}</div>}
      {action}
    </div>
  );
}

export function LoadingState({ text = 'Загрузка…' }: { text?: string }) {
  return (
    <div class="al-state" role="status" aria-live="polite">
      <div class="al-progress al-progress--indeterminate" aria-hidden="true"><div class="al-progress__bar" /></div>
      <p class="al-state__text">{text}</p>
    </div>
  );
}

export function ErrorState({ title = 'Не удалось показать раздел', text, onRetry }: { title?: string; text?: ComponentChildren; onRetry?: () => void }) {
  return (
    <div class="al-state al-state--error" role="alert">
      <Icon name="error" class="al-state__icon" />
      <p class="al-state__title">{title}</p>
      {text && <div class="al-state__text">{text}</div>}
      {onRetry && <Button icon="undo" onClick={onRetry}>Повторить</Button>}
    </div>
  );
}
