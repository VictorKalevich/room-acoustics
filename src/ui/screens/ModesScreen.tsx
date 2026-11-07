import { useState } from 'preact/hooks';
import type { Mode, ReverbResult, Room } from '../../core/types';
import { bonelloCheck, modeIssues, proportionsNotes } from '../../core/modes';
import { ModeChart } from '../components/Charts';
import { Panel, Note, Details } from '../components/Fields';
import { S } from '../strings';
import { fmt } from '../format';

export function ModesScreen({ room, modes, fMax, reverb }: { room: Room; modes: Mode[]; fMax: number; reverb: ReverbResult }) {
  const [showAll, setShowAll] = useState(false);
  const notes = proportionsNotes(room);
  const issues = modeIssues(modes, Math.min(fMax, 200));
  const bonello = bonelloCheck(modes, Math.min(fMax, 200));
  const axial = modes.filter((m) => m.kind === 'axial');
  const shown = showAll ? modes : modes.filter((m) => m.f <= Math.min(fMax, 150));

  return (
    <div class="screen">
      <Panel class="panel--hero">
        <div class="stat-row">
          <div class="stat">
            <span class="stat__value">{modes[0] ? fmt(modes[0].f, 1) : '—'} <small>Гц</small></span>
            <span class="stat__label">{S.modes.first}</span>
          </div>
          <div class="stat">
            <span class="stat__value">{fmt(reverb.schroeder, 0)} <small>Гц</small></span>
            <span class="stat__label">{S.room.schroeder}</span>
          </div>
        </div>
        <ModeChart modes={modes} fMax={fMax} schroeder={reverb.schroeder} />
        <div class="legend">
          <span class="legend__item legend__item--axial">{S.modes.kinds.axial}</span>
          <span class="legend__item legend__item--tangential">{S.modes.kinds.tangential}</span>
          <span class="legend__item legend__item--oblique">{S.modes.kinds.oblique}</span>
        </div>
        <p class="muted small">{S.modes.count(modes.length, Math.round(fMax))}. {S.modes.chartCaption}</p>
      </Panel>

      <Panel title={S.modes.proportions}>
        {notes.length ? notes.map((n) => <Note tone="warn">{n}</Note>) : <Note tone="good">{S.modes.proportionsOk}</Note>}
        {issues.clusters.length > 0 && (
          <>
            <h3 class="subhead">{S.modes.clusters}</h3>
            <ul class="plain-list">
              {issues.clusters.map((c) => <li>{fmt(c.f1, 1)} и {fmt(c.f2, 1)} Гц</li>)}
            </ul>
          </>
        )}
        {issues.gaps.length > 0 && (
          <>
            <h3 class="subhead">{S.modes.gaps}</h3>
            <ul class="plain-list">
              {issues.gaps.map((c) => <li>{fmt(c.f1, 1)} – {fmt(c.f2, 1)} Гц</li>)}
            </ul>
          </>
        )}
        <h3 class="subhead">{S.modes.bonello}</h3>
        <p class="small">
          {bonello.ok ? S.modes.bonelloOk : S.modes.bonelloBad(bonello.violations.map((v) => fmt(v, v < 40 ? 1 : 0)).join(', '))}
        </p>
        <p class="muted small">Осевых мод ниже 200 Гц: {axial.filter((m) => m.f <= 200).length}.</p>
      </Panel>

      <Panel title={S.modes.table}>
        <div class="table-scroll">
          <table class="modes-table">
            <thead>
              <tr>
                <th>{S.modes.colF}</th>
                <th>{S.modes.colN}</th>
                <th>{S.modes.colKind}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((m) => (
                <tr class={`is-${m.kind}`}>
                  <td class="num">{fmt(m.f, 1)}</td>
                  <td class="num">{m.n.join(' ')}</td>
                  <td>
                    {S.modes.kinds[m.kind]}
                    {m.degenerate && <span class="tag">{S.modes.degenerate}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!showAll && modes.length > shown.length && (
          <button type="button" class="btn btn--ghost" onClick={() => setShowAll(true)}>
            Показать все {modes.length}
          </button>
        )}
        <Details summary="Допущения">
          <p class="small">{S.modes.assumptions}</p>
        </Details>
      </Panel>
    </div>
  );
}
