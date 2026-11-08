// Термин с пунктирным подчёркиванием: касание открывает короткое объяснение снизу экрана.
import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { TERM } from '../glossary';

let open: string | null = null;
const subs = new Set<(id: string | null) => void>();
export function showTerm(id: string | null) { open = id; subs.forEach((s) => s(open)); }

export function Term({ id, children }: { id: string; children: ComponentChildren }) {
  return (
    <button type="button" class="term" onClick={(e) => { e.stopPropagation(); showTerm(id); }} aria-haspopup="dialog">
      {children}
    </button>
  );
}

/** Нижняя шторка с объяснением (одна на приложение). */
export function TermSheet() {
  const [id, setId] = useState<string | null>(open);
  useEffect(() => { subs.add(setId); return () => { subs.delete(setId); }; }, []);
  const t = id ? TERM[id] : null;
  if (!t) return null;
  return (
    <div class="sheet-backdrop" onClick={() => showTerm(null)}>
      <div class="sheet" role="dialog" aria-modal="true" aria-label={t.title} onClick={(e) => e.stopPropagation()}>
        <div class="sheet__head">
          <strong>{t.title}</strong>
          <button type="button" class="sheet__close" aria-label="Закрыть" onClick={() => showTerm(null)}>×</button>
        </div>
        <p class="small">{t.text}</p>
      </div>
    </div>
  );
}
