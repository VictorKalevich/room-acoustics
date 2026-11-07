import type { Placement } from '../../core/types';
import { fmt } from '../format';
import { S } from '../strings';

interface Props {
  depth: number;
  width: number;
  placement?: Placement | null;
  ghost?: Placement | null;
  /** Зона слушателя (м от передней стены). */
  zone?: [number, number] | null;
  showDims?: boolean;
}

/**
 * План комнаты сверху, как архитектурный чертёж: передняя стена (с колонками) — сверху.
 * x комнаты (глубина) идёт вниз, y (ширина) — вправо.
 */
export function PlanView({ depth, width, placement, ghost, zone, showDims = true }: Props) {
  const W = 320;
  const pad = 30;
  const scale = Math.min((W - 2 * pad) / width, (W * 1.25 - 2 * pad) / depth);
  const rw = width * scale;
  const rh = depth * scale;
  const H = rh + pad + 46;
  const ox = (W - rw) / 2;
  const oy = pad;
  const wall = 7;
  const X = (y: number) => ox + y * scale; // ширина → экранный x
  const Y = (x: number) => oy + x * scale; // глубина → экранный y

  const p = placement;
  const spk = p?.sources.filter((s) => s.id.startsWith('spk')) ?? [];
  const subs = p?.sources.filter((s) => s.id.startsWith('sub')) ?? [];

  return (
    <svg class="plan" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`План комнаты ${fmt(depth, 2)} на ${fmt(width, 2)} м`}>
      <defs>
        <pattern id="hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="5" class="plan__hatch" />
        </pattern>
      </defs>
      {/* стены */}
      <rect x={ox - wall} y={oy - wall} width={rw + 2 * wall} height={rh + 2 * wall} class="plan__wall" fill="url(#hatch)" />
      <rect x={ox} y={oy} width={rw} height={rh} class="plan__floor" />
      <rect x={ox - wall} y={oy - wall} width={rw + 2 * wall} height={wall} class="plan__front" />
      <text x={ox + rw / 2} y={oy - wall - 6} class="plan__label" text-anchor="middle">{S.room.front}</text>

      {zone && (
        <rect x={ox + 4} y={Y(zone[0])} width={rw - 8} height={Math.max(2, (zone[1] - zone[0]) * scale)} class="plan__zone" rx="6" />
      )}

      {/* размеры */}
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

      {ghost && ghost !== p && <Marks p={ghost} X={X} Y={Y} ghost />}

      {p && spk.length === 2 && (
        <polygon
          class="plan__triangle"
          points={`${X(spk[0].pos.y)},${Y(spk[0].pos.x)} ${X(spk[1].pos.y)},${Y(spk[1].pos.x)} ${X(p.listener.y)},${Y(p.listener.x)}`}
        />
      )}
      {p && spk.length === 1 && (
        <line class="plan__triangle" x1={X(spk[0].pos.y)} y1={Y(spk[0].pos.x)} x2={X(p.listener.y)} y2={Y(p.listener.x)} />
      )}
      {p && <Marks p={p} X={X} Y={Y} />}
      {p && subs.length > 0 && null}
    </svg>
  );
}

function Marks({ p, X, Y, ghost }: { p: Placement; X: (v: number) => number; Y: (v: number) => number; ghost?: boolean }) {
  const cls = ghost ? ' is-ghost' : '';
  return (
    <g>
      {p.sources.map((s) => {
        const cx = X(s.pos.y);
        const cy = Y(s.pos.x);
        if (s.id.startsWith('sub')) {
          return (
            <g class={`plan__sub${cls}`}>
              <rect x={cx - 9} y={cy - 9} width="18" height="18" rx="3" />
              <circle cx={cx} cy={cy} r="5" />
              {!ghost && <text x={cx} y={cy + 22} text-anchor="middle">{`С${s.id.slice(3)}`}</text>}
            </g>
          );
        }
        // колонка направлена на слушателя
        const ang = (Math.atan2(Y(p.listener.x) - cy, X(p.listener.y) - cx) * 180) / Math.PI - 90;
        return (
          <g class={`plan__spk${cls}`} transform={`translate(${cx} ${cy}) rotate(${ang})`}>
            <rect x="-8" y="-6" width="16" height="12" rx="2" />
            <path d="M -5 6 L 5 6 L 7 10 L -7 10 Z" />
          </g>
        );
      })}
      <g class={`plan__listener${cls}`}>
        <circle cx={X(p.listener.y)} cy={Y(p.listener.x)} r="8" />
        <circle cx={X(p.listener.y)} cy={Y(p.listener.x)} r="2.5" class="plan__dot" />
      </g>
    </g>
  );
}
