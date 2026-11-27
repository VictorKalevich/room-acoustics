// Генераторы (V2-037): запуск только кнопкой, уровень в безопасных пределах, «Стоп» всегда доступен; при уходе со
// страницы или скрытии вкладки звук останавливается и сам не возобновляется. Экспорт WAV — без воспроизведения.
import { useCallback, useEffect, useState } from 'preact/hooks';
import { Button, Notice, NumberField, SegmentedControl, SelectField, Switch, TextField, useToast } from '../../../design-system';
import {
  DEFAULT_SIGNAL, LEVEL_DEFAULT, LEVEL_MAX, LEVEL_MIN, LOOPED, MAX_SECONDS, OCTAVES, SIGNAL_LABEL, TEST_SIGNALS, signalFileName, signalIssues, signalWav, synth, toChannels,
  type SignalKind, type SignalSettings, type TestGroup, type TestSignal,
} from '../../../application/signals';
import { listCategory, putEntry } from '../../../storage/library';
import { audioSupport, outputRate, play, stopAudio, useStopOnLeave } from '../../../shared/audio';
import { useApp } from '../../../shared/context';
import { downloadBlob } from '../../../shared/files';
import { Block, Inputs, freq, n0 } from './common';

const WAV_RATE = 48000;
const KINDS = Object.keys(SIGNAL_LABEL) as SignalKind[];

/** Воспроизведение одного сигнала: id играющего, запуск и остановка; ошибки — в тосте. */
function usePlayer() {
  const toast = useToast();
  const [playing, setPlaying] = useState<string | null>(null);
  const stop = () => { stopAudio(); setPlaying(null); };
  useStopOnLeave(stopAudio);
  const start = async (id: string, s: SignalSettings) => {
    try {
      const fs = outputRate();
      const p = await play(toChannels(synth(s, fs), s.channel, s.invertRight), fs, LOOPED[s.kind]);
      setPlaying(id);
      void p.ended.then(() => setPlaying((cur) => (cur === id ? null : cur)));
    } catch (e) {
      toast.show(`Не удалось воспроизвести: ${(e as Error).message}`, { tone: 'error' });
    }
  };
  return { playing, start, stop };
}

function SafetyNotice() {
  const sup = audioSupport();
  if (!sup.output) return <Notice tone="danger" title="Воспроизведение недоступно">Браузер не поддерживает Web Audio. Файл WAV можно скачать и воспроизвести в другой программе.</Notice>;
  return <Notice tone="warning" title="Начните с малой громкости">Перед запуском уменьшите громкость усилителя. Сигнал запускается только кнопкой и останавливается при уходе со страницы или сворачивании приложения.</Notice>;
}

interface SignalPreset { id: string; name: string; kind: 'signal'; settings: SignalSettings; createdAt: string }

export function SignalGeneratorTool() {
  const { db, clock } = useApp();
  const toast = useToast();
  const [s, setS] = useState<SignalSettings>(DEFAULT_SIGNAL);
  const [name, setName] = useState('Сигнал');
  const [saved, setSaved] = useState<SignalPreset[]>([]);
  const [pick, setPick] = useState('');
  const player = usePlayer();
  const reload = useCallback(() => listCategory(db, 'signals').then((l) => setSaved((l as unknown as SignalPreset[]).filter((p) => p.kind === 'signal' && p.settings)), () => undefined), [db]);
  useEffect(() => { void reload(); }, [reload]);
  const issues = signalIssues(s, WAV_RATE);
  // изменённые настройки не подменяют звучащий сигнал: он останавливается
  const set = (patch: Partial<SignalSettings>) => { if (player.playing) player.stop(); setS({ ...s, ...patch }); };
  const noise = s.kind === 'white' || s.kind === 'pink';
  return (
    <div class="al-stack al-stack--16">
      <SafetyNotice />
      <Block title="Сигнал">
        <Inputs>
          <SelectField label="Вид" value={s.kind} options={KINDS.map((k) => ({ value: k, label: SIGNAL_LABEL[k] }))} onChange={(kind) => set({ kind })} />
          {s.kind === 'sine' && <NumberField label="Частота" unit="Гц" value={s.f} min={10} max={22000} decimals={1} onCommit={(f) => set({ f })} />}
          {(s.kind === 'sweep' || s.kind === 'multitone') && [
            <NumberField key="f1" label="От" unit="Гц" value={s.f1} min={10} max={22000} decimals={1} onCommit={(f1) => set({ f1 })} />,
            <NumberField key="f2" label="До" unit="Гц" value={s.f2} min={10} max={22000} decimals={1} onCommit={(f2) => set({ f2 })} />,
          ]}
          {noise && <SelectField label="Полоса" value={s.band === null ? '' : String(s.band)} options={[{ value: '', label: 'Весь диапазон' }, ...OCTAVES.map((b) => ({ value: String(b), label: `Октава ${freq(b)}` }))]} onChange={(v) => set({ band: v ? Number(v) : null })} />}
          <NumberField label="Пиковый уровень" unit="дБ полной шкалы" value={s.levelDb} min={LEVEL_MIN} max={LEVEL_MAX} decimals={0} onCommit={(levelDb) => set({ levelDb })} hint={`От ${n0(LEVEL_MIN)} до ${n0(LEVEL_MAX)}; по умолчанию ${n0(LEVEL_DEFAULT)}`} />
          <NumberField label="Длительность" unit="с" value={s.seconds} min={0.5} max={MAX_SECONDS} decimals={1} onCommit={(seconds) => set({ seconds })} hint={LOOPED[s.kind] ? 'Воспроизводится по кругу до «Стоп»' : 'Воспроизводится один раз'} />
        </Inputs>
        <SegmentedControl label="Каналы" value={s.channel} onChange={(channel) => set({ channel })} options={[{ value: 'both', label: 'Оба' }, { value: 'left', label: 'Левый' }, { value: 'right', label: 'Правый' }]} />
        {s.channel === 'both' && <Switch label="Правый канал в противофазе" checked={s.invertRight} onChange={(invertRight) => set({ invertRight })} />}
        {issues.map((x) => <Notice key={x} tone="danger">{x}</Notice>)}
        <div class="al-row">
          {player.playing ? <Button variant="primary" icon="stop" onClick={player.stop}>Стоп</Button>
            : <Button variant="primary" icon="play" disabled={!!issues.length || !audioSupport().output} onClick={() => void player.start('gen', s)}>Воспроизвести</Button>}
          <Button icon="download" disabled={!!issues.length} onClick={() => downloadBlob(signalFileName(s), new Blob([signalWav(s, WAV_RATE)], { type: 'audio/wav' }))}>Скачать WAV</Button>
        </div>
        <p class="al-text-secondary">{`WAV: 48 кГц, 32 бита с плавающей точкой, два канала. Уровень — пиковый: у шума средний уровень ниже пикового примерно на 10–12 дБ.`}</p>
      </Block>
      <Block title="Мои сигналы">
        <div class="al-row al-row--bottom">
          <TextField label="Название" value={name} onInput={setName} maxLength={80} />
          <Button small icon="download" onClick={() => {
            const rec: SignalPreset = { id: clock.newId(), name: name.trim() || 'Сигнал', kind: 'signal', settings: s, createdAt: clock.now() };
            void putEntry(db, 'signals', rec).then(() => { toast.show('Сохранено в «Мои данные» → «Тестовые сигналы»'); void reload(); }, () => toast.show('Не удалось сохранить', { tone: 'error' }));
          }}>Сохранить настройки</Button>
        </div>
        {saved.length > 0 && (
          <div class="al-row al-row--bottom">
            <SelectField label="Сохранённый сигнал" value={pick} options={[{ value: '', label: 'Выберите' }, ...saved.map((p) => ({ value: p.id, label: p.name }))]} onChange={setPick} />
            <Button small disabled={!pick} onClick={() => { const p = saved.find((x) => x.id === pick); if (p) { set({ ...DEFAULT_SIGNAL, ...p.settings }); setName(p.name); } }}>Загрузить</Button>
          </div>
        )}
      </Block>
    </div>
  );
}

const GROUPS: { id: TestGroup; title: string; text: string }[] = [
  { id: 'channels', title: 'Каналы и полярность', text: 'Проверка подключения: какая колонка звучит и в одной ли фазе' },
  { id: 'reference', title: 'Опорный тон и свипы', text: 'Для выставления уровня и внешних измерительных программ' },
  { id: 'band', title: 'Шум в октаве', text: 'Розовый шум одной октавы: слушать полосу или мерить её уровень' },
];

export function TestSignalsTool() {
  const [level, setLevel] = useState(LEVEL_DEFAULT);
  const [band, setBand] = useState('band-125');
  const player = usePlayer();
  const withLevel = (t: TestSignal): SignalSettings => ({ ...t.settings, levelDb: level });
  const actions = (t: TestSignal) => (
    <div class="al-row al-row--nowrap">
      {player.playing === t.id ? <Button small variant="primary" icon="stop" onClick={player.stop} aria-label={`Остановить: ${t.title}`}>Стоп</Button>
        : <Button small icon="play" disabled={!audioSupport().output} onClick={() => void player.start(t.id, withLevel(t))} aria-label={`Воспроизвести: ${t.title}`}>Пуск</Button>}
      <Button small variant="ghost" icon="download" onClick={() => downloadBlob(signalFileName(withLevel(t)), new Blob([signalWav(withLevel(t), WAV_RATE)], { type: 'audio/wav' }))} aria-label={`Скачать WAV: ${t.title}`}>WAV</Button>
    </div>
  );
  const bands = TEST_SIGNALS.filter((t) => t.group === 'band');
  const current = bands.find((t) => t.id === band) ?? bands[0];
  return (
    <div class="al-stack al-stack--16">
      <SafetyNotice />
      <Block title="Уровень">
        <Inputs><NumberField label="Пиковый уровень всех сигналов" unit="дБ полной шкалы" value={level} min={LEVEL_MIN} max={LEVEL_MAX} decimals={0} onCommit={(v) => { player.stop(); setLevel(v); }} /></Inputs>
      </Block>
      {GROUPS.map((g) => (
        <Block key={g.id} title={g.title} subtitle={g.text}>
          {g.id === 'band' ? (
            <div class="al-row al-row--bottom">
              <SelectField label="Октава" value={current.id} options={bands.map((t) => ({ value: t.id, label: t.title.replace('Шум в октаве ', '') }))} onChange={(v) => { if (player.playing === current.id) player.stop(); setBand(v); }} />
              {actions(current)}
            </div>
          ) : (
            <ul role="list" class="al-list" aria-label={g.title}>
              {TEST_SIGNALS.filter((t) => t.group === g.id).map((t) => (
                <li key={t.id} class="al-list__item al-list__item--wrap">
                  <div class="al-list__text"><span class="al-list__title">{t.title}</span><span class="al-list__meta">{t.text}</span></div>
                  {actions(t)}
                </li>
              ))}
            </ul>
          )}
        </Block>
      ))}
    </div>
  );
}
