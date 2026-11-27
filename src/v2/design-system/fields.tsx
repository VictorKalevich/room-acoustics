// Поля Acoustic Lab: текст, число с единицей, выбор, переключатель, флажок, сегменты, вкладки, ползунок.
// Число принимает запятую и точку; пустое поле — NaN (или null при optional); значение применяется по завершении ввода.
import type { ComponentChildren, TargetedEvent } from 'preact';
import { useEffect, useId, useRef, useState } from 'preact/hooks';
import { Icon } from './Icon';

interface FieldShell {
  label: string;
  hint?: string;
  error?: string | null;
  compact?: boolean;
  disabled?: boolean;
  hideLabel?: boolean;
}

function Shell({ id, label, hint, error, compact, disabled, hideLabel, children }: FieldShell & { id: string; children: ComponentChildren }) {
  return (
    <div class={['al-field', compact && 'al-field--compact', error && 'al-field--error', disabled && 'al-field--disabled'].filter(Boolean).join(' ')}>
      <label class={hideLabel ? 'al-visually-hidden' : 'al-field__label'} for={id}>{label}</label>
      {children}
      {error ? <span class="al-field__error" id={`${id}-err`} role="alert">{error}</span> : hint && <span class="al-field__hint" id={`${id}-hint`}>{hint}</span>}
    </div>
  );
}

const describedBy = (id: string, error?: string | null, hint?: string) => (error ? `${id}-err` : hint ? `${id}-hint` : undefined);

export interface TextFieldProps extends FieldShell {
  value: string;
  onInput: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  maxLength?: number;
  autoFocus?: boolean;
  type?: 'text' | 'search';
}

export function TextField({ value, onInput, placeholder, multiline, maxLength, autoFocus, type = 'text', ...shell }: TextFieldProps) {
  const id = useId();
  const common = {
    id, value, placeholder, maxLength, disabled: shell.disabled, autoFocus,
    'aria-invalid': !!shell.error || undefined, 'aria-describedby': describedBy(id, shell.error, shell.hint),
    onInput: (e: TargetedEvent<HTMLInputElement | HTMLTextAreaElement>) => onInput(e.currentTarget.value),
  };
  return (
    <Shell id={id} {...shell}>
      <div class="al-field__box">{multiline ? <textarea {...common} /> : <input {...common} type={type} list={undefined} />}</div>
    </Shell>
  );
}

/** Разбор числа: запятая и точка как разделитель, пробелы игнорируются. Пустая строка — NaN. */
export function parseNumber(text: string): number {
  const t = text.replace(/\s| /g, '').replace(',', '.').replace('−', '-');
  if (!t || !/^-?(\d+\.?\d*|\.\d+)$/.test(t)) return NaN;
  return Number(t);
}

export function formatNumber(v: number | null, decimals = 2): string {
  if (v === null || !Number.isFinite(v)) return '';
  const fixed = Number(v.toFixed(decimals));
  return String(fixed).replace('.', ',');
}

export interface NumberFieldProps extends FieldShell {
  value: number | null;
  onCommit: (v: number) => void;
  unit?: string;
  min?: number;
  max?: number;
  decimals?: number;
  /** Пустое поле допустимо: передаётся NaN, вызывающий решает, что это значит. */
  optional?: boolean;
  placeholder?: string;
}

export function NumberField({ value, onCommit, unit, min, max, decimals = 2, optional, placeholder, ...shell }: NumberFieldProps) {
  const id = useId();
  const [text, setText] = useState(formatNumber(value, decimals));
  const [local, setLocal] = useState<string | null>(null);
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setText(formatNumber(value, decimals)); }, [value, decimals]);
  const check = (t: string): string | null => {
    const v = parseNumber(t);
    if (!t.trim()) return optional ? null : 'Введите число.';
    if (!Number.isFinite(v)) return 'Введите число, например 2,5.';
    if (min !== undefined && v < min) return `Не меньше ${formatNumber(min, decimals)}${unit ? ` ${unit}` : ''}.`;
    if (max !== undefined && v > max) return `Не больше ${formatNumber(max, decimals)}${unit ? ` ${unit}` : ''}.`;
    return null;
  };
  const commit = () => {
    focused.current = false;
    const err = check(text);
    setLocal(err);
    if (err) return;
    const v = parseNumber(text);
    if (!(Number.isNaN(v) && value === null) && v !== value) onCommit(v);
    setText(formatNumber(Number.isFinite(v) ? v : null, decimals));
  };
  const error = shell.error ?? local;
  return (
    <Shell id={id} {...shell} error={error}>
      <div class="al-field__box">
        <input
          id={id}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={text}
          placeholder={placeholder}
          disabled={shell.disabled}
          aria-invalid={!!error || undefined}
          aria-describedby={describedBy(id, error, shell.hint)}
          onFocus={() => { focused.current = true; }}
          onInput={(e) => { setText(e.currentTarget.value); if (local) setLocal(check(e.currentTarget.value)); }}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur(); }}
        />
        {unit && <span class="al-field__unit" aria-hidden="true">{unit}</span>}
      </div>
    </Shell>
  );
}

export interface Option<T extends string> { value: T; label: string; disabled?: boolean }

export interface SelectFieldProps<T extends string> extends FieldShell {
  value: T;
  options: readonly Option<T>[];
  onChange: (v: T) => void;
}

export function SelectField<T extends string>({ value, options, onChange, ...shell }: SelectFieldProps<T>) {
  const id = useId();
  return (
    <Shell id={id} {...shell}>
      <div class="al-field__box">
        <select id={id} value={value} disabled={shell.disabled} aria-describedby={describedBy(id, shell.error, shell.hint)} onChange={(e) => onChange(e.currentTarget.value as T)}>
          {options.map((o) => <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>)}
        </select>
        <span class="al-field__chevron" aria-hidden="true"><Icon name="chevronDown" small /></span>
      </div>
    </Shell>
  );
}

export function Switch({ checked, onChange, label, disabled, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean; hint?: string }) {
  return (
    <button type="button" role="switch" class="al-switch" aria-checked={checked} aria-disabled={disabled || undefined} onClick={() => !disabled && onChange(!checked)}>
      <span class="al-switch__track" aria-hidden="true"><span class="al-switch__thumb" /></span>
      <span class="al-stack al-stack--8">
        <span>{label}</span>
        {hint && <span class="al-field__hint">{hint}</span>}
      </span>
    </button>
  );
}

export function Checkbox({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <label class="al-check">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.currentTarget.checked)} />
      <span>{label}</span>
    </label>
  );
}

/** Перемещение выбора стрелками по кругу, Home и End — для групп переключателей и вкладок. */
export function rovingIndex(key: string, i: number, n: number): number | null {
  if (key === 'ArrowRight' || key === 'ArrowDown') return (i + 1) % n;
  if (key === 'ArrowLeft' || key === 'ArrowUp') return (i - 1 + n) % n;
  if (key === 'Home') return 0;
  if (key === 'End') return n - 1;
  return null;
}

export function SegmentedControl<T extends string>({ value, options, onChange, label, block }: { value: T; options: readonly Option<T>[]; onChange: (v: T) => void; label: string; block?: boolean }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const enabled = options.filter((o) => !o.disabled);
  return (
    <div class={['al-segmented', block && 'al-segmented--block'].filter(Boolean).join(' ')} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          ref={(el) => { refs.current[options.indexOf(o)] = el; }}
          type="button"
          role="radio"
          class="al-segmented__item"
          aria-checked={o.value === value}
          tabIndex={o.value === value ? 0 : -1}
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
          onKeyDown={(e) => {
            const i = enabled.indexOf(o);
            const next = rovingIndex(e.key, i, enabled.length);
            if (next === null) return;
            e.preventDefault();
            onChange(enabled[next].value);
            refs.current[options.indexOf(enabled[next])]?.focus();
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export interface TabItem<T extends string> { id: T; label: string }

export function Tabs<T extends string>({ value, tabs, onChange, label, idPrefix }: { value: T; tabs: readonly TabItem<T>[]; onChange: (v: T) => void; label: string; idPrefix: string }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  return (
    <div class="al-tabs" role="tablist" aria-label={label}>
      {tabs.map((t, i) => (
        <button
          key={t.id}
          ref={(el) => { refs.current[i] = el; }}
          type="button"
          role="tab"
          id={`${idPrefix}-tab-${t.id}`}
          aria-controls={`${idPrefix}-panel`}
          aria-selected={t.id === value}
          tabIndex={t.id === value ? 0 : -1}
          class="al-tabs__tab"
          onClick={() => onChange(t.id)}
          onKeyDown={(e) => {
            const next = rovingIndex(e.key, i, tabs.length);
            if (next === null) return;
            e.preventDefault();
            onChange(tabs[next].id);
            refs.current[next]?.focus();
          }}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function TabPanel({ idPrefix, active, children }: { idPrefix: string; active: string; children: ComponentChildren }) {
  return <div role="tabpanel" id={`${idPrefix}-panel`} aria-labelledby={`${idPrefix}-tab-${active}`} tabIndex={0}>{children}</div>;
}

export function RangeField({ label, value, min, max, step, onInput, format }: { label: string; value: number; min: number; max: number; step: number; onInput: (v: number) => void; format: (v: number) => string }) {
  const id = useId();
  return (
    <div class="al-field">
      <div class="al-row al-row--between">
        <label class="al-field__label" for={id}>{label}</label>
        <span class="al-text-small al-num al-text-secondary">{format(value)}</span>
      </div>
      <input id={id} class="al-range" type="range" min={min} max={max} step={step} value={value} aria-valuetext={format(value)} onInput={(e) => onInput(Number(e.currentTarget.value))} />
    </div>
  );
}
