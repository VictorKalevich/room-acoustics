// Наложения на план и график событий Acoustic Lab (V2-031–V2-033): тепловая карта по узлам сетки, пути отражений
// и точки на плане (вид сверху), шкала карты и график событий по времени (расчётные отражения, ETC).
import { useState } from 'preact/hooks';
import { niceTicks, useWidth } from './charts';
import type { PlanMap } from './PlanView';

const fmt = (v: number, d = 1) => v.toFixed(d).replace('.', ',').replace('-', '−');

export const HEAT_LEVELS = 5;

/** Ступень шкалы карты: 0 — лучше всего, HEAT_LEVELS − 1 — хуже всего. */
export function heatLevel(v: number, min: number, max: number, lowerIsBetter = true): number {
  const t = max - min > 1e-9 ? (v - min) / (max - min) : 0;
  const k = Math.min(HEAT_LEVELS - 1, Math.max(0, Math.floor(t * HEAT_LEVELS)));
  return lowerIsBetter ? k : HEAT_LEVELS - 1 - k;
}

export interface HeatGrid {
  /** Первый узел по x (от передней стены) и y (от левой стены), шаг, м; значения — индекс ix·ny + iy, NaN — нет данных. */
  x0: number;
  y0: number;
  step: number;
  nx: number;
  ny: number;
  values: ArrayLike<number>;
  min: number;
  max: number;
  lowerIsBetter?: boolean;
}

/** Тепловая карта на плане сверху: ячейка вокруг узла сетки окрашена ступенью шкалы. */
export function PlanHeat({ map, grid }: { map: PlanMap; grid: HeatGrid }) {
  const cells = [];
  const s = grid.step * map.scale;
  for (let ix = 0; ix < grid.nx; ix++) {
    for (let iy = 0; iy < grid.ny; iy++) {
      const v = grid.values[ix * grid.ny + iy];
      if (!Number.isFinite(v)) continue;
      const [cx, cy] = map.at({ x: grid.x0 + ix * grid.step, y: grid.y0 + iy * grid.step });
      cells.push(<rect key={`${ix}-${iy}`} class={`al-plan__heat-cell al-plan__heat-cell--${heatLevel(v, grid.min, grid.max, grid.lowerIsBetter ?? true)}`} x={cx - s / 2} y={cy - s / 2} width={s} height={s} />);
    }
  }
  return <g class="al-plan__heat" aria-hidden="true">{cells}</g>;
}

/** Шкала тепловой карты: пять ступеней с границами значений. */
export function HeatLegend({ min, max, unit, lowerIsBetter = true, title }: { min: number; max: number; unit: string; lowerIsBetter?: boolean; title: string }) {
  const step = (max - min) / HEAT_LEVELS;
  const items = Array.from({ length: HEAT_LEVELS }, (_, k) => {
    const lo = min + k * step, hi = lo + step;
    return { level: heatLevel(lo + step / 2, min, max, lowerIsBetter), text: `${fmt(lo)}–${fmt(hi)} ${unit}` };
  }).sort((a, b) => a.level - b.level);
  return (
    <ul class="al-heat-legend" role="list" aria-label={title}>
      {items.map((it) => <li key={it.level}><span class={`al-heat-legend__swatch al-plan__heat-cell--${it.level}`} aria-hidden="true" />{it.text}{it.level === 0 ? ' · лучше' : it.level === HEAT_LEVELS - 1 ? ' · хуже' : ''}</li>)}
    </ul>
  );
}

export interface PlanPathPoint { x: number; y: number }

/** Путь на плане сверху (например, источник → точка отражения → слушатель); выбранный — толще. */
export function PlanPath({ map, points, selected = false, label }: { map: PlanMap; points: readonly PlanPathPoint[]; selected?: boolean; label: string }) {
  const d = points.map((p, i) => { const [u, v] = map.at(p); return `${i ? 'L' : 'M'}${u.toFixed(1)},${v.toFixed(1)}`; }).join('');
  const last = points.length > 2 ? map.at(points[Math.floor(points.length / 2)]) : null;
  return (
    <g class={`al-plan__path${selected ? ' al-plan__path--selected' : ''}`}>
      <title>{label}</title>
      <path d={d} />
      {last && <circle class="al-plan__path-point" cx={last[0]} cy={last[1]} r={selected ? 5 : 3.5} />}
    </g>
  );
}

export interface TimeEvent { id: string; t: number; db: number; label: string; direct?: boolean }

/**
 * График событий во времени: стойка на задержке (мс) высотой уровня относительно прямого звука (дБ). Прямой звук —
 * в нуле. Событие выбирается касанием или стрелками; выбранное — подсвечено и описано под графиком.
 */
export function EventChart({ title, events, selectedId, onSelect, tMax, dbMin = -30, height = 220 }: {
  title: string; events: readonly TimeEvent[]; selectedId?: string | null; onSelect?: (id: string | null) => void; tMax?: number; dbMin?: number; height?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [own, setOwn] = useState<string | null>(null);
  const sel = selectedId === undefined ? own : selectedId;
  const pick = (id: string | null) => { setOwn(id); onSelect?.(id); };
  const pad = { l: 44, r: 12, t: 12, b: 28 };
  const iw = Math.max(10, width - pad.l - pad.r), ih = height - pad.t - pad.b;
  const top = tMax ?? Math.max(5, ...events.map((e) => e.t)) * 1.1;
  const sx = (t: number) => pad.l + (t / top) * iw;
  const sy = (db: number) => pad.t + (Math.min(0, Math.max(dbMin, db)) / dbMin) * ih;
  const order = [...events].sort((a, b) => a.t - b.t);
  const current = order.find((e) => e.id === sel) ?? null;
  const xTicks = niceTicks(0, top, Math.max(3, Math.round(iw / 80))).filter((t) => t <= top);
  const yTicks = niceTicks(dbMin, 0, 4).filter((v) => v >= dbMin && v <= 0);
  return (
    <figure class="al-chart" ref={ref}>
      <svg class="al-chart__svg" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" tabindex={0}
        aria-label={`${title}. Время от 0 до ${fmt(top, 0)} мс, уровень от ${fmt(dbMin, 0)} до 0 дБ относительно прямого звука. Стрелки влево и вправо выбирают событие.`}
        onKeyDown={(e) => {
          if (!order.length) return;
          const i = current ? order.indexOf(current) : -1;
          if (e.key === 'ArrowRight') pick(order[Math.min(order.length - 1, i + 1)].id);
          else if (e.key === 'ArrowLeft') pick(order[Math.max(0, i - 1)].id);
          else if (e.key === 'Escape') pick(null);
          else return;
          e.preventDefault();
        }}>
        {yTicks.map((v) => (
          <g key={v}>
            <line class="al-chart__grid" x1={pad.l} x2={pad.l + iw} y1={sy(v)} y2={sy(v)} />
            <text class="al-chart__tick" x={pad.l - 6} y={sy(v) + 4} text-anchor="end">{fmt(v, 0)}</text>
          </g>
        ))}
        {xTicks.map((t) => (
          <g key={t}>
            <line class="al-chart__grid" x1={sx(t)} x2={sx(t)} y1={pad.t} y2={pad.t + ih} />
            <text class="al-chart__tick" x={sx(t)} y={height - 8} text-anchor="middle">{fmt(t, 0)}</text>
          </g>
        ))}
        <text class="al-chart__label" x={4} y={pad.t + 4}>дБ</text>
        <text class="al-chart__label" x={pad.l + iw} y={height - 8} text-anchor="end">мс</text>
        {order.map((e) => (
          <g key={e.id} class={['al-chart__stem', e.direct && 'al-chart__stem--direct', e.id === sel && 'al-chart__stem--selected'].filter(Boolean).join(' ')}
            onPointerDown={() => pick(e.id)}>
            <title>{e.label}</title>
            <line x1={sx(e.t)} x2={sx(e.t)} y1={pad.t + ih} y2={sy(e.db)} />
            <circle cx={sx(e.t)} cy={sy(e.db)} r={e.id === sel ? 5 : 3.5} />
          </g>
        ))}
      </svg>
      <div class="al-chart__readout" aria-live="polite">{current ? `${current.label}: ${fmt(current.t)} мс, ${fmt(current.db)} дБ` : ''}</div>
    </figure>
  );
}
