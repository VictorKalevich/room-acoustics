import { useEffect, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { fmt } from '../format';

interface NumberFieldProps {
  label: string;
  value: number;
  onChange: (v: number) => void;
  unit?: string;
  min: number;
  max: number;
  digits?: number;
  hint?: string;
  id?: string;
  compact?: boolean;
}

/** Числовое поле: принимает запятую и точку, проверяет диапазон, не мешает вводу. */
export function NumberField(p: NumberFieldProps) {
  const digits = p.digits ?? 2;
  const [text, setText] = useState(fmtPlain(p.value, digits));
  const [error, setError] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setText(fmtPlain(p.value, digits));
  }, [p.value, focused, digits]);

  const commit = (s: string) => {
    const v = Number(s.replace(',', '.').replace(/\s/g, ''));
    if (s.trim() === '' || !Number.isFinite(v)) {
      setError('Введите число');
      return;
    }
    if (v < p.min || v > p.max) {
      setError(`От ${fmt(p.min, digits > 0 ? undefinedDigits(p.min) : 0)} до ${fmt(p.max, undefinedDigits(p.max))}${p.unit ? ' ' + p.unit : ''}`);
      return;
    }
    setError(null);
    if (v !== p.value) p.onChange(v);
  };

  const id = p.id ?? `f-${p.label.replace(/\s+/g, '-')}`;
  return (
    <div class={`field${p.compact ? ' field--compact' : ''}${error ? ' field--error' : ''}`}>
      <label for={id}>{p.label}</label>
      <div class="field__box">
        <input
          id={id}
          inputMode="decimal"
          autocomplete="off"
          value={text}
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-err` : p.hint ? `${id}-hint` : undefined}
          onFocus={(e) => { setFocused(true); (e.target as HTMLInputElement).select(); }}
          onInput={(e) => {
            const s = (e.target as HTMLInputElement).value;
            setText(s);
            commit(s);
          }}
          onBlur={() => { setFocused(false); if (!error) setText(fmtPlain(p.value, digits)); }}
        />
        {p.unit && <span class="field__unit">{p.unit}</span>}
      </div>
      {error ? (
        <p class="field__error" id={`${id}-err`} role="alert">{error}</p>
      ) : p.hint ? (
        <p class="field__hint" id={`${id}-hint`}>{p.hint}</p>
      ) : null}
    </div>
  );
}

const undefinedDigits = (v: number) => (Number.isInteger(v) ? 0 : 1);

function fmtPlain(v: number, digits: number): string {
  if (!Number.isFinite(v)) return '';
  const s = Number(v.toFixed(digits)).toString();
  return s.replace('.', ',');
}

export function Segmented<T extends string | number>(p: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div class="field">
      <span class="field__label" id={`seg-${p.label}`}>{p.label}</span>
      <div class="segmented" role="radiogroup" aria-labelledby={`seg-${p.label}`}>
        {p.options.map((o) => (
          <button
            type="button"
            role="radio"
            aria-checked={o.value === p.value}
            class={o.value === p.value ? 'is-on' : ''}
            onClick={() => p.onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function SelectField(p: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  const id = `s-${p.label.replace(/\s+/g, '-')}`;
  return (
    <div class="field">
      <label for={id}>{p.label}</label>
      <div class="field__box field__box--select">
        <select id={id} value={p.value} onChange={(e) => p.onChange((e.target as HTMLSelectElement).value)}>
          {p.options.map((o) => (
            <option value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

export function Panel(p: { title?: string; children: ComponentChildren; id?: string; class?: string }) {
  return (
    <section class={`panel ${p.class ?? ''}`} id={p.id} aria-label={p.title}>
      {p.title && <h2 class="panel__title">{p.title}</h2>}
      {p.children}
    </section>
  );
}

export function Note(p: { children: ComponentChildren; tone?: 'warn' | 'info' | 'good' }) {
  return <p class={`note note--${p.tone ?? 'info'}`}>{p.children}</p>;
}

export function Details(p: { summary: string; children: ComponentChildren }) {
  return (
    <details class="details">
      <summary>{p.summary}</summary>
      <div class="details__body">{p.children}</div>
    </details>
  );
}
