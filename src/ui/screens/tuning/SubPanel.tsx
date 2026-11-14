// Сабвуфер: задержка, фаза, частота раздела; свои фильтры PEQ и all-pass.
import { evalPpo } from '../../../core/precision';
import { useState } from 'preact/hooks';
import type { Project } from '../../../state/project';
import type { Setup, SubSetting } from '../../../core/types';
import { hasAdjustments, optionsFor, type IntegrationResult } from '../../../core/integration';
import { biquad } from '../../../core/eq';
import { allpassBiquad, type SubFilterResult } from '../../../core/subfilters';
import { compute } from '../../compute';
import { ResponseChart } from '../../components/Charts';
import { NumberField, Panel, Segmented, Note, Details } from '../../design-system';
import { S } from '../../strings';
import { Term } from '../../components/Term';
import { fmt } from '../../format';
import { ExportBlock } from './shared';

// ---------- Сабвуфер ----------

export function SubPanel({ project, onSetup }: { project: Project; onSetup: (s: Setup) => void }) {
  const { room, sources, constraints: c, current } = project;
  const subs = sources.filter((s) => s.kind === 'sub' && current.positions[s.id]);
  const [res, setRes] = useState<IntegrationResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState(false);

  const run = () => {
    setBusy(true);
    setError(null);
    setApplied(false);
    compute('integrate', { room, sources, constraints: c, setup: current, ppo: evalPpo(project.precision) }).promise
      .then((r) => { setRes(r); setBusy(false); })
      .catch((e) => { setError(e.message); setBusy(false); });
  };
  const setOne = (id: string, patch: Partial<SubSetting>) => {
    const prev = current.subSettings[id] ?? { delayMs: 0, phaseDeg: 0, gainDb: 0 };
    onSetup({ ...current, subSettings: { ...current.subSettings, [id]: { ...prev, ...patch } } });
    setApplied(false);
  };
  const xoAdj = c.crossover.adjustable && sources.some((s) => s.kind === 'speaker');
  const [filtersReset, setFiltersReset] = useState(false);

  return (
    <Panel title={S.tuning.subTitle}>
      <p class="small">{S.tuning.subIntro}</p>
      {!hasAdjustments(sources, c) && <Note tone="warn">{S.sub.caps}: нет ни задержки, ни фазы, ни уровня. Укажите регулировки в «Расстановка → Система».</Note>}
      <button type="button" class="btn btn--primary" onClick={run} disabled={busy}>{busy ? S.tuning.running : S.tuning.run}</button>
      {error && <Note tone="warn">{error}</Note>}
      {res && (
        <div class="tuning-result">
          <div class="stat-row">
            <div class="stat"><span class="stat__value">{fmt(res.before, 1)} <small>дБ</small></span><span class="stat__label">{S.tuning.before}</span></div>
            <div class="stat"><span class="stat__value">{fmt(res.after, 1)} <small>дБ</small></span><span class="stat__label">{S.tuning.after}</span></div>
          </div>
          <table class="pos-table">
            <thead><tr><th /><th>{S.tuning.delay}</th><th>{S.tuning.phase}</th><th>{S.tuning.gain}</th></tr></thead>
            <tbody>
              {subs.map((s) => {
                const v = res.settings[s.id];
                return (
                  <tr key={s.id}>
                    <th scope="row">{S.placement.sourceName(s.id)}</th>
                    <td class="num">{s.delayMode === 'adjustable' ? `${fmt(v.delayMs, 1)} мс` : '—'}</td>
                    <td class="num">{s.phaseMode && s.phaseMode !== 'none' ? `${fmt(v.phaseDeg, 0)}°` : '—'}</td>
                    <td class="num">{s.levelAdjustable ? `${v.gainDb > 0 ? '+' : ''}${fmt(v.gainDb, 1)} дБ` : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {xoAdj && res.crossoverHz && <p class="small"><strong>{S.tuning.xo}:</strong> {fmt(res.crossoverHz, 0)} Гц</p>}
          <ResponseChart
            fLo={res.responseAfter.f[0]}
            fHi={res.responseAfter.f[res.responseAfter.f.length - 1]}
            lines={[
              { f: res.responseAfter.f, db: res.responseAfter.target, cls: 'is-target', dash: true },
              { f: res.responseBefore.f, db: res.responseBefore.db, cls: 'is-baseline' },
              { f: res.responseAfter.f, db: res.responseAfter.db, cls: 'is-room' },
            ]}
          />
          <div class="legend">
            <span class="legend__item legend__item--room">{S.tuning.after}</span>
            <span class="legend__item legend__item--baseline">{S.tuning.before}</span>
          </div>
          {res.notes.map((n, ki) => <Note key={ki}>{n}</Note>)}
          <button
            type="button"
            class="btn"
            disabled={applied}
            onClick={() => {
              const hadFilters = Object.values(current.subSettings).some((v) => (v.peq?.length ?? 0) + (v.allpass?.length ?? 0) > 0);
              onSetup({ ...current, subSettings: res.settings, crossoverHz: res.crossoverHz });
              setApplied(true);
              setFiltersReset(hadFilters && !Object.values(res.settings).some((v) => (v.peq?.length ?? 0) + (v.allpass?.length ?? 0) > 0));
            }}
          >
            {applied ? S.tuning.applied : S.tuning.apply}
          </button>
          {applied && filtersReset && <Note tone="warn">{S.subf.resetNote}</Note>}
        </div>
      )}
      <Details summary={S.tuning.manualSettings}>
        {subs.map((s) => {
          const v = current.subSettings[s.id] ?? { delayMs: 0, phaseDeg: 0, gainDb: 0 };
          const o = optionsFor(s);
          return (
            <div key={s.id} class="sub-settings">
              <span class="range-row__label">{S.placement.sourceName(s.id)}</span>
              <div class="grid-3">
                {o.delays.length > 1 && <NumberField compact id={`${s.id}-d`} label={S.tuning.delay} unit="мс" value={v.delayMs} min={0} max={s.maxDelayMs ?? 20} digits={1} onChange={(x) => setOne(s.id, { delayMs: x })} />}
                {s.phaseMode === 'polarity' && (
                  <Segmented label={S.tuning.phase} value={v.phaseDeg >= 90 ? 180 : 0} options={[{ value: 0, label: '0°' }, { value: 180, label: '180°' }]} onChange={(x) => setOne(s.id, { phaseDeg: x })} />
                )}
                {(s.phaseMode === 'continuous' || s.phaseMode === 'full') && (
                  <NumberField compact id={`${s.id}-p`} label={S.tuning.phase} unit="°" value={v.phaseDeg} min={0} max={s.phaseMode === 'full' ? 359 : 180} digits={0} onChange={(x) => setOne(s.id, { phaseDeg: x })} />
                )}
                {s.levelAdjustable && <NumberField compact id={`${s.id}-g`} label={S.tuning.gain} unit="дБ" value={v.gainDb} min={-6} max={6} digits={1} onChange={(x) => setOne(s.id, { gainDb: x })} />}
              </div>
            </div>
          );
        })}
        {xoAdj && (
          <NumberField id="xo" label={S.tuning.xo} unit="Гц" value={current.crossoverHz ?? Math.max(...sources.filter((s) => s.kind === 'sub').map((s) => s.fHigh))} min={c.crossover.min} max={c.crossover.max} digits={0} onChange={(x) => onSetup({ ...current, crossoverHz: x })} />
        )}
        {xoAdj && current.crossoverHz != null && (current.crossoverHz < (c.crossover.spkLimit ?? -Infinity) || current.crossoverHz > (c.crossover.subLimit ?? Infinity)) && (
          <Note tone="warn">{S.sub.xoOutside(c.crossover.spkLimit != null ? fmt(c.crossover.spkLimit, 0) : '…', c.crossover.subLimit != null ? fmt(c.crossover.subLimit, 0) : '…')}</Note>
        )}
      </Details>
      <Details summary={S.subf.title}>
        <SubFiltersBlock project={project} onSetup={onSetup} />
      </Details>
    </Panel>
  );
}
// ---------- Свои фильтры сабвуферов (PEQ и all-pass) ----------

function SubFiltersBlock({ project, onSetup }: { project: Project; onSetup: (s: Setup) => void }) {
  const { room, sources, constraints: c, current } = project;
  const subs = sources.filter((s) => s.kind === 'sub' && current.positions[s.id]);
  const capable = subs.filter((s) => (s.peqBands ?? 0) > 0 || s.allpass);
  const [res, setRes] = useState<SubFilterResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [applied, setApplied] = useState(false);
  const [fs, setFs] = useState(48000);
  const run = () => {
    setBusy(true);
    setApplied(false);
    compute('subFilters', { room, sources, constraints: c, setup: current, ppo: evalPpo(project.precision) })
      .promise.then((r) => { setRes(r); setBusy(false); })
      .catch(() => setBusy(false));
  };
  const textFor = (id: string, set?: SubSetting) => {
    const lines = [`# ${S.placement.sourceName(id)}`];
    (set?.peq ?? []).forEach((p) => lines.push(`Filter: ON PK Fc ${p.f.toFixed(1)} Hz Gain ${p.gainDb.toFixed(1)} dB Q ${p.q.toFixed(2)}`));
    (set?.allpass ?? []).forEach((p) => lines.push(`Filter: ON AP Fc ${p.f.toFixed(1)} Hz Q ${p.q.toFixed(2)}`));
    return lines.join('\n');
  };
  const dspFor = (set?: SubSetting) => {
    const out: string[] = [];
    let i = 1;
    for (const p of set?.peq ?? []) {
      const b = biquad(p, fs);
      out.push(`biquad${i++},`, `b0=${b.b0.toFixed(15)},`, `b1=${b.b1.toFixed(15)},`, `b2=${b.b2.toFixed(15)},`, `a1=${(-b.a1).toFixed(15)},`, `a2=${(-b.a2).toFixed(15)},`);
    }
    for (const p of set?.allpass ?? []) {
      const b = allpassBiquad(p, fs);
      out.push(`biquad${i++},`, `b0=${b.b0.toFixed(15)},`, `b1=${b.b1.toFixed(15)},`, `b2=${b.b2.toFixed(15)},`, `a1=${(-b.a1).toFixed(15)},`, `a2=${(-b.a2).toFixed(15)},`);
    }
    return out.join('\n');
  };
  return (
    <div class="subf">
      <p class="small">{S.subf.intro} <Term id="peq">PEQ</Term>, <Term id="allpass">all-pass</Term>.</p>
      {capable.length === 0 ? <Note>{S.subf.noCaps}</Note> : (
        <button type="button" class="btn btn--primary" disabled={busy} onClick={run}>{busy ? S.tuning.running : S.subf.run}</button>
      )}
      {res && (
        <>
          <div class="stat-row">
            <div class="stat"><span class="stat__value">{fmt(res.before, 1)} <small>дБ</small></span><span class="stat__label">{S.tuning.before}</span></div>
            <div class="stat"><span class="stat__value">{fmt(res.after, 1)} <small>дБ</small></span><span class="stat__label">{S.tuning.after}</span></div>
          </div>
          {subs.map((s) => {
            const set = res.settings[s.id];
            const n = (set?.peq?.length ?? 0) + (set?.allpass?.length ?? 0);
            return (
              <div key={s.id} class="sub-settings">
                <span class="range-row__label">{S.placement.sourceName(s.id)}</span>
                {n === 0 ? <p class="muted small">{S.subf.none}</p> : (
                  <ul class="plain-list small">
                    {(set?.peq ?? []).map((p, ki) => <li key={ki}>PEQ {fmt(p.f, 1)} Гц, {p.gainDb > 0 ? '+' : ''}{fmt(p.gainDb, 1)} дБ, Q {fmt(p.q, 1)}</li>)}
                    {(set?.allpass ?? []).map((p, ki) => <li key={ki}>All-pass {fmt(p.f, 1)} Гц, Q {fmt(p.q, 2)}</li>)}
                  </ul>
                )}
              </div>
            );
          })}
          <ResponseChart
            fLo={res.responseAfter.f[0]}
            fHi={res.responseAfter.f[res.responseAfter.f.length - 1]}
            lines={[
              { f: res.responseAfter.f, db: res.responseAfter.target, cls: 'is-target', dash: true },
              { f: res.responseBefore.f, db: res.responseBefore.db, cls: 'is-baseline' },
              { f: res.responseAfter.f, db: res.responseAfter.db, cls: 'is-room' },
            ]}
          />
          {res.notes.map((t, ki) => <Note key={ki}>{t}</Note>)}
          <button type="button" class="btn" disabled={applied} onClick={() => {
            // только фильтры: задержка, фаза и уровень могли измениться после подбора фильтров
            const merged = { ...current.subSettings };
            for (const [id, v] of Object.entries(res.settings)) merged[id] = { ...(merged[id] ?? { delayMs: v.delayMs, phaseDeg: v.phaseDeg, gainDb: v.gainDb }), peq: v.peq, allpass: v.allpass };
            onSetup({ ...current, subSettings: merged });
            setApplied(true);
          }}>
            {applied ? S.tuning.applied : S.tuning.apply}
          </button>
          <h4 class="subhead">{S.tuning.eqExport}</h4>
          <ExportBlock id="subf-apo" title="Equalizer APO" text={subs.map((s) => textFor(s.id, res.settings[s.id])).join('\n\n')} file="sub-filters-apo.txt" />
          <Segmented label="miniDSP, частота дискретизации" value={fs} options={[{ value: 48000, label: '48 кГц' }, { value: 96000, label: '96 кГц' }]} onChange={setFs} />
          {subs.map((s) => (
            <ExportBlock key={s.id} id={`subf-${s.id}`} title={`miniDSP: ${S.placement.sourceName(s.id)}`} text={dspFor(res.settings[s.id])} file={`sub-filters-${s.id}-${fs / 1000}k.txt`} />
          ))}
        </>
      )}
    </div>
  );
}
