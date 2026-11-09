// Подтверждение необратимого действия: шторка снизу, как у пояснений терминов.
import { useEffect, useRef } from 'preact/hooks';
import { useSheetLock } from '../sheetLock';

interface Props {
  title: string;
  text: string;
  confirm: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmSheet({ title, text, confirm, onConfirm, onCancel }: Props) {
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
        <div class="btn-row sheet__actions">
          <button type="button" class="btn" ref={cancelRef} onClick={onCancel}>Отмена</button>
          <button type="button" class="btn btn--danger" onClick={onConfirm}>{confirm}</button>
        </div>
      </div>
    </div>
  );
}
