import { useRef } from 'preact/hooks';
import type { Extension, Opening, Placement, Room, Vec3, Zone } from '../../core/types';
import { extensionBox } from '../../core/geometry';
import type { Heatmap } from '../../core/field';
import { fmt } from '../format';
import { S } from '../strings';

export interface PlanItem {
  id: string;
  kind: 'spk' | 'sub' | 'listener';
  pos: Vec3;
  label?: string;
}

export interface PlanMark {
  x: number;
  y: number;
  label: string;
  kind: 'best' | 'trap' | 'probe';
}

export interface WallMark {
  surface: 'left' | 'right' | 'front' | 'back';
  /** координата вдоль стены: для левой/правой — x (глубина), для передней/задней — y (ширина) */
  at: number;
}

interface Props {
  depth: number;
  width: number;
  placement?: Placement | null;
  items?: PlanItem[];
  seats?: Vec3[];
  zones?: Zone[];
  extensions?: Extension[];
  openings?: Opening[];
  listenerZone?: [number, number] | null;
  heatmap?: Heatmap | null;
  marks?: PlanMark[];
  wallMarks?: WallMark[];
  selectedId?: string | null;
  onMove?: (id: string, pos: { x: number; y: number }) => void;
  onSelect?: (id: string) => void;
  onTap?: (pos: { x: number; y: number }) => void;
  showDims?: boolean;
  label?: string;
}

const SNAP = 0.05;
const snap = (v: number) => Math.round(v / SNAP) * SNAP;

/**
 * План комнаты сверху, как архитектурный чертёж: передняя стена (с колонками) — сверху.
 * x комнаты (глубина) идёт вниз, y (ширина) — вправо. Элементы можно перетаскивать пальцем.
 */
export function PlanView(p: Props) {
  const { depth, width, showDims = true } = p;
  const W = 320;
  const pad = 30;
  // габариты с учётом смежных помещений
  const shape = { depth, width, height: 3 } as Room;
  const extBoxes = (p.extensions ?? []).map((e) => ({ e, b: extensionBox(shape, e) }));
  const bx0 = Math.min(0, ...extBoxes.map((x) => x.b.x0));
  const bx1 = Math.max(depth, ...extBoxes.map((x) => x.b.x1));
  const by0 = Math.min(0, ...extBoxes.map((x) => x.b.y0));
  const by1 = Math.max(width, ...extBoxes.map((x) => x.b.y1));
  const scale = Math.min((W - 2 * pad) / (by1 - by0), (W * 1.25 - 2 * pad) / (bx1 - bx0));
  const rw = width * scale;
  const rh = depth * scale;
  const H = (bx1 - bx0) * scale + pad + 46;
  const ox = (W - (by1 - by0) * scale) / 2 - by0 * scale;
  const oy = pad - bx0 * scale;
  const wall = 7;
  const X = (y: number) => ox + y * scale;
  const Y = (x: number) => oy + x * scale;
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<string | null>(null);
  const moved = useRef(false);

  const items: PlanItem[] = p.items ?? (p.placement
    ? [
        ...p.placement.sources.filter((s) => s.pos).map((s) => ({
          id: s.id, kind: (s.id.startsWith('sub') ? 'sub' : 'spk') as PlanItem['kind'], pos: s.pos,
        })),
        { id: 'listener', kind: 'listener' as const, pos: p.placement.listener },
      ]
    : []);
  const seats = p.seats ?? p.placement?.seats ?? [];
  const listener = items.find((i) => i.kind === 'listener');
  const spk = items.filter((i) => i.kind === 'spk');

  const toRoom = (e: PointerEvent | MouseEvent) => {
    const svg = svgRef.current!;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const q = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    return { x: (q.y - oy) / scale, y: (q.x - ox) / scale };
  };
  const clamp = (r: { x: number; y: number }) => ({
    x: Math.min(depth - 0.05, Math.max(0.05, snap(r.x))),
    y: Math.min(width - 0.05, Math.max(0.05, snap(r.y))),
  });

  const hm = p.heatmap;
  const top = hm ? heatTop(hm) : 0;
  const color = (v: number) => {
    if (!hm) return 'transparent';
    const t = top > hm.min ? Math.min(1, Math.max(0, (v - hm.min) / (top - hm.min))) : 0;
    return `hsl(${Math.round(160 - 145 * t)} 62% 48%)`;
  };

  const interactive = !!(p.onMove || p.onTap);
  return (
    <svg
      ref={svgRef}
      class={`plan${interactive ? ' plan--interactive' : ''}`}
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={p.label ?? `План комнаты ${fmt(depth, 2)} на ${fmt(width, 2)} м`}
      onPointerMove={(e) => {
        if (!drag.current || !p.onMove) return;
        moved.current = true;
        p.onMove(drag.current, clamp(toRoom(e)));
      }}
      onPointerUp={() => { drag.current = null; }}
      onPointerCancel={() => { drag.current = null; }}
      onClick={(e) => {
        if (moved.current) { moved.current = false; return; }
        if (!p.onTap) return;
        const r = toRoom(e);
        if (r.x < 0 || r.y < 0 || r.x > depth || r.y > width) return;
        p.onTap(r);
      }}
    >
      <defs>
        <pattern id="hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="5" class="plan__hatch" />
        </pattern>
        <pattern id="zonehatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
          <line x1="0" y1="0" x2="0" y2="6" class="plan__zonehatch" />
        </pattern>
      </defs>
      {extBoxes.map(({ e, b }) => (
        <g class="plan__ext">
          <rect x={X(b.y0)} y={Y(b.x0)} width={(b.y1 - b.y0) * scale} height={(b.x1 - b.x0) * scale} class="plan__ext-floor" />
          {extEdges(e, b).map((ed) => (
            <line x1={X(ed[1])} y1={Y(ed[0])} x2={X(ed[3])} y2={Y(ed[2])} class={ed[4] ? 'plan__ext-open' : 'plan__ext-wall'} />
          ))}
        </g>
      ))}
      <rect x={ox - wall} y={oy - wall} width={rw + 2 * wall} height={rh + 2 * wall} class="plan__wall" fill="url(#hatch)" />
      <rect x={ox} y={oy} width={rw} height={rh} class="plan__floor" />
      <rect x={ox - wall} y={oy - wall} width={rw + 2 * wall} height={wall} class="plan__front" />
      {[...(p.extensions ?? []).map((e) => ({ wall: e.wall, a0: e.arch.a0, a1: e.arch.a1, cls: 'plan__arch' })), ...(p.openings ?? []).map((o) => ({ wall: o.wall, a0: o.a0, a1: o.a1, cls: 'plan__gap' }))].map((g) => {
        const r =
          g.wall === 'right' ? { x: ox + rw - 1, y: Y(g.a0), w: wall + 2, h: (g.a1 - g.a0) * scale } :
          g.wall === 'left' ? { x: ox - wall - 1, y: Y(g.a0), w: wall + 2, h: (g.a1 - g.a0) * scale } :
          g.wall === 'back' ? { x: X(g.a0), y: oy + rh - 1, w: (g.a1 - g.a0) * scale, h: wall + 2 } :
          { x: X(g.a0), y: oy - wall - 1, w: (g.a1 - g.a0) * scale, h: wall + 2 };
        return <rect class={g.cls} x={r.x} y={r.y} width={Math.max(1, r.w)} height={Math.max(1, r.h)} />;
      })}
      <text x={ox + rw / 2} y={oy - wall - 6} class="plan__label" text-anchor="middle">{S.room.front}</text>

      {hm && (
        <g class="plan__heat">
          {Array.from(hm.scores).map((v, i) => {
            if (!Number.isFinite(v)) return null;
            const cx = hm.x0 + Math.floor(i / hm.ny) * hm.step;
            const cy = hm.y0 + (i % hm.ny) * hm.step;
            return (
              <rect
                x={X(cy - hm.step / 2)}
                y={Y(cx - hm.step / 2)}
                width={hm.step * scale + 0.4}
                height={hm.step * scale + 0.4}
                fill={color(v)}
                opacity={hm.allowed[i] ? 0.62 : 0.2}
              />
            );
          })}
        </g>
      )}

      {(p.zones ?? []).map((z) => (
        <g class={`plan__zone-rect is-${z.kind}`}>
          <rect x={X(z.y0)} y={Y(z.x0)} width={(z.y1 - z.y0) * scale} height={(z.x1 - z.x0) * scale} fill="url(#zonehatch)" />
          <rect x={X(z.y0)} y={Y(z.x0)} width={(z.y1 - z.y0) * scale} height={(z.x1 - z.x0) * scale} class="plan__zone-outline" />
          <text x={X((z.y0 + z.y1) / 2)} y={Y((z.x0 + z.x1) / 2) + 4} text-anchor="middle">{S.zones.short[z.kind]}</text>
        </g>
      ))}

      {p.listenerZone && (
        <rect x={ox + 4} y={Y(p.listenerZone[0])} width={rw - 8} height={Math.max(2, (p.listenerZone[1] - p.listenerZone[0]) * scale)} class="plan__zone" rx="6" />
      )}

      {showDims && (
        <g class="plan__dims">
          <line x1={ox} y1={oy + rh + wall + 12} x2={ox + rw} y2={oy + rh + wall + 12} />
          <text x={ox + rw / 2} y={oy + rh + wall + 25} text-anchor="middle">{fmt(width, 2)} м</text>
          <line x1={ox + rw + wall + 10} y1={oy} x2={ox + rw + wall + 10} y2={oy + rh} />
          <text x={ox + rw + wall + 14} y={oy + rh / 2} transform={`rotate(90 ${ox + rw + wall + 14} ${oy + rh / 2})`} text-anchor="middle">
            {fmt(depth, 2)} м
          </text>
        </g>
      )}

      {(p.wallMarks ?? []).map((m) => {
        const pos =
          m.surface === 'left' ? { x: ox - wall / 2, y: Y(m.at) } :
          m.surface === 'right' ? { x: ox + rw + wall / 2, y: Y(m.at) } :
          m.surface === 'front' ? { x: X(m.at), y: oy - wall / 2 } : { x: X(m.at), y: oy + rh + wall / 2 };
        return <circle class="plan__reflection" cx={pos.x} cy={pos.y} r="4.5" />;
      })}

      {listener && spk.length === 2 && (
        <polygon
          class="plan__triangle"
          points={`${X(spk[0].pos.y)},${Y(spk[0].pos.x)} ${X(spk[1].pos.y)},${Y(spk[1].pos.x)} ${X(listener.pos.y)},${Y(listener.pos.x)}`}
        />
      )}
      {listener && spk.length === 1 && (
        <line class="plan__triangle" x1={X(spk[0].pos.y)} y1={Y(spk[0].pos.x)} x2={X(listener.pos.y)} y2={Y(listener.pos.x)} />
      )}

      {seats.length > 1 && seats.map((s) => <circle class="plan__seat" cx={X(s.y)} cy={Y(s.x)} r="5" />)}

      {(p.marks ?? []).map((m) => (
        <g class={`plan__mark is-${m.kind}`}>
          <circle cx={X(m.y)} cy={Y(m.x)} r={m.kind === 'probe' ? 6 : 9} />
          {m.label && <text x={X(m.y)} y={Y(m.x) + 4} text-anchor="middle">{m.label}</text>}
        </g>
      ))}

      {items.map((it) => {
        const cx = X(it.pos.y);
        const cy = Y(it.pos.x);
        const sel = p.selectedId === it.id ? ' is-selected' : '';
        const start = (e: PointerEvent) => {
          if (!p.onMove && !p.onSelect) return;
          e.stopPropagation();
          (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
          drag.current = p.onMove ? it.id : null;
          moved.current = false;
          p.onSelect?.(it.id);
        };
        const common = { onPointerDown: start, 'data-id': it.id };
        if (it.kind === 'sub') {
          return (
            <g class={`plan__sub${sel}`} {...common}>
              <circle cx={cx} cy={cy} r="18" class="plan__hit" />
              <rect x={cx - 9} y={cy - 9} width="18" height="18" rx="3" />
              <circle cx={cx} cy={cy} r="5" />
              <text x={cx} y={cy + 22} text-anchor="middle">{it.label ?? `С${it.id.slice(3)}`}</text>
            </g>
          );
        }
        if (it.kind === 'listener') {
          return (
            <g class={`plan__listener${sel}`} {...common}>
              <circle cx={cx} cy={cy} r="18" class="plan__hit" />
              <circle cx={cx} cy={cy} r="8" />
              <circle cx={cx} cy={cy} r="2.5" class="plan__dot" />
            </g>
          );
        }
        const ang = listener ? (Math.atan2(Y(listener.pos.x) - cy, X(listener.pos.y) - cx) * 180) / Math.PI - 90 : 0;
        return (
          <g class={`plan__spk${sel}`} {...common}>
            <circle cx={cx} cy={cy} r="18" class="plan__hit" />
            <g transform={`translate(${cx} ${cy}) rotate(${ang})`}>
              <rect x="-8" y="-6" width="16" height="12" rx="2" />
              <path d="M -5 6 L 5 6 L 7 10 L -7 10 Z" />
            </g>
          </g>
        );
      })}
    </svg>
  );
}

/** Верх цветовой шкалы: 75-й процентиль, чтобы единичные плохие клетки у стен не «съедали» контраст. */
export function heatTop(hm: Heatmap): number {
  const v = Array.from(hm.scores).filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return hm.max;
  return Math.max(v[Math.floor(v.length * 0.75)], hm.min + 1);
}

/** Стороны смежного помещения (кроме стороны у комнаты): [x0, y0, x1, y1, открыта]. */
function extEdges(e: Extension, b: { x0: number; x1: number; y0: number; y1: number }): [number, number, number, number, boolean][] {
  const alongX = e.wall === 'left' || e.wall === 'right';
  const edges: [number, number, number, number, boolean][] = [];
  if (alongX) {
    edges.push([b.x0, b.y0, b.x0, b.y1, e.openStart], [b.x1, b.y0, b.x1, b.y1, e.openEnd]);
    const farY = e.wall === 'right' ? b.y1 : b.y0;
    edges.push([b.x0, farY, b.x1, farY, e.openFar]);
  } else {
    edges.push([b.x0, b.y0, b.x1, b.y0, e.openStart], [b.x0, b.y1, b.x1, b.y1, e.openEnd]);
    const farX = e.wall === 'back' ? b.x1 : b.x0;
    edges.push([farX, b.y0, farX, b.y1, e.openFar]);
  }
  return edges;
}

export function HeatLegend({ hm }: { hm: Heatmap }) {
  return (
    <div class="heat-legend">
      <span>{fmt(hm.min, 1)} дБ</span>
      <span class="heat-legend__bar" aria-hidden="true" />
      <span>≥ {fmt(heatTop(hm), 1)} дБ</span>
      <span class="muted small heat-legend__hint">{S.manual.legend}</span>
    </div>
  );
}
