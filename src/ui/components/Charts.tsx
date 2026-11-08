import type { Mode } from '../../core/types';
import { fmt } from '../format';
import { S } from '../strings';
import { modeWhere } from '../../core/modes';

const TICKS = [20, 30, 40, 50, 60, 80, 100, 150, 200, 300, 400, 500];

function logScale(f0: number, f1: number, x0: number, x1: number) {
  const a = Math.log(f0);
  const b = Math.log(f1);
  return (f: number) => x0 + ((Math.log(f) - a) / (b - a)) * (x1 - x0);
}

interface Line {
  f: number[];
  db: number[];
  cls: string;
  dash?: boolean;
}

/** АЧХ в точке прослушивания: комната, цель (без комнаты), базовая для сравнения. */
export function ResponseChart({ lines, fLo, fHi }: { lines: Line[]; fLo: number; fHi: number }) {
  const W = 340, H = 210, l = 34, r = 10, t = 12, b = 26;
  const x = logScale(fLo, fHi, l, W - r);
  // центрируем по цели
  const all = lines.flatMap((ln) => ln.db).filter((v) => Number.isFinite(v));
  const mean = all.reduce((a, v) => a + v, 0) / Math.max(1, all.length);
  const ref = Math.round(mean / 5) * 5;
  const yMin = ref - 18;
  const yMax = ref + 15;
  const y = (v: number) => t + ((yMax - Math.max(yMin, Math.min(yMax, Number.isFinite(v) ? v : yMin))) / (yMax - yMin)) * (H - t - b);
  const ticks = TICKS.filter((f) => f >= fLo && f <= fHi);
  const yTicks = [-10, 0, 10];
  return (
    <svg class="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="График АЧХ">
      {ticks.map((f, ki) => (
        <g key={ki} class="chart__grid">
          <line x1={x(f)} x2={x(f)} y1={t} y2={H - b} />
          {/* у правого края подпись частоты наезжала бы на «Гц» */}
          {x(f) < W - r - 26 && <text x={x(f)} y={H - 8} text-anchor="middle">{f}</text>}
        </g>
      ))}
      {yTicks.map((v, ki) => (
        <g key={ki} class="chart__grid">
          <line x1={l} x2={W - r} y1={y(ref + v)} y2={y(ref + v)} />
          <text x={l - 5} y={y(ref + v) + 4} text-anchor="end">{v > 0 ? `+${v}` : v === 0 ? '0' : `−${-v}`}</text>
        </g>
      ))}
      <text x={W - r} y={H - 8} class="chart__unit" text-anchor="end">Гц</text>
      {lines.map((ln, ki) => (
        <polyline key={ki}
          class={`chart__line ${ln.cls}`}
          stroke-dasharray={ln.dash ? '5 4' : undefined}
          points={ln.f.map((f, i) => `${x(f).toFixed(1)},${y(ln.db[i]).toFixed(1)}`).join(' ')}
        />
      ))}
    </svg>
  );
}

/** Распределение мод: линия на частоте моды, высота — по типу. */
export function ModeChart({ modes, fMax, schroeder }: { modes: Mode[]; fMax: number; schroeder: number }) {
  const W = 340, H = 150, l = 10, r = 10, t = 10, b = 26;
  const x = logScale(15, fMax, l, W - r);
  const base = H - b;
  const hOf = { axial: base - t, tangential: (base - t) * 0.62, oblique: (base - t) * 0.36 };
  const ticks = TICKS.filter((f) => f >= 20 && f <= fMax);
  return (
    <svg class="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Распределение мод по частоте">
      {ticks.map((f, ki) => (
        <g key={ki} class="chart__grid">
          <line x1={x(f)} x2={x(f)} y1={t} y2={base} />
          <text x={x(f)} y={H - 8} text-anchor="middle">{f}</text>
        </g>
      ))}
      <line x1={l} x2={W - r} y1={base} y2={base} class="chart__axis" />
      {schroeder < fMax && (
        <g class="chart__schroeder">
          <line x1={x(schroeder)} x2={x(schroeder)} y1={t} y2={base} />
          <text x={x(schroeder) - 4} y={t + 10} text-anchor="end">{`fШ ${fmt(schroeder, 0)}`}</text>
        </g>
      )}
      {modes.map((m, ki) => (
        <line key={ki}
          class={`chart__mode chart__mode--${m.kind}`}
          x1={x(m.f)}
          x2={x(m.f)}
          y1={base}
          y2={base - hOf[m.kind]}
        >
          <title>{`${fmt(m.f, 1)} Гц, ${S.modes.kinds[m.kind]}${m.kind === 'oblique' ? '' : `, ${modeWhere(m.n)}`}`}</title>
        </line>
      ))}
      {/* совпадающие сильные моды (осевые) отмечены точкой */}
      {modes
        .filter((m) => m.degenerate && m.kind === 'axial')
        .map((m, ki) => <circle key={ki} class="chart__degenerate" cx={x(m.f)} cy={base - hOf.axial - 4} r="3.5" />)}
    </svg>
  );
}
