// Форматирование для экранов v2: русская запятая, единицы через неразрывный пробел, без ложной точности.
import type { Room, RoomConfiguration, SystemLayout } from '../domain/model';

const nf = (d: number) => new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: d });

export const num = (v: number, decimals = 2) => nf(decimals).format(v);
const comma = (s: string) => s.replace('.', ',').replace('-', '−');
/** Фиксированное число знаков — для таблиц и сравнения значений. */
export const n0 = (v: number) => comma(String(Math.round(v)));
export const n1 = (v: number) => comma(v.toFixed(1));
export const n2 = (v: number) => comma(v.toFixed(2));
export const n3 = (v: number) => comma(v.toFixed(3));
export const hz = (v: number) => `${v < 100 ? n1(v) : n0(v)} Гц`;
/** Частота во всём слышимом диапазоне: от 1 кГц — в килогерцах. */
export const freq = (v: number) => (v >= 1000 ? `${comma((v / 1000).toFixed(v >= 10000 ? 1 : 2))} кГц` : hz(v));

export const meters = (v: number, decimals = 2) => `${num(v, decimals)} м`;
export const cm = (v: number) => `${num(v * 100, 0)} см`;

export function dims(c: RoomConfiguration): { depth: number; width: number; height: number } | null {
  const g = c.geometry;
  return g.kind === 'rect' ? { depth: g.depth, width: g.width, height: g.height } : null;
}

export function dimsText(c: RoomConfiguration): string {
  const d = dims(c);
  return d ? `${num(d.depth)} × ${num(d.width)} × ${num(d.height)} м` : 'Сложная форма';
}

export function volumeText(c: RoomConfiguration): string | null {
  const d = dims(c);
  return d ? `${num(d.depth * d.width * d.height, 1)} м³` : null;
}

export const LAYOUT_LABEL: Record<SystemLayout, string> = {
  mono: 'Моно 1.0', '2.0': 'Стерео 2.0', '2.1': 'Стерео 2.1', '2.2': 'Стерео 2.2', '5.1': '5.1', custom: 'Произвольная',
};

export function systemText(c: RoomConfiguration): string {
  const speakers = c.audio.sources.filter((s) => s.kind !== 'sub').length;
  const subs = c.audio.sources.filter((s) => s.kind === 'sub').length;
  if (!speakers && !subs) return 'Нет источников';
  return `${LAYOUT_LABEL[c.audio.layout]}: ${speakers} кол. + ${subs} саб.`;
}

const dateFmt = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
export const dateTime = (iso: string) => { const t = Date.parse(iso); return Number.isFinite(t) ? dateFmt.format(t) : '—'; };

export const roomOriginText = (r: Room) => (r.origin.kind === 'migrated' ? 'Перенесена из прежней версии' : null);

/** Следующее свободное название «Комната N». */
export function nextRoomName(existing: readonly string[]): string {
  const used = new Set(existing.map((n) => n.trim().toLowerCase()));
  for (let i = 1; ; i++) if (!used.has(`комната ${i}`)) return `Комната ${i}`;
}
