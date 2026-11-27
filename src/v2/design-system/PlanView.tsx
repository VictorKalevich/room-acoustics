// План помещения Acoustic Lab (V2-014, V2-024). Координаты комнаты — как в ядре (R01): x — от передней стены,
// y — от левой стены, z — от пола. Вид сверху: передняя стена вверху; сбоку: передняя стена слева; спереди: левая
// стена слева. Объект выбирается касанием или клавишей, перемещается перетаскиванием или стрелками (Shift — шаг 25 см).
import type { ComponentChildren } from 'preact';
import { useRef, useState } from 'preact/hooks';
import { useWidth } from './charts';

export type PlanItemType = 'source' | 'sub' | 'listener' | 'seat' | 'obstacle' | 'absorber' | 'bass-trap' | 'diffuser' | 'zone';
export type PlanViewKind = 'top' | 'side' | 'front';
export type WallSide = 'front' | 'back' | 'left' | 'right';

export interface PlanItem {
  id: string;
  type: PlanItemType;
  label: string;
  /** Центр объекта. */
  x: number;
  y: number;
  z?: number;
  /** Размеры по осям x, y, z; без них — точечный объект. */
  dx?: number;
  dy?: number;
  dz?: number;
  locked?: boolean;
  disabled?: boolean;
  /** Положение в другой конфигурации при сравнении: рисуется контуром, не выбирается. */
  ghost?: boolean;
}

export interface PlanOpening { id: string; wall: WallSide; a0: number; a1: number; bottom: number; top: number; closed: boolean; label: string }

/**
 * Пристройка за стеной основного прямоугольника (V2-046): часть комнаты сложной формы или смежная зона. Коробка в
 * координатах комнаты (может уходить в отрицательные), проход — участок стены `wall` от `a0` до `a1`.
 */
export interface PlanAnnex { id: string; x0: number; x1: number; y0: number; y1: number; height: number; wall: WallSide; a0: number; a1: number; label: string; part: boolean }

export interface PlanPoint { x?: number; y?: number; z?: number }

/** Перевод координат комнаты в координаты рисунка для наложений (`renderOverlay`): точка и масштаб, пикселей на метр. */
export interface PlanMap { at: (p: { x: number; y: number; z?: number }) => [number, number]; scale: number }

export interface PlanViewProps {
  title: string;
  depth: number;
  width: number;
  height: number;
  view?: PlanViewKind;
  items: readonly PlanItem[];
  openings?: readonly PlanOpening[];
  annexes?: readonly PlanAnnex[];
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  /** Новое положение центра: `final` — конец перетаскивания или шаг клавишей. */
  onMove?: (id: string, to: PlanPoint, final: boolean) => void;
  gridStep?: number;
  /** Привязка перетаскивания к сетке, м; 0 — шаг 1 см. Клавиши двигают на 5 и 25 см независимо от привязки. */
  snapStep?: number;
  children?: ComponentChildren;
  /** Наложение под объектами (карта, пути): получает перевод координат текущего вида. */
  renderOverlay?: (m: PlanMap) => ComponentChildren;
}

interface Axes { u: (p: { x: number; y: number; z: number }) => number; v: (p: { x: number; y: number; z: number }) => number; U: number; V: number; su: 'x' | 'y'; sv: 'x' | 'z'; du: 'dx' | 'dy'; dv: 'dx' | 'dy' | 'dz' }

export function axesFor(view: PlanViewKind, depth: number, width: number, height: number): Axes {
  if (view === 'side') return { u: (p) => p.x, v: (p) => height - p.z, U: depth, V: height, su: 'x', sv: 'z', du: 'dx', dv: 'dz' };
  if (view === 'front') return { u: (p) => p.y, v: (p) => height - p.z, U: width, V: height, su: 'y', sv: 'z', du: 'dy', dv: 'dz' };
  return { u: (p) => p.y, v: (p) => p.x, U: width, V: depth, su: 'y', sv: 'x', du: 'dy', dv: 'dx' };
}

const fmtM = (v: number) => `${v.toFixed(2).replace('.', ',')} м`;
const TYPE_NAME: Record<PlanItemType, string> = {
  source: 'колонка', sub: 'сабвуфер', listener: 'слушатель', seat: 'место', obstacle: 'интерьер', absorber: 'панель', 'bass-trap': 'басовая ловушка', diffuser: 'диффузор', zone: 'зона',
};

/** Пристройка в координатах вида; в виде сбоку и спереди — только выходящая за основную часть по горизонтали. */
function annexBox(view: PlanViewKind, a: PlanAnnex, height: number, U: number): { u0: number; u1: number; v0: number; v1: number } | null {
  if (view === 'top') return { u0: a.y0, u1: a.y1, v0: a.x0, v1: a.x1 };
  const [u0, u1] = view === 'side' ? [a.x0, a.x1] : [a.y0, a.y1];
  if (u0 >= -1e-6 && u1 <= U + 1e-6) return null;
  return { u0, u1, v0: height - a.height, v1: height };
}

export function PlanView({ title, depth, width, height, view = 'top', items, openings = [], annexes = [], selectedId, onSelect, onMove, gridStep = 0.5, snapStep = 0, children, renderOverlay }: PlanViewProps) {
  const [ref, cw] = useWidth<HTMLDivElement>();
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<{ id: string; du: number; dv: number } | null>(null);
  const ax = axesFor(view, depth, width, height);
  const boxes = annexes.flatMap((a) => { const b = annexBox(view, a, height, ax.U); return b ? [{ a, b }] : []; });
  const u0 = Math.min(0, ...boxes.map((x) => x.b.u0)), u1 = Math.max(ax.U, ...boxes.map((x) => x.b.u1));
  const v0 = Math.min(0, ...boxes.map((x) => x.b.v0)), v1 = Math.max(ax.V, ...boxes.map((x) => x.b.v1));
  const pad = 28;
  const maxH = typeof window === 'undefined' ? 480 : Math.max(240, window.innerHeight * 0.62);
  const scale = Math.max(10, Math.min((cw - pad * 2) / (u1 - u0), (maxH - pad * 2) / (v1 - v0)));
  const W = (u1 - u0) * scale + pad * 2, H = (v1 - v0) * scale + pad * 2;
  const pu = (u: number) => pad + (u - u0) * scale, pv = (v: number) => pad + (v - v0) * scale;
  const pos = (it: PlanItem) => ({ x: it.x, y: it.y, z: it.z ?? 0 });
  const toRoom = (clientX: number, clientY: number) => {
    const r = svgRef.current!.getBoundingClientRect();
    const u = ((clientX - r.left) * (W / r.width) - pad) / scale + u0;
    const v = ((clientY - r.top) * (H / r.height) - pad) / scale + v0;
    return { u, v };
  };
  const apply = (it: PlanItem, u: number, v: number, step = 0): PlanPoint => {
    const halfU = (it[ax.du] ?? 0) / 2, halfV = (it[ax.dv] ?? 0) / 2;
    const snap = (t: number) => (step > 0 ? Math.round(t / step) * step : t);
    const cu = Math.min(ax.U - halfU, Math.max(halfU, snap(u)));
    const cv = Math.min(ax.V - halfV, Math.max(halfV, ax.sv === 'z' ? height - snap(height - v) : snap(v)));
    const out: PlanPoint = {};
    out[ax.su] = round(cu);
    if (ax.sv === 'z') out.z = round(height - cv);
    else out.x = round(cv);
    return out;
  };
  const describe = (it: PlanItem) => {
    const p = pos(it);
    const coords = view === 'top' ? `x ${fmtM(p.x)}, y ${fmtM(p.y)}` : view === 'side' ? `x ${fmtM(p.x)}, высота ${fmtM(p.z)}` : `y ${fmtM(p.y)}, высота ${fmtM(p.z)}`;
    return `${it.label} (${TYPE_NAME[it.type]}): ${coords}${it.locked ? ', закреплён' : ''}${it.disabled ? ', не учитывается' : ''}`;
  };
  const gridU = [] as number[], gridV = [] as number[];
  for (let u = gridStep; u < ax.U - 1e-6; u += gridStep) gridU.push(u);
  for (let v = gridStep; v < ax.V - 1e-6; v += gridStep) gridV.push(v);
  const order: PlanItemType[] = ['zone', 'obstacle', 'absorber', 'bass-trap', 'diffuser', 'seat', 'sub', 'source', 'listener'];
  const sorted = [...items].sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));

  return (
    <div class="al-plan" ref={ref}>
      <svg
        ref={svgRef}
        class="al-plan__svg"
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        role="group"
        aria-label={`${title}. ${view === 'top' ? 'Вид сверху, передняя стена вверху' : view === 'side' ? 'Вид сбоку, передняя стена слева' : 'Вид спереди, левая стена слева'}. ${fmtM(ax.U)} × ${fmtM(ax.V)}.${annexes.length ? ` За стенами: ${annexes.map((a) => a.label).join(', ')}.` : ''}`}
        onPointerDown={(e) => { if (e.target === e.currentTarget || (e.target as Element).classList.contains('al-plan__floor')) onSelect?.(null); }}
        onPointerMove={(e) => {
          if (!drag || !onMove) return;
          const it = items.find((i) => i.id === drag.id);
          if (!it) return;
          const { u, v } = toRoom(e.clientX, e.clientY);
          onMove(it.id, apply(it, u - drag.du, v - drag.dv, snapStep), false);
        }}
        onPointerUp={(e) => {
          if (!drag || !onMove) { setDrag(null); return; }
          const it = items.find((i) => i.id === drag.id);
          if (it) {
            const { u, v } = toRoom(e.clientX, e.clientY);
            onMove(it.id, apply(it, u - drag.du, v - drag.dv, snapStep), true);
          }
          setDrag(null);
        }}
        onPointerCancel={() => setDrag(null)}
      >
        {boxes.map(({ a, b }) => (
          <rect key={`annex-${a.id}`} class={a.part ? 'al-plan__annex al-plan__annex--part' : 'al-plan__annex'} x={pu(b.u0)} y={pv(b.v0)} width={(b.u1 - b.u0) * scale} height={(b.v1 - b.v0) * scale}><title>{a.label}</title></rect>
        ))}
        <rect class="al-plan__floor" x={pu(0)} y={pv(0)} width={ax.U * scale} height={ax.V * scale} />
        {gridU.map((u) => <line key={`u${u}`} class="al-plan__grid" x1={pu(u)} x2={pu(u)} y1={pv(0)} y2={pv(ax.V)} />)}
        {gridV.map((v) => <line key={`v${v}`} class="al-plan__grid" x1={pu(0)} x2={pu(ax.U)} y1={pv(v)} y2={pv(v)} />)}
        {view === 'top' && <line class="al-plan__wall-front" x1={pu(0)} x2={pu(ax.U)} y1={pv(0)} y2={pv(0)}><title>Передняя стена</title></line>}
        {view === 'side' && <line class="al-plan__wall-front" x1={pu(0)} x2={pu(0)} y1={pv(0)} y2={pv(ax.V)}><title>Передняя стена</title></line>}
        {view === 'top' && openings.map((o) => {
          const [x1, y1, x2, y2] = o.wall === 'front' ? [o.a0, 0, o.a1, 0] : o.wall === 'back' ? [o.a0, ax.V, o.a1, ax.V] : o.wall === 'left' ? [0, o.a0, 0, o.a1] : [ax.U, o.a0, ax.U, o.a1];
          return <line key={o.id} class={['al-plan__opening', o.closed && 'al-plan__opening--closed'].filter(Boolean).join(' ')} x1={pu(x1)} y1={pv(y1)} x2={pu(x2)} y2={pv(y2)}><title>{o.label}</title></line>;
        })}
        {view === 'top' && boxes.map(({ a }) => {
          const [x1, y1, x2, y2] = a.wall === 'front' ? [a.a0, 0, a.a1, 0] : a.wall === 'back' ? [a.a0, ax.V, a.a1, ax.V] : a.wall === 'left' ? [0, a.a0, 0, a.a1] : [ax.U, a.a0, ax.U, a.a1];
          return <line key={`pass-${a.id}`} class="al-plan__passage" x1={pu(x1)} y1={pv(y1)} x2={pu(x2)} y2={pv(y2)} />;
        })}
        {view !== 'top' && boxes.filter(({ a }) => a.part).map(({ a }) => {
          const u = a.wall === 'back' || a.wall === 'right' ? ax.U : 0;
          return <line key={`pass-${a.id}`} class="al-plan__passage" x1={pu(u)} y1={pv(height - a.height)} x2={pu(u)} y2={pv(height)} />;
        })}
        {boxes.map(({ a, b }) => (b.u1 - b.u0) * scale > 56 && (b.v1 - b.v0) * scale > 18 && (
          <text key={`annex-label-${a.id}`} class="al-plan__dim" x={pu((b.u0 + b.u1) / 2)} y={pv((b.v0 + b.v1) / 2) + 4} text-anchor="middle">{a.label}</text>
        ))}
        <text class="al-plan__dim" x={pu(ax.U / 2)} y={pad - 8} text-anchor="middle">{fmtM(ax.U)}</text>
        <text class="al-plan__dim" x={pad - 8} y={pv(ax.V / 2)} text-anchor="middle" transform={`rotate(-90 ${pad - 8} ${pv(ax.V / 2)})`}>{fmtM(ax.V)}</text>
        {renderOverlay?.({ at: (p) => [pu(ax.u({ z: 0, ...p })), pv(ax.v({ z: 0, ...p }))], scale })}
        {children}
        {sorted.map((it) => {
          const p = pos(it);
          const cx = pu(ax.u(p)), cy = pv(ax.v(p));
          const su = (it[ax.du] ?? 0) * scale, sv = (it[ax.dv] ?? 0) * scale;
          const point = !su || !sv;
          const r = it.type === 'sub' ? 10 : it.type === 'seat' ? 7 : 9;
          const cls = it.type === 'source' || it.type === 'sub' ? 'al-plan__source'
            : it.type === 'listener' ? 'al-plan__listener' : it.type === 'seat' ? 'al-plan__seat'
            : it.type === 'obstacle' ? 'al-plan__obstacle' : it.type === 'zone' ? 'al-plan__zone'
            : `al-plan__treatment${it.type === 'absorber' ? '' : ` al-plan__treatment--${it.type}`}${it.disabled ? ' al-plan__treatment--off' : ''}`;
          const shape = point
            ? (it.type === 'sub' ? <rect class={cls} x={cx - r} y={cy - r} width={r * 2} height={r * 2} rx={3} /> : <circle class={cls} cx={cx} cy={cy} r={r} />)
            : <rect class={cls} x={cx - su / 2} y={cy - sv / 2} width={su} height={sv} rx={3} />;
          if (it.ghost) return <g key={`ghost-${it.id}`} class="al-plan__ghost" aria-hidden="true">{point ? <circle class="al-plan__compare" cx={cx} cy={cy} r={r + 3} /> : <rect class="al-plan__compare" x={cx - su / 2} y={cy - sv / 2} width={su} height={sv} />}</g>;
          const hitR = Math.max(22, r + 8);
          const interactive = !!onSelect;
          return (
            <g
              key={it.id}
              class={['al-plan__object', it.id === selectedId && 'is-selected', it.locked && 'is-locked', drag?.id === it.id && 'is-dragging'].filter(Boolean).join(' ')}
              data-id={it.id}
              tabindex={interactive ? 0 : undefined}
              role={interactive ? 'button' : undefined}
              aria-pressed={interactive ? it.id === selectedId : undefined}
              aria-label={describe(it)}
              onPointerDown={(e) => {
                if (!interactive) return;
                e.stopPropagation();
                onSelect?.(it.id);
                if (it.locked || !onMove) return;
                (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
                svgRef.current?.setPointerCapture?.(e.pointerId);
                const { u, v } = toRoom(e.clientX, e.clientY);
                setDrag({ id: it.id, du: u - ax.u(p), dv: v - ax.v(p) });
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect?.(it.id); return; }
                if (e.key === 'Escape') { onSelect?.(null); return; }
                const step = e.shiftKey ? 0.25 : 0.05;
                const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
                if (!d || it.locked || !onMove) return;
                e.preventDefault();
                onMove(it.id, apply(it, ax.u(p) + d[0], ax.v(p) + d[1]), true);
              }}
            >
              {point ? <circle class="al-plan__hit" cx={cx} cy={cy} r={hitR} /> : <rect class="al-plan__hit" x={cx - su / 2 - 4} y={cy - sv / 2 - 4} width={su + 8} height={sv + 8} rx={4} />}
              {shape}
              {(point || su > 40) && <text class="al-plan__label" x={cx} y={point ? (cy - r - 20 < pv(0) ? cy + r + 14 : cy - r - 6) : cy + 4} text-anchor="middle">{it.label}</text>}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

const round = (v: number) => Math.round(v * 100) / 100;

export function PlanLegend({ types }: { types: readonly ('source' | 'listener' | 'absorber' | 'bass-trap' | 'diffuser' | 'interior')[] }) {
  const names = { source: 'Колонки и сабвуферы', listener: 'Слушатели', absorber: 'Поглощающие панели', 'bass-trap': 'Басовые ловушки', diffuser: 'Диффузоры', interior: 'Интерьер' };
  return (
    <ul class="al-plan-legend" role="list" aria-label="Обозначения плана">
      {types.map((t) => <li key={t}><span class={`al-plan-legend__swatch al-plan-legend__swatch--${t}`} aria-hidden="true" />{names[t]}</li>)}
    </ul>
  );
}
