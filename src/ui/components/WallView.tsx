// Развёртка стены (019): вид изнутри комнаты, как видит человек, стоящий лицом к стене.
// Окна, двери, проёмы, арка коридора, ковры и шторы, панели обработки (только показ) и мебель у стены.
import { useId } from 'preact/hooks';
import type { Room, WallId } from '../../core/types';
import { furnitureAtWall } from '../../core/furniture';
import { shownTreatments } from '../../core/treatments';
import { wallLength } from '../../core/geometry';
import { fmt } from '../format';
import { S } from '../strings';

/** Какие стены видны у левого и правого края, если стоять лицом к стене. */
const ENDS: Record<WallId, [WallId, WallId]> = {
  front: ['left', 'right'], back: ['right', 'left'], left: ['back', 'front'], right: ['front', 'back'],
};
/** Координата вдоль стены растёт справа налево (задняя и левая стены, если смотреть изнутри). */
const MIRROR: Record<WallId, boolean> = { front: false, back: true, left: true, right: false };
const OPPOSITE: Record<WallId, WallId> = { front: 'back', back: 'front', left: 'right', right: 'left' };

/** Высота стены в точке u с учётом скоса потолка. */
export function wallTopAt(room: Room, wall: WallId, u: number): number {
  const s = room.slope, H = room.height;
  if (!s || s.wall === OPPOSITE[wall]) return H;
  if (s.wall === wall) return Math.min(H, s.low);
  const L = wallLength(room, wall);
  const d = s.wall === 'left' || s.wall === 'front' ? u : L - u;
  return d >= s.run ? H : s.low + ((H - s.low) * Math.max(0, d)) / s.run;
}

export function WallView({ room, wall }: { room: Room; wall: WallId }) {
  const carpetId = `wall-carpet-${useId()}`;
  const L = wallLength(room, wall);
  const H = room.height;
  const W = 320, pad = 26, top = 16, bottom = 34;
  const scale = Math.min((W - 2 * pad) / L, 190 / H);
  const ox = (W - L * scale) / 2;
  const VH = top + H * scale + bottom;
  const X = (u: number) => (MIRROR[wall] ? ox + (L - u) * scale : ox + u * scale);
  const Y = (v: number) => top + (H - v) * scale;
  const span = (a0: number, a1: number, v0: number, v1: number) => {
    const xa = X(Math.max(0, Math.min(a0, L))), xb = X(Math.max(0, Math.min(a1, L)));
    const ya = Y(Math.min(Math.max(v0, v1), H)), yb = Y(Math.max(0, Math.min(v0, v1)));
    return { x: Math.min(xa, xb), y: ya, width: Math.max(1, Math.abs(xb - xa)), height: Math.max(1, yb - ya) };
  };
  const run = room.slope ? Math.min(room.slope.run, L) : 0;
  const us = [...new Set([0, run, L - run, L].map((u) => Math.max(0, Math.min(L, u))))].sort((a, b) => a - b);
  const outline = [
    ...us.map((u) => `${X(u)},${Y(wallTopAt(room, wall, u))}`),
    `${X(us[us.length - 1])},${Y(0)}`, `${X(us[0])},${Y(0)}`,
  ].join(' ');

  const feats = (room.features ?? []).filter((f) => f.wall === wall);
  const openings = (room.openings ?? []).filter((o) => o.wall === wall);
  const arches = (room.extensions ?? []).filter((e) => e.wall === wall);
  const panels = (shownTreatments(room) ?? []).filter((t) => t.kind === 'panel' && t.wall === wall && t.enabled !== false);
  const covers = (room.coverings ?? []).filter((c) => c.surface === wall);
  const furniture = furnitureAtWall(room, wall);
  const [leftEnd, rightEnd] = ENDS[wall];

  return (
    <svg class="wall-view" viewBox={`0 0 ${W} ${VH}`} role="img"
      aria-label={S.editor.wallViewLabel(S.openings.walls[wall], fmt(L, 2), fmt(H, 2))}>
      <defs>
        <pattern id={carpetId} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="6" class="wall-view__weave" />
        </pattern>
      </defs>
      <polygon points={outline} class="wall-view__wall" />
      {panels.map((t) => {
        const at = t.at ?? L / 2, z = t.z ?? H / 2;
        return <rect key={t.id} class="wall-view__treat" {...span(at - t.width / 2, at + t.width / 2, z - t.height / 2, z + t.height / 2)} />;
      })}
      {openings.map((o) => <rect key={o.id} class="wall-view__gap" {...span(o.a0, o.a1, 0, o.height)} />)}
      {arches.map((e) => <rect key={e.id} class="wall-view__arch" {...span(e.arch.a0, e.arch.a1, 0, e.arch.height)} />)}
      {feats.map((f) => {
        const r = span(f.a0, f.a1, f.bottom, f.top);
        return f.kind === 'window'
          ? (
            <g key={f.id} class="wall-view__window">
              <rect {...r} />
              <line x1={r.x + r.width / 2} y1={r.y} x2={r.x + r.width / 2} y2={r.y + r.height} />
            </g>
          )
          : <rect key={f.id} class="wall-view__door" {...r} />;
      })}
      {covers.map((c) => {
        const r = span(c.u0, c.u1, c.v0, c.v1);
        if (c.kind === 'carpet') return <rect key={c.id} class="wall-view__carpet" {...r} fill={`url(#${carpetId})`} />;
        const folds = Math.max(1, Math.floor(r.width / (c.grade === 'heavy' ? 7 : 12)));
        return (
          <g key={c.id} class={`wall-view__curtain${c.grade === 'light' ? ' is-light' : ''}`}>
            <rect {...r} />
            {Array.from({ length: folds - 1 }, (_, i) => {
              const x = r.x + ((i + 1) * r.width) / folds;
              return <line key={i} class="wall-view__fold" x1={x} y1={r.y} x2={x} y2={r.y + r.height} />;
            })}
          </g>
        );
      })}
      {/* мебель стоит перед стеной — поверх окон и штор, полупрозрачная */}
      {furniture.map(({ z, a0, a1, height }) => {
        const r = span(a0, a1, 0, height);
        return (
          <g key={z.id} class="wall-view__furniture">
            <rect {...r} />
            {r.width > 34 && <text x={r.x + r.width / 2} y={r.y + Math.min(r.height - 3, 12)} text-anchor="middle">{z.name ?? S.zones.short.furniture}</text>}
          </g>
        );
      })}
      <line class="wall-view__floor" x1={X(0)} y1={Y(0)} x2={X(L)} y2={Y(0)} />
      <text x={Math.min(X(0), X(L))} y={Y(0) + 14} class="wall-view__end">{S.editor.neighbour[leftEnd]}</text>
      <text x={Math.max(X(0), X(L))} y={Y(0) + 14} text-anchor="end" class="wall-view__end">{S.editor.neighbour[rightEnd]}</text>
      <text x={W / 2} y={Y(0) + 28} text-anchor="middle" class="wall-view__dim">{fmt(L, 2)} × {fmt(H, 2)} м</text>
    </svg>
  );
}
