import { useLayoutEffect, useId, useRef, useState } from 'preact/hooks';

/** Compact action picker with touch dismissal and keyboard navigation. */
export function ActionMenu({ label, actions }: {
  label: string;
  actions: { label: string; onSelect: () => void }[];
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const close = () => { setOpen(false); trigger.current?.focus(); };
  // Focus before paint: a delayed opening effect must not steal focus back after Escape.
  useLayoutEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  return (
    <div class="action-menu" ref={root} onBlur={(event) => {
      if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false);
    }} onKeyDown={(event) => {
      if (event.key === 'Escape' && open) { event.preventDefault(); close(); }
    }}>
      <button ref={trigger} type="button" class="btn" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined}
        onClick={() => setOpen(!open)} onKeyDown={(event) => {
          if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); }
        }}>{label}<span aria-hidden="true"> ▾</span></button>
      {open && <div ref={menu} id={id} role="menu" aria-label={label} class="action-menu__popup"
        onKeyDown={(event) => {
          if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button'));
          const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
            : (current + (event.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length;
          buttons[next]?.focus();
        }}>
        {actions.map(action => <button key={action.label} type="button" role="menuitem" tabIndex={-1}
          onClick={() => { close(); action.onSelect(); }}>{action.label}</button>)}
      </div>}
    </div>
  );
}
