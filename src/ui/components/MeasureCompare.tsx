// «До и после»: текущий замер против одного из прошлых той же расстановки.
import { useMemo, useState } from 'preact/hooks';
import type { Measurement, Setup } from '../../core/types';
import { compareTakes, type TakeStats } from '../../core/measure';
import { ResponseChart } from './Charts';
import { Note, SelectField } from '../design-system';
import { S } from '../strings';
import { fmt } from '../format';

const NONE: Measurement[] = [];
const signed = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${fmt(Math.abs(v), 1)}`;

export function MeasureCompare({ setup, onSetup }: { setup: Setup; onSetup: (s: Setup) => void }) {
  const m = setup.measurement;
  const hist = setup.history ?? NONE;
  const [pick, setPick] = useState(0);
  const idx = Math.min(pick, Math.max(0, hist.length - 1));
  const res = useMemo(() => {
    if (!m || !hist[idx]) return null;
    try { return compareTakes(hist[idx], m); } catch (e) { return (e as Error).message; }
  }, [m, hist, idx]);
  if (!m || !hist.length) return null;

  const date = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  };
  // значение и частота — двумя строками: на ширине телефона три колонки иначе не помещаются
  const row = (label: string, get: (s: TakeStats) => [string, string?], r: Exclude<typeof res, string | null>) => (
    <tr>
      <th scope="row">{label}</th>
      {[r.statsBefore, r.statsAfter].map((st, i) => {
        const [v, f] = get(st);
        return <td key={i} class="num"><span class="v">{v}</span>{f && <span class="f">{f}</span>}</td>;
      })}
    </tr>
  );
  let verdict: { text: string; tone: 'good' | 'warn' } | null = null;
  if (res && typeof res !== 'string') {
    const d = res.statsAfter.rms - res.statsBefore.rms;
    verdict = d < -0.5 ? { text: S.compare.better(fmt(-d, 1)), tone: 'good' } : d > 0.5 ? { text: S.compare.worse(fmt(d, 1)), tone: 'warn' } : { text: S.compare.same, tone: 'good' };
  }

  return (
    <div class="measure-compare" data-testid="measure-compare">
      <h3 class="subhead">{S.compare.title}</h3>
      <p class="muted small">{S.compare.intro}</p>
      {hist.length > 1 && (
        <SelectField
          label={S.compare.with}
          value={String(idx)}
          options={hist.map((h, i) => ({ value: String(i), label: `${h.name}${date(h.importedAt) ? `, ${date(h.importedAt)}` : ''}` }))}
          onChange={(v) => setPick(Number(v))}
        />
      )}
      {hist.length === 1 && <p class="small">{S.compare.withOne(hist[0].name, date(hist[0].importedAt))}</p>}
      {typeof res === 'string' && <Note tone="warn">{res}</Note>}
      {res && typeof res !== 'string' && (
        <>
          <ResponseChart
            fLo={res.fLo}
            fHi={res.fHi}
            lines={[
              { f: res.f, db: res.before, cls: 'is-before', dash: true },
              { f: res.f, db: res.after, cls: 'is-room' },
            ]}
          />
          <p class="muted small">{S.compare.legend(fmt(res.fLo, 0), fmt(res.fHi, 0))}</p>
          <table class="rt-table compare-table">
            <thead><tr><th /><th scope="col">{S.compare.before}</th><th scope="col">{S.compare.after}</th></tr></thead>
            <tbody>
              {row(S.compare.rms, (s) => [`${fmt(s.rms, 1)} дБ`], res)}
              {row(S.compare.peak, (s) => [`${signed(s.peak.db)} дБ`, `${fmt(s.peak.f, 0)} Гц`], res)}
              {row(S.compare.dip, (s) => [`${signed(s.dip.db)} дБ`, `${fmt(s.dip.f, 0)} Гц`], res)}
            </tbody>
          </table>
          {verdict && <Note tone={verdict.tone}>{verdict.text}</Note>}
        </>
      )}
      <div class="btn-row">
        <button type="button" class="btn btn--small btn--ghost" onClick={() => { onSetup({ ...setup, history: [] }); setPick(0); }}>{S.compare.forget}</button>
      </div>
    </div>
  );
}
