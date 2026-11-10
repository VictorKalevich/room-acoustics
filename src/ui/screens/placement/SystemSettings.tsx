import { useMemo } from 'preact/hooks';
import type { Project } from '../../../state/project';
import { defaultSources, validateSources } from '../../../state/project';
import type { BassObjective, Constraints, SourceSpec, SubZone, PhaseMode } from '../../../core/types';
import { evalBand } from '../../../core/system';
import { NumberField, Segmented, Note, Details, SelectField } from '../../components/Fields';
import { SetupCard } from '../../components/SetupCard';
import { ObjectivePicker } from '../../components/ObjectivePicker';
import { S } from '../../strings';
import { fmtInt } from '../../format';

export function SystemSettings({ project, onSources, onConstraints }: {
  project: Project; onSources: (sources: SourceSpec[]) => void; onConstraints: (constraints: Constraints) => void;
}) {
  const { room, sources, constraints: c } = project;
  const spk = sources.filter((s) => s.kind === 'speaker');
  const subs = sources.filter((s) => s.kind === 'sub');
  const srcErrors = validateSources(sources);
  const band = useMemo(() => { const b = evalBand(room, sources); return [b.fLo, b.fHi] as [number, number]; }, [room, sources]);
  const setCounts = (nSpk: number, nSub: number) => {
    const next = defaultSources(nSpk, nSub);
    // сохраняем введённые пользователем диапазоны и высоты
    const firstSpk = spk[0];
    for (const s of next) {
      const old = sources.find((o) => o.id === s.id) ?? (s.kind === 'speaker' ? firstSpk : subs[0]);
      if (old && old.kind === s.kind) {
        const { id: _id, ...rest } = old;
        void _id;
        Object.assign(s, rest);
      }
    }
    // при появлении/исчезновении сабвуфера меняем нижнюю границу колонок по умолчанию
    if (nSub > 0 && subs.length === 0) next.forEach((s) => s.kind === 'speaker' && s.fLow < 80 && (s.fLow = 80));
    if (nSub === 0 && subs.length > 0) next.forEach((s) => s.kind === 'speaker' && s.fLow === 80 && (s.fLow = 50));
    onSources(next);
  };

  const updateSpeakers = (patch: Partial<SourceSpec>) =>
    onSources(sources.map((s) => (s.kind === 'speaker' ? { ...s, ...patch } : s)));
  const updateSource = (id: string, patch: Partial<SourceSpec>) =>
    onSources(sources.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  const updateSubs = (patch: Partial<SourceSpec>) =>
    onSources(sources.map((s) => (s.kind === 'sub' ? { ...s, ...patch } : s)));
  const setC = (patch: Partial<Constraints>) => onConstraints({ ...c, ...patch });

  // общие настройки обоих режимов: система, места и высота ушей, где может стоять сабвуфер, цель подбора
  const sharedBody = (
    <>
      <h3 class="subhead">{S.placement.system}</h3>
        <Segmented
          label={S.placement.speakers}
          value={spk.length}
          options={[{ value: 1, label: S.placement.speakersMono }, { value: 2, label: S.placement.speakersStereo }]}
          onChange={(n) => setCounts(n, subs.length)}
        />
        <Segmented
          label={S.placement.subs}
          value={subs.length}
          options={[0, 1, 2, 3, 4].map((n) => ({ value: n, label: n === 0 ? 'Нет' : String(n) }))}
          onChange={(n) => setCounts(spk.length, n)}
        />
        <h3 class="subhead">{S.placement.range}</h3>
        <RangeRow
          label={S.placement.speakerRange}
          lo={spk[0]?.fLow ?? 80}
          hi={spk[0]?.fHigh ?? 20000}
          onLo={(v) => updateSpeakers({ fLow: v })}
          onHi={(v) => updateSpeakers({ fHigh: v })}
        />
        {subs.map((s, i) => (
          <RangeRow key={s.id}
            label={S.placement.subRange(i + 1)}
            lo={s.fLow}
            hi={s.fHigh}
            onLo={(v) => updateSource(s.id, { fLow: v })}
            onHi={(v) => updateSource(s.id, { fHigh: v })}
          />
        ))}
        {srcErrors.map((e, ki) => <Note key={ki} tone="warn">{e.message}</Note>)}
        {subs.length > 0 && (
          <Details summary={S.sub.caps}>
            {subs.map((s, i) => (
              <div key={s.id} class="sub-caps">
                <span class="range-row__label">{S.placement.subRange(i + 1)}</span>
                <Segmented
                  label={S.sub.delay}
                  value={s.delayMode ?? 'none'}
                  options={[{ value: 'none', label: S.sub.delayModes.none }, { value: 'adjustable', label: S.sub.delayModes.adjustable }]}
                  onChange={(v) => updateSource(s.id, { delayMode: v as SourceSpec['delayMode'] })}
                />
                {s.delayMode === 'adjustable' && (
                  <NumberField id={`${s.id}-maxd`} label={S.sub.maxDelay} value={s.maxDelayMs ?? 20} unit="мс" min={1} max={50} digits={0} onChange={(v) => updateSource(s.id, { maxDelayMs: v })} />
                )}
                <SelectField
                  label={`${S.sub.phase} (${S.placement.subRange(i + 1).toLowerCase()})`}
                  value={s.phaseMode ?? 'none'}
                  options={(['none', 'polarity', 'continuous', 'full'] as PhaseMode[]).map((m) => ({ value: m, label: S.sub.phaseModes[m] }))}
                  onChange={(v) => updateSource(s.id, { phaseMode: v as PhaseMode })}
                />
                <label class="check">
                  <input type="checkbox" checked={!!s.levelAdjustable} onChange={(e) => updateSource(s.id, { levelAdjustable: (e.target as HTMLInputElement).checked })} />
                  <span>{S.sub.level}</span>
                </label>
                <Segmented
                  label={`${S.sub.peqBands} (${S.placement.subRange(i + 1).toLowerCase()})`}
                  value={s.peqBands ?? 0}
                  options={[0, 2, 4, 6, 10].map((n) => ({ value: n, label: n === 0 ? S.sub.none : String(n) }))}
                  onChange={(v) => updateSource(s.id, { peqBands: v })}
                />
                <label class="check">
                  <input type="checkbox" checked={!!s.allpass} onChange={(e) => updateSource(s.id, { allpass: (e.target as HTMLInputElement).checked })} />
                  <span>{S.sub.allpass}</span>
                </label>
              </div>
            ))}
            {spk.length > 0 && (
              <>
                <label class="check">
                  <input type="checkbox" checked={c.crossover.adjustable} onChange={(e) => setC({ crossover: { ...c.crossover, adjustable: (e.target as HTMLInputElement).checked } })} />
                  <span>{S.sub.crossover}</span>
                </label>
                {c.crossover.adjustable && (
                  <div class="grid-2">
                    <NumberField id="xo-min" label={S.sub.xoMin} value={c.crossover.min} unit="Гц" min={30} max={c.crossover.max - 10} digits={0} onChange={(v) => setC({ crossover: { ...c.crossover, min: v } })} />
                    <NumberField id="xo-max" label={S.sub.xoMax} value={c.crossover.max} unit="Гц" min={c.crossover.min + 10} max={250} digits={0} onChange={(v) => setC({ crossover: { ...c.crossover, max: v } })} />
                  </div>
                )}
              </>
            )}
          </Details>
        )}
        <Details summary={S.placement.heights}>
          <div class="grid-2">
            <NumberField label={S.placement.speakerHeight} value={spk[0]?.height ?? 1} unit="м" min={0} max={3} onChange={(v) => updateSpeakers({ height: v })} />
            {subs.length > 0 && (
              <NumberField label={S.placement.subHeight} value={subs[0].height} unit="м" min={0} max={3} onChange={(v) => updateSubs({ height: v })} />
            )}
          </div>
        </Details>
      <h3 class="subhead">{S.setup.places}</h3>
        {subs.length > 0 && (
          <Segmented
            label={S.placement.subZone}
            value={c.subZone}
            options={(['corners', 'walls', 'anywhere'] as SubZone[]).map((z) => ({ value: z, label: S.placement.zones[z] }))}
            onChange={(z) => setC({ subZone: z })}
          />
        )}
        <Segmented
          label={S.seats.count}
          value={c.seats.count}
          options={[1, 2, 3, 4, 5].map((n) => ({ value: n, label: String(n) }))}
          onChange={(n) => setC({ seats: { ...c.seats, count: n } })}
        />
        {c.seats.count > 1 && (
          <NumberField id="seat-spacing" label={S.seats.spacing} value={c.seats.spacing} unit="м" min={0.4} max={1.2} onChange={(v) => setC({ seats: { ...c.seats, spacing: v } })} />
        )}
        <p class="muted small">{S.seats.hint}</p>
        <Details summary={S.placement.earHeight}>
          <NumberField label={S.placement.earHeight} value={c.earHeight} unit="м" min={0.5} max={2} onChange={(v) => setC({ earHeight: v })} />
        </Details>
      <h3 class="subhead">{S.objective.title}</h3>
      <p class="muted small">{S.objective.intro}</p>
      <ObjectivePicker room={room} value={c.objective} onChange={(o: BassObjective) => setC({ objective: o })} band={band} />
    </>
  );
  const summary = S.setup.summary(
    spk.length, spk[0] ? `${fmtInt(spk[0].fLow)}–${fmtInt(spk[0].fHigh)}` : '',
    subs.length, subs[0] ? `${fmtInt(subs[0].fLow)}–${fmtInt(subs[0].fHigh)}` : '',
    c.seats.count, S.objective.names[c.objective?.id ?? 'flat'].toLowerCase(),
  );
  const sharedCard = <SetupCard title={S.setup.title} summary={summary}>{sharedBody}</SetupCard>;
  return sharedCard;
}

function RangeRow(p: { label: string; lo: number; hi: number; onLo: (v: number) => void; onHi: (v: number) => void }) {
  return (
    <div class="range-row">
      <span class="range-row__label">{p.label}</span>
      <NumberField compact label={S.placement.from} value={p.lo} unit="Гц" min={10} max={23999} digits={0} onChange={p.onLo} id={`${p.label}-lo`} />
      <NumberField compact label={S.placement.to} value={p.hi} unit="Гц" min={11} max={24000} digits={0} onChange={p.onHi} id={`${p.label}-hi`} />
    </div>
  );
}

