const nf = (digits: number) =>
  new Intl.NumberFormat('ru-RU', { minimumFractionDigits: digits, maximumFractionDigits: digits });

const cache = new Map<number, Intl.NumberFormat>();
export function fmt(v: number, digits = 1): string {
  if (!Number.isFinite(v)) return '—';
  let f = cache.get(digits);
  if (!f) { f = nf(digits); cache.set(digits, f); }
  return f.format(v);
}

/** Со знаком «+» или «−»; знак — после округления до `digits`, чтобы не было «−0,0». */
export function fmtSigned(v: number, digits = 1): string {
  const r = Math.round(v * 10 ** digits) / 10 ** digits;
  return `${r > 0 ? '+' : r < 0 ? '−' : ''}${fmt(Math.abs(r), digits)}`;
}

export const fmtHz =(f: number) => (f >= 1000 ? `${fmt(f / 1000, f % 1000 ? 1 : 0)} к` : fmt(f, f < 100 ? 1 : 0));
export const fmtInt = (n: number) => new Intl.NumberFormat('ru-RU').format(Math.round(n));
