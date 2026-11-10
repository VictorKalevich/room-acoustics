// «Обзор»: оценка комнаты 0–100, подоценки, список проблем с переходами и время затухания мод.
import { useMemo, useState } from 'preact/hooks';
import type { Project } from '../../state/project';
import type { Mode, ReverbResult } from '../../core/types';
import { buildOverview, decayLimit, type ModeDecay, type Severity } from '../../core/overview';
import type { Destination } from '../navigation';
import { useSetupEval } from '../useEval';
import { Panel, Note } from '../components/Fields';
import { PlayButton } from '../components/MiniPlayer';
import { Term } from '../components/Term';
import { S } from '../strings';
import { fmt } from '../format';
import { modeWhere } from '../../core/modes';

interface Props {
  project: Project;
  modes: Mode[];
  reverb: ReverbResult;
  onGo: (t: Destination, f?: number) => void;
}

const SUB_TERM: Record<string, string> = { bass: 'flatness', decay: 'decay', symmetry: 'reflection', reverb: 'rt60', proportions: 'mode' };

export function OverviewScreen({ project, modes, reverb, onGo }: Props) {
  const { room, sources, constraints: c, current } = project;
  const { ev, busy } = useSetupEval(room, sources, c, current);
  const o = useMemo(() => buildOverview(room, sources, current, ev, modes, reverb), [room, sources, current, ev, modes, reverb]);
  const [all, setAll] = useState(false);
  const shown = all ? o.problems : o.problems.slice(0, 6);
  const grade = o.score >= 80 ? S.overview.grades.great : o.score >= 65 ? S.overview.grades.good : o.score >= 45 ? S.overview.grades.fair : S.overview.grades.poor;
  return (
    <div class="screen">
      <Panel class="panel--hero">
        <div class="score-hero">
          <ScoreRing value={o.score} />
          <div>
            <strong class="score-hero__grade">{grade}</strong>
            <p class="muted small">{S.overview.scoreHint}</p>
            {busy && <p class="progress-text small"><span class="spinner" aria-hidden="true" /> {S.overview.computing}</p>}
          </div>
        </div>
        <ul class="subscores">
          {o.subs.map((s) => (
            <li key={s.id}>
              <span class="subscores__name"><Term id={SUB_TERM[s.id]}>{S.overview.subs[s.id]}</Term></span>
              <span class="subscores__bar" aria-hidden="true"><span style={{ width: `${s.value}%` }} class={s.value < 45 ? 'is-low' : s.value < 70 ? 'is-mid' : ''} /></span>
              <span class="subscores__val">{s.value}</span>
              <span class="subscores__note muted small">{s.note}</span>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title={S.overview.problems}>
        {o.problems.length === 0 && <Note tone="good">{S.overview.noProblems}</Note>}
        <ul class="problems">
          {shown.map((p, ki) => (
            <li key={ki} class={`problem is-${p.severity}`}>
              <div class="problem__head">
                <span class={`sev sev--${p.severity}`}>{S.overview.sev[p.severity as Severity]}</span>
                <strong>{p.title}</strong>
                {p.f != null && <PlayButton f={p.f} />}
              </div>
              <p class="small muted">{p.detail}</p>
              <div class="btn-row">
                {p.actions.map((a) => (
                  <button key={a} type="button" class="btn btn--small btn--ghost" onClick={() => onGo(a === 'tuning' ? (p.id.startsWith('peak-') ? 'tuning/eq' : 'tuning/treatment') : a, p.f)}>{a === 'tuning' ? (p.id.startsWith('peak-') ? 'Эквалайзер' : 'Обработка') : S.overview.actions[a]}</button>
                ))}
              </div>
            </li>
          ))}
        </ul>
        {!all && o.problems.length > shown.length && (
          <button type="button" class="btn btn--ghost" onClick={() => setAll(true)}>{S.overview.showAll(o.problems.length)}</button>
        )}
      </Panel>

      <Panel title={S.overview.decayTitle}>
        <p class="small">{S.overview.decayIntro} <Term id="ebu">{S.overview.ebu}</Term>.</p>
        <DecayChart decays={o.decays} volume={reverb.volume} />
        <div class="legend">
          <span class="legend__item legend__item--axial">{S.modes.kinds.axial}</span>
          <span class="legend__item legend__item--tangential">{S.modes.kinds.tangential}</span>
          <span class="legend__item legend__item--oblique">{S.modes.kinds.oblique}</span>
          <span class="legend__item legend__item--target">{S.overview.limit}</span>
        </div>
        {ev?.model === 'wave' && <p class="muted small">{S.overview.waveNote}</p>}
      </Panel>
    </div>
  );
}

function ScoreRing({ value }: { value: number }) {
  const r = 44, c = 2 * Math.PI * r;
  const cls = value < 45 ? 'is-low' : value < 70 ? 'is-mid' : '';
  return (
    <svg class={`score-ring ${cls}`} viewBox="0 0 110 110" role="img" aria-label={`Оценка ${value} из 100`}>
      <circle cx="55" cy="55" r={r} class="score-ring__track" />
      <circle cx="55" cy="55" r={r} class="score-ring__val" stroke-dasharray={`${(c * value) / 100} ${c}`} transform="rotate(-90 55 55)" />
      <text x="55" y="62" text-anchor="middle" class="score-ring__num">{value}</text>
    </svg>
  );
}

function DecayChart({ decays, volume }: { decays: ModeDecay[]; volume: number }) {
  const W = 320, H = 190, l = 36, r = 10, t = 10, b = 26;
  const f0 = 20, f1 = Math.max(60, ...decays.map((d) => d.f)) * 1.05;
  const tMax = Math.max(0.6, ...decays.map((d) => Math.max(d.t60, d.limit))) * 1.1;
  const X = (f: number) => l + ((Math.log(f) - Math.log(f0)) / (Math.log(f1) - Math.log(f0))) * (W - l - r);
  const Y = (v: number) => t + (1 - v / tMax) * (H - t - b);
  const lim: string[] = [];
  for (let i = 0; i <= 40; i++) {
    const f = f0 * Math.pow(f1 / f0, i / 40);
    lim.push(`${i ? 'L' : 'M'}${X(f).toFixed(1)},${Y(decayLimit(f, volume)).toFixed(1)}`);
  }
  const yt = [0, 0.2, 0.4, 0.6, 0.8, 1, 1.2, 1.5, 2].filter((v) => v <= tMax);
  // подписи частот не заходят на подпись единиц «Гц» у правого края
  const xt = [20, 30, 40, 50, 70, 100, 150, 200].filter((f) => f <= f1 && X(f) < W - r - 24);
  return (
    <svg class="chart decay-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Время затухания мод">
      {yt.map((v, ki) => <g key={ki}><line x1={l} x2={W - r} y1={Y(v)} y2={Y(v)} class="chart__grid" /><text x={l - 4} y={Y(v) + 3} text-anchor="end" class="chart__tick">{fmt(v, 1)}</text></g>)}
      {xt.map((f, ki) => <text key={ki} x={X(f)} y={H - 8} text-anchor="middle" class="chart__tick">{f}</text>)}
      <path d={lim.join(' ')} class="decay-chart__limit" />
      {decays.map((d, ki) => (
        <circle key={ki} cx={X(d.f)} cy={Y(d.t60)} r={d.kind === 'axial' ? 4 : 3} class={`decay-chart__pt is-${d.kind}${d.t60 > d.limit ? ' is-over' : ''}`}>
          <title>{`${fmt(d.f, 1)} Гц (${modeWhere(d.n)}): ${fmt(d.t60, 2)} с`}</title>
        </circle>
      ))}
      <text x={l} y={t + 2} class="chart__tick">с</text>
      <text x={W - r} y={H - 8} text-anchor="end" class="chart__tick">Гц</text>
    </svg>
  );
}
