// Вертикальный ползунок с двумя ручками: слой по высоте «от … до …» (м), шаг 5 см.
import { useRef } from 'preact/hooks';
import { fmt } from '../format';

interface Props {
  max: number;
  value: [number, number];
  onChange: (v: [number, number]) => void;
  step?: number;
}

export function HeightRange({ max, value, onChange, step = 0.05 }: Props) {
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef<0 | 1 | null>(null);
  const [lo, hi] = value;
  const pct = (v: number) => `${(1 - v / max) * 100}%`;
  const fromEvent = (e: PointerEvent) => {
    const r = track.current!.getBoundingClientRect();
    const t = 1 - (e.clientY - r.top) / r.height;
    return Math.round(Math.min(max, Math.max(0, t * max)) / step) * step;
  };
  const move = (e: PointerEvent) => {
    if (drag.current === null) return;
    const v = fromEvent(e);
    onChange(drag.current === 0 ? [Math.min(v, hi), hi] : [lo, Math.max(v, lo)]);
  };
  const start = (which: 0 | 1) => (e: PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    drag.current = which;
  };
  const key = (which: 0 | 1) => (e: KeyboardEvent) => {
    const d = e.key === 'ArrowUp' ? step : e.key === 'ArrowDown' ? -step : 0;
    if (!d) return;
    e.preventDefault();
    const v = Math.min(max, Math.max(0, (which ? hi : lo) + d));
    onChange(which === 0 ? [Math.min(v, hi), hi] : [lo, Math.max(v, lo)]);
  };
  // касание дорожки двигает ближайшую ручку
  const tapTrack = (e: PointerEvent) => {
    const v = fromEvent(e);
    const which: 0 | 1 = Math.abs(v - lo) <= Math.abs(v - hi) ? 0 : 1;
    onChange(which === 0 ? [Math.min(v, hi), hi] : [lo, Math.max(v, lo)]);
    drag.current = which;
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  };
  return (
    <div class="hrange" onPointerMove={move} onPointerUp={() => (drag.current = null)} onPointerCancel={() => (drag.current = null)}>
      <span class="hrange__cap">{fmt(max, 1)} м</span>
      <div class="hrange__track" ref={track} onPointerDown={tapTrack}>
        <div class="hrange__fill" style={{ top: pct(hi), bottom: `${(lo / max) * 100}%` }} />
        {([0, 1] as const).map((w, ki) => (
          <button key={ki}
            type="button"
            class="hrange__thumb"
            style={{ top: pct(w ? hi : lo) }}
            role="slider"
            aria-orientation="vertical"
            aria-label={w ? 'Верх слоя' : 'Низ слоя'}
            aria-valuemin={0}
            aria-valuemax={max}
            aria-valuenow={w ? hi : lo}
            aria-valuetext={`${Math.round((w ? hi : lo) * 100)} см`}
            onPointerDown={start(w)}
            onKeyDown={key(w)}
          >
            <span class="hrange__label">{Math.round((w ? hi : lo) * 100)}</span>
          </button>
        ))}
      </div>
      <span class="hrange__cap">0</span>
    </div>
  );
}
