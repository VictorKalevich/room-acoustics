// Переключатели слоёв над планом: карта звука и оси комнаты. Выбор запоминается на устройстве.
import { useState } from 'preact/hooks';
import { S } from '../strings';

const KEY_MAP = 'ra-plan-map';
const KEY_AXES = 'ra-plan-axes';

function read(key: string, dflt: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v === null ? dflt : v === '1';
  } catch {
    return dflt;
  }
}
function write(key: string, v: boolean) {
  try { localStorage.setItem(key, v ? '1' : '0'); } catch { /* без хранилища — только на время сеанса */ }
}

/** Состояние слоёв плана: карта по умолчанию включена, оси — выключены. */
export function usePlanLayers() {
  const [map, setMap] = useState(() => read(KEY_MAP, true));
  const [axes, setAxes] = useState(() => read(KEY_AXES, false));
  return {
    map,
    axes,
    setMap: (v: boolean) => { setMap(v); write(KEY_MAP, v); },
    setAxes: (v: boolean) => { setAxes(v); write(KEY_AXES, v); },
  };
}

export function PlanLayers({ map, axes, setMap, setAxes }: ReturnType<typeof usePlanLayers>) {
  return (
    <div class="plan-layers" role="group" aria-label="Слои плана">
      <button type="button" class={`chip${map ? ' is-on' : ''}`} aria-pressed={map} onClick={() => setMap(!map)}>{S.layers.map}</button>
      <button type="button" class={`chip${axes ? ' is-on' : ''}`} aria-pressed={axes} onClick={() => setAxes(!axes)}>{S.layers.axes}</button>
    </div>
  );
}
