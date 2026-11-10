/** Shared navigation for analysis, tuning and measurement workspaces. */
export function SectionNav<T extends string>({ label, value, options, onChange }: {
  label: string;
  value: T;
  options: { value: T; label: string; hint?: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <nav class={`section-nav${options.length === 4 ? ' section-nav--four' : ''}`} aria-label={label}>
      {options.map((option) => (
        <button key={option.value} type="button" class={value === option.value ? 'is-on' : ''}
          aria-current={value === option.value ? 'page' : undefined} onClick={() => onChange(option.value)}>
          <span>{option.label}</span>
          {option.hint && <small>{option.hint}</small>}
        </button>
      ))}
    </nav>
  );
}
