import { useMemo, useState } from 'preact/hooks';
import { maxBoostDb } from '../../core/micCurve';
import { FFT_SIZE } from '../../core/noise';
import type { NoiseView } from '../../core/noiseRecord';
import { bandPowers, SPECTRUM_HOP, SPECTRUM_SIZE, type SpectrumPeriod, type Weight } from '../../core/noiseSpectrum';
import { ResponseChart } from '../components/Charts';
import { Panel, SelectField } from '../design-system';
import { noisePlot } from '../noisePlot';
import { S } from '../strings';

export const levelText = (power?: number | null) =>
  power == null ? '—' : power === 0 ? '−∞' : (10 * Math.log10(power)).toFixed(1);

export function NoiseLevels({ meter, weight }: { meter: NoiseView | null; weight: Weight }) {
  const range = weight === 'Z' ? meter?.blockPower : meter?.spectral.range[weight];
  const power = weight === 'Z' ? meter?.sessionPower : meter?.spectral.leqPower(weight);
  const interval = weight === 'Z' ? FFT_SIZE : SPECTRUM_SIZE;
  const duration = meter ? (weight === 'Z' ? meter.history.length * FFT_SIZE / meter.sampleRate : meter.spectral.weightedSeconds) : 0;
  const peak = meter?.peakAmplitude;
  return <>
    <p>Leq за сеанс ({weight}) · {levelText(power)} dBFS · учтено {duration.toFixed(2)} с</p>
    <p>Минимум / максимум RMS ({weight}) · {levelText(range?.min)} / {levelText(range?.max)} dBFS</p>
    {meter && <p class="small">Интервал RMS и экстремумов · {(1000 * interval / meter.sampleRate).toFixed(1)} мс
      {weight !== 'Z' && ' · окно Ханна'}</p>}
    <p>Цифровой sample peak за сеанс · {levelText(peak == null ? null : peak * peak)} dBFS</p>
  </>;
}

const periods = [
  { value: 'now', label: 'Сейчас' }, { value: '10', label: 'Среднее за 10 с' },
  { value: '60', label: 'Среднее за 60 с' }, { value: 'session', label: 'Среднее за сеанс' },
];

/** periods — доступные периоды (056: у импорта schema 2/3 только сохранённый в файле). */
export function NoiseAnalysis({ meter, blocks, weight, period, onPeriod, view, onView, periods: allowed }: {
  meter: NoiseView | null; blocks: number; weight: Weight; period: SpectrumPeriod; onPeriod(v: SpectrumPeriod): void; view: string; onView(v: string): void;
  periods?: readonly SpectrumPeriod[];
}) {
  const [upper, setUpper] = useState('20000');
  const [floor, setFloor] = useState('-120');
  const [smoothing, setSmoothing] = useState('0');
  const corrected = !!meter?.profile && view === 'corrected';
  const spectrum = meter?.spectral;
  const average = useMemo(() => blocks ? spectrum?.average(period, weight, corrected) : undefined, [spectrum, blocks, period, weight, corrected]);
  const highHz = Math.min(Number(upper), (meter?.sampleRate ?? 48000) / 2);
  const plot = useMemo(() => average?.seconds && spectrum
    ? noisePlot(average.density, spectrum.binHz, highHz, Number(smoothing)) : null, [average, spectrum, highHz, smoothing]);
  const bands = useMemo(() => average?.seconds && spectrum ? bandPowers(average.density, spectrum.binHz) : [], [average, spectrum]);
  const empty = blocks ? 'Прогрев спектра · ожидаем полное непрерывное окно' : S.noise.empty;
  return <>
    <Panel title={S.noise.spectrum}>
      {meter?.profile && <>
        <SelectField label="Представление спектра" value={view} onChange={onView} options={[
          { value: 'corrected', label: 'С поправкой · ' + meter.profile.name + ' · v' + meter.profile.version },
          { value: 'raw', label: 'Исходный спектр' },
        ]} />
        <p class="small">Поправка в диапазоне {meter.profile.validRangeHz.join('–')} Гц, усиление до +{meter.profile.maxBoostDb ?? maxBoostDb} дБ. За границами сохранена исходная энергия.</p>
      </>}
      <div class="grid-2">
        <SelectField label="Спектр и полосы" value={period} options={allowed ? periods.filter(p => allowed.includes(p.value as SpectrumPeriod)) : periods}
          onChange={v => onPeriod(v as SpectrumPeriod)} />
        <SelectField label="Диапазон частот" value={upper} onChange={setUpper} options={[
          { value: '20000', label: '20 Гц – 20 кГц' }, { value: '250', label: '20–250 Гц' },
        ]} />
        <SelectField label="Шкала PSD" value={floor} onChange={setFloor} options={['-100', '-120', '-140']
          .map(value => ({ value, label: value + '…0 dBFS/Гц' }))} />
        <SelectField label="Сглаживание графика" value={smoothing} onChange={setSmoothing} options={['0', '3', '6', '12', '24']
          .map(value => ({ value, label: value === '0' ? 'Без сглаживания' : '1/' + value + ' октавы' }))} />
      </div>
      {plot && plot.peakHz != null ? <>
        <ResponseChart label={S.noise.spectrum} lines={[{ ...plot, cls: 'is-measured' }]} fLo={20} fHi={highHz}
          yRange={[Number(floor), 0]} yTicks={Array.from({ length: 1 - Number(floor) / 20 }, (_, i) => -20 * i)} />
        <p class="small">PSD ({weight}), dBFS/Гц · пик {plot.peakHz.toFixed(2)} Гц</p>
      </> : <p class="small">{average?.seconds ? 'Нет энергии в выбранном диапазоне' : empty}</p>}
      {corrected && average && average.seconds > 0 && <p>Уровень по PSD с поправкой ({weight}) за выбранный интервал · {levelText(average.density.reduce((sum, v) => sum + v, 0) * spectrum!.binHz)} dBFS</p>}
      {meter && <p class="small">FFT {SPECTRUM_SIZE} · шаг {spectrum!.binHz.toFixed(3)} Гц · окно {(SPECTRUM_SIZE / meter.sampleRate).toFixed(3)} с
        {' · интервал '}{(SPECTRUM_HOP / meter.sampleRate).toFixed(3)} с · учтено {(average?.seconds ?? 0).toFixed(2)} с</p>}
    </Panel>
    <Panel title="Энергия по полосам">
      <p class="small">Вес {weight} · доля энергии от 20 Гц до {Math.min(20000, (meter?.sampleRate ?? 48000) / 2)} Гц.
        {meter && meter.sampleRate < 40000 && ' Верхняя граница ограничена частотой Найквиста.'}</p>
      {bands.length ? bands.map(b => <div class="meter" key={b.lo}>
        <span class="meter__label">{b.lo}–{b.hi} Гц</span>
        <span class="meter__track" aria-hidden="true"><span class="meter__fill" style={{ width: (b.percent ?? 0) + '%' }} /></span>
        <span class="meter__value">{b.percent == null ? '—' : b.percent.toFixed(1) + ' %'} · {(b.power * average!.seconds).toExponential(2)} FS²·с</span>
      </div>) : <p class="small">{empty}</p>}
    </Panel>
  </>;
}
