import { useId, useMemo, useState } from 'preact/hooks';
import type { ComponentProps } from 'preact';
import { ResponseChart } from './Charts';
import { Segmented } from '../design-system';
import { normalizeSmoothing, pickSmoothing, smoothChart, smoothingOptions, smoothingPosition, type ChartScreen, type ChartSmoothing } from '../chartSmoothing';
import { pointsPerOctave } from '../../core/precision';
import { S } from '../strings';

export function SmoothedResponseChart({ screen, ...chart }: ComponentProps<typeof ResponseChart> & { screen: ChartScreen }) {
  const key = `ra-chart-smoothing:${screen}`;
  const [setting, setSetting] = useState(() => {
    try { return normalizeSmoothing(JSON.parse(localStorage.getItem(key) ?? 'null'), screen); }
    catch { return normalizeSmoothing(null, screen); }
  });
  const save = (next: ChartSmoothing) => {
    setSetting(next);
    try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* keep the session preference */ }
  };
  // 026: набор точек зависит от подробности данных (основная кривая — последняя): 1/24 и 1/48 — только при повышенной точности
  const main = chart.lines[chart.lines.length - 1];
  const ppo = main ? pointsPerOctave(main.f) : 0;
  const options = smoothingOptions(screen, ppo);
  const pos = smoothingPosition(setting, options);
  const id = `smoothing-${useId()}`;
  const voice = screen === 'voice';
  const nativeLabel = (i: number) => `Исходная кривая ${options[i].label} октавы`;
  const label = setting.mode === 'psycho' ? 'Психоакустическое'
    : voice && pos === 0 ? `Исходная кривая · ${options[0].label} октавы`
      : pos === 0 ? 'Без дополнительного сглаживания' : `${options[pos].label} октавы`;
  const lines = useMemo(() => chart.lines.map((line) => ({ ...line, db: smoothChart(line.f, line.db, setting, screen, ppo) })), [chart.lines, setting, screen, ppo]);
  const fineAvailable = options.some((o) => o.base === null);
  return (
    <div class="smoothed-chart" data-screen={screen}>
      <div class="chart-controls">
        <Segmented label="Обработка графика" value={setting.mode} onChange={(mode) => save({ ...setting, mode })}
          options={[{ value: 'octave', label: 'Октавное' }, { value: 'psycho', label: 'Психоакустическое' }]} />
        <label class="field__label" for={setting.mode === 'octave' ? id : undefined}>Сглаживание: <strong>{label}</strong></label>
        {setting.mode === 'octave' && <>
          <input id={id} class="smoothing-slider" type="range" min="0" max={options.length - 1} step="1"
            value={pos} aria-label="Сглаживание графика" aria-valuetext={label}
            onInput={(e) => save(pickSmoothing(setting, options[Number(e.currentTarget.value)]))} />
          <div class="smoothing-stops" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
            {options.map((option, i) => <button key={option.label} type="button" class={pos === i ? 'is-on' : ''}
              aria-pressed={pos === i} aria-label={voice && i === 0 ? nativeLabel(0) : `Сглаживание ${option.label}`}
              onClick={() => save(pickSmoothing(setting, option))}>{option.label}</button>)}
          </div>
          <div class="smoothing-ends small muted"><span>Больше деталей</span><span>Общая форма</span></div>
        </>}
        <p class="small muted">{setting.mode === 'psycho'
          ? 'Приближённая оценка тонального баланса с акцентом на пики. Не показывает эхо и длительность затухания.'
          : 'Меняется только график. Оценки, карта и подбор остаются прежними.'}</p>
        {voice && <p class="small muted">{S.precision.voiceData(options[0].label)}</p>}
        {!fineAvailable && <p class="small muted">{voice ? S.precision.fineVoice : S.precision.fineBass}</p>}
      </div>
      <ResponseChart {...chart} lines={lines} referenceLines={chart.lines} />
    </div>
  );
}
