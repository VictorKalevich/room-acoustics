const nf = (digits: number) =>
  new Intl.NumberFormat('ru-RU', { minimumFractionDigits: digits, maximumFractionDigits: digits });

const cache = new Map<number, Intl.NumberFormat>();
export function fmt(v: number, digits = 1): string {
  if (!Number.isFinite(v)) return '—';
  let f = cache.get(digits);
  if (!f) { f = nf(digits); cache.set(digits, f); }
  return f.format(v);
}

export const fmtHz = (f: number) => (f >= 1000 ? `${fmt(f / 1000, f % 1000 ? 1 : 0)} к` : fmt(f, f < 100 ? 1 : 0));
export const fmtInt = (n: number) => new Intl.NumberFormat('ru-RU').format(Math.round(n));
