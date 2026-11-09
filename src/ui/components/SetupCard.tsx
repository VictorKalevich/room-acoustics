// Общие настройки расстановки (система, места, цель подбора) — над переключателем режима.
// Сворачивается, как «Что на плане», но выделена: это главное, что нужно задать. Состояние запоминается;
// в свёрнутом виде — сводка в одну-две строки.
import type { ComponentChildren } from 'preact';

const KEY_OPEN = 'ra-setup-open';

export function SetupCard({ title, summary, children }: { title: string; summary: string; children: ComponentChildren }) {
  let open = true;
  try { open = localStorage.getItem(KEY_OPEN) !== '0'; } catch { /* без хранилища — открыта */ }
  return (
    <details
      class="setup-card"
      open={open}
      onToggle={(e) => { try { localStorage.setItem(KEY_OPEN, (e.currentTarget as HTMLDetailsElement).open ? '1' : '0'); } catch { /* нет хранилища */ } }}
    >
      <summary class="setup-card__head">
        <span class="setup-card__title">{title}</span>
        <span class="setup-card__summary small">{summary}</span>
      </summary>
      <div class="setup-card__body">{children}</div>
    </details>
  );
}
