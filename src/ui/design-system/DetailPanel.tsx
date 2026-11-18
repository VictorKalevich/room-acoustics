import type { ComponentChildren } from 'preact';
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { useSheetLock } from '../sheetLock';
import { useSectionVisible } from '../components/SectionVisibility';

/** A retained presentation surface. Opening it never owns or restarts an acoustic task. */
export function DetailPanel({ title, summary, children, open: controlled, onOpenChange }: { title: string; summary?: string; children: ComponentChildren; open?: boolean; onOpenChange?: (open: boolean) => void }) {
  const [local, setLocal] = useState(false);
  const open = controlled ?? local;
  const setOpen = useCallback((value: boolean) => { setLocal(value); onOpenChange?.(value); }, [onOpenChange]);
  const visible = useSectionVisible();
  const active = open && visible;
  const id = useId();
  const shell = useRef<HTMLDivElement>(null), body = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null), back = useRef<HTMLButtonElement>(null);
  useSheetLock(shell, body, active);
  useEffect(() => { if (!visible) setOpen(false); }, [visible, setOpen]);

  useLayoutEffect(() => {
    if (!active) return;
    const opener = trigger.current;
    back.current?.focus({ preventScroll: true });
    const key = (e: KeyboardEvent) => {
      // Existing confirmations / glossary sheets stay above this surface.
      if (document.querySelector('.sheet-backdrop')) return;
      const panels = [...document.querySelectorAll('.detail-page:not([hidden])')];
      if (panels[panels.length - 1] !== shell.current) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); }
      if (e.key === 'Tab') {
        const items = [...shell.current!.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary,[href],[tabindex="0"]')].filter(el => el.tabIndex >= 0 && el.checkVisibility());
        const first = items[0], last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); opener?.focus({ preventScroll: true }); };
  }, [active, setOpen]);
  return <div class="detail-entry">
    <button type="button" ref={trigger} class="setting-link" aria-expanded={active} aria-controls={id} onClick={() => setOpen(true)}>
      <span><strong>{title}</strong>{summary && <span class="small muted">{summary}</span>}</span><span aria-hidden="true">›</span>
    </button>
    <div ref={shell} id={id} class="detail-page" hidden={!active} role="dialog" aria-modal="true" aria-label={title}>
      <header class="detail-page__header"><button type="button" class="btn btn--ghost" ref={back} onClick={() => setOpen(false)}>← Назад</button><h2>{title}</h2></header>
      <div ref={body} class="detail-page__body"><div class="screen">{children}</div></div>
    </div>
  </div>;
}
