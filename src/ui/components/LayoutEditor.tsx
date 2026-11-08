// Вид скана сверху: перетаскиваемые стороны основной комнаты, найденные проёмы и коридор.
import { useEffect, useRef } from 'preact/hooks';
import type { LayoutResult } from '../../scan/layout';
import { extensionBox } from '../../core/geometry';
import type { Extension, Room } from '../../core/types';
import { fmt } from '../format';

export interface Rect { x0: number; x1: number; y0: number; y1: number }

interface Props {
  layout: LayoutResult;
  /** Элементы стен с выбранным видом (если не заданы — рисуются найденные проёмы и окна). */
  marks?: { wall: string; a0: number; a1: number; kind: 'arch' | 'door' | 'window' }[];
  rect: Rect;
  height: number;
  onRect: (r: Rect) => void;
  onRectDone: (r: Rect) => void;
}

const W = 320;
const PAD = 22;

export function LayoutEditor({ layout, marks, rect, height, onRect, onRectDone }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<keyof Rect | null>(null);
  const b = layout.bounds;
  const bx0 = Math.min(b.x0, rect.x0) - 0.2, bx1 = Math.max(b.x1, rect.x1) + 0.2;
  const by0 = Math.min(b.y0, rect.y0) - 0.2, by1 = Math.max(b.y1, rect.y1) + 0.2;
  const scale = Math.min((W - 2 * PAD) / (by1 - by0), (W * 1.2 - 2 * PAD) / (bx1 - bx0));
  const Hh = (bx1 - bx0) * scale + 2 * PAD;
  const X = (y: number) => PAD + (y - by0) * scale;
  const Y = (x: number) => PAD + (x - bx0) * scale;

  // контур скана — на canvas (тысячи точек)
  useEffect(() => {
    const cv = canvas.current;
    if (!cv) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = W * dpr;
    cv.height = Hh * dpr;
    const g = cv.getContext('2d');
    if (!g) return;
    g.scale(dpr, dpr);
    g.clearRect(0, 0, W, Hh);
    g.fillStyle = getComputedStyle(cv).color || '#555';
    const o = layout.outline;
    // границы зависят и от прямоугольника: при его растяжке за пределы скана точки сдвигаются вместе с разметкой
    for (let i = 0; i < o.length; i += 2) g.fillRect(PAD + (o[i + 1] - by0) * scale - 0.6, PAD + (o[i] - bx0) * scale - 0.6, 1.2, 1.2);
  }, [layout, Hh, scale, bx0, by0]);

  const toRoom = (e: PointerEvent) => {
    const s = svg.current!;
    const pt = s.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const q = pt.matrixTransform(s.getScreenCTM()!.inverse());
    return { x: (q.y - PAD) / scale + bx0, y: (q.x - PAD) / scale + by0 };
  };
  const move = (e: PointerEvent) => {
    const k = drag.current;
    if (!k) return;
    const p = toRoom(e);
    const v = Math.round((k === 'x0' || k === 'x1' ? p.x : p.y) * 20) / 20;
    const next = { ...rect, [k]: v };
    if (next.x1 - next.x0 < 1 || next.y1 - next.y0 < 1) return;
    onRect(next);
  };

  // проёмы и коридор — в координатах выбранного прямоугольника
  const local = { depth: rect.x1 - rect.x0, width: rect.y1 - rect.y0, height } as Room;
  const ext = layout.extension ? extensionBox(local, layout.extension as Extension) : null;
  const wallSeg = (wall: string, a0: number, a1: number) => {
    const L = (v: number, along: 'x' | 'y') => (along === 'x' ? rect.x0 + v : rect.y0 + v);
    switch (wall) {
      case 'front': return [X(L(a0, 'y')), Y(rect.x0), X(L(a1, 'y')), Y(rect.x0)];
      case 'back': return [X(L(a0, 'y')), Y(rect.x1), X(L(a1, 'y')), Y(rect.x1)];
      case 'left': return [X(rect.y0), Y(L(a0, 'x')), X(rect.y0), Y(L(a1, 'x'))];
      default: return [X(rect.y1), Y(L(a0, 'x')), X(rect.y1), Y(L(a1, 'x'))];
    }
  };
  const handles: { k: keyof Rect; cx: number; cy: number }[] = [
    { k: 'x0', cx: X((rect.y0 + rect.y1) / 2), cy: Y(rect.x0) },
    { k: 'x1', cx: X((rect.y0 + rect.y1) / 2), cy: Y(rect.x1) },
    { k: 'y0', cx: X(rect.y0), cy: Y((rect.x0 + rect.x1) / 2) },
    { k: 'y1', cx: X(rect.y1), cy: Y((rect.x0 + rect.x1) / 2) },
  ];

  return (
    <div class="layout-editor" style={{ aspectRatio: `${W} / ${Hh}` }}>
      <canvas ref={canvas} class="layout-editor__scan" style={{ width: '100%', height: '100%' }} />
      <svg
        ref={svg}
        class="layout-editor__svg"
        viewBox={`0 0 ${W} ${Hh}`}
        onPointerMove={move}
        onPointerUp={() => { if (drag.current) { drag.current = null; onRectDone(rect); } }}
        onPointerCancel={() => { drag.current = null; }}
        aria-label="Вид скана сверху: перетащите стороны прямоугольника на стены основной комнаты"
      >
        {ext && (
          <rect
            class="layout-editor__ext"
            x={X(rect.y0 + ext.y0)}
            y={Y(rect.x0 + ext.x0)}
            width={(ext.y1 - ext.y0) * scale}
            height={(ext.x1 - ext.x0) * scale}
          />
        )}
        <rect class="layout-editor__room" x={X(rect.y0)} y={Y(rect.x0)} width={(rect.y1 - rect.y0) * scale} height={(rect.x1 - rect.x0) * scale} />
        <line class="layout-editor__front" x1={X(rect.y0)} y1={Y(rect.x0)} x2={X(rect.y1)} y2={Y(rect.x0)} />
        {(marks ?? [
          ...layout.openings.map((o) => ({ ...o, kind: (o.kind === 'door' ? 'door' : 'arch') as 'arch' | 'door' | 'window' })),
          ...(layout.windows ?? []).map((w) => ({ ...w, kind: 'window' as const })),
        ]).map((m, ki) => {
          const [x1, y1, x2, y2] = wallSeg(m.wall, m.a0, m.a1);
          const cls = m.kind === 'arch' ? 'layout-editor__opening' : m.kind === 'door' ? 'layout-editor__door' : 'layout-editor__window';
          return <line key={ki} class={cls} x1={x1} y1={y1} x2={x2} y2={y2} />;
        })}
        {layout.extension && (() => {
          const e = layout.extension!;
          const [x1, y1, x2, y2] = wallSeg(e.wall, e.arch.a0, e.arch.a1);
          return <line class="layout-editor__arch" x1={x1} y1={y1} x2={x2} y2={y2} />;
        })()}
        {handles.map((h, ki) => (
          <g key={ki}
            class="layout-editor__handle"
            onPointerDown={(e) => { e.stopPropagation(); (e.currentTarget as Element).setPointerCapture?.(e.pointerId); drag.current = h.k; }}
          >
            <circle cx={h.cx} cy={h.cy} r="16" class="plan__hit" />
            <circle cx={h.cx} cy={h.cy} r="7" />
          </g>
        ))}
        <text x={X((rect.y0 + rect.y1) / 2)} y={Y((rect.x0 + rect.x1) / 2)} text-anchor="middle" class="layout-editor__dims">
          {fmt(rect.x1 - rect.x0, 2)} × {fmt(rect.y1 - rect.y0, 2)} м
        </text>
      </svg>
    </div>
  );
}
