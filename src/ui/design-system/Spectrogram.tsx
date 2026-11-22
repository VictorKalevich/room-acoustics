import { useId, useLayoutEffect, useRef } from 'preact/hooks';
import { fmt, fmtHz } from '../format';
import { plotLeft, plotRight, plotWidth, timeTicks, timeX, viewPoint, xTime } from './timeAxis';

const top = 10, bottom = 176, height = 210;
/** Viridis, 9 опорных цветов: равномерная яркость, различима при нарушениях цветового зрения, одна и та же в обеих темах. */
export const spectrogramStops = ['#440154', '#472d7b', '#3b528b', '#2c728e', '#21918c', '#28ae80', '#5ec962', '#addc30', '#fde725'];
const lut = (() => {
  const rgb = spectrogramStops.map(c => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16)));
  const table = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) {
    const p = i / 255 * (rgb.length - 1), k = Math.min(rgb.length - 2, Math.floor(p)), f = p - k;
    for (let c = 0; c < 3; c++) table[i * 3 + c] = rgb[k][c] + (rgb[k + 1][c] - rgb[k][c]) * f;
  }
  return table;
})();

export interface SpectrogramView {
  /** Уровни по пикселям, столбец за столбцом снизу вверх: columns × rows; NaN — нет данных. */
  values: Float32Array;
  columns: number;
  rows: number;
  /** Доля времени столбца с данными, 0…1. */
  coverage: Float32Array;
  /** Границы строк по частоте, Гц; строки равны по логарифму частоты. */
  edgesHz: readonly number[];
  start: number;
  end: number;
  range: readonly [number, number];
}

const fTicks = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];

/** Спектрограмма (055): X — время сеанса, Y — логарифм частоты, цвет — уровень в единицах unit. Пропуски не закрашиваются. */
export function Spectrogram({ label, view, unit, cursor, onPick }: {
  label: string; view: SpectrogramView; unit: string; cursor?: { seconds: number; row: number | null }; onPick?(seconds: number, row: number): void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const gradient = 'spectrogram-scale-' + useId().replace(/\W/g, '');
  const { values, columns, rows, coverage, edgesHz, start, end, range: [lo, hi] } = view;
  useLayoutEffect(() => {
    const ctx = canvas.current?.getContext('2d');
    if (!ctx) return;
    const image = ctx.createImageData(columns, rows), data = image.data, span = hi - lo || 1;
    for (let x = 0; x < columns; x++) for (let r = 0; r < rows; r++) {
      const v = values[x * rows + r], at = ((rows - 1 - r) * columns + x) * 4;
      if (Number.isNaN(v)) { data[at + 3] = 0; continue; }
      const i = 3 * Math.round(255 * Math.max(0, Math.min(1, (v - lo) / span)));
      data[at] = lut[i]; data[at + 1] = lut[i + 1]; data[at + 2] = lut[i + 2]; data[at + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
  }, [values, columns, rows, lo, hi]);
  const logLo = Math.log(edgesHz[0]), logHi = Math.log(edgesHz[edgesHz.length - 1]);
  const fy = (hz: number) => bottom - (Math.log(hz) - logLo) / (logHi - logLo) * (bottom - top);
  const step = plotWidth / columns;
  const gaps: [number, number][] = [];
  const partial: [number, number][] = [];
  for (let x = 0; x < columns; x++) {
    if (!coverage[x]) {
      if (gaps.length && gaps[gaps.length - 1][1] === x) gaps[gaps.length - 1][1]++; else gaps.push([x, x + 1]);
    } else if (coverage[x] < 0.999) partial.push([x, coverage[x]]);
  }
  const pick = onPick && ((e: MouseEvent) => {
    const p = viewPoint(e, 340, height);
    if (p.x < plotLeft || p.x > plotRight || p.y < top || p.y > bottom) return;
    onPick(xTime(p.x, start, end), Math.min(rows - 1, Math.floor((bottom - p.y) / (bottom - top) * rows)));
  });
  const cursorX = cursor && timeX(cursor.seconds, start, end);
  return <div class="spectrogram">
    <div class="spectrogram__plot">
      <canvas ref={canvas} class="spectrogram__image" width={columns} height={rows} aria-hidden="true" />
      <svg class="chart" viewBox={`0 0 340 ${height}`} role="img" aria-label={label} onClick={pick}>
        {gaps.map(([a, b]) => <rect key={a} class="chart__gap" x={plotLeft + a * step} y={top} width={(b - a) * step} height={bottom - top} />)}
        {partial.map(([x, c]) => <rect key={x} class="chart__gap" x={plotLeft + x * step} y={bottom + 1} width={step} height={4} opacity={1 - c} />)}
        <rect class="chart__frame" x={plotLeft} y={top} width={plotWidth} height={bottom - top} />
        {fTicks.filter(f => f >= edgesHz[0] && f <= edgesHz[edgesHz.length - 1]).map(f => <g class="chart__grid" key={f}>
          <line x1={plotLeft - 4} x2={plotLeft} y1={fy(f)} y2={fy(f)} />
          <text x={plotLeft - 6} y={fy(f) + 3} text-anchor="end">{f < 1000 ? f : fmtHz(f)}</text>
        </g>)}
        {timeTicks(start, end).map(({ seconds, label: text }) => <g class="chart__grid" key={seconds}>
          <line x1={timeX(seconds, start, end)} x2={timeX(seconds, start, end)} y1={bottom} y2={bottom + 6} />
          <text x={timeX(seconds, start, end)} y={bottom + 18} text-anchor="middle">{text}</text>
        </g>)}
        <text class="chart__unit" x={plotLeft - 6} y={top - 2} text-anchor="end">Гц</text>
        {cursorX != null && cursorX >= plotLeft && cursorX <= plotRight && <line class="chart__cursor" x1={cursorX} x2={cursorX} y1={top} y2={bottom} />}
        {cursor?.row != null && cursor.row < rows && <rect class="chart__pick" x={plotLeft} width={plotWidth}
          y={bottom - (cursor.row + 1) / rows * (bottom - top)} height={(bottom - top) / rows} />}
      </svg>
    </div>
    <svg class="color-scale" viewBox="0 0 340 30" aria-hidden="true">
      <defs><linearGradient id={gradient}>{spectrogramStops.map((c, i) =>
        <stop key={c} offset={i / (spectrogramStops.length - 1)} stop-color={c} />)}</linearGradient></defs>
      <rect x={plotLeft} y={2} width={plotWidth} height={10} rx={3} fill={`url(#${gradient})`} />
      <text x={plotLeft} y={26}>{fmt(lo, 0)}</text>
      <text x={(plotLeft + plotRight) / 2} y={26} text-anchor="middle">{unit}</text>
      <text x={plotRight} y={26} text-anchor="end">{fmt(hi, 0)}</text>
    </svg>
  </div>;
}
