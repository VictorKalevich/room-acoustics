// Графики Acoustic Lab (V2-014): частотная характеристика на логарифмической оси и столбцы по полосам.
// Рисуются в пикселях ширины контейнера (подписи не сжимаются на узком экране). Вид данных различается начертанием
// линии, маркером и подписью в легенде. Курсор — указателем и стрелками, значения — текстом под графиком.
import type { ComponentChildren, RefObject } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';

export type SeriesKind = 'measured' | 'predicted' | 'calculated' | 'current' | 'experimental' | 'target' | 'estimated' | 'demo' | 'imported';

export const SERIES_LABEL: Record<SeriesKind, string> = {
  measured: 'измерение', predicted: 'прогноз', calculated: 'расчёт', current: 'текущая', experimental: 'эксперимент',
  target: 'цель', estimated: 'оценка', demo: 'демонстрация', imported: 'импорт',
};

/** variant — несколько рядов одного вида (например, полосы кроссовера): цвет из палитры рядов, штрих — по виду. */
export type SeriesVariant = 2 | 3 | 4;
export interface Series { id: string; label: string; kind: SeriesKind; x: readonly number[]; y: readonly number[]; variant?: SeriesVariant }
const lineClass = (kind: SeriesKind, variant?: SeriesVariant) => `al-chart__line al-chart__line--${kind}${variant ? ` al-chart__line--v${variant}` : ''}`;

/** Ширина элемента; до первого измерения — запасная. */
export function useWidth<T extends HTMLElement>(fallback = 640): [RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setW(Math.max(200, Math.round(el.getBoundingClientRect().width) || fallback));
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [fallback]);
  return [ref, w];
}

const FREQ_TICKS = [10, 20, 31.5, 50, 63, 100, 125, 200, 250, 500, 1000, 2000, 4000, 5000, 10000, 20000];

export function formatHz(f: number): string {
  if (f >= 1000) return `${String(Number((f / 1000).toFixed(f >= 10000 ? 0 : 1))).replace('.', ',')} кГц`;
  return `${String(Number(f.toFixed(f < 100 ? 1 : 0))).replace('.', ',')} Гц`;
}
const tickHz = (f: number) => (f >= 1000 ? `${String(f / 1000).replace('.', ',')}k` : String(f).replace('.', ','));
const fmt = (v: number, d = 1) => (Number.isFinite(v) ? v.toFixed(d).replace('.', ',').replace('-', '−') : '—');

export function niceTicks(lo: number, hi: number, count = 5): number[] {
  const span = hi - lo || 1;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((s) => span / s <= count) ?? 10 * mag;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Number(v.toFixed(10)));
  return out;
}

/** Индекс ближайшей точки по частоте (x возрастает). */
export function nearestIndex(xs: readonly number[], x: number): number {
  let lo = 0, hi = xs.length - 1;
  if (hi < 0) return -1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] < x) lo = mid; else hi = mid;
  }
  return Math.abs(xs[lo] - x) <= Math.abs(xs[hi] - x) ? lo : hi;
}

export interface FrequencyChartProps {
  series: readonly Series[];
  fMin: number;
  fMax: number;
  yUnit?: string;
  yRange?: [number, number];
  title: string;
  /** Полосы на оси частот (например, полоса оценки или проблемные частоты). */
  bands?: readonly { f0: number; f1: number; label: string }[];
  /** Вертикальные отметки (моды). */
  marks?: readonly { f: number; label: string }[];
  height?: number;
  empty?: ComponentChildren;
}

export function FrequencyChart({ series, fMin, fMax, yUnit = 'дБ', yRange, title, bands = [], marks = [], height = 240, empty }: FrequencyChartProps) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [cursor, setCursor] = useState<number | null>(null);
  const pad = { l: 44, r: 12, t: 12, b: 28 };
  const iw = Math.max(10, width - pad.l - pad.r), ih = height - pad.t - pad.b;
  const visible = series.filter((s) => s.x.length > 1);
  const [y0, y1] = useMemo(() => {
    if (yRange) return yRange;
    let lo = Infinity, hi = -Infinity;
    for (const s of visible) s.x.forEach((x, i) => { if (x >= fMin && x <= fMax && Number.isFinite(s.y[i])) { lo = Math.min(lo, s.y[i]); hi = Math.max(hi, s.y[i]); } });
    if (!Number.isFinite(lo)) return [0, 1] as [number, number];
    const m = Math.max(3, (hi - lo) * 0.1);
    return [Math.floor((lo - m) / 5) * 5, Math.ceil((hi + m) / 5) * 5] as [number, number];
  }, [visible, fMin, fMax, yRange]);
  if (!visible.length) return <div class="al-chart__empty" ref={ref}>{empty ?? 'Нет данных для графика.'}</div>;
  const lx0 = Math.log10(fMin), lx1 = Math.log10(fMax);
  const sx = (f: number) => pad.l + ((Math.log10(f) - lx0) / (lx1 - lx0)) * iw;
  const sy = (v: number) => pad.t + (1 - (v - y0) / (y1 - y0 || 1)) * ih;
  const fx = (px: number) => 10 ** (lx0 + ((px - pad.l) / iw) * (lx1 - lx0));
  const path = (s: Series) => {
    let d = '';
    let pen = false;
    s.x.forEach((x, i) => {
      const v = s.y[i];
      if (x < fMin || x > fMax || !Number.isFinite(v)) { pen = false; return; }
      d += `${pen ? 'L' : 'M'}${sx(x).toFixed(1)},${sy(Math.min(y1, Math.max(y0, v))).toFixed(1)}`;
      pen = true;
    });
    return d;
  };
  // расстояние — до последней оставленной отметки, иначе на узком графике с широкой полосой пропадают все, кроме первой
  const ticks = FREQ_TICKS.filter((f) => f >= fMin && f <= fMax).reduce<number[]>((kept, f) => (kept.length && sx(f) - sx(kept[kept.length - 1]) <= 28 ? kept : [...kept, f]), []);
  const yTicks = niceTicks(y0, y1, Math.max(3, Math.round(ih / 48)));
  const main = visible[0];
  const ci = cursor === null ? -1 : cursor;
  const cf = ci >= 0 ? main.x[ci] : null;
  const readout = cf === null ? '' : `${formatHz(cf)}: ` + visible.map((s) => `${s.label} ${fmt(s.y[nearestIndex(s.x, cf)])} ${yUnit}`).join('; ');
  const move = (clientX: number, svg: SVGSVGElement) => {
    const r = svg.getBoundingClientRect();
    const f = fx(clientX - r.left);
    setCursor(nearestIndex(main.x, Math.min(fMax, Math.max(fMin, f))));
  };
  return (
    <figure class="al-chart" ref={ref}>
      <svg
        class="al-chart__svg"
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`${title}. Ось частот от ${formatHz(fMin)} до ${formatHz(fMax)}, уровень от ${fmt(y0, 0)} до ${fmt(y1, 0)} ${yUnit}. Стрелки влево и вправо показывают значения.`}
        tabindex={0}
        onPointerMove={(e) => move(e.clientX, e.currentTarget)}
        onPointerDown={(e) => move(e.clientX, e.currentTarget)}
        onPointerLeave={() => setCursor(null)}
        onBlur={() => setCursor(null)}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 10 : 1;
          if (e.key === 'ArrowRight') setCursor((c) => Math.min(main.x.length - 1, (c ?? nearestIndex(main.x, fMin)) + step));
          else if (e.key === 'ArrowLeft') setCursor((c) => Math.max(0, (c ?? nearestIndex(main.x, fMax)) - step));
          else return;
          e.preventDefault();
        }}
      >
        {bands.map((b) => <rect key={b.label} class="al-chart__band" x={sx(Math.max(fMin, b.f0))} y={pad.t} width={Math.max(1, sx(Math.min(fMax, b.f1)) - sx(Math.max(fMin, b.f0)))} height={ih}><title>{b.label}</title></rect>)}
        {yTicks.map((v) => (
          <g key={v}>
            <line class="al-chart__grid" x1={pad.l} x2={pad.l + iw} y1={sy(v)} y2={sy(v)} />
            <text class="al-chart__tick" x={pad.l - 6} y={sy(v) + 4} text-anchor="end">{fmt(v, 0)}</text>
          </g>
        ))}
        {ticks.map((f) => (
          <g key={f}>
            <line class="al-chart__grid" x1={sx(f)} x2={sx(f)} y1={pad.t} y2={pad.t + ih} />
            <text class="al-chart__tick" x={sx(f)} y={height - 8} text-anchor="middle">{tickHz(f)}</text>
          </g>
        ))}
        <text class="al-chart__label" x={4} y={pad.t + 4}>{yUnit}</text>
        {marks.filter((m) => m.f >= fMin && m.f <= fMax).map((m) => <line key={m.label} class="al-chart__cursor" x1={sx(m.f)} x2={sx(m.f)} y1={pad.t} y2={pad.t + ih}><title>{m.label}</title></line>)}
        {visible.map((s) => <path key={s.id} class={lineClass(s.kind, s.variant)} d={path(s)} data-kind={s.kind} />)}
        {cf !== null && (
          <g>
            <line class="al-chart__cursor" x1={sx(cf)} x2={sx(cf)} y1={pad.t} y2={pad.t + ih} />
            {visible.map((s) => {
              const v = s.y[nearestIndex(s.x, cf)];
              return Number.isFinite(v) ? <circle key={s.id} class={`al-chart__marker al-chart__marker--${s.kind}`} cx={sx(cf)} cy={sy(Math.min(y1, Math.max(y0, v)))} r={4} /> : null;
            })}
          </g>
        )}
      </svg>
      <Legend items={visible.map((s) => ({ label: s.label, kind: s.kind, variant: s.variant }))} />
      <div class="al-chart__readout" aria-live="polite">{readout}</div>
    </figure>
  );
}

export function Legend({ items }: { items: readonly { label: string; kind: SeriesKind; variant?: SeriesVariant }[] }) {
  return (
    <ul class="al-legend" role="list" aria-label="Обозначения">
      {items.map((it) => (
        <li class="al-legend__item" key={it.label}>
          <svg class="al-legend__swatch" viewBox="0 0 24 12" aria-hidden="true"><path class={lineClass(it.kind, it.variant)} d="M1 6H23" /></svg>
          <span>{it.label}{it.kind !== 'current' && it.kind !== 'experimental' && it.label.toLowerCase() !== SERIES_LABEL[it.kind] ? ` (${SERIES_LABEL[it.kind]})` : ''}</span>
        </li>
      ))}
    </ul>
  );
}

export interface BarSeries { id: string; label: string; kind: SeriesKind; values: readonly (number | null)[] }

/** Столбцы по категориям (например, время реверберации по октавам): у нескольких рядов — группы. */
export function BarChart({ categories, series, unit, title, height = 220 }: { categories: readonly string[]; series: readonly BarSeries[]; unit: string; title: string; height?: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const pad = { l: 40, r: 8, t: 12, b: 28 };
  const iw = Math.max(10, width - pad.l - pad.r), ih = height - pad.t - pad.b;
  const max = Math.max(0.1, ...series.flatMap((s) => s.values.filter((v): v is number => v !== null && Number.isFinite(v))));
  const yTicks = niceTicks(0, max * 1.1, 4);
  const top = yTicks[yTicks.length - 1] || max;
  const sy = (v: number) => pad.t + (1 - v / top) * ih;
  const gw = iw / categories.length;
  const bw = Math.min(28, (gw * 0.75) / series.length);
  return (
    <figure class="al-chart" ref={ref}>
      <svg class="al-chart__svg" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${title}: ${categories.map((c, i) => `${c} — ${series.map((s) => `${s.label} ${s.values[i] === null ? 'нет данных' : fmt(s.values[i]!, 2)}`).join(', ')}`).join('; ')} ${unit}`}>
        {yTicks.map((v) => (
          <g key={v}>
            <line class="al-chart__grid" x1={pad.l} x2={pad.l + iw} y1={sy(v)} y2={sy(v)} />
            <text class="al-chart__tick" x={pad.l - 6} y={sy(v) + 4} text-anchor="end">{fmt(v, v < 1 ? 1 : 0)}</text>
          </g>
        ))}
        <text class="al-chart__label" x={4} y={pad.t + 4}>{unit}</text>
        {categories.map((c, i) => (
          <g key={c}>
            {series.map((s, k) => {
              const v = s.values[i];
              if (v === null || !Number.isFinite(v)) return null;
              const x = pad.l + gw * i + (gw - bw * series.length) / 2 + k * bw;
              return <rect key={s.id} class={`al-chart__bar al-chart__bar--${s.kind}`} x={x + 1} y={sy(v)} width={Math.max(1, bw - 2)} height={Math.max(0, pad.t + ih - sy(v))} rx={2}><title>{`${c}: ${s.label} ${fmt(v, 2)} ${unit}`}</title></rect>;
            })}
            <text class="al-chart__tick" x={pad.l + gw * i + gw / 2} y={height - 8} text-anchor="middle">{c}</text>
          </g>
        ))}
        <line class="al-chart__axis" x1={pad.l} x2={pad.l + iw} y1={pad.t + ih} y2={pad.t + ih} />
      </svg>
      {series.length > 1 && <Legend items={series.map((s) => ({ label: s.label, kind: s.kind }))} />}
    </figure>
  );
}
