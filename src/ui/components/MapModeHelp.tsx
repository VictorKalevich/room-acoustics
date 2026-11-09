// Что показывает карта в режимах «Место слушателя» / «Место сабвуфера»: строка-подсказка под переключателем
// и разворачивающееся пояснение обоих режимов (как «Что на плане»).
import { S } from '../strings';

export type MapMode = 'listener' | 'sub';

/** where: «manual» — значки можно двигать; «auto» — карта выбранного варианта, двигать — в ручном режиме. */
export function MapModeHelp({ mode, where, sub = 'С1' }: { mode: MapMode; where: 'manual' | 'auto'; sub?: string }) {
  const t = S.mapHelp;
  return (
    <div class="map-help">
      <p class="map-help__line small">
        {mode === 'listener' ? t.lineListener : t.lineSub} {where === 'manual' ? (mode === 'listener' ? t.moveListener : t.moveSub(sub)) : t.moveAuto}
      </p>
      <details class="details map-help__more">
        <summary>{t.title}</summary>
        <div class="map-help__modes">
          <div class={`map-help__mode${mode === 'listener' ? ' is-on' : ''}`}>
            <strong>{S.manual.findListener}</strong>
            <p class="small">{t.listener}</p>
          </div>
          <div class={`map-help__mode${mode === 'sub' ? ' is-on' : ''}`}>
            <strong>{S.manual.findSub}</strong>
            <p class="small">{t.sub}</p>
          </div>
          <p class="muted small">{where === 'manual' ? t.noteManual : t.noteAuto}</p>
        </div>
      </details>
    </div>
  );
}
