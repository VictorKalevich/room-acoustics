// Замер REW: сравнение с расчётом и уточнение модели.
import { useMemo, useRef, useState } from 'preact/hooks';
import type { Project } from '../../../state/project';
import type { Leakage, Room, Setup } from '../../../core/types';
import { DAMPING_MODEL } from '../../../core/types';
import { isWave } from '../../../core/geometry';
import { useEffect } from 'preact/hooks';
import { compareMeasurement, parseRew, type CalibrationResult, type Comparison } from '../../../core/measure';
import { compute } from '../../compute';
import { ResponseChart } from '../../components/Charts';
import { Panel, Note } from '../../design-system';
import { S } from '../../strings';
import { fmt } from '../../format';
import { MeasureCompare } from '../../components/MeasureCompare';
import { withMeasurement } from '../../../state/variant';

// ---------- Замер REW ----------

export function MeasurePanel({ project, onRoom, onSetup }: { project: Project; onRoom: (r: Room) => void; onSetup: (s: Setup) => void }) {
  const { room, sources, constraints: c, current } = project;
  const m = current.measurement;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cal, setCal] = useState<CalibrationResult | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const wave = isWave(room);
  const cmpSync = useMemo(() => {
    if (!m || wave) return null;
    try { return compareMeasurement(room, sources, c, current, m); } catch (e) { return { error: (e as Error).message }; }
  }, [m, room, sources, c, current, wave]);
  const [cmpAsync, setCmpAsync] = useState<Comparison | { error: string } | null>(null);
  useEffect(() => {
    if (!m || !wave) { setCmpAsync(null); return; }
    const j = compute('compare', { room, sources, constraints: c, setup: current, measurement: m });
    j.promise.then(setCmpAsync).catch((e) => setCmpAsync({ error: e.message }));
    return () => j.cancel();
  }, [m, room, sources, c, current, wave]);
  const cmp = wave ? cmpAsync : cmpSync;

  const load = async (f: File) => {
    setError(null);
    setCal(null);
    try {
      onSetup(withMeasurement(current, parseRew(await f.text(), f.name)));
    } catch (e) {
      setError((e as Error).message);
    }
  };
  // подстройка считается секунды: к её концу комнату могли изменить — правим последнюю, а не ту, что была при нажатии
  const roomRef = useRef(room);
  useEffect(() => { roomRef.current = room; }, [room]);
  const runCal = () => {
    if (!m) return;
    setBusy(true);
    compute('calibrate', { room, sources, constraints: c, setup: current, measurement: m }).promise
      .then((r) => {
        setCal(r);
        setBusy(false);
        // 022: запоминаем, по какому замеру подстроено и какая герметичность была выбрана до подстройки
        const now = roomRef.current;
        const leakageBefore = now.calibration?.leakageBefore ?? now.leakage;
        onRoom({ ...now, leakage: r.leakage, calibration: { dampingScale: r.dampingScale, model: DAMPING_MODEL, source: m.name, leakageBefore } });
      })
      .catch((e) => { setError(e.message); setBusy(false); });
  };

  return (
    <Panel title={S.tuning.measureTitle}>
      <p class="small">{S.tuning.measureIntro}</p>
      <input
        ref={input}
        id="rew-file"
        type="file"
        accept=".txt,.csv,text/plain"
        class="visually-hidden"
        onChange={(e) => {
          const f = (e.target as HTMLInputElement).files?.[0];
          if (f) load(f);
          (e.target as HTMLInputElement).value = '';
        }}
      />
      <div class="btn-row">
        <button type="button" class="btn" onClick={() => input.current?.click()}>{S.tuning.measureLoad}</button>
        {m && <button type="button" class="btn btn--ghost" onClick={() => { onSetup({ ...current, measurement: null }); setCal(null); }}>{S.tuning.measureRemove}</button>}
      </div>
      {error && <Note tone="warn">{error}</Note>}
      {m && cmp && 'error' in cmp && <Note tone="warn">{cmp.error}</Note>}
      {m && cmp && !('error' in cmp) && (
        <>
          <p class="muted small">{m.name}</p>
          <ResponseChart
            fLo={cmp.f[0]}
            fHi={cmp.f[cmp.f.length - 1]}
            lines={[
              { f: cmp.f, db: cmp.model, cls: 'is-baseline' },
              { f: cmp.f, db: cmp.measured, cls: 'is-measured' },
            ]}
          />
          <div class="legend">
            <span class="legend__item legend__item--measured">{S.tuning.legendMeasured}</span>
            <span class="legend__item legend__item--baseline">{cmp.averaged ? S.tuning.legendModelAvg : S.tuning.legendModel}</span>
          </div>
          <p class="small"><strong>{S.tuning.measureRms(fmt(cmp.rms, 1))}</strong></p>
          <p class="muted small">{S.tuning.measureHow}</p>
          <div class="btn-row">
            <button type="button" class="btn btn--primary" onClick={runCal} disabled={busy}>{busy ? S.tuning.calibrating : S.tuning.calibrate}</button>
            {room.calibration && (
              <button type="button" class="btn btn--ghost" onClick={() => { onRoom({ ...room, calibration: null, leakage: room.calibration?.leakageBefore ?? room.leakage }); setCal(null); }}>{S.tuning.resetCalibration}</button>
            )}
          </div>
          {cal && (
            <Note tone="good">
              {S.tuning.calibrated(fmt(cal.dampingScale, 2), S.zones.leakages[cal.leakage as Leakage].toLowerCase(), fmt(cal.rmsBefore, 1), fmt(cal.rmsAfter, 1))}
            </Note>
          )}
        </>
      )}
      <MeasureCompare setup={current} onSetup={onSetup} />
    </Panel>
  );
}
