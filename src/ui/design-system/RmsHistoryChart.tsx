import { useMemo } from 'preact/hooks';
import type { NoisePoint } from '../../core/noise';
import { S } from '../strings';

const left = 38, right = 328, top = 12, bottom = 142;
const y = (v: number) => top + Math.max(0, Math.min(100, -v)) / 100 * (bottom - top);

/** В одном пикселе сохраняем оба экстремума. Пропущенные интервалы разрывают линию. */
function trace(rows: readonly NoisePoint[], first: number, start: number, end: number, averaged: boolean) {
  let path = '', previousX = -1, low = 0, high = 0, lowFirst = true, move = true;
  function flush() {
    if (previousX < 0) return;
    const a = y(lowFirst ? low : high).toFixed(1), b = y(lowFirst ? high : low).toFixed(1);
    path += (move ? 'M' : 'L') + previousX + ' ' + a + 'l0.1 0';
    if (a !== b) path += 'V' + b;
    move = false;
    previousX = -1;
  }
  for (let i = first; i < rows.length; i++) {
    const point = rows[i];
    if (point.missingBefore || (averaged && !point.windowComplete)) {
      flush();
      move = true;
      if (averaged && !point.windowComplete) continue;
    }
    const x = Math.round(left + (point.endSeconds - start) / (end - start) * (right - left));
    const value = (averaged ? point.rms1sDbfs : point.rmsDbfs) ?? -100;
    if (previousX !== x) {
      flush();
      previousX = x;
      low = high = value;
    } else if (value < low) { low = value; lowFirst = false; }
    else if (value > high) { high = value; lowFirst = true; }
  }
  flush();
  return path;
}

export function RmsHistoryChart({ rows, live }: { rows: readonly NoisePoint[]; live: boolean }) {
  const end = Math.max(1, rows.at(-1)?.endSeconds ?? 0);
  const start = live ? Math.max(0, end - 60) : 0;
  const count = rows.length;
  const paths = useMemo(() => {
    let first = count;
    while (first && rows[first - 1].endSeconds >= start) first--;
    return [trace(rows, first, start, end, false), trace(rows, first, start, end, true)];
  }, [rows, count, start, end]);
  return <>
    <svg class="chart" viewBox="0 0 340 172" role="img" aria-label={S.noise.history}>
      {[0, -20, -40, -60, -80, -100].map(db => <g class="chart__grid" key={db}>
        <line x1={left} x2={right} y1={y(db)} y2={y(db)} />
        <text x={left - 4} y={y(db) + 3} text-anchor="end">{db}</text>
      </g>)}
      {[0, 0.5, 1].map(fraction => {
        const x = left + fraction * (right - left);
        return <g class="chart__grid" key={fraction}>
          <line x1={x} x2={x} y1={top} y2={bottom} />
          <text x={x} y={bottom + 18} text-anchor={fraction === 1 ? 'end' : 'middle'}>
            {Number((start + fraction * (end - start)).toFixed(1))} с
          </text>
        </g>;
      })}
      <path class="chart__line is-measured" d={paths[0]} />
      <path class="chart__line is-room" d={paths[1]} />
    </svg>
    <div class="legend">
      <span class="legend__item legend__item--measured">{S.noise.blockRms}</span>
      <span class="legend__item legend__item--room">{S.noise.secondRms}</span>
    </div>
  </>;
}
