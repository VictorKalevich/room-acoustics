// Различия двух конфигураций по областям (V2-028, V2-029): что во второй иначе, чем в первой.
import { DIFF_AREA_LABEL, diffConfigs, type DiffArea } from '../../application/experiment';
import type { RoomConfiguration } from '../../domain/model';

export function ChangeList({ a, b, title, empty = 'Конфигурации совпадают.' }: { a: RoomConfiguration; b: RoomConfiguration; title: string; empty?: string }) {
  const changes = diffConfigs(a, b);
  if (!changes.length) return <p class="al-text-small al-text-secondary">{empty}</p>;
  const areas = [...new Set(changes.map((c) => c.area))] as DiffArea[];
  return (
    <div class="al-stack al-stack--8" role="group" aria-label={title}>
      <h3 class="al-text-overline">{title}: {changes.length}</h3>
      <dl class="al-changes">
        {areas.map((area) => (
          <div key={area} class="al-changes__group">
            <dt class="al-changes__area">{DIFF_AREA_LABEL[area]}</dt>
            {changes.filter((c) => c.area === area).map((c) => <dd key={c.text} class="al-changes__item">{c.text}</dd>)}
          </div>
        ))}
      </dl>
    </div>
  );
}
