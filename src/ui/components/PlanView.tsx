import { useRef } from 'preact/hooks';
import type { Extension, Opening, Placement, Room, Vec3, WallFeature, WallId, Zone } from '../../core/types';
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
  /** Окна и закрытые двери — ориентиры на стенах. */
  features?: WallFeature[];
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
  /** Показывать под планом пояснение «Что на плане» (по умолчанию — да). */
  showKey?: boolean;
  /** Свои пояснения для отдельных обозначений (например, что значат номера в режиме сабвуфера). */
  keyNotes?: Partial<Record<KeyId, string>>;
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
  const feats = p.features ?? [];
  const H = (bx1 - bx0) * scale + pad + 46;
  const ox = (W - (by1 - by0) * scale) / 2 - by0 * scale;
  const oy = pad - bx0 * scale;
  const wall = 7;
  const X = (y: number) => ox + y * scale;
  const Y = (x: number) => oy + x * scale;
  /** Участок стены (в толщине стены) в координатах рисунка. */
  const wallRect = (w: WallId, a0: number, a1: number) =>
    w === 'right' ? { x: ox + rw - 1, y: Y(a0), w: wall + 2, h: (a1 - a0) * scale } :
    w === 'left' ? { x: ox - wall - 1, y: Y(a0), w: wall + 2, h: (a1 - a0) * scale } :
    w === 'back' ? { x: X(a0), y: oy + rh - 1, w: (a1 - a0) * scale, h: wall + 2 } :
    { x: X(a0), y: oy - wall - 1, w: (a1 - a0) * scale, h: wall + 2 };
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
  // какие обозначения есть на этом плане
  const keys: KeyId[] = ['front'];
  if (spk.length) keys.push('spk');
  if (items.some((i) => i.kind === 'sub')) keys.push('sub');
  if (listener) keys.push('listener');
  if (listener && spk.length) keys.push('triangle');
  if (seats.length > 1) keys.push('seats');
  if (hm) keys.push('heat');
  if ((p.marks ?? []).some((m) => m.kind === 'best')) keys.push('best');
  if ((p.marks ?? []).some((m) => m.kind === 'probe')) keys.push('probe');
  if ((p.wallMarks ?? []).length) keys.push('reflection');
  if ((p.marks ?? []).some((m) => m.kind === 'trap')) keys.push('trap');
  if (p.listenerZone) keys.push('listenerZone');
  if ((p.zones ?? []).length) keys.push('zone');
  if (feats.some((f) => f.kind === 'window')) keys.push('window');
  if (feats.some((f) => f.kind === 'door')) keys.push('door');
  if ((p.openings ?? []).length) keys.push('opening');
  if ((p.extensions ?? []).length) keys.push('arch', 'corridor');
  const { showKey = true } = p;
  return (
    <>
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
      {feats.map((f) => {
        const seg = wallRect(f.wall, f.a0, f.a1);
        if (f.kind === 'window') {
          const horiz = f.wall === 'front' || f.wall === 'back';
          return (
            <g class="plan__window">
              <rect x={seg.x} y={seg.y} width={Math.max(1, seg.w)} height={Math.max(1, seg.h)} />
              {horiz
                ? <line x1={seg.x} y1={seg.y + seg.h / 2} x2={seg.x + seg.w} y2={seg.y + seg.h / 2} />
                : <line x1={seg.x + seg.w / 2} y1={seg.y} x2={seg.x + seg.w / 2} y2={seg.y + seg.h} />}
            </g>
          );
        }
        // дверь: проём в стене, полотно и дуга открывания внутрь комнаты
        const L = (f.a1 - f.a0) * scale;
        const hinge =
          f.wall === 'front' ? { x: X(f.a0), y: oy } :
          f.wall === 'back' ? { x: X(f.a0), y: oy + rh } :
          f.wall === 'left' ? { x: ox, y: Y(f.a0) } : { x: ox + rw, y: Y(f.a0) };
        const inward = f.wall === 'front' ? [0, 1] : f.wall === 'back' ? [0, -1] : f.wall === 'left' ? [1, 0] : [-1, 0];
        const alongV = f.wall === 'front' || f.wall === 'back' ? [1, 0] : [0, 1];
        const leaf = { x: hinge.x + inward[0] * L, y: hinge.y + inward[1] * L };
        const end = { x: hinge.x + alongV[0] * L, y: hinge.y + alongV[1] * L };
        const sweep = (inward[0] * alongV[1] - inward[1] * alongV[0]) > 0 ? 1 : 0;
        return (
          <g class="plan__door">
            <rect class="plan__door-gap" x={seg.x} y={seg.y} width={Math.max(1, seg.w)} height={Math.max(1, seg.h)} />
            <line x1={hinge.x} y1={hinge.y} x2={leaf.x} y2={leaf.y} />
            <path d={`M ${leaf.x} ${leaf.y} A ${L} ${L} 0 0 ${sweep} ${end.x} ${end.y}`} class="plan__door-arc" />
          </g>
        );
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
    {showKey && <PlanKey keys={keys} notes={p.keyNotes} />}
    </>
  );
}

export type KeyId =
  | 'front' | 'spk' | 'sub' | 'listener' | 'triangle' | 'seats' | 'heat' | 'best' | 'probe'
  | 'reflection' | 'trap' | 'listenerZone' | 'zone' | 'window' | 'door' | 'opening' | 'arch' | 'corridor';

/** Маленький значок обозначения — теми же стилями, что и на плане. */
function KeyIcon({ id }: { id: KeyId }) {
  const g = (() => {
    switch (id) {
      case 'front': return <rect x="2" y="7" width="24" height="6" class="plan__front" />;
      case 'spk': return <g class="plan__spk"><g transform="translate(14 9)"><rect x="-8" y="-6" width="16" height="12" rx="2" /><path d="M -5 6 L 5 6 L 7 10 L -7 10 Z" /></g></g>;
      case 'sub': return <g class="plan__sub"><rect x="5" y="1" width="18" height="18" rx="3" /><circle cx="14" cy="10" r="5" /></g>;
      case 'listener': return <g class="plan__listener"><circle cx="14" cy="10" r="8" /><circle cx="14" cy="10" r="2.5" class="plan__dot" /></g>;
      case 'triangle': return <polygon class="plan__triangle" points="3,3 25,3 14,18" />;
      case 'seats': return <circle class="plan__seat" cx="14" cy="10" r="5" />;
      case 'heat': return <g><rect x="2" y="4" width="8" height="12" fill="hsl(160 62% 48%)" /><rect x="10" y="4" width="8" height="12" fill="hsl(88 62% 48%)" /><rect x="18" y="4" width="8" height="12" fill="hsl(15 62% 48%)" /></g>;
      case 'best': return <g class="plan__mark is-best"><circle cx="14" cy="10" r="9" /><text x="14" y="14" text-anchor="middle">1</text></g>;
      case 'probe': return <g class="plan__mark is-probe"><circle cx="14" cy="10" r="6" /></g>;
      case 'reflection': return <circle class="plan__reflection" cx="14" cy="10" r="4.5" />;
      case 'trap': return <g class="plan__mark is-trap"><circle cx="14" cy="10" r="7" /></g>;
      case 'listenerZone': return <rect class="plan__zone" x="2" y="3" width="24" height="14" rx="4" />;
      case 'zone': return <g class="plan__zone-rect"><rect x="3" y="3" width="22" height="14" fill="url(#keyhatch)" /><rect x="3" y="3" width="22" height="14" class="plan__zone-outline" /></g>;
      case 'window': return <g class="plan__window"><rect x="2" y="6" width="24" height="8" /><line x1="2" y1="10" x2="26" y2="10" /></g>;
      case 'door': return <g class="plan__door"><rect class="plan__door-gap" x="2" y="1" width="24" height="5" /><line x1="2" y1="6" x2="2" y2="19" /><path d="M 2 19 A 13 13 0 0 0 15 6" class="plan__door-arc" /></g>;
      case 'opening': return <rect class="plan__gap" x="2" y="6" width="24" height="8" />;
      case 'arch': return <rect class="plan__arch" x="2" y="6" width="24" height="8" />;
      case 'corridor': return <g class="plan__ext"><rect x="2" y="3" width="24" height="14" class="plan__ext-floor" /><line x1="2" y1="3" x2="26" y2="3" class="plan__ext-wall" /><line x1="26" y1="3" x2="26" y2="17" class="plan__ext-open" /></g>;
    }
  })();
  return (
    <svg class="plan-key__icon" viewBox="0 0 28 20" aria-hidden="true">
      <defs>
        <pattern id="keyhatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
          <line x1="0" y1="0" x2="0" y2="5" class="plan__zonehatch" />
        </pattern>
      </defs>
      {g}
    </svg>
  );
}

const KEY_OPEN = 'ra-plankey-open';

/** Пояснение «Что на плане»: только те обозначения, что есть на этом плане. Состояние (открыто/закрыто) запоминается. */
export function PlanKey({ keys, notes }: { keys: KeyId[]; notes?: Partial<Record<KeyId, string>> }) {
  let open = true;
  try { open = localStorage.getItem(KEY_OPEN) !== '0'; } catch { /* без хранилища — открыто */ }
  return (
    <details
      class="details plan-key"
      open={open}
      onToggle={(e) => { try { localStorage.setItem(KEY_OPEN, (e.currentTarget as HTMLDetailsElement).open ? '1' : '0'); } catch { /* нет хранилища */ } }}
    >
      <summary>{S.plan.keyTitle}</summary>
      <ul class="plan-key__list">
        {keys.map((k) => (
          <li class="plan-key__item">
            <KeyIcon id={k} />
            <span class="small">{notes?.[k] ?? S.plan.key[k]}</span>
          </li>
        ))}
      </ul>
    </details>
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
