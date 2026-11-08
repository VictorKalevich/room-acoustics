// Эквалайзер по расчёту или замеру и экспорт фильтров.
import { useState } from 'preact/hooks';
import type { Project } from '../../../state/project';
import { evaluateSetup, type SetupEval } from '../../../core/system';
import { isWave } from '../../../core/geometry';
import { designEq, exportEqualizerAPO, exportMiniDSP, exportREW, type EqResult } from '../../../core/eq';
import { measurementAt } from '../../../core/measure';
import { compute } from '../../compute';
import { ResponseChart } from '../../components/Charts';
import { Panel, Segmented, Note, Details } from '../../components/Fields';
import { S } from '../../strings';
import { Term } from '../../components/Term';
import { Auralize } from '../../components/Auralize';
import { shareFile } from '../../audio/mic';
import { firLinearPhase, firMinPhase, linearPhaseLength, wavFloat32 } from '../../../core/dsp';
import { fmt } from '../../format';
import { ExportBlock } from './shared';
import { exportCamillaDSP } from '../../../core/camilla';

// ---------- Эквалайзер ----------

export function EqPanel({ project }: { project: Project }) {
  const { room, sources, constraints: c, current } = project;
  const m = current.measurement;
  const [source, setSource] = useState<'model' | 'measured'>('model');
  const [res, setRes] = useState<{ eq: EqResult; f: number[]; before: number[]; target: number[] } | null>(null);
  const [fs, setFs] = useState<48000 | 96000>(96000);
  const [exportTo, setExportTo] = useState<'apo' | 'rew' | 'minidsp' | 'camilla'>('apo');
  const [camillaXo, setCamillaXo] = useState(false);

  const [eqBusy, setEqBusy] = useState(false);
  const run = () => {
    if (isWave(room)) {
      setEqBusy(true);
      compute<SetupEval>('evaluate', { room, sources, constraints: c, setup: current, ppo: 48 }).promise
        .then((e) => { setEqBusy(false); finish(e); })
        .catch(() => setEqBusy(false));
    } else finish(evaluateSetup(room, sources, c, current, { ppo: 48 }));
  };
  const finish = (e: SetupEval) => {
    let f = e.response.f;
    let db = e.response.db;
    let target = e.response.target;
    if (source === 'measured' && m) {
      const meas = measurementAt(m, f);
      const idx = meas.map((v, i) => (v == null ? -1 : i)).filter((i) => i >= 0);
      f = idx.map((i) => e.response.f[i]);
      target = idx.map((i) => e.response.target[i]);
      const raw = idx.map((i) => meas[i] as number);
      const mean = raw.reduce((a, b) => a + b, 0) / raw.length - target.reduce((a, b) => a + b, 0) / target.length;
      db = raw.map((v) => v - mean);
    }
    // по замеру частоты пиков точные — фильтры могут быть уже; по модели — не уже Q = 8
    setRes({ eq: designEq(f, db, target, { maxQ: source === 'measured' ? 12 : 8 }), f, before: db, target });
  };

  return (
    <Panel title={S.tuning.eqTitle}>
      <p class="small">{S.tuning.eqIntro}</p>
      {m && (
        <Segmented label={S.tuning.eqSource} value={source} options={[{ value: 'model', label: S.tuning.eqModel }, { value: 'measured', label: S.tuning.eqMeasured }]} onChange={(v) => { setSource(v); setRes(null); }} />
      )}
      <button type="button" class="btn btn--primary" onClick={run} disabled={eqBusy}>{eqBusy ? S.model.computing : S.tuning.eqRun}</button>
      {res && res.eq.filters.length === 0 && <Note tone="good">{S.tuning.eqNone}</Note>}
      {res && res.eq.filters.length > 0 && (
        <>
          <p class="small"><strong>{S.tuning.eqImprove(fmt(res.eq.stdBefore, 1), fmt(res.eq.stdAfter, 1))}</strong></p>
          <table class="pos-table">
            <thead><tr><th>№</th><th>{S.tuning.eqColF}</th><th>{S.tuning.eqColG}</th><th>{S.tuning.eqColQ}</th></tr></thead>
            <tbody>
              {res.eq.filters.map((p, i) => (
                <tr key={i}><th scope="row">{i + 1}</th><td class="num">{fmt(p.f, 1)} Гц</td><td class="num">{fmt(p.gainDb, 1)} дБ</td><td class="num">{fmt(p.q, 2)}</td></tr>
              ))}
            </tbody>
          </table>
          <ResponseChart
            fLo={res.f[0]}
            fHi={res.f[res.f.length - 1]}
            lines={[
              { f: res.f, db: res.target, cls: 'is-target', dash: true },
              { f: res.f, db: res.before, cls: 'is-baseline' },
              { f: res.f, db: res.eq.after, cls: 'is-room' },
            ]}
          />
          <div class="legend">
            <span class="legend__item legend__item--room">{S.tuning.legendAfter}</span>
            <span class="legend__item legend__item--baseline">{S.tuning.legendBefore}</span>
          </div>
          <Note>{S.tuning.eqWhere}</Note>
          <h3 class="subhead">{S.tuning.eqExport}</h3>
          {/* один формат за раз: выбирают тот, что нужен для своего плеера или DSP */}
          <Segmented label={S.tuning.exportTo} value={exportTo} options={[{ value: 'apo' as const, label: 'APO' }, { value: 'rew' as const, label: 'REW' }, { value: 'minidsp' as const, label: 'miniDSP' }, { value: 'camilla' as const, label: 'Camilla' }]} onChange={setExportTo} />
          {exportTo === 'apo' && <ExportBlock id="eq-apo" title="Equalizer APO" text={exportEqualizerAPO(res.eq.filters)} file="eq-equalizer-apo.txt" />}
          {exportTo === 'rew' && <ExportBlock id="eq-rew" title="REW" text={exportREW(res.eq.filters)} file="eq-rew.txt" />}
          {exportTo === 'camilla' && (
            <>
              <p class="muted small">{S.tuning.camillaIntro}</p>
              {current.crossoverHz ? (
                <label class="check">
                  <input type="checkbox" checked={camillaXo} onChange={(e) => setCamillaXo((e.target as HTMLInputElement).checked)} />
                  <span>{S.tuning.camillaXo(fmt(current.crossoverHz, 0))}</span>
                </label>
              ) : null}
              <ExportBlock id="eq-camilla" title="CamillaDSP 3 (YAML)" text={exportCamillaDSP({ sources, eq: res.eq.filters, subSettings: current.subSettings, crossoverHz: current.crossoverHz, withCrossover: camillaXo })} file="camilladsp-room-acoustics.yml" />
            </>
          )}
          <Segmented label={S.tuning.sampleRate} value={fs} options={[{ value: 48000, label: '48 кГц' }, { value: 96000, label: '96 кГц' }]} onChange={setFs} />
          {exportTo === 'minidsp' && <ExportBlock id="eq-minidsp" title={`miniDSP biquad, ${fs / 1000} кГц`} text={exportMiniDSP(res.eq.filters, fs)} file={`eq-minidsp-${fs / 1000}k.txt`} />}
          <h4 class="subhead">{S.fir.title}</h4>
          <p class="muted small">{S.fir.intro} <Term id="fir">FIR</Term>.</p>
          <div class="btn-row">
            <button type="button" class="btn btn--small" onClick={() => shareFile(wavFloat32([firMinPhase(res.eq.filters, fs)], fs), `eq-fir-minphase-${fs / 1000}k.wav`, 'audio/wav')}>{S.fir.min(fs / 1000)}</button>
            <button type="button" class="btn btn--small" onClick={() => shareFile(wavFloat32([firLinearPhase(res.eq.filters, fs)], fs), `eq-fir-linphase-${fs / 1000}k.wav`, 'audio/wav')}>{S.fir.lin(fs / 1000)}</button>
          </div>
          <p class="muted small">{S.fir.note(fs / 1000, fmt(linearPhaseLength(res.eq.filters, fs) / 2 / fs, 2))}</p>
          <Details summary={S.aural.title}>
            <Auralize response={{ f: res.f, db: res.before, target: res.target }} filters={res.eq.filters} />
          </Details>
        </>
      )}
      {res && res.eq.dips.length > 0 && (
        <>
          <h3 class="subhead">{S.tuning.eqDips}</h3>
          <ul class="plain-list small">{res.eq.dips.map((d, ki) => <li key={ki}>{fmt(d.f, 0)} Гц: {fmt(d.depth, 1)} дБ</li>)}</ul>
        </>
      )}
    </Panel>
  );
}
