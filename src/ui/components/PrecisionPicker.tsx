// Точность расчёта (026): общая настройка проекта для «Расстановки», «Настройки» и «Голоса».
// Собрана из Segmented и Note дизайн-системы; предупреждение о времени — при любом уровне выше стандартного.
import { PRECISIONS, normalizePrecision, type Precision } from '../../core/precision';
import { Note, Segmented } from '../design-system';
import { S } from '../strings';

export function PrecisionPicker({ value, onChange, where }: { value: Precision | undefined; onChange: (p: Precision) => void; where: 'bass' | 'voice' }) {
  const v = normalizePrecision(value);
  const t = S.precision;
  return (
    <>
      <Segmented label={t.title} value={v} options={PRECISIONS.map((p) => ({ value: p, label: t.names[p] }))} onChange={onChange} />
      <p class="muted small">{where === 'voice' ? t.voice[v] : t.bass[v]}</p>
      {v !== 'standard' && <Note tone="warn">{where === 'voice' ? t.slowVoice[v] : t.slow[v]}</Note>}
      <p class="muted small">{t.shared}</p>
    </>
  );
}
