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

export interface PlanPoint { x?: number; y?: number; z?: number }

export interface PlanViewProps {
  title: string;
  depth: number;
  width: number;
  height: number;
  view?: PlanViewKind;
  items: readonly PlanItem[];
  openings?: readonly PlanOpening[];
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  /** Новое положение центра: `final` — конец перетаскивания или шаг клавишей. */
  onMove?: (id: string, to: PlanPoint, final: boolean) => void;
  gridStep?: number;
  /** Привязка перетаскивания к сетке, м; 0 — шаг 1 см. Клавиши двигают на 5 и 25 см независимо от привязки. */
  snapStep?: number;
  children?: ComponentChildren;
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

export function PlanView({ title, depth, width, height, view = 'top', items, openings = [], selectedId, onSelect, onMove, gridStep = 0.5, snapStep = 0, children }: PlanViewProps) {
  const [ref, cw] = useWidth<HTMLDivElement>();
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<{ id: string; du: number; dv: number } | null>(null);
  const ax = axesFor(view, depth, width, height);
  const pad = 28;
  const maxH = typeof window === 'undefined' ? 480 : Math.max(240, window.innerHeight * 0.62);
  const scale = Math.max(10, Math.min((cw - pad * 2) / ax.U, (maxH - pad * 2) / ax.V));
  const W = ax.U * scale + pad * 2, H = ax.V * scale + pad * 2;
  const pu = (u: number) => pad + u * scale, pv = (v: number) => pad + v * scale;
  const pos = (it: PlanItem) => ({ x: it.x, y: it.y, z: it.z ?? 0 });
  const toRoom = (clientX: number, clientY: number) => {
    const r = svgRef.current!.getBoundingClientRect();
    const u = ((clientX - r.left) * (W / r.width) - pad) / scale;
    const v = ((clientY - r.top) * (H / r.height) - pad) / scale;
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
        aria-label={`${title}. ${view === 'top' ? 'Вид сверху, передняя стена вверху' : view === 'side' ? 'Вид сбоку, передняя стена слева' : 'Вид спереди, левая стена слева'}. ${fmtM(ax.U)} × ${fmtM(ax.V)}.`}
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
        <rect class="al-plan__floor" x={pu(0)} y={pv(0)} width={ax.U * scale} height={ax.V * scale} />
        {gridU.map((u) => <line key={`u${u}`} class="al-plan__grid" x1={pu(u)} x2={pu(u)} y1={pv(0)} y2={pv(ax.V)} />)}
        {gridV.map((v) => <line key={`v${v}`} class="al-plan__grid" x1={pu(0)} x2={pu(ax.U)} y1={pv(v)} y2={pv(v)} />)}
        {view === 'top' && <line class="al-plan__wall-front" x1={pu(0)} x2={pu(ax.U)} y1={pv(0)} y2={pv(0)}><title>Передняя стена</title></line>}
        {view === 'side' && <line class="al-plan__wall-front" x1={pu(0)} x2={pu(0)} y1={pv(0)} y2={pv(ax.V)}><title>Передняя стена</title></line>}
        {view === 'top' && openings.map((o) => {
          const [x1, y1, x2, y2] = o.wall === 'front' ? [o.a0, 0, o.a1, 0] : o.wall === 'back' ? [o.a0, ax.V, o.a1, ax.V] : o.wall === 'left' ? [0, o.a0, 0, o.a1] : [ax.U, o.a0, ax.U, o.a1];
          return <line key={o.id} class={['al-plan__opening', o.closed && 'al-plan__opening--closed'].filter(Boolean).join(' ')} x1={pu(x1)} y1={pv(y1)} x2={pu(x2)} y2={pv(y2)}><title>{o.label}</title></line>;
        })}
        <text class="al-plan__dim" x={pu(ax.U / 2)} y={pad - 8} text-anchor="middle">{fmtM(ax.U)}</text>
        <text class="al-plan__dim" x={pad - 8} y={pv(ax.V / 2)} text-anchor="middle" transform={`rotate(-90 ${pad - 8} ${pv(ax.V / 2)})`}>{fmtM(ax.V)}</text>
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
