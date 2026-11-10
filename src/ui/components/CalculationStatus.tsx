import { Note } from './Fields';

/** Only presentation; calculation functions and their outputs are unchanged. */
export function CalculationStatus({ busy, error, stale, label = 'Пересчитываем…' }: {
  busy?: boolean; error?: string | null; stale?: string; label?: string;
}) {
  return <>
    {busy && <p class="progress-text small" role="status" aria-live="polite"><span class="spinner" aria-hidden="true" /> {label}</p>}
    {error && <div role="alert"><Note tone="warn">{error}</Note></div>}
    {!busy && stale && <Note tone="warn">{stale}</Note>}
  </>;
}
