// Карточки метрик, таблицы, пары «название — значение», каркасные блоки страницы (V2-014).
import type { ComponentChildren } from 'preact';
import { Badge, type BadgeTone } from './feedback';

export type MetricTone = 'neutral' | 'good' | 'warning' | 'danger';

/** Метрика: неизвестное значение показывается прочерком с пояснением, а не нулём. */
export function MetricCard({ label, value, unit, note, tone = 'neutral', kind }: { label: string; value: string | null; unit?: string; note?: ComponentChildren; tone?: MetricTone; kind?: { tone: BadgeTone; label: string } }) {
  return (
    <div class={['al-metric', value === null && 'al-metric--missing', tone !== 'neutral' && `al-metric--${tone}`].filter(Boolean).join(' ')}>
      <div class="al-row al-row--between">
        <span class="al-metric__label">{label}</span>
        {kind && <Badge tone={kind.tone}>{kind.label}</Badge>}
      </div>
      <span class="al-metric__value">{value ?? '—'}{value !== null && unit && <span class="al-metric__unit">{unit}</span>}</span>
      {note && <span class="al-metric__note">{note}</span>}
    </div>
  );
}

export interface Column<R> { key: string; title: string; numeric?: boolean; render: (row: R) => ComponentChildren }

export function DataTable<R>({ caption, columns, rows, rowKey, empty = 'Нет строк.' }: { caption: string; columns: readonly Column<R>[]; rows: readonly R[]; rowKey: (r: R) => string; empty?: string }) {
  return (
    <div class="al-table-wrap" role="region" aria-label={caption} tabIndex={0}>
      <table class="al-table">
        <caption class="al-visually-hidden">{caption}</caption>
        <thead><tr>{columns.map((c) => <th key={c.key} scope="col" class={c.numeric ? 'al-table__num' : undefined}>{c.title}</th>)}</tr></thead>
        <tbody>
          {rows.length ? rows.map((r) => <tr key={rowKey(r)}>{columns.map((c) => <td key={c.key} class={c.numeric ? 'al-table__num' : undefined}>{c.render(r)}</td>)}</tr>)
            : <tr><td colSpan={columns.length}>{empty}</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

export function KeyValue({ items }: { items: readonly [string, ComponentChildren][] }) {
  return <dl class="al-kv">{items.map(([k, v]) => [<dt key={`${k}-k`}>{k}</dt>, <dd key={`${k}-v`}>{v}</dd>])}</dl>;
}

export function Card({ title, subtitle, actions, children, muted, flush, as = 'section', id, class: cls }: { title?: ComponentChildren; subtitle?: ComponentChildren; actions?: ComponentChildren; children?: ComponentChildren; muted?: boolean; flush?: boolean; as?: 'section' | 'div' | 'article'; id?: string; class?: string }) {
  const Tag = as;
  return (
    <Tag id={id} class={['al-card', muted && 'al-card--muted', flush && 'al-card--flush', cls].filter(Boolean).join(' ')}>
      {(title || actions) && (
        <div class="al-card__head">
          <div class="al-stack al-stack--8">
            {title && <h3 class="al-card__title">{title}</h3>}
            {subtitle && <p class="al-card__subtitle">{subtitle}</p>}
          </div>
          {actions && <div class="al-row">{actions}</div>}
        </div>
      )}
      {children}
    </Tag>
  );
}

export function PageHead({ title, overline, text, actions }: { title: string; overline?: string; text?: ComponentChildren; actions?: ComponentChildren }) {
  return (
    <header class="al-page-head">
      <div class="al-page-head__text">
        {overline && <span class="al-text-overline">{overline}</span>}
        <h1 class="al-text-headline">{title}</h1>
        {text && <p class="al-text-secondary">{text}</p>}
      </div>
      {actions && <div class="al-row">{actions}</div>}
    </header>
  );
}

export function Section({ title, actions, children, id }: { title: string; actions?: ComponentChildren; children: ComponentChildren; id?: string }) {
  return (
    <section class="al-section" aria-labelledby={id ? `${id}-title` : undefined}>
      <div class="al-section__head">
        <h2 class="al-section__title" id={id ? `${id}-title` : undefined}>{title}</h2>
        {actions && <div class="al-row">{actions}</div>}
      </div>
      {children}
    </section>
  );
}
