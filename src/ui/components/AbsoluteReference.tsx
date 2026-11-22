import { useState } from 'preact/hooks';
import type { NoiseMeter } from '../../core/noise';
import { absoluteOffset, referenceLevel, type ReferencePair } from '../../core/micReference';
import { micCatalog } from '../../state/micCatalog';
import type { NoiseDiagnostics } from '../audio/noiseDiagnostics';
import { Details, Note, Panel } from '../design-system';
import type { MicSetup } from './MicCalibrationPanel';

const verifiedNow = () => new Date().toISOString();

export function AbsoluteReference({ meter, setup, next, path, busy, refresh }: {
  meter: NoiseMeter | null; setup: MicSetup | null; next: MicSetup | null; path: NoiseDiagnostics | null;
  busy: boolean; refresh(): void;
}) {
  const [reading, setReading] = useState('');
  const [first, setFirst] = useState<{ pair: ReferencePair; route: string; device: string; start: number | null } | null>(null);
  const [message, setMessage] = useState('');
  if (!meter || !setup || !path || setup.input.source === 'system') return null;
  const device = setup.input.source.localDeviceId;
  const route = JSON.stringify([setup.input.confirmedModel, path.backend, path.sampleRate, path.settings, path.constraintsFallback]);
  const level = !busy && path.settings.autoGainControl !== true ? referenceLevel(meter) : null;
  const previous = first?.device === device && first.route === route ? first : null;
  const stored = setup.input.absoluteCalibration;
  const matching = stored?.physicalInput === device && stored.captureMode === route && stored.references?.length === 2;
  const inRange = matching && level !== null && level >= Math.min(...stored.references!.map(r => r.measuredDbfs)) - 1 &&
    level <= Math.max(...stored.references!.map(r => r.measuredDbfs)) + 1;
  async function record() {
    try {
      if (!meter || !next || level === null || next.input.source === 'system' || next.input.source.localDeviceId !== device ||
          next.input.confirmedModel !== setup?.input.confirmedModel) throw new Error('Для проверки верните тот же вход и модель.');
      const referenceSpl = Number(reading.trim().replace(',', '.'));
      if (!reading.trim() || !Number.isFinite(referenceSpl) || referenceSpl <= 0 || referenceSpl > 194) throw new Error('Введите показание эталонного шумомера в дБ SPL.');
      const pair = { measuredDbfs: level, referenceSpl };
      if (!previous) {
        setFirst({ route, device, start: meter.audioStartMs, pair }); setReading('');
        setMessage('Первая точка сохранена. Запишите второй сеанс с разницей не менее 10 дБ.'); return;
      }
      if (meter.audioStartMs === previous.start) throw new Error('Для второй точки запишите новый сеанс.');
      const offsetDb = absoluteOffset(previous.pair, pair);
      await micCatalog.saveAbsolute({ tool: 'noise' }, next.input, { offsetDb, physicalInput: device, captureMode: route,
        verifiedAt: verifiedNow(), references: [previous.pair, pair] });
      setFirst(null); setReading(''); setMessage('Привязка сохранена для следующих измерений.'); refresh();
    } catch (e) { setMessage((e as Error).message); }
  }
  return <Panel title="Абсолютная калибровка входа">
    {inRange && <p>Оценка SPL на 1 кГц · {(level! + stored!.offsetDb).toFixed(1)} дБ SPL · последние 5 с, Z</p>}
    <Details summary="Сверка с эталонным шумомером">
      <p class="small">Зафиксируйте микрофон и эталон рядом. Запишите два уровня тона 1 кГц при одинаковой ориентации.
        Для каждого остановите запись после стабильных 5 с и введите показание эталона за тот же интервал, вес Z.
        Оценка действует на этом входе в проверенном диапазоне уровней.</p>
      <p>Уровень входа · {level?.toFixed(2) ?? '—'} dBFS</p>
      <label class="field"><span>Показание эталона, дБ SPL</span><span class="field__box"><input inputMode="decimal"
        value={reading} onInput={e => setReading(e.currentTarget.value)} /></span></label>
      <button class="btn" disabled={level === null || !next} onClick={record}>{previous ? 'Проверить вторую точку' : 'Зафиксировать первую точку'}</button>
      {message && <Note>{message}</Note>}
    </Details>
  </Panel>;
}
