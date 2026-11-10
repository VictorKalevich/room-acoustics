import { useId, useMemo, useState } from 'preact/hooks';
import type { ComponentProps } from 'preact';
import { ResponseChart } from './Charts';
import { Segmented } from './Fields';
import { normalizeSmoothing, smoothChart, smoothingOptions, type ChartScreen, type ChartSmoothing } from '../chartSmoothing';

export function SmoothedResponseChart({ screen, ...chart }: ComponentProps<typeof ResponseChart> & { screen: ChartScreen }) {
  const key = `ra-chart-smoothing:${screen}`;
  const [setting, setSetting] = useState(() => {
    try { return normalizeSmoothing(JSON.parse(localStorage.getItem(key) ?? 'null'), screen); }
    catch { return normalizeSmoothing(null, screen); }
  });
  const set = (patch: Partial<ChartSmoothing>) => {
    const next = { ...setting, ...patch };
    setSetting(next);
    try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* keep the session preference */ }
  };
  const options = smoothingOptions(screen);
  const id = `smoothing-${useId()}`;
  const native = screen === 'voice' && setting.index === 0;
  const label = setting.mode === 'psycho' ? 'Психоакустическое'
    : native ? 'Исходная кривая · 1/6 октавы'
      : setting.index === 0 ? 'Без дополнительного сглаживания' : `${options[setting.index].label} октавы`;
  const lines = useMemo(() => chart.lines.map((line) => ({ ...line, db: smoothChart(line.f, line.db, setting, screen) })), [chart.lines, setting, screen]);
  return (
    <div class="smoothed-chart" data-screen={screen}>
      <div class="chart-controls">
        <Segmented label="Обработка графика" value={setting.mode} onChange={(mode) => set({ mode })}
          options={[{ value: 'octave', label: 'Октавное' }, { value: 'psycho', label: 'Психоакустическое' }]} />
        <label class="field__label" for={setting.mode === 'octave' ? id : undefined}>Сглаживание: <strong>{label}</strong></label>
        {setting.mode === 'octave' && <>
          <input id={id} class="smoothing-slider" type="range" min="0" max={options.length - 1} step="1"
            value={setting.index} aria-label="Сглаживание графика" aria-valuetext={label}
            onInput={(e) => set({ index: Number(e.currentTarget.value) })} />
          <div class="smoothing-stops" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
            {options.map((option, i) => <button key={option.label} type="button" class={setting.index === i ? 'is-on' : ''}
              aria-pressed={setting.index === i} aria-label={screen === 'voice' && i === 0 ? 'Исходная кривая 1/6 октавы' : `Сглаживание ${option.label}`}
              onClick={() => set({ index: i })}>{option.label}</button>)}
          </div>
          <div class="smoothing-ends small muted"><span>Больше деталей</span><span>Общая форма</span></div>
        </>}
        <p class="small muted">{setting.mode === 'psycho'
          ? 'Приближённая оценка тонального баланса с акцентом на пики. Не показывает эхо и длительность затухания.'
          : 'Меняется только график. Оценки, карта и подбор остаются прежними.'}</p>
        {screen === 'voice' && <p class="small muted">Исходные данные уже усреднены по 1/6 октавы. Более мелкие детали здесь не восстанавливаются.</p>}
      </div>
      <ResponseChart {...chart} lines={lines} referenceLines={chart.lines} />
    </div>
  );
}
