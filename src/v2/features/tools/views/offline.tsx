// Режим «Из файла» инструмента «Измерение АЧХ свипом» (V2-049): WAV, записанный другой программой или устройством
// (например, файл генератора, сыгранный плеером), или импульсная характеристика. Время пролёта — только по петле.
import { useState } from 'preact/hooks';
import { Button, FrequencyChart, KeyValue, Notice, NumberField, SegmentedControl, SelectField } from '../../../design-system';
import { speedOfSound } from '../../../../core/physics';
import { analyzeImpulse, analyzeSweepRecording, decodeWav, type OfflineResult, type WavData } from '../../../application/offline';
import { downloadText } from '../../../shared/files';
import { Block, Inputs, SaveToRoom, n0, n1, n2 } from './common';

type FileKind = 'sweep' | 'ir';
const SPEED = speedOfSound(20);

export function FileSweep() {
  const [file, setFile] = useState<{ name: string; wav: WavData } | null>(null);
  const [kind, setKind] = useState<FileKind>('sweep');
  const [mic, setMic] = useState(0);
  const [loop, setLoop] = useState(-1);
  const [f1, setF1] = useState(20);
  const [f2, setF2] = useState(20000);
  const [seconds, setSeconds] = useState(10);
  const [res, setRes] = useState<OfflineResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = async (f: File | undefined) => {
    if (!f) return;
    setRes(null);
    setError(null);
    try {
      const wav = decodeWav(await f.arrayBuffer());
      setFile({ name: f.name, wav });
      setMic(0);
      setLoop(wav.channels.length > 1 ? 1 : -1);
    } catch (e) {
      setFile(null);
      setError((e as Error).message);
    }
  };
  const run = () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    // деконволюция длинной записи занимает до секунды: сначала показать «идёт обработка»
    setTimeout(() => {
      try {
        const ch = file.wav.channels;
        setRes(kind === 'ir' ? analyzeImpulse(ch[mic], file.wav.fs) : analyzeSweepRecording(ch[mic], file.wav.fs, { f1, f2, seconds }, SPEED, loop >= 0 && loop !== mic ? ch[loop] : undefined));
      } catch (e) {
        setRes(null);
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    }, 0);
  };
  const w = file?.wav;
  const chOpts = w ? w.channels.map((_, i) => ({ value: String(i), label: `Канал ${i + 1}` })) : [];
  const method = kind === 'ir' ? 'Импульсная характеристика из файла: окно 10 мс до пика и 1 с после, сглаживание 1/24 октавы'
    : `Запись логарифмического свипа ${n0(f1)}–${n0(f2)} Гц, ${n1(seconds)} с из файла, деконволюция ядра${res?.arrival ? ', время пролёта по петле' : ''}`;
  return (
    <div class="al-stack al-stack--16">
      <Block title="Обработка записи из файла" subtitle="Свип можно сыграть и записать любой программой: например, скачать свип в генераторе и записать его другим устройством. Файл не сохраняется — сохраняется только результат.">
        <div class="al-row al-row--12">
          <label class="al-btn al-btn--secondary al-btn--small">
            <input class="al-visually-hidden" type="file" accept=".wav,audio/wav,audio/x-wav" aria-label="Файл записи WAV" onChange={(e) => void load(e.currentTarget.files?.[0])} />
            Выбрать WAV
          </label>
          {file && <span class="al-text-small al-text-secondary">{`«${file.name}»`}</span>}
        </div>
        {w && (
          <>
            <KeyValue items={[
              ['Частота дискретизации', `${n0(w.fs)} Гц`],
              ['Каналы', String(w.channels.length)],
              ['Длительность', `${n1(w.channels[0].length / w.fs)} с`],
              ['Формат', `${w.bits} бит${w.float ? ', плавающая точка' : ''}`],
            ]} />
            <SegmentedControl label="Что в файле" value={kind} onChange={(k) => { setKind(k); setRes(null); }} options={[{ value: 'sweep', label: 'Запись свипа' }, { value: 'ir', label: 'Импульсная характеристика' }]} />
            <Inputs>
              <SelectField label="Канал микрофона" value={String(mic)} options={chOpts} onChange={(v) => { setMic(Number(v)); setRes(null); }} />
              {kind === 'sweep' && w.channels.length > 1 && (
                <SelectField label="Канал петли (loopback)" value={String(loop)} onChange={(v) => { setLoop(Number(v)); setRes(null); }}
                  options={[{ value: '-1', label: 'Нет' }, ...chOpts.filter((o) => Number(o.value) !== mic)]} hint="Электрическая копия сигнала: даёт время пролёта" />
              )}
              {kind === 'sweep' && (
                <>
                  <NumberField label="Свип от" unit="Гц" decimals={0} value={f1} min={5} max={1000} onCommit={(v) => { setF1(v); setRes(null); }} />
                  <NumberField label="Свип до" unit="Гц" decimals={0} value={f2} min={100} max={96000} onCommit={(v) => { setF2(v); setRes(null); }} />
                  <NumberField label="Длительность свипа" unit="с" decimals={1} value={seconds} min={0.5} max={60} onCommit={(v) => { setSeconds(v); setRes(null); }} />
                </>
              )}
            </Inputs>
            {kind === 'sweep' && <p class="al-text-small al-text-secondary">Параметры — как у сыгранного свипа. Свип генератора «Свип 20 Гц – 20 кГц» — 20–20 000 Гц, 10 с; «Свип 15–200 Гц» — 15–200 Гц, 10 с.</p>}
            <div class="al-row">
              <Button variant="primary" busy={busy} onClick={run}>Обработать</Button>
            </div>
          </>
        )}
        {busy && <p class="al-text-secondary">Идёт обработка записи…</p>}
        {error && <Notice tone="danger">{error}</Notice>}
      </Block>
      {res && file && (
        <Block title={`АЧХ из файла «${file.name}»`}>
          <FrequencyChart title={`АЧХ из файла ${file.name}`} fMin={res.f[0]} fMax={res.f[res.f.length - 1]} series={[{ id: 'fr', label: 'Замер из файла', kind: 'measured', x: res.f, y: res.db }]} />
          <KeyValue items={[
            ['Запас над шумом', `${n0(res.snrDb)} дБ`],
            ['Пик записи', `${n1(20 * Math.log10(Math.max(1e-9, res.peak)))} дБFS`],
            ['Пик импульсной характеристики', `${n1(res.peakMs)} мс от начала файла`],
            ...(res.arrival ? [['Время пролёта по петле', `${n2(res.arrival.ms)} мс`], ['Расстояние до колонки', `${n2(res.arrival.distance)} м`]] as [string, string][] : []),
          ]} />
          {res.warnings.length > 0 && <Notice tone="warning">{res.warnings.join(' ')}</Notice>}
          <p class="al-text-small al-text-secondary">{res.arrival
            ? 'Время пролёта — разность пиков импульсных характеристик микрофона и петли; расстояние — при 20 °C. Пик сабвуфера запаздывает на групповую задержку его фильтров: это и есть время, которое выравнивают задержкой.'
            : kind === 'sweep' ? 'Без петли время пролёта неизвестно: в запись входят задержки звуковой карты и плеера.' : 'Время от начала файла зависит от того, как файл экспортирован; для выравнивания каналов используйте запись свипа с петлёй.'}</p>
          <div class="al-row"><Button small icon="download" onClick={() => downloadText('frequency-response.csv', ['f_Hz;dB'].concat(res.f.map((f, i) => `${f.toFixed(2)};${res.db[i].toFixed(2)}`)).join('\n') + '\n', 'text/csv')}>АЧХ, CSV</Button></div>
          <SaveToRoom build={() => ({
            kind: 'frequency-response', name: `АЧХ из файла «${file.name}»`, method, device: 'Файл', file: { fileName: file.name, format: 'WAV' },
            data: { f: res.f, db: res.db, ref: 'dB re 1' }, points: 1, warnings: res.warnings,
            limitations: ['Запись сделана вне приложения: уровень относительный, микрофон и его калибровка неизвестны.', 'Снимка модели на момент записи нет: привязка к конфигурации и точке — при сохранении или позже.'],
            ...(res.arrival ? { timing: { arrivalMs: res.arrival.ms, ref: 'loopback' as const, distance: res.arrival.distance } } : {}),
          })} />
        </Block>
      )}
    </div>
  );
}
