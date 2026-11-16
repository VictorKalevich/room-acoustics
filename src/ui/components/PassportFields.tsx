// Паспорт спада источника (044 — сабвуфер, 045 — колонки): частоты −3 и −10 дБ (любая может быть не указана), корпус
// и описание получившегося спада. Стоит в «Системе» под «Диапазоном».
import type { Enclosure, Passport, SourceSpec } from '../../core/types';
import { PASSPORT_MAX, PASSPORT_MIN, passportRolloff, rolloffAt } from '../../core/deepBass';
import { NumberField, Segmented, Note } from '../design-system';
import { S } from '../strings';
import { fmt } from '../format';

const BOXES: Enclosure[] = ['ported', 'sealed'];

export function PassportFields({ id, label, source, onChange }: {
  id: string; label: string; source: SourceSpec; onChange: (p: Passport | undefined) => void;
}) {
  const p = source.passport;
  // пустая точка — поле убирается; пустой паспорт не хранится
  const set = (patch: Partial<Passport>) => {
    const next: Passport = { ...p, ...patch };
    for (const k of Object.keys(next) as (keyof Passport)[]) if (next[k] === undefined || Number.isNaN(next[k])) delete next[k];
    onChange(Object.keys(next).length ? next : undefined);
  };
  const point = (v: number | undefined) => (v === undefined ? NaN : v);
  const r = passportRolloff(source);
  return (
    <div class="sub-caps">
      <div class="range-row">
        <span class="range-row__label">{label}</span>
        <NumberField compact optional id={`${id}-f3`} label={S.passport.f3} value={point(p?.f3)} unit="Гц" min={PASSPORT_MIN} max={PASSPORT_MAX} digits={1} onChange={(v) => set({ f3: v })} />
        <NumberField compact optional id={`${id}-f10`} label={S.passport.f10} value={point(p?.f10)} unit="Гц" min={PASSPORT_MIN} max={PASSPORT_MAX} digits={1} onChange={(v) => set({ f10: v })} />
      </div>
      <Segmented
        label={`${S.passport.box} (${label.toLowerCase()})`}
        value={p?.box ?? 'ported'}
        options={BOXES.map((b) => ({ value: b, label: S.passport.boxes[b] }))}
        onChange={(b: Enclosure) => set({ box: b })}
      />
      <p class="muted small">{p
        ? S.passport.curve(fmt(6 * r.order, 0), fmt(r.fc, 1), fmt(rolloffAt(r, 10), 1)) + S.passport.by[r.by]
        : S.passport.none + (source.kind === 'sub' ? S.passport.noneDeep : '')}</p>
      {r.conflict && <Note tone="warn">{S.passport.conflict}</Note>}
    </div>
  );
}
