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

/**
 * Имя файла экспорта шумомера (054, UX-001): название пользователя без префикса, недопустимые символы заменены;
 * без названия — «noise-ГГГГ-ММ-ДД-ЧЧММ» по началу записи.
 */
export function noiseFileName(name: string, startMs: number | null, now = Date.now()) {
  const safe = name.trim().replace(/\.json$/i, '').replace(/[^\p{L}\p{N}._ -]+/gu, '-').slice(0, 80).replace(/^[.\s-]+|[.\s-]+$/g, '');
  if (safe) return safe + '.json';
  const d = new Date(startMs ?? now), pad = (n: number) => String(n).padStart(2, '0');
  return `noise-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.json`;
}

/** Время аудиошкалы шумомера (055): «м:сс» или «ч:мм:сс». */
export function fmtClock(seconds: number) {
  const s = Math.max(0, Math.round(seconds)), pad = (n: number) => String(n).padStart(2, '0');
  const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60);
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}
