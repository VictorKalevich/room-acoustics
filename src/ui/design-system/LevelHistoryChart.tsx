import { useMemo } from 'preact/hooks';
import { plotLeft, plotRight, timeTicks, timeX, viewPoint, xTime } from './timeAxis';

const top = 22, bottom = 146, height = 178;

export interface LevelSeries {
  /** Начало первого столбца и длительность столбца, с. */
  start: number;
  step: number;
  /** Уровень столбца, дБ; NaN — нет значения. */
  db: Float64Array;
  /** 1 — окно полное; неполное окно с данными рисуется отдельной линией. */
  complete: Uint8Array;
  /** Учтённые отсчёты столбца; 0 — пропуск. */
  valid: Float64Array;
}

/** Обе крайние точки пикселя сохраняются, линия рвётся на пропуске и на смене полноты окна. */
function trace(s: LevelSeries, start: number, end: number, y: (v: number) => number, complete: boolean) {
  let path = '', px = -1, low = 0, high = 0, move = true;
  const flush = () => {
    if (px < 0) return;
    path += (move ? 'M' : 'L') + px + ' ' + y(low).toFixed(1) + 'l0.1 0';
    if (high !== low) path += 'V' + y(high).toFixed(1);
    move = false;
    px = -1;
  };
  for (let i = 0; i < s.db.length; i++) {
    const v = s.db[i];
    if (Number.isNaN(v) || !!s.complete[i] !== complete) { flush(); move = true; continue; }
    const x = Math.round(timeX(s.start + (i + 0.5) * s.step, start, end));
    if (x !== px) { flush(); px = x; low = high = v; }
    else { low = Math.min(low, v); high = Math.max(high, v); }
  }
  flush();
  return path;
}

/** История уровня по столбцам времени (055): ось дБ подбирается по данным, пропуски затенены. */
export function LevelHistoryChart({ label, series, start, end, unit, cursor, onPick }: {
  label: string; series: LevelSeries; start: number; end: number; unit: string; cursor?: number; onPick?(seconds: number): void;
}) {
  const { lo, hi, paths, gaps } = useMemo(() => {
    let min = Infinity, max = -Infinity;
    for (const v of series.db) if (Number.isFinite(v)) { min = Math.min(min, v); max = Math.max(max, v); }
    const upper = Number.isFinite(max) ? Math.ceil(max / 10) * 10 : 0;
    const lower = Math.min(upper - 20, Number.isFinite(min) ? Math.floor(min / 10) * 10 : -100);
    const yOf = (v: number) => bottom - (Math.max(lower, Math.min(upper, v)) - lower) / (upper - lower) * (bottom - top);
    const empty: [number, number][] = [];
    for (let i = 0; i < series.valid.length; i++) if (!series.valid[i]) {
      const a = series.start + i * series.step;
      if (empty.length && empty[empty.length - 1][1] === a) empty[empty.length - 1][1] = a + series.step; else empty.push([a, a + series.step]);
    }
    return { lo: lower, hi: upper, gaps: empty, paths: [trace(series, start, end, yOf, true), trace(series, start, end, yOf, false)] };
  }, [series, start, end]);
  const y = (v: number) => bottom - (v - lo) / (hi - lo) * (bottom - top);
  const stepDb = hi - lo > 60 ? 20 : 10;
  const pick = onPick && ((e: MouseEvent) => {
    const p = viewPoint(e, 340, height);
    if (p.x >= plotLeft && p.x <= plotRight) onPick(xTime(p.x, start, end));
  });
  const cursorX = cursor == null ? null : timeX(cursor, start, end);
  const clip = (a: number) => Math.max(plotLeft, Math.min(plotRight, timeX(a, start, end)));
  return <svg class="chart" viewBox={`0 0 340 ${height}`} role="img" aria-label={label} onClick={pick}>
    {gaps.map(([a, b]) => clip(b) > clip(a) && <rect key={a} class="chart__gap" x={clip(a)} y={top} width={clip(b) - clip(a)} height={bottom - top} />)}
    {Array.from({ length: (hi - lo) / stepDb + 1 }, (_, i) => hi - i * stepDb).map(db => <g class="chart__grid" key={db}>
      <line x1={plotLeft} x2={plotRight} y1={y(db)} y2={y(db)} />
      <text x={plotLeft - 4} y={y(db) + 3} text-anchor="end">{db}</text>
    </g>)}
    {timeTicks(start, end).map(({ seconds, label: text }) => <g class="chart__grid" key={seconds}>
      <line x1={timeX(seconds, start, end)} x2={timeX(seconds, start, end)} y1={top} y2={bottom} />
      <text x={timeX(seconds, start, end)} y={bottom + 18} text-anchor="middle">{text}</text>
    </g>)}
    <text class="chart__unit" x={plotLeft - 4} y={top - 10} text-anchor="end">{unit}</text>
    <path class="chart__line is-baseline" d={paths[1]} />
    <path class="chart__line is-room" d={paths[0]} />
    {cursorX != null && cursorX >= plotLeft && cursorX <= plotRight && <line class="chart__cursor" x1={cursorX} x2={cursorX} y1={top} y2={bottom} />}
  </svg>;
}
