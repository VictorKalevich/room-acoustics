// Выбор цели подбора мест для баса: ровность, провалы, широкие провалы внизу, провалы на модах.
import { useMemo } from 'preact/hooks';
import type { BassObjective, ModePreset, ObjectiveId, Room } from '../../core/types';
import { computeModes } from '../../core/modes';
import { DEFAULT_OBJECTIVE, objectiveModes } from '../../core/objective';
import { isWave } from '../../core/geometry';
import { Segmented, SelectField, Note } from './Fields';
import { S } from '../strings';
import { fmt } from '../format';

const IDS: ObjectiveId[] = ['flat', 'dips', 'lowDips', 'wideLow', 'modes'];
const PRESETS: ModePreset[] = ['first', 'axial', 'lowest', 'custom'];

const nKey = (n: readonly number[]) => n.join(' ');

/** Полоса, в которой оцениваются моды (как у расчёта: от нижней границы системы до 200 Гц). */
export function ObjectivePicker({ room, value, onChange, band }: { room: Room; value: BassObjective | undefined; onChange: (o: BassObjective) => void; band: [number, number] }) {
  const o = value ?? DEFAULT_OBJECTIVE;
  const preset = o.modePreset ?? 'first';
  const counted = useMemo(() => (o.id === 'modes' ? objectiveModes(room, o, band[0], band[1]) : []), [room, o, band]);
  // кандидаты для выбора вручную: первые 16 мод в полосе
  const choices = useMemo(() => computeModes(room, Math.max(band[1], 40), 10).filter((m) => m.f >= band[0] && m.f <= band[1]).slice(0, 16), [room, band]);
  const picked = new Set((o.modes ?? []).map(nKey));
  const toggle = (n: [number, number, number]) => {
    const k = nKey(n);
    const next = picked.has(k) ? (o.modes ?? []).filter((x) => nKey(x) !== k) : [...(o.modes ?? []), n];
    onChange({ ...o, modePreset: 'custom', modes: next });
  };

  return (
    <div class="objective">
      <SelectField
        label={S.objective.pick}
        value={o.id}
        options={IDS.map((id) => ({ value: id, label: S.objective.names[id] }))}
        onChange={(v) => onChange({ ...o, id: v as ObjectiveId })}
      />
      <p class="muted small">{S.objective.hints[o.id]}</p>
      {o.id === 'modes' && (
        <>
          <Segmented
            label={S.objective.presetLabel}
            value={preset}
            options={PRESETS.map((p) => ({ value: p, label: S.objective.presets[p] }))}
            // «Свои» начинаются с текущего набора — его удобно поправить, а не набирать заново
            onChange={(p) => onChange({ ...o, modePreset: p, ...(p === 'custom' && !(o.modes ?? []).length ? { modes: counted.map((m) => m.n) } : {}) })}
          />
          <p class="muted small">{S.objective.presetHints[preset]}</p>
          {preset === 'custom' && (
            <div class="chips" role="group" aria-label={S.objective.presetLabel}>
              {choices.map((m) => (
                <button key={nKey(m.n)} type="button" class={`chip${picked.has(nKey(m.n)) ? ' is-on' : ''}`} aria-pressed={picked.has(nKey(m.n))} onClick={() => toggle(m.n)}>
                  {fmt(m.f, 1)} Гц <small>{nKey(m.n)}</small>
                </button>
              ))}
            </div>
          )}
          {counted.length ? (
            <p class="small">
              {S.objective.counted}: {counted.map((m) => `${fmt(m.f, 0)} Гц (${nKey(m.n)})`).join(', ')}
            </p>
          ) : (
            <Note tone="warn">{preset === 'custom' && !(o.modes ?? []).length ? S.objective.pickSome : S.objective.none}</Note>
          )}
          {isWave(room) && <p class="muted small">{S.objective.approxWave}</p>}
        </>
      )}
    </div>
  );
}
