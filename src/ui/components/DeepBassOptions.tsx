// Параметры цели «Глубже низ» (044): до какой частоты продлевать бас, допустимый спад и паспорт спада каждого сабвуфера.
import type { BassObjective, DeepDrop, Enclosure, SourceSpec, SubPassport } from '../../core/types';
import { DEEP_DROPS, DEEP_HZ_MAX, DEEP_HZ_MIN, DEFAULT_DROP, PASSPORT_MAX, PASSPORT_MIN, autoDeepHz, rolloffAt, subRolloff } from '../../core/deepBass';
import { NumberField, Segmented, Note } from '../design-system';
import { S } from '../strings';
import { fmt } from '../format';

const BOXES: Enclosure[] = ['ported', 'sealed'];

export function DeepBassOptions({ sources, value, onChange, onSources }: {
  sources: SourceSpec[]; value: BassObjective; onChange: (o: BassObjective) => void; onSources: (sources: SourceSpec[]) => void;
}) {
  const subs = sources.filter((s) => s.kind === 'sub');
  if (!subs.length) return <Note tone="warn">{S.deep.noSub}</Note>;
  const auto = autoDeepHz(sources)!;
  const setHz = (v: number) => {
    if (Number.isNaN(v)) {
      if (value.deepHz === undefined) return;
      const { deepHz: _hz, ...rest } = value;
      void _hz;
      onChange(rest);
    } else onChange({ ...value, deepHz: v });
  };
  // пустая точка паспорта — поле убирается; пустой паспорт не хранится
  const setPassport = (s: SourceSpec, patch: Partial<SubPassport>) => {
    const next: SubPassport = { ...s.passport, ...patch };
    for (const k of Object.keys(next) as (keyof SubPassport)[]) if (next[k] === undefined || Number.isNaN(next[k])) delete next[k];
    onSources(sources.map((x) => {
      if (x.id !== s.id) return x;
      const { passport: _p, ...rest } = x;
      void _p;
      return Object.keys(next).length ? { ...rest, passport: next } : rest;
    }));
  };
  const point = (v: number | undefined) => (v === undefined ? NaN : v);
  return (
    <>
      <NumberField
        id="deep-hz"
        label={S.deep.hz}
        value={value.deepHz ?? auto}
        unit="Гц"
        min={DEEP_HZ_MIN}
        max={DEEP_HZ_MAX}
        digits={0}
        optional
        hint={value.deepHz === undefined ? S.deep.hzAuto : S.deep.hzBack(fmt(auto, 0))}
        onChange={setHz}
      />
      <Segmented
        label={S.deep.drop}
        value={value.deepDrop ?? DEFAULT_DROP}
        options={DEEP_DROPS.map((d) => ({ value: d, label: S.deep.dropOpt(d) }))}
        onChange={(d: DeepDrop) => onChange({ ...value, deepDrop: d })}
      />
      <p class="muted small">{S.deep.dropHint}</p>
      <h4 class="subhead">{S.deep.passport}</h4>
      <p class="muted small">{S.deep.passportIntro}</p>
      {subs.map((s, i) => {
        const r = subRolloff(s);
        const name = S.placement.subRange(i + 1);
        return (
          <div key={s.id} class="sub-caps">
            <div class="range-row">
              <span class="range-row__label">{name}</span>
              <NumberField compact optional id={`${s.id}-f3`} label={S.deep.f3} value={point(s.passport?.f3)} unit="Гц" min={PASSPORT_MIN} max={PASSPORT_MAX} digits={1} onChange={(v) => setPassport(s, { f3: v })} />
              <NumberField compact optional id={`${s.id}-f10`} label={S.deep.f10} value={point(s.passport?.f10)} unit="Гц" min={PASSPORT_MIN} max={PASSPORT_MAX} digits={1} onChange={(v) => setPassport(s, { f10: v })} />
            </div>
            <Segmented
              label={`${S.deep.box} (${name.toLowerCase()})`}
              value={s.passport?.box ?? 'ported'}
              options={BOXES.map((b) => ({ value: b, label: S.deep.boxes[b] }))}
              onChange={(b: Enclosure) => setPassport(s, { box: b })}
            />
            <p class="muted small">{S.deep.curve(fmt(6 * r.order, 0), fmt(r.fc, 1), fmt(rolloffAt(r, 10), 1)) + S.deep.by[r.by]}</p>
            {r.conflict && <Note tone="warn">{S.deep.conflict}</Note>}
          </div>
        );
      })}
      <p class="muted small">{S.deep.boxHint}</p>
      <p class="muted small">{S.deep.model}</p>
    </>
  );
}
