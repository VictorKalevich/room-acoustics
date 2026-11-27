// Измерения (V2-036): шумомер и анализатор спектра — NoiseMeter ядра; АЧХ — свип и деконволюция ядра (analyzeSweep);
// затухание — clapRT60 ядра по хлопку или по импульсной характеристике свипа. Без калибровки уровни — в дБ
// относительно полной шкалы (дБFS), а не дБ SPL. Запуск только кнопкой; синтетических данных нет.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  BarChart, Button, DataTable, FrequencyChart, IconButton, KeyValue, MetricCard, Notice, NumberField, SegmentedControl, SelectField, type Column,
} from '../../../design-system';
import { analyzeSweep, averageRT, clapRT60, convolve, inverseSweep, logSweep, powerAverage, sweepSegment, type BandRT, type SweepResult } from '../../../../core/dsp';
import { NoiseMeter } from '../../../../core/noise';
import { bandPowers, type SpectrumPeriod, type Weight } from '../../../../core/noiseSpectrum';
import { variantOf } from '../../../../core/noiseTimeline';
import { exceeded } from '../../../application/signals';
import type { ToolMeasurement } from '../../../application/measure';
import { audioSupport, openCapture, outputRate, playAndRecord, stopAudio, useStopOnLeave, type Capture } from '../../../shared/audio';
import { downloadText } from '../../../shared/files';
import { Block, Inputs, SaveToRoom, hz, n0, n1, n2, num } from './common';

const db10 = (p: number | null | undefined) => (p && p > 0 ? 10 * Math.log10(p) : null);
const dbText = (v: number | null) => (v === null ? '—' : n1(v));
const WEIGHTS: { value: Weight; label: string }[] = [{ value: 'A', label: 'A' }, { value: 'C', label: 'C' }, { value: 'Z', label: 'Z (без коррекции)' }];

/** «20–60 Гц», «500 Гц – 2 кГц», «5–20 кГц». */
const bandText = (lo: number, hi: number) => (hi < 1000 ? `${num(lo, 0)}–${num(hi, 0)} Гц` : lo >= 1000 ? `${num(lo / 1000, 1)}–${num(hi / 1000, 1)} кГц` : `${num(lo, 0)} Гц – ${num(hi / 1000, 1)} кГц`);

function micError(e: unknown): string {
  const name = (e as { name?: string })?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Доступ к микрофону запрещён. Разрешите его в настройках браузера и попробуйте снова.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'Микрофон не найден. Подключите микрофон и попробуйте снова.';
  if (name === 'NotReadableError') return 'Микрофон занят другим приложением.';
  if (name === 'AbortError') return 'Остановлено.';
  return (e as Error)?.message || 'Не удалось открыть микрофон.';
}

function Uncalibrated() {
  return <p class="al-text-secondary">Уровни — в дБ относительно полной шкалы (дБFS): без калибровки микрофона это не дБ SPL. Обработку речи (эхо- и шумоподавление, автоусиление) приложение просит выключить.</p>;
}

function MicInfo({ cap }: { cap: Pick<Capture, 'device' | 'sampleRate' | 'processing'> }) {
  return (
    <div class="al-stack al-stack--8">
      <KeyValue items={[['Микрофон', cap.device], ['Частота дискретизации', `${n1(cap.sampleRate / 1000)} кГц`]]} />
      {cap.processing.length > 0 && <Notice tone="warning" title="Браузер оставил обработку звука">{`Включено: ${cap.processing.join(', ')}. Уровни и спектр могут быть искажены.`}</Notice>}
    </div>
  );
}

function NoInput() {
  return <Notice tone="danger" title="Микрофон недоступен">Браузер не даёт доступ к микрофону. Откройте приложение по HTTPS в Safari или Chrome.</Notice>;
}

/** Микрофон с NoiseMeter ядра: блоки 4096 отсчётов, пропуски видны по номеру блока; перерисовка 4 раза в секунду. */
function useMeter() {
  const [cap, setCap] = useState<Capture | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [tick, setTick] = useState(0);
  const meter = useRef<NoiseMeter | null>(null);
  const running = useRef<Capture | null>(null);
  useEffect(() => {
    if (!cap) return;
    const t = setInterval(() => setTick((n) => n + 1), 250);
    return () => clearInterval(t);
  }, [cap]);
  const stop = () => { running.current?.stop(); running.current = null; setCap(null); };
  useStopOnLeave(stop);
  const start = async () => {
    setError(null);
    setStarting(true);
    try {
      // блоки, пришедшие до создания измерителя, не учитываются; нумерация — от первого учтённого
      const holder: { m: NoiseMeter | null; base: number | null } = { m: null, base: null };
      const c = await openCapture((pcm, seq) => {
        const mm = holder.m;
        if (!mm || mm.limitReached) return;
        holder.base ??= seq;
        mm.push(pcm, seq - holder.base);
      });
      holder.m = new NoiseMeter(c.sampleRate);
      meter.current = holder.m;
      running.current = c;
      setCap(c);
    } catch (e) {
      setError(micError(e));
    } finally {
      setStarting(false);
    }
  };
  return { meter: meter.current, cap, error, starting, start, stop, running: !!cap, tick };
}

function StartStop({ running, starting, start, stop, what }: { running: boolean; starting: boolean; start: () => void; stop: () => void; what: string }) {
  return running
    ? <Button variant="primary" icon="stop" onClick={stop}>Стоп</Button>
    : <Button variant="primary" icon="mic" busy={starting} disabled={!audioSupport().input} onClick={start}>{what}</Button>;
}

export function NoiseMeterTool() {
  const m = useMeter();
  const [weight, setWeight] = useState<Weight>('A');
  const [info, setInfo] = useState<Pick<Capture, 'device' | 'sampleRate' | 'processing'> | null>(null);
  useEffect(() => { if (m.cap) setInfo({ device: m.cap.device, sampleRate: m.cap.sampleRate, processing: m.cap.processing }); }, [m.cap]);
  const meter = m.meter;
  const tl = meter?.timeline;
  const n = tl?.levelCount ?? 0;
  const v = variantOf(weight, false);
  const now = tl && n ? db10(tl.window(n - 1, 1, weight).power) : null;
  const total = tl && n ? tl.interval(0, n, weight, v) : null;
  const leq1 = tl && n ? tl.series('leq1', weight, 0, n) : null;
  const seconds = leq1 ? Array.from(leq1.power).filter((p, i) => leq1.complete[i] && p > 0).map((p) => 10 * Math.log10(p)) : [];
  const snap = meter?.snapshot();
  const peak = meter?.peakAmplitude ? 20 * Math.log10(meter.peakAmplitude) : null;
  const last = Math.ceil(n / 60) - 1;
  const minutes = tl && n ? Array.from({ length: Math.min(10, last + 1) }, (_, i) => last - i).map((k) => ({ k, power: tl.interval(k * 60, Math.min(n, (k + 1) * 60), weight, v).power })) : [];
  const bandCols: Column<NonNullable<typeof total>['bands'][number]>[] = [
    { key: 'b', title: 'Полоса', render: (b) => bandText(b.lo, b.hi) },
    { key: 'l', title: 'Уровень, дБFS', numeric: true, render: (b) => dbText(db10(b.power)) },
    { key: 'p', title: 'Доля', numeric: true, render: (b) => (b.percent === null ? '—' : `${n0(b.percent)} %`) },
  ];
  const csv = () => {
    if (!tl) return '';
    const rows = ['second;leq1_Z_dBFS;leq1_A_dBFS;leq1_C_dBFS'];
    const z = tl.series('leq1', 'Z', 0, n).power, a = tl.series('leq1', 'A', 0, n).power, c = tl.series('leq1', 'C', 0, n).power;
    for (let i = 0; i < n; i++) rows.push([i + 1, db10(z[i]), db10(a[i]), db10(c[i])].map((x) => (x === null ? '' : typeof x === 'number' ? x.toFixed(2) : x)).join(';'));
    return rows.join('\n') + '\n';
  };
  return (
    <div class="al-stack al-stack--16">
      {!audioSupport().input && <NoInput />}
      <Block title="Шумомер">
        <SegmentedControl label="Частотная коррекция" value={weight} onChange={setWeight} options={WEIGHTS} />
        <div class="al-row"><StartStop {...m} what={meter ? 'Новый замер' : 'Начать замер'} /></div>
        {m.error && <Notice tone="danger">{m.error}</Notice>}
        {info && <MicInfo cap={info} />}
        <Uncalibrated />
      </Block>
      {meter && (
        <>
          <div class="al-grid al-grid--metrics" role="list" aria-label="Уровни">
            <div role="listitem"><MetricCard label={`Сейчас (1 с), ${weight}`} value={now === null ? null : n1(now)} unit="дБFS" /></div>
            <div role="listitem"><MetricCard label={`Leq за замер, ${weight}`} value={total?.power ? n1(10 * Math.log10(total.power)) : null} unit="дБFS" note={`${n0(snap?.activeSeconds ?? 0)} с`} /></div>
            <div role="listitem"><MetricCard label="Min (1 с)" value={seconds.length ? n1(Math.min(...seconds)) : null} unit="дБFS" /></div>
            <div role="listitem"><MetricCard label="Max (1 с)" value={seconds.length ? n1(Math.max(...seconds)) : null} unit="дБFS" /></div>
            {[10, 50, 90].map((p) => <div role="listitem" key={p}><MetricCard label={`L${p}`} value={seconds.length ? n1(exceeded(seconds, p)!) : null} unit="дБFS" note={`Превышается ${p} % времени`} /></div>)}
            <div role="listitem"><MetricCard label="Пик (Z)" value={peak === null ? null : n1(peak)} unit="дБFS" tone={snap?.clipped ? 'danger' : 'neutral'} note={snap?.clipped ? 'Есть перегрузка' : undefined} /></div>
          </div>
          {(snap?.missing ?? 0) > 0 && <Notice tone="warning">{`Пропущено блоков: ${snap!.missing}. Устройство не успевало передавать звук; пропуски не входят в уровни.`}</Notice>}
          {meter.limitReached && <Notice tone="warning">Достигнут предел длительности замера (12 часов).</Notice>}
          {total && <Block title={`Полосы частот, ${weight}`}>
            <DataTable caption={`Полосы частот, ${weight}`} columns={bandCols} rows={total.bands} rowKey={(b) => String(b.lo)} />
          </Block>}
          <Block title={`История по минутам, Leq ${weight}`}>
            <DataTable caption={`История по минутам, Leq ${weight}`} columns={[
              { key: 'm', title: 'Минута', numeric: true, render: (r: (typeof minutes)[number]) => String(r.k + 1) },
              { key: 'l', title: 'Leq, дБFS', numeric: true, render: (r: (typeof minutes)[number]) => dbText(db10(r.power)) },
            ]} rows={minutes} rowKey={(r) => String(r.k)} />
          </Block>
          <Block title="Сохранение">
            {m.running && <p class="al-text-secondary">Остановите замер, чтобы скачать или сохранить его.</p>}
            <div class="al-row"><Button small icon="download" disabled={m.running || !n} onClick={() => downloadText('noise-levels.csv', csv(), 'text/csv')}>Уровни по секундам, CSV</Button></div>
            {!m.running && n > 0 && <SaveToRoom build={() => {
              const psd = meter.spectral.average('session', weight).density;
              const bands = thirdOctaves(20, Math.min(20000, meter.sampleRate / 2));
              const p = bandPowers(psd, meter.spectral.binHz, bands.edges);
              const pts = p.map((b, i) => ({ f: bands.centers[i], db: db10(b.power) })).filter((x): x is { f: number; db: number } => x.db !== null);
              return {
                kind: 'noise', name: `Шум ${weight}, Leq ${total?.power ? n1(10 * Math.log10(total.power)) : '—'} дБFS`, method: 'Шумомер: спектр сеанса по третям октавы, NoiseMeter ядра', device: info?.device ?? 'Микрофон',
                data: { f: pts.map((x) => x.f), db: pts.map((x) => x.db), ref: 'dBFS' }, warnings: snap?.clipped ? ['В записи есть перегрузка.'] : [], limitations: ['Без калибровки микрофона: дБFS, не дБ SPL.'],
              } satisfies ToolMeasurement;
            }} />}
          </Block>
        </>
      )}
    </div>
  );
}

/** Полосы 1/N октавы от f0 до f1: центры по ряду 1000·2^(k/N), края — середины между центрами. */
function fractionalBands(f0: number, f1: number, N: number) {
  const k0 = Math.ceil(N * Math.log2(f0 / 1000)), k1 = Math.floor(N * Math.log2(f1 / 1000));
  const centers = Array.from({ length: Math.max(0, k1 - k0 + 1) }, (_, i) => 1000 * 2 ** ((k0 + i) / N));
  const edges = [...centers.map((c) => c * 2 ** (-1 / (2 * N))), centers[centers.length - 1] * 2 ** (1 / (2 * N))];
  return { centers, edges };
}
const thirdOctaves = (f0: number, f1: number) => fractionalBands(f0, f1, 3);

type Resolution = '1' | '3' | '6' | '12' | 'fft';

/** Текущий спектр: дробно-октавные полосы среднего за период или БПФ последнего блока. */
function spectrumOf(meter: NoiseMeter | null, bands: { centers: number[]; edges: number[] } | null, res: Resolution, period: SpectrumPeriod, weight: Weight): { x: number[]; y: number[] } {
  if (!meter) return { x: [], y: [] };
  if (res === 'fft') { const s = meter.snapshot(); return { x: s.f, y: s.db }; }
  if (!bands || !meter.spectral.frameCount) return { x: [], y: [] };
  const p = bandPowers(meter.spectral.average(period, weight).density, meter.spectral.binHz, bands.edges);
  return { x: bands.centers, y: p.map((b) => db10(b.power) ?? NaN) };
}
const RES: { value: Resolution; label: string }[] = [{ value: '1', label: '1/1 октавы' }, { value: '3', label: '1/3 октавы' }, { value: '6', label: '1/6 октавы' }, { value: '12', label: '1/12 октавы' }, { value: 'fft', label: 'БПФ 4096' }];
const PERIODS: { value: SpectrumPeriod; label: string }[] = [{ value: 'now', label: 'Мгновенно' }, { value: '10', label: '10 с' }, { value: '60', label: '60 с' }, { value: 'session', label: 'Весь замер' }];

export function RtaTool() {
  const m = useMeter();
  const [weight, setWeight] = useState<Weight>('Z');
  const [res, setRes] = useState<Resolution>('3');
  const [period, setPeriod] = useState<SpectrumPeriod>('10');
  const [hold, setHold] = useState<number[] | null>(null);
  const [info, setInfo] = useState<Pick<Capture, 'device' | 'sampleRate' | 'processing'> | null>(null);
  useEffect(() => { if (m.cap) setInfo({ device: m.cap.device, sampleRate: m.cap.sampleRate, processing: m.cap.processing }); }, [m.cap]);
  const meter = m.meter;
  const bands = useMemo(() => (res === 'fft' || !meter ? null : fractionalBands(20, Math.min(20000, meter.sampleRate / 2), Number(res))), [res, meter]);
  const { x, y } = spectrumOf(meter, bands, res, period, weight);
  const { running, tick } = m;
  useEffect(() => { setHold(null); }, [res, weight, meter]);
  useEffect(() => {
    const cur = running ? spectrumOf(meter, bands, res, period, weight).y : [];
    if (!cur.length) return;
    setHold((h) => (h && h.length === cur.length ? h.map((v, i) => (Number.isFinite(cur[i]) ? Math.max(Number.isFinite(v) ? v : -Infinity, cur[i]) : v)) : [...cur]));
  }, [tick, running, meter, bands, res, period, weight]);
  // удержание пиков рисуется первым: текущий спектр поверх него
  const series = [...(hold && hold.length === x.length ? [{ id: 'hold', label: 'Удержание пиков', kind: 'measured' as const, variant: 2 as const, x, y: hold }] : []), { id: 'rta', label: 'Измерение', kind: 'measured' as const, x, y }];
  return (
    <div class="al-stack al-stack--16">
      {!audioSupport().input && <NoInput />}
      <Block title="Анализатор спектра">
        <Inputs>
          <SelectField label="Разрешение" value={res} options={RES} onChange={setRes} />
          <SelectField label="Усреднение" value={period} options={PERIODS} onChange={setPeriod} />
          <SelectField label="Коррекция" value={weight} options={WEIGHTS} onChange={setWeight} />
        </Inputs>
        {res === 'fft' && <p class="al-text-secondary">БПФ — спектр последнего блока 4096 отсчётов без усреднения и коррекции, уровень относительный.</p>}
        <div class="al-row">
          <StartStop {...m} what={meter ? 'Новый замер' : 'Начать'} />
          {hold && <Button small variant="ghost" onClick={() => setHold(null)}>Сбросить пики</Button>}
        </div>
        {m.error && <Notice tone="danger">{m.error}</Notice>}
        {info && <MicInfo cap={info} />}
        <Uncalibrated />
      </Block>
      {meter && <Block title="Спектр с микрофона">
        <FrequencyChart title="Спектр с микрофона" yUnit={res === 'fft' ? 'дБ' : 'дБFS'} fMin={20} fMax={Math.min(20000, meter.sampleRate / 2)} series={series} empty="Спектр появится через секунду после начала." />
      </Block>}
      {meter && !m.running && x.length > 0 && res !== 'fft' && (
        <Block title="Сохранение">
          <SaveToRoom build={() => ({
            kind: 'noise', name: `Спектр 1/${res} окт., ${weight}`, method: `RTA: средний спектр (${PERIODS.find((p) => p.value === period)!.label.toLowerCase()}) по 1/${res} октавы, NoiseMeter ядра`, device: info?.device ?? 'Микрофон',
            data: { f: x.filter((_, i) => Number.isFinite(y[i])), db: y.filter(Number.isFinite), ref: 'dBFS' }, warnings: [], limitations: ['Без калибровки микрофона: дБFS, не дБ SPL.'],
          })} />
        </Block>
      )}
    </div>
  );
}

const SWEEP_F1 = 10, SWEEP_F2 = 1000, SWEEP_T = 6;
type Take = SweepResult & { id: number; warn: string | null };

function sweepQuality(r: SweepResult): string | null {
  return r.peak > 0.98 ? 'Перегрузка микрофона: уменьшите громкость.' : r.peak < 0.01 ? 'Слишком тихо: увеличьте громкость.' : r.snrDb < 20 ? `Мало запаса над шумом (${n0(r.snrDb)} дБ): тише в комнате или громче сигнал.` : null;
}

/** Воспроизведение свипа и запись одного дубля; ошибки — текстом. */
function useTake<T>(run: (signal: AbortSignal) => Promise<T>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ctl = useRef<AbortController | null>(null);
  const stop = () => { ctl.current?.abort(); stopAudio(); };
  useStopOnLeave(stop);
  const go = async (onDone: (v: T) => void) => {
    setError(null);
    setBusy(true);
    const c = new AbortController();
    ctl.current = c;
    try {
      onDone(await run(c.signal));
    } catch (e) {
      setError(micError(e));
    } finally {
      ctl.current = null;
      setBusy(false);
    }
  };
  return { busy, error, go, stop };
}

const CHANNEL_OPTS = [{ value: 'both', label: 'Обе колонки' }, { value: 'left', label: 'Левая' }, { value: 'right', label: 'Правая' }] as const;
type Ch = (typeof CHANNEL_OPTS)[number]['value'];
const route = (x: Float32Array, ch: Ch): Float32Array[] => { const z = new Float32Array(x.length); return ch === 'left' ? [x, z] : ch === 'right' ? [z, x] : [x, x]; };

export function SweepTool() {
  const [level, setLevel] = useState(-12);
  const [ch, setCh] = useState<Ch>('both');
  const [takes, setTakes] = useState<Take[]>([]);
  const [device, setDevice] = useState('Микрофон');
  const t = useTake(async (signal) => {
    const amp = 10 ** (level / 20);
    const r = await playAndRecord(route(logSweep(SWEEP_F1, SWEEP_F2, SWEEP_T, outputRate(), amp), ch), 1.5, signal);
    setDevice(r.device);
    const sweep = logSweep(SWEEP_F1, SWEEP_F2, SWEEP_T, r.fs, amp);
    if (r.rec.length < sweep.length) throw new Error('Запись короче сигнала: попробуйте ещё раз.');
    const seg = sweepSegment(r.rec, sweep.length, r.fs);
    if (!seg) throw new Error('Свип не найден в записи: проверьте, что колонка звучит и микрофон её слышит.');
    return analyzeSweep(seg, sweep, SWEEP_F1, SWEEP_F2, r.fs);
  });
  const avg = takes.length ? { f: takes[0].f, db: powerAverage(takes.map((x) => x.db)) } : null;
  const cols: Column<Take>[] = [
    { key: 'n', title: 'Дубль', numeric: true, render: (x) => String(x.id) },
    { key: 's', title: 'Запас над шумом', numeric: true, render: (x) => `${n0(x.snrDb)} дБ` },
    { key: 'p', title: 'Пик записи', numeric: true, render: (x) => `${n1(20 * Math.log10(Math.max(1e-9, x.peak)))} дБFS` },
    { key: 'q', title: 'Качество', render: (x) => x.warn ?? 'хорошо' },
    { key: 'd', title: 'Удалить', render: (x) => <IconButton icon="trash" small label={`Удалить дубль ${x.id}`} onClick={() => setTakes(takes.filter((y) => y.id !== x.id))} /> },
  ];
  return (
    <div class="al-stack al-stack--16">
      {!audioSupport().input && <NoInput />}
      <Notice tone="warning" title="Начните с малой громкости">Свип 10 Гц – 1 кГц длится 6 секунд и запускается только кнопкой. Поставьте микрофон на место слушателя.</Notice>
      <Block title="Измерение АЧХ свипом" subtitle="Деконволюция записи, окно 1 с после прямого звука, сглаживание 1/24 октавы">
        <Inputs>
          <NumberField label="Уровень свипа" unit="дБ полной шкалы" value={level} min={-40} max={-6} decimals={0} onCommit={setLevel} />
          <SelectField label="Каналы" value={ch} options={[...CHANNEL_OPTS]} onChange={setCh} />
        </Inputs>
        <div class="al-row">
          {t.busy ? <Button variant="primary" icon="stop" onClick={t.stop}>Стоп</Button>
            : <Button variant="primary" icon="play" disabled={!audioSupport().input} onClick={() => void t.go((r) => setTakes((a) => [...a, { ...r, id: (a[a.length - 1]?.id ?? 0) + 1, warn: sweepQuality(r) }]))}>{takes.length ? 'Ещё дубль' : 'Измерить'}</Button>}
          {takes.length > 0 && !t.busy && <Button small variant="ghost" onClick={() => setTakes([])}>Начать заново</Button>}
        </div>
        {t.busy && <p class="al-text-secondary">Идёт измерение: не шумите и не трогайте микрофон.</p>}
        {t.error && <Notice tone="danger">{t.error}</Notice>}
        <p class="al-text-secondary">Микрофон без калибровки: форма АЧХ относительная, абсолютный уровень неизвестен.</p>
      </Block>
      {avg && (
        <Block title={takes.length > 1 ? `АЧХ, среднее по ${takes.length} дублям` : 'АЧХ'}>
          <FrequencyChart title={takes.length > 1 ? `АЧХ, среднее по ${takes.length} дублям` : 'АЧХ'} fMin={15} fMax={500} series={[{ id: 'fr', label: 'Измерение', kind: 'measured', x: avg.f, y: avg.db }]} />
        </Block>
      )}
      {takes.length > 0 && <Block title="Дубли">
        <DataTable caption="Дубли" columns={cols} rows={takes} rowKey={(x) => String(x.id)} />
      </Block>}
      {avg && !t.busy && (
        <Block title="Сохранение">
          <div class="al-row"><Button small icon="download" onClick={() => downloadText('frequency-response.csv', ['f_Hz;dB'].concat(avg.f.map((f, i) => `${f.toFixed(2)};${avg.db[i].toFixed(2)}`)).join('\n') + '\n', 'text/csv')}>АЧХ, CSV</Button></div>
          <SaveToRoom build={() => ({
            kind: 'frequency-response', name: `АЧХ свипом${takes.length > 1 ? `, ${takes.length} дубля` : ''}`, method: 'Логарифмический свип 10 Гц – 1 кГц, 6 с, деконволюция (analyzeSweep ядра)', device,
            data: { f: avg.f, db: avg.db, ref: 'dB re 1' }, points: takes.length,
            warnings: takes.map((x) => x.warn).filter((w): w is string => !!w), limitations: ['Микрофон без калибровки: уровень относительный.', 'Полоса анализа 15–500 Гц.'],
          })} />
        </Block>
      )}
    </div>
  );
}

const RT_LABEL = (b: number) => (b >= 1000 ? `${b / 1000}k` : String(b));
type DecayMethod = 'clap' | 'sweep';
const CLAP_SECONDS = 4;

/** Запись микрофона заданной длительности; остановка — signal. */
async function recordFor(seconds: number, signal: AbortSignal): Promise<{ rec: Float32Array; fs: number; device: string }> {
  const blocks: Float32Array[] = [];
  const cap = await openCapture((pcm) => blocks.push(pcm));
  try {
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(resolve, seconds * 1000);
      signal.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('Остановлено', 'AbortError')); }, { once: true });
    });
  } finally {
    cap.stop();
  }
  const rec = new Float32Array(blocks.length * 4096);
  blocks.forEach((b, i) => rec.set(b, i * 4096));
  return { rec, fs: cap.sampleRate, device: cap.device };
}

export function DecayTool() {
  const [method, setMethod] = useState<DecayMethod>('clap');
  const [level, setLevel] = useState(-12);
  const [takes, setTakes] = useState<BandRT[][]>([]);
  const [warn, setWarn] = useState<string | null>(null);
  const [device, setDevice] = useState('Микрофон');
  const t = useTake(async (signal) => {
    if (method === 'clap') {
      const r = await recordFor(CLAP_SECONDS, signal);
      setDevice(r.device);
      let pk = 0;
      for (let i = 0; i < r.rec.length; i++) pk = Math.max(pk, Math.abs(r.rec[i]));
      setWarn(pk >= 0.999 ? 'Хлопок перегрузил микрофон: отойдите дальше.' : pk < 0.05 ? 'Хлопок слишком тихий: хлопните громче или ближе.' : null);
      return clapRT60(r.rec, r.fs);
    }
    const amp = 10 ** (level / 20);
    const r = await playAndRecord(route(logSweep(20, 20000, SWEEP_T, outputRate(), amp), 'both'), 2.5, signal);
    setDevice(r.device);
    const sweep = logSweep(20, 20000, SWEEP_T, r.fs, amp);
    const seg = sweepSegment(r.rec, sweep.length, r.fs);
    if (!seg) throw new Error('Свип не найден в записи: проверьте, что колонки звучат и микрофон их слышит.');
    const ir = convolve(seg, inverseSweep(sweep, 20, 20000, r.fs));
    setWarn(null);
    return clapRT60(Float32Array.from(ir), r.fs);
  });
  const avg = takes.length ? averageRT(takes) : null;
  const cols: Column<BandRT>[] = [
    { key: 'b', title: 'Октава', numeric: true, render: (b) => hz(b.band) },
    { key: 't', title: 'RT60', numeric: true, render: (b) => (b.t60 === null ? 'мало запаса над шумом' : `${n2(b.t60)} с`) },
    { key: 'm', title: 'Метод', render: (b) => (b.t60 === null ? '—' : b.approx ? 'T10, приблизительно' : 'T20') },
  ];
  return (
    <div class="al-stack al-stack--16">
      {!audioSupport().input && <NoInput />}
      <Block title="Время реверберации" subtitle="Кривая Шрёдера с поправкой на шум, октавы 125 Гц – 4 кГц">
        <SegmentedControl label="Источник звука" value={method} onChange={(v) => { setMethod(v); setTakes([]); }} options={[{ value: 'clap', label: 'Хлопок' }, { value: 'sweep', label: 'Свип через колонки' }]} />
        {method === 'sweep' && <Inputs><NumberField label="Уровень свипа" unit="дБ полной шкалы" value={level} min={-40} max={-6} decimals={0} onCommit={setLevel} /></Inputs>}
        <p class="al-text-secondary">{method === 'clap' ? `После нажатия запись идёт ${CLAP_SECONDS} секунды: хлопните один раз громко и замрите.` : 'Свип 20 Гц – 20 кГц, 6 секунд: начните с малой громкости усилителя.'}</p>
        <div class="al-row">
          {t.busy ? <Button variant="primary" icon="stop" onClick={t.stop}>Стоп</Button>
            : <Button variant="primary" icon="mic" disabled={!audioSupport().input} onClick={() => void t.go((r) => setTakes((a) => [...a, r]))}>{takes.length ? 'Ещё замер' : method === 'clap' ? 'Записать хлопок' : 'Измерить'}</Button>}
          {takes.length > 0 && !t.busy && <Button small variant="ghost" onClick={() => setTakes([])}>Начать заново</Button>}
        </div>
        {t.busy && <p class="al-text-secondary">{method === 'clap' ? 'Запись: хлопните сейчас.' : 'Идёт измерение: не шумите.'}</p>}
        {t.error && <Notice tone="danger">{t.error}</Notice>}
        {warn && <Notice tone="warning">{warn}</Notice>}
      </Block>
      {avg && (
        <>
          <Block title={`RT60 по октавам${takes.length > 1 ? `, среднее по ${takes.length} замерам` : ''}, Гц`}>
            <BarChart title={`RT60 по октавам${takes.length > 1 ? `, среднее по ${takes.length} замерам` : ''}, Гц`} unit="с" categories={avg.map((b) => RT_LABEL(b.band))} series={[{ id: 'rt', label: 'Измерение', kind: 'measured', values: avg.map((b) => b.t60) }]} />
          </Block>
          <Block title="Время реверберации по октавам">
            <DataTable caption="Время реверберации по октавам" columns={cols} rows={avg} rowKey={(b) => String(b.band)} />
          </Block>
          <Block title="Сохранение">
            <SaveToRoom build={() => ({
              kind: 'rt60', name: `RT60 (${method === 'clap' ? 'хлопок' : 'свип'}${takes.length > 1 ? `, ${takes.length} замера` : ''})`,
              method: method === 'clap' ? 'Хлопок, кривая Шрёдера по октавам (clapRT60 ядра)' : 'Свип 20 Гц – 20 кГц, импульсная характеристика, кривая Шрёдера (clapRT60 ядра)', device,
              data: { f: [], db: [], ref: 'dBFS', rt60: avg }, points: takes.length, warnings: avg.some((b) => b.approx) ? ['Часть октав оценена по T10: значение приблизительное.'] : [], limitations: [],
            })} />
          </Block>
        </>
      )}
    </div>
  );
}
