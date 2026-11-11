// Подтверждение действия: шторка снизу, как у пояснений терминов.
// 021: своя подпись отмены, третье действие («Не сохранять»), основной тон и содержимое (например, список).
import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { useSheetLock } from '../sheetLock';

interface Props {
  title: string;
  text: string;
  confirm: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** Подпись отмены (по умолчанию «Отмена»); отмена получает фокус и срабатывает по Escape. */
  cancel?: string;
  /** Третье действие между отменой и подтверждением. */
  extra?: { label: string; onClick: () => void };
  /** danger — необратимое действие (по умолчанию), primary — обычное подтверждение. */
  tone?: 'danger' | 'primary';
  children?: ComponentChildren;
}

export function ConfirmSheet({ title, text, confirm, onConfirm, onCancel, cancel = 'Отмена', extra, tone = 'danger', children }: Props) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const bd = useRef<HTMLDivElement>(null), sh = useRef<HTMLDivElement>(null);
  useSheetLock(bd, sh);
  useEffect(() => {
    cancelRef.current?.focus();
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [onCancel]);
  return (
    <div class="sheet-backdrop" ref={bd} onClick={onCancel}>
      <div class="sheet" ref={sh} role="alertdialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div class="sheet__head">
          <strong>{title}</strong>
        </div>
        <p class="small">{text}</p>
        {children}
        <div class="btn-row sheet__actions">
          <button type="button" class="btn" ref={cancelRef} onClick={onCancel}>{cancel}</button>
          {extra && <button type="button" class="btn" onClick={extra.onClick}>{extra.label}</button>}
          <button type="button" class={`btn ${tone === 'primary' ? 'btn--primary' : 'btn--danger'}`} onClick={onConfirm}>{confirm}</button>
        </div>
      </div>
    </div>
  );
}
