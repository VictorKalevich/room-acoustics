// Вертикальный ползунок высоты среза (м), шаг 5 см: одна ручка — плоскость среза.
import { useRef } from 'preact/hooks';

interface Props {
  max: number;
  value: number;
  onChange: (v: number) => void;
  step?: number;
}

export function HeightRange({ max, value, onChange, step = 0.05 }: Props) {
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef(false);
  const pct = (v: number) => `${(1 - v / max) * 100}%`;
  const fromEvent = (e: PointerEvent) => {
    const r = track.current!.getBoundingClientRect();
    const t = 1 - (e.clientY - r.top) / r.height;
    return Math.round(Math.min(max, Math.max(0, t * max)) / step) * step;
  };
  const move = (e: PointerEvent) => { if (drag.current) onChange(fromEvent(e)); };
  const start = (e: PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    drag.current = true;
  };
  const key = (e: KeyboardEvent) => {
    const d = e.key === 'ArrowUp' ? step : e.key === 'ArrowDown' ? -step : 0;
    if (!d) return;
    e.preventDefault();
    onChange(Math.min(max, Math.max(0, value + d)));
  };
  // касание дорожки переносит ручку туда и сразу даёт тянуть
  const tapTrack = (e: PointerEvent) => {
    onChange(fromEvent(e));
    drag.current = true;
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  };
  const cm = Math.round(value * 100);
  return (
    <div class="hrange" onPointerMove={move} onPointerUp={() => (drag.current = false)} onPointerCancel={() => (drag.current = false)}>
      <span class="hrange__cap">{(Math.round(max * 10) / 10).toString().replace('.', ',')} м</span>
      <div class="hrange__track" ref={track} onPointerDown={tapTrack}>
        <div class="hrange__fill" style={{ top: pct(value), bottom: 0 }} />
        <button
          type="button"
          class="hrange__thumb"
          style={{ top: pct(value) }}
          role="slider"
          aria-orientation="vertical"
          aria-label="Высота среза"
          aria-valuemin={0}
          aria-valuemax={max}
          aria-valuenow={value}
          aria-valuetext={`${cm} см`}
          onPointerDown={start}
          onKeyDown={key}
        >
          <span class="hrange__label">{cm}</span>
        </button>
      </div>
      <span class="hrange__cap">0</span>
    </div>
  );
}
