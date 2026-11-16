// Параметры цели «Глубже низ» (044): до какой частоты продлевать бас и допустимый спад. Паспорт спада сабвуфера —
// в «Системе» (045), цель читает его оттуда.
import type { BassObjective, DeepDrop, SourceSpec } from '../../core/types';
import { DEEP_DROPS, DEEP_HZ_MAX, DEEP_HZ_MIN, DEFAULT_DROP, autoDeepHz } from '../../core/deepBass';
import { NumberField, Segmented, Note } from '../design-system';
import { S } from '../strings';
import { fmt } from '../format';

export function DeepBassOptions({ sources, value, onChange }: {
  sources: SourceSpec[]; value: BassObjective; onChange: (o: BassObjective) => void;
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
      <p class="muted small">{S.deep.passportWhere}</p>
      <p class="muted small">{S.deep.model}</p>
    </>
  );
}
