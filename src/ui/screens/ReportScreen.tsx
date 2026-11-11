// Отчёт: всё по комнате на одной странице. «Сохранить PDF» — системная печать (на iPhone — «Поделиться → Сохранить в Файлы»).
import { useMemo, useRef, useState } from 'preact/hooks';
import { shownTreatments } from '../../core/treatments';
import { shareFile } from '../audio/mic';
import type { Project } from '../../state/project';
import type { Mode, ReverbResult } from '../../core/types';
import { SURFACES } from '../../core/types';
import { buildOverview } from '../../core/overview';
import { designEq, exportEqualizerAPO } from '../../core/eq';
import { getMaterial } from '../../core/materials';
import { useSetupEval } from '../useEval';
import { PlanView, type PlanItem } from '../components/PlanView';
import { Panel } from '../design-system';
import { S } from '../strings';
import { fmt } from '../format';
import { BUILD } from '../updates';
import { modeWhere } from '../../core/modes';

interface Props { project: Project; modes: Mode[]; reverb: ReverbResult }

export function ReportScreen({ project, modes, reverb }: Props) {
  const { room, sources, constraints: c, current } = project;
  const { ev, busy } = useSetupEval(room, sources, c, current, 48);
  const o = useMemo(() => buildOverview(room, sources, current, ev, modes, reverb), [room, sources, current, ev, modes, reverb]);
  const eq = useMemo(() => (ev ? designEq(ev.response.f, ev.response.db, ev.response.target) : null), [ev]);
  const items: PlanItem[] = [
    ...sources.filter((s) => current.positions[s.id]).map((s) => ({ id: s.id, kind: (s.kind === 'sub' ? 'sub' : 'spk') as PlanItem['kind'], pos: current.positions[s.id] })),
    { id: 'listener', kind: 'listener', pos: current.listener },
  ];
  const subs = sources.filter((s) => s.kind === 'sub');
  const axial = o.decays.filter((d) => d.kind === 'axial').slice(0, 10);
  const [date] = useState(() => new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }));
  const root = useRef<HTMLDivElement>(null);
  // запасной путь: отчёт отдельным HTML-файлом со стилями (в режиме приложения на iPhone печать может не открываться)
  const shareHtml = () => {
    const css = Array.from(document.styleSheets).map((sh) => { try { return Array.from(sh.cssRules).map((r) => r.cssText).join('\n'); } catch { return ''; } }).join('\n');
    const body = root.current?.outerHTML ?? '';
    const html = `<!doctype html><html lang="ru" data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${S.report.title(project.name).replace(/</g, '&lt;')}</title><style>${css}</style></head><body><main class="content">${body}</main></body></html>`;
    void shareFile(html, `${project.name.replace(/[\\/:*?"<>|]+/g, '_') || 'room'}-report.html`, 'text/html');
  };
  return (
    <div class="screen report" ref={root}>
      <div class="btn-row no-print">
        <button type="button" class="btn btn--primary" onClick={() => window.print()}>{S.report.print}</button>
        <button type="button" class="btn" onClick={shareHtml}>{S.report.shareFile}</button>
      </div>
      <p class="muted small no-print">{S.report.printHint}</p>

      <Panel>
        <h2 class="report__title">{S.report.title(project.name)}</h2>
        <p class="muted small">{date} · {S.report.version(BUILD.sha)}</p>
        {busy && <p class="muted small no-print">{S.overview.computing}</p>}
      </Panel>

      <Panel title={S.report.room}>
        <table class="report-table">
          <tbody>
            <tr><th>{S.report.dims}</th><td>{fmt(room.depth, 2)} × {fmt(room.width, 2)} × {fmt(room.height, 2)} м, {fmt(reverb.volume, 1)} м³</td></tr>
            {SURFACES.map((sf, ki) => <tr key={ki}><th>{S.room.surfaces[sf]}</th><td>{getMaterial(room.materials[sf]).name}</td></tr>)}
            <tr><th>RT60 (500–1000 Гц)</th><td>{fmt(reverb.tMid, 2)} с</td></tr>
            <tr><th>{S.room.schroeder}</th><td>{fmt(reverb.schroeder, 0)} Гц</td></tr>
            <tr><th>{S.report.model}</th><td>{ev?.model === 'wave' ? S.model.waveTag : S.model.modalTag}</td></tr>
            {(room.extensions ?? []).map((e, ki) => <tr key={ki}><th>{S.openings.corridor}</th><td>{S.report.corridor(S.openings.wallsShort[e.wall], fmt(e.depth, 2), fmt(e.a1 - e.a0, 2))}</td></tr>)}
            {(room.openings ?? []).map((op, ki) => <tr key={ki}><th>{S.openings.opening}</th><td>{S.layout.openingFound(S.openings.wallsShort[op.wall], fmt(op.a1 - op.a0, 2), fmt(op.height, 2))}</td></tr>)}
          </tbody>
        </table>
      </Panel>

      <Panel title={S.report.score}>
        <p class="report__score"><strong>{o.score}</strong> / 100</p>
        <table class="report-table">
          <tbody>{o.subs.map((s) => <tr key={s.id}><th>{S.overview.subs[s.id]}</th><td>{s.value} — {s.note}</td></tr>)}</tbody>
        </table>
        <h3 class="subhead">{S.overview.problems}</h3>
        <ul class="plain-list small">
          {o.problems.slice(0, 10).map((p, ki) => <li key={ki}><strong>[{S.overview.sev[p.severity]}]</strong> {p.title}. {p.detail}</li>)}
        </ul>
      </Panel>

      <Panel title={S.report.placement}>
        <PlanView depth={room.depth} width={room.width} items={items} seats={ev?.seats ?? []} zones={room.zones} extensions={room.extensions} openings={room.openings} features={room.features} treatments={shownTreatments(room)} slope={room.slope} showKey={false} />
        <table class="report-table">
          <thead><tr><th>{S.report.what}</th><th>{S.report.fromFront}</th><th>{S.report.fromLeft}</th><th>{S.report.heightCol}</th></tr></thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id}><td>{it.kind === 'listener' ? S.report.listener : S.placement.sourceName(it.id)}</td><td>{fmt(it.pos.x, 2)}</td><td>{fmt(it.pos.y, 2)}</td><td>{fmt(it.pos.z, 2)}</td></tr>
            ))}
          </tbody>
        </table>
        {ev && <p class="small">{S.report.flatness(fmt(ev.score, 1), fmt(ev.fLo, 0), fmt(ev.fHi, 0))}</p>}
      </Panel>

      {subs.length > 0 && (
        <Panel title={S.report.subs}>
          <table class="report-table">
            <thead><tr><th>{S.report.what}</th><th>{S.tuning.delay}</th><th>{S.tuning.phase}</th><th>{S.tuning.gain}</th></tr></thead>
            <tbody>
              {subs.map((s) => {
                const v = current.subSettings[s.id] ?? { delayMs: 0, phaseDeg: 0, gainDb: 0 };
                return <tr key={s.id}><td>{S.placement.sourceName(s.id)}</td><td>{fmt(v.delayMs, 1)} мс</td><td>{fmt(v.phaseDeg, 0)}°</td><td>{fmt(v.gainDb, 1)} дБ</td></tr>;
              })}
            </tbody>
          </table>
          {current.crossoverHz && <p class="small">{S.report.crossover(fmt(current.crossoverHz, 0))}</p>}
        </Panel>
      )}

      {eq && eq.filters.length > 0 && (
        <Panel title={S.report.eq}>
          <table class="report-table">
            <thead><tr><th>№</th><th>{S.report.freq}</th><th>Q</th><th>{S.report.gainCol}</th></tr></thead>
            <tbody>{eq.filters.map((f, i) => <tr key={i}><td>{i + 1}</td><td>{fmt(f.f, 1)} Гц</td><td>{fmt(f.q, 2)}</td><td>{fmt(f.gainDb, 1)} дБ</td></tr>)}</tbody>
          </table>
          <p class="muted small">{S.report.eqNote}</p>
          <pre class="report-pre">{exportEqualizerAPO(eq.filters)}</pre>
        </Panel>
      )}

      <Panel title={S.report.modes}>
        <table class="report-table">
          <thead><tr><th>{S.report.freq}</th><th>{S.modes.colN}</th><th>T60</th><th>{S.overview.limit}</th></tr></thead>
          <tbody>{axial.map((d, ki) => <tr key={ki} class={d.t60 > d.limit ? 'is-over' : ''}><td>{fmt(d.f, 1)} Гц</td><td>{modeWhere(d.n)}</td><td>{fmt(d.t60, 2)} с</td><td>{fmt(d.limit, 2)} с</td></tr>)}</tbody>
        </table>
      </Panel>

      {(room.treatments ?? []).length > 0 && (
        <Panel title={S.treat.title}>
          <ul class="plain-list small">
            {(room.treatments ?? []).filter((t) => t.enabled !== false).map((t, ki) => (
              <li key={ki}>{S.treat.kinds[t.kind]}: {Math.round(t.thickness * 100)} см, {fmt(t.width, 2)} × {fmt(t.height, 2)} м{t.kind === 'corner' ? `, ${S.treat.corners[t.corner ?? 'front-left'].toLowerCase()} угол` : t.kind === 'panel' ? `, ${S.openings.wallsShort[t.wall ?? 'left']} стена, центр ${fmt(t.at ?? 0, 2)} м` : `, центр ${fmt(t.x ?? 0, 2)} × ${fmt(t.y ?? 0, 2)} м`}</li>
            ))}
          </ul>
          <p class="small">{room.treatmentsOn ? S.report.treatOn : S.report.treatOff}</p>
        </Panel>
      )}

      {current.measurement && (
        <Panel title={S.report.measurement}>
          <p class="small">{current.measurement.name}, {new Date(current.measurement.importedAt).toLocaleDateString('ru-RU')}. {room.calibration ? S.report.calibrated(fmt(room.calibration.dampingScale, 2)) : ''}</p>
        </Panel>
      )}
    </div>
  );
}
