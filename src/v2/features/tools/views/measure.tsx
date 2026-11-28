// Измерения (V2-036): шумомер и анализатор спектра — NoiseMeter ядра (уровни, полосы, спектрограмма), Fast/Slow и БПФ
// с выбором окна — application/analyzer; АЧХ — свип и деконволюция ядра (analyzeSweep; во всей полосе — тот же порядок
// в analyzer); искажения синуса — analyzer; затухание — clapRT60 ядра по хлопку или по импульсной характеристике свипа.
// Без калибровки уровни — в дБ относительно полной шкалы (дБFS), а не дБ SPL. Запуск только кнопкой; синтетических данных нет.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  BarChart, Button, ConfirmDialog, DataTable, FrequencyChart, IconButton, KeyValue, MetricCard, Notice, NumberField, SegmentedControl, SelectField, Spectrogram, type Column,
} from '../../../design-system';
import { analyzeSweep, averageRT, clapRT60, convolve, inverseSweep, logSweep, powerAverage, sweepSegment, type BandRT, type SweepResult } from '../../../../core/dsp';
import {
  FFT_SIZES, FftAnalyzer, OVERLAPS, TimeWeighted, WINDOWS, WINDOW_LABEL, analyzeSweepBand, decimateLog, distortion, intermod, steadySegment, windowOf, windowStats,
  type Averaging, type Distortion, type Intermod, type Sideband, type TimeWeight, type WindowKind,
} from '../../../application/analyzer';
import { NoiseMeter } from '../../../../core/noise';
import { bandPowers, type SpectrumPeriod, type Weight } from '../../../../core/noiseSpectrum';
import { variantOf } from '../../../../core/noiseTimeline';
import { DEFAULT_SIGNAL, exceeded, synth } from '../../../application/signals';
import type { ToolMeasurement } from '../../../application/measure';
import { audioSupport, chooseDevices, chosenDevices, listDevices, openCapture, outputRate, playAndRecord, stopAudio, useStopOnLeave, type AudioDevices, type Capture } from '../../../shared/audio';
import { downloadText } from '../../../shared/files';
import { Block, Inputs, SaveToRoom, hz, n0, n1, n2, num } from './common';
import { FileSweep } from './offline';

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

/** Получатель блоков микрофона вместе с NoiseMeter (Fast/Slow, БПФ): новый замер — новый измеритель. */
type Tap = (pcm: Float32Array, meter: NoiseMeter) => void;

/** Микрофон с NoiseMeter ядра: блоки 4096 отсчётов, пропуски видны по номеру блока; перерисовка 4 раза в секунду. */
function useMeter(tap?: { current: Tap | null }) {
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
        tap?.current?.(pcm, mm);
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

const TIME_MODES: { value: TimeWeight | '1'; label: string }[] = [{ value: 'F', label: 'Fast' }, { value: 'S', label: 'Slow' }, { value: '1', label: 'Leq 1 с' }];

export function NoiseMeterTool() {
  const tw = useRef<{ meter: NoiseMeter; t: TimeWeighted } | null>(null);
  const tap = useRef<Tap | null>((pcm, meter) => {
    if (tw.current?.meter !== meter) tw.current = { meter, t: new TimeWeighted(meter.sampleRate) };
    tw.current.t.push(pcm);
  });
  const m = useMeter(tap);
  const [weight, setWeight] = useState<Weight>('A');
  const [time, setTime] = useState<TimeWeight | '1'>('F');
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
  const tLevel = time === '1' ? null : tw.current && tw.current.meter === meter ? tw.current.t.level(weight, time) : null;
  const tName = time === 'F' ? 'Fast' : time === 'S' ? 'Slow' : '1 с';
  const lNow = time === '1' ? now : tLevel?.now ?? null;
  const lMin = time === '1' ? (seconds.length ? Math.min(...seconds) : null) : tLevel?.min ?? null;
  const lMax = time === '1' ? (seconds.length ? Math.max(...seconds) : null) : tLevel?.max ?? null;
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
        <SegmentedControl label="Временная характеристика" value={time} onChange={setTime} options={TIME_MODES} />
        <div class="al-row"><StartStop {...m} what={meter ? 'Новый замер' : 'Начать замер'} /></div>
        {m.error && <Notice tone="danger">{m.error}</Notice>}
        {info && <MicInfo cap={info} />}
        <Uncalibrated />
        {time !== '1' && <p class="al-text-secondary">Fast и Slow — экспоненциальное усреднение с постоянной 0,125 и 1 с по блокам около 85 мс. Это приближение, а не шумомер класса IEC 61672.</p>}
      </Block>
      {meter && (
        <>
          <div class="al-grid al-grid--metrics" role="list" aria-label="Уровни">
            <div role="listitem"><MetricCard label={`Сейчас (${tName}), ${weight}`} value={lNow === null ? null : n1(lNow)} unit="дБFS" /></div>
            <div role="listitem"><MetricCard label={`Leq за замер, ${weight}`} value={total?.power ? n1(10 * Math.log10(total.power)) : null} unit="дБFS" note={`${n0(snap?.activeSeconds ?? 0)} с`} /></div>
            <div role="listitem"><MetricCard label={`Min (${tName})`} value={lMin !== null ? n1(lMin) : lMax !== null ? '−∞' : null} unit="дБFS" note={lMin === null && lMax !== null ? 'Была цифровая тишина' : undefined} /></div>
            <div role="listitem"><MetricCard label={`Max (${tName})`} value={lMax === null ? null : n1(lMax)} unit="дБFS" /></div>
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

type Resolution = '1' | '3' | '6' | '12';
type RtaMode = 'rta' | 'fft';

/** Средний спектр по дробно-октавным полосам за период. */
function spectrumOf(meter: NoiseMeter | null, bands: { centers: number[]; edges: number[] } | null, period: SpectrumPeriod, weight: Weight): { x: number[]; y: number[] } {
  if (!meter || !bands || !meter.spectral.frameCount) return { x: [], y: [] };
  const p = bandPowers(meter.spectral.average(period, weight).density, meter.spectral.binHz, bands.edges);
  return { x: bands.centers, y: p.map((b) => db10(b.power) ?? NaN) };
}

interface FftState { meter: NoiseMeter; key: string; a: FftAnalyzer }
/** Спектр БПФ текущего замера, прорежен для графика (максимум в 1/96 октавы). */
function fftSpectrum(st: FftState | null, meter: NoiseMeter | null): { x: number[]; y: number[] } {
  if (!st || !meter || st.meter !== meter) return { x: [], y: [] };
  const sp = st.a.spectrum(20, Math.min(20000, meter.sampleRate / 2));
  const s = decimateLog(sp.f, sp.db);
  return { x: s.f, y: s.db };
}

const RES: { value: Resolution; label: string }[] = [{ value: '1', label: '1/1 октавы' }, { value: '3', label: '1/3 октавы' }, { value: '6', label: '1/6 октавы' }, { value: '12', label: '1/12 октавы' }];
const PERIODS: { value: SpectrumPeriod; label: string }[] = [{ value: 'now', label: 'Мгновенно' }, { value: '10', label: '10 с' }, { value: '60', label: '60 с' }, { value: 'session', label: 'Весь замер' }];
const AVERAGING: { value: Averaging; label: string }[] = [{ value: 'none', label: 'Без усреднения' }, { value: '4', label: 'По 4 кадрам' }, { value: '16', label: 'По 16 кадрам' }, { value: 'all', label: 'За весь замер' }];
const SPECTROGRAM_SECONDS = 60;
const SPECTROGRAM_COLUMNS = 120;

export function RtaTool() {
  const [mode, setMode] = useState<RtaMode>('rta');
  const [weight, setWeight] = useState<Weight>('Z');
  const [res, setRes] = useState<Resolution>('3');
  const [period, setPeriod] = useState<SpectrumPeriod>('10');
  const [size, setSize] = useState(8192);
  const [win, setWin] = useState<WindowKind>('hann');
  const [overlap, setOverlap] = useState(0.5);
  const [averaging, setAveraging] = useState<Averaging>('4');
  const key = `${size}|${win}|${overlap}|${averaging}`;
  const cfg = useRef({ key, size, win, overlap, averaging });
  useEffect(() => { cfg.current = { key, size, win, overlap, averaging }; }, [key, size, win, overlap, averaging]);
  const an = useRef<FftState | null>(null);
  // новые настройки БПФ — новый анализатор со следующего блока
  const tap = useRef<Tap | null>((pcm, meter) => {
    const c = cfg.current;
    if (an.current?.meter !== meter || an.current.key !== c.key) an.current = { meter, key: c.key, a: new FftAnalyzer(meter.sampleRate, c.size, c.win, c.overlap, c.averaging) };
    an.current.a.push(pcm);
  });
  const m = useMeter(tap);
  const [hold, setHold] = useState<number[] | null>(null);
  const [info, setInfo] = useState<Pick<Capture, 'device' | 'sampleRate' | 'processing'> | null>(null);
  useEffect(() => { if (m.cap) setInfo({ device: m.cap.device, sampleRate: m.cap.sampleRate, processing: m.cap.processing }); }, [m.cap]);
  const meter = m.meter;
  const rate = meter?.sampleRate ?? info?.sampleRate ?? 48000;
  const bands = useMemo(() => (!meter ? null : fractionalBands(20, Math.min(20000, meter.sampleRate / 2), Number(res))), [res, meter]);
  const { x, y } = mode === 'fft' ? fftSpectrum(an.current, meter) : spectrumOf(meter, bands, period, weight);
  const { running, tick } = m;
  useEffect(() => { setHold(null); }, [mode, res, weight, meter, key]);
  useEffect(() => {
    const cur = running ? (mode === 'fft' ? fftSpectrum(an.current, meter) : spectrumOf(meter, bands, period, weight)).y : [];
    if (!cur.length) return;
    setHold((h) => (h && h.length === cur.length ? h.map((v, i) => (Number.isFinite(cur[i]) ? Math.max(Number.isFinite(v) ? v : -Infinity, cur[i]) : v)) : [...cur]));
  }, [tick, running, meter, bands, period, weight, mode]);
  const stats = useMemo(() => windowStats(windowOf(win, size)), [win, size]);
  const frames = an.current?.meter === meter ? an.current?.a.frames ?? 0 : 0;
  // удержание пиков рисуется первым: текущий спектр поверх него
  const series = [...(hold && hold.length === x.length ? [{ id: 'hold', label: 'Удержание пиков', kind: 'measured' as const, variant: 2 as const, x, y: hold }] : []), { id: 'rta', label: 'Измерение', kind: 'measured' as const, x, y }];
  const tl = meter?.timeline;
  const sg = (() => {
    if (!tl || !tl.end || !meter) return null;
    const img = tl.spectrogramImage(tl.end - SPECTROGRAM_SECONDS * meter.sampleRate, tl.end, SPECTROGRAM_COLUMNS, variantOf(weight, false));
    const values = Float32Array.from(img.power, (p) => (p > 0 ? 10 * Math.log10(p) : NaN));
    let top = -Infinity;
    for (const v of values) if (Number.isFinite(v)) top = Math.max(top, v);
    return Number.isFinite(top) ? { values, max: Math.ceil(top / 10) * 10, edges: tl.spectrogramEdges } : null;
  })();
  return (
    <div class="al-stack al-stack--16">
      {!audioSupport().input && <NoInput />}
      <Block title="Анализатор спектра">
        <SegmentedControl label="Вид спектра" value={mode} onChange={setMode} options={[{ value: 'rta', label: 'Полосы (RTA)' }, { value: 'fft', label: 'БПФ' }]} />
        {mode === 'rta' ? (
          <Inputs>
            <SelectField label="Разрешение" value={res} options={RES} onChange={setRes} />
            <SelectField label="Усреднение" value={period} options={PERIODS} onChange={setPeriod} />
            <SelectField label="Коррекция" value={weight} options={WEIGHTS} onChange={setWeight} />
          </Inputs>
        ) : (
          <Inputs>
            <SelectField label="Размер БПФ" value={String(size)} options={FFT_SIZES.map((n) => ({ value: String(n), label: `${n} отсчётов` }))} onChange={(v) => setSize(Number(v))} />
            <SelectField label="Окно" value={win} options={WINDOWS.map((w) => ({ value: w, label: WINDOW_LABEL[w] }))} onChange={setWin} />
            <SelectField label="Перекрытие кадров" value={String(overlap)} options={OVERLAPS.map((o) => ({ value: String(o), label: `${n0(o * 100)} %` }))} onChange={(v) => setOverlap(Number(v))} />
            <SelectField label="Усреднение" value={averaging} options={AVERAGING} onChange={setAveraging} />
          </Inputs>
        )}
        {mode === 'fft' && (
          <KeyValue items={[
            ['Шаг БПФ', `${n2(rate / size)} Гц`],
            [`Фактическое разрешение (окно ${WINDOW_LABEL[win]})`, `${n2((stats.enbwBins * rate) / size)} Гц`],
            ['Длина кадра', `${n0((size / rate) * 1000)} мс`],
            ...(meter ? [['Кадров', String(frames)] as [string, string]] : []),
          ]} />
        )}
        <div class="al-row">
          <StartStop {...m} what={meter ? 'Новый замер' : 'Начать'} />
          {hold && <Button small variant="ghost" onClick={() => setHold(null)}>Сбросить пики</Button>}
        </div>
        {m.error && <Notice tone="danger">{m.error}</Notice>}
        {info && <MicInfo cap={info} />}
        <Uncalibrated />
        <p class="al-text-secondary">{mode === 'fft'
          ? 'БПФ без частотной коррекции. Высота линии — уровень синуса в дБFS; шум с ростом размера БПФ читается ниже. Точнее всего амплитуду синуса даёт окно Flat Top, разделение близких тонов — Блэкмана — Харриса.'
          : 'Спектр шума в комнате — не АЧХ: для частотной характеристики используйте измерение свипом.'}</p>
      </Block>
      {meter && <Block title="Спектр с микрофона">
        <FrequencyChart title="Спектр с микрофона" yUnit="дБFS" fMin={20} fMax={Math.min(20000, meter.sampleRate / 2)} series={series} empty="Спектр появится через секунду после начала." />
      </Block>}
      {meter && (
        <Block title={`Спектрограмма, ${weight}`} subtitle={`Последние ${SPECTROGRAM_SECONDS} с, полосы 1/12 октавы (история шумомера ядра)`}>
          {sg ? <Spectrogram title={`Спектрограмма, ${weight}`} values={sg.values} columns={SPECTROGRAM_COLUMNS} edgesHz={sg.edges} min={sg.max - 80} max={sg.max} unit="дБFS" seconds={SPECTROGRAM_SECONDS} />
            : <p class="al-text-secondary">Спектрограмма появится через секунду после начала.</p>}
        </Block>
      )}
      {meter && !m.running && x.length > 0 && mode === 'rta' && (
        <Block title="Сохранение">
          <SaveToRoom build={() => ({
            kind: 'noise', name: `Спектр 1/${res} окт., ${weight}`, method: `RTA: средний спектр (${PERIODS.find((p) => p.value === period)!.label.toLowerCase()}) по 1/${res} октавы, NoiseMeter ядра`, device: info?.device ?? 'Микрофон',
            data: { f: x.filter((_, i) => Number.isFinite(y[i])), db: y.filter(Number.isFinite), ref: 'dBFS' }, warnings: [], limitations: ['Без калибровки микрофона: дБFS, не дБ SPL.'],
          })} />
        </Block>
      )}
      <DistortionBlock />
    </div>
  );
}

const THD_FREQS = [100, 250, 500, 1000, 2000, 5000];
const THD_SECONDS = 3;
const THD_LEVEL = -20;

/** Искажения: синус (THD, THD+N, гармоники) или два тона SMPTE (IMD) через колонки, запись, БПФ устойчивого участка. */
type DistortionTest = 'thd' | 'imd';
type DistortionResult = { test: 'thd'; d: Distortion; peak: number; f: number } | { test: 'imd'; d: Intermod; peak: number };
const SMPTE = { f1: 60, f2: 7000, ratioDb: -12 };

function DistortionBlock() {
  const [test, setTest] = useState<DistortionTest>('thd');
  const [f, setF] = useState(1000);
  const [level, setLevel] = useState(THD_LEVEL);
  // повышение уровня выше уже подтверждённого — только после явного подтверждения
  const [allowed, setAllowed] = useState(THD_LEVEL);
  const [ask, setAsk] = useState<number | null>(null);
  const [ch, setCh] = useState<Ch>('both');
  const [result, setResult] = useState<DistortionResult | null>(null);
  const t = useTake(async (signal): Promise<DistortionResult> => {
    const tone = (fs: number) => test === 'thd'
      ? synth({ ...DEFAULT_SIGNAL, kind: 'stepped', list: String(f), stepSeconds: THD_SECONDS, fadeMs: 20, levelDb: level }, fs)
      : faded(synth({ ...DEFAULT_SIGNAL, kind: 'two-tone', ...SMPTE, seconds: THD_SECONDS, levelDb: level }, fs), Math.round(0.02 * fs));
    const r = await playAndRecord(route(tone(outputRate()), ch), 0.3, signal);
    let peak = 0;
    for (let i = 0; i < r.rec.length; i++) peak = Math.max(peak, Math.abs(r.rec[i]));
    const seg = steadySegment(r.rec, r.fs, Math.min(65536, 2 ** Math.floor(Math.log2(2 * r.fs))));
    if (!seg) throw new Error('Тон не найден в записи: проверьте, что колонка звучит и микрофон её слышит.');
    if (test === 'imd') {
      const d = intermod(seg, r.fs, SMPTE.f1, SMPTE.f2);
      if (!d) throw new Error('Запись слишком короткая для анализа.');
      return { test, d, peak };
    }
    const d = distortion(seg, r.fs, f);
    if (!d) throw new Error('Запись слишком короткая для анализа.');
    return { test, d, peak, f };
  });
  const warn = !result ? null
    : result.peak >= 0.98 ? 'Перегрузка микрофона: искажения записи, а не колонки. Уменьшите громкость.'
    : result.test === 'thd' && result.d.fundamentalDb - result.d.noiseDb < 50 ? 'Тон мало выше шума: THD+N в основном показывает шум. Сделайте громче или тише в комнате.'
    : result.test === 'thd' && Math.abs(result.d.f0 - result.f) > result.f * 0.01 ? `Найден тон ${n1(result.d.f0)} Гц вместо ${n0(result.f)} Гц: частоты устройства расходятся.`
    : result.test === 'imd' && Math.max(...result.d.sidebands.map((b) => b.relDb)) < -70 ? 'Боковые полосы на уровне шума: IMD ниже предела этого измерения.' : null;
  const cols: Column<Distortion['harmonics'][number]>[] = [
    { key: 'n', title: 'Гармоника', numeric: true, render: (h) => String(h.n) },
    { key: 'f', title: 'Частота', numeric: true, render: (h) => hz(h.f) },
    { key: 'r', title: 'К основному тону', numeric: true, render: (h) => `${n1(h.relDb)} дБ` },
    { key: 'p', title: 'Доля', numeric: true, render: (h) => `${h.percent < 0.01 ? '< 0,01' : n2(h.percent)} %` },
  ];
  const sideCols: Column<Sideband>[] = [
    { key: 'k', title: 'Боковая', render: (b) => `f₂ ${b.order > 0 ? '+' : '−'} ${Math.abs(b.order)}·f₁` },
    { key: 'f', title: 'Частота', numeric: true, render: (b) => hz(b.f) },
    { key: 'r', title: 'К тону 7 кГц', numeric: true, render: (b) => `${n1(b.relDb)} дБ` },
  ];
  return (
    <>
      <Block title="Искажения" subtitle="Синус: THD, THD+N, гармоники. Два тона SMPTE: интермодуляция">
        <SegmentedControl label="Тест" value={test} onChange={(v) => { setTest(v); setResult(null); }} options={[{ value: 'thd', label: 'Синус (THD)' }, { value: 'imd', label: 'Два тона (IMD)' }]} />
        <Inputs>
          {test === 'thd' && <SelectField label="Частота тона" value={String(f)} options={THD_FREQS.map((v) => ({ value: String(v), label: hz(v) }))} onChange={(v) => setF(Number(v))} />}
          <NumberField label="Пиковый уровень" unit="дБFS" value={level} min={-40} max={-6} decimals={0} onCommit={(v) => (v > allowed ? setAsk(v) : setLevel(v))} hint={`До ${n0(allowed)} — без подтверждения`} />
          <SelectField label="Каналы" value={ch} options={[...CHANNEL_OPTS]} onChange={setCh} />
        </Inputs>
        {test === 'imd' && <p class="al-text-secondary">60 Гц и 7 кГц, второй тон на 12 дБ тише (4:1).</p>}
        <div class="al-row">
          {t.busy ? <Button variant="primary" icon="stop" onClick={t.stop}>Стоп</Button>
            : <Button variant="primary" icon="play" disabled={!audioSupport().input} onClick={() => void t.go(setResult)}>Измерить искажения</Button>}
        </div>
        {t.busy && <p class="al-text-secondary">{`Звучит ${test === 'thd' ? `тон ${hz(f)}` : 'двухтоновый сигнал'}, ${THD_SECONDS} с.`}</p>}
        {t.error && <Notice tone="danger">{t.error}</Notice>}
        <p class="al-text-secondary">Измеряется вся цепочка: усилитель, колонка, помещение, микрофон и звуковой тракт устройства. Результат не приписывается конкретному динамику; встроенный микрофон сам искажает громкий звук.</p>
      </Block>
      {result && warn && <Notice tone="warning">{warn}</Notice>}
      {result?.test === 'thd' && (
        <>
          <div class="al-grid al-grid--metrics" role="list" aria-label="Искажения">
            <div role="listitem"><MetricCard label="THD" value={n2(result.d.thd)} unit="%" note={`${result.d.harmonics.length} гармоник`} /></div>
            <div role="listitem"><MetricCard label="THD+N" value={n2(result.d.thdN)} unit="%" note="20 Гц – 20 кГц" /></div>
            <div role="listitem"><MetricCard label="Основной тон" value={n1(result.d.fundamentalDb)} unit="дБFS" note={hz(result.d.f0)} /></div>
            <div role="listitem"><MetricCard label="Шумовой порог" value={n1(result.d.noiseDb)} unit="дБFS" note={`на бин ${n2(result.d.binHz)} Гц`} /></div>
          </div>
          <Block title="Гармоники">
            <DataTable caption="Гармоники" columns={cols} rows={result.d.harmonics} rowKey={(h) => String(h.n)} empty="Гармоники выше 20 кГц не измеряются." />
          </Block>
        </>
      )}
      {result?.test === 'imd' && (
        <>
          <div class="al-grid al-grid--metrics" role="list" aria-label="Интермодуляция">
            <div role="listitem"><MetricCard label="IMD (SMPTE)" value={n2(result.d.imd)} unit="%" note="Боковые f₂ ± 1…4·f₁" /></div>
            <div role="listitem"><MetricCard label="Тон 7 кГц" value={n1(result.d.f2Db)} unit="дБFS" /></div>
          </div>
          <Block title="Боковые полосы">
            <DataTable caption="Боковые полосы" columns={sideCols} rows={result.d.sidebands} rowKey={(b) => String(b.order)} />
          </Block>
        </>
      )}
      {ask !== null && (
        <ConfirmDialog title={`Повысить уровень до ${n0(ask)} дБFS?`} text="Громкий тон может повредить твитеры и слух. Перед подтверждением уменьшите громкость усилителя." confirmLabel="Повысить" danger
          onConfirm={() => { setLevel(ask); setAllowed(ask); setAsk(null); }} onCancel={() => setAsk(null)} />
      )}
    </>
  );
}

/** Плавные края m отсчётов у сигнала без своих краёв (двухтоновый повторяемый). */
function faded(x: Float32Array, m: number): Float32Array {
  for (let i = 0; i < m && i < x.length / 2; i++) {
    const g = 0.5 - 0.5 * Math.cos((Math.PI * i) / m);
    x[i] *= g;
    x[x.length - 1 - i] *= g;
  }
  return x;
}

type SweepRange = 'low' | 'full';
const SWEEP_RANGES: Record<SweepRange, { f1: number; f2: number; lo: number; hi: number; label: string; short: string }> = {
  low: { f1: 10, f2: 1000, lo: 15, hi: 500, label: '10 Гц – 1 кГц (низкие)', short: '10 Гц – 1 кГц' },
  full: { f1: 20, f2: 20000, lo: 20, hi: 20000, label: '20 Гц – 20 кГц', short: '20 Гц – 20 кГц' },
};
const SWEEP_SECONDS = [3, 6, 10, 15];
const SWEEP_TAILS = [0.5, 1, 1.5, 2, 3];
type Take = SweepResult & { id: number; warn: string | null; range: SweepRange };

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

/** Свип: запись микрофоном в приложении или обработка файла записи (V2-049). */
export function SweepTool() {
  const [mode, setMode] = useState<'mic' | 'file'>('mic');
  return (
    <div class="al-stack al-stack--16">
      <SegmentedControl label="Источник записи" value={mode} onChange={setMode} options={[{ value: 'mic', label: 'Микрофон' }, { value: 'file', label: 'Из файла WAV' }]} />
      {mode === 'mic' ? <MicSweep /> : <FileSweep />}
    </div>
  );
}

/** Выбор микрофона и выхода (V2-049): на время сеанса; выход — где браузер это умеет (Chrome, Edge). */
function Devices({ output }: { output: boolean }) {
  const [list, setList] = useState<AudioDevices | null>(null);
  const [sel, setSel] = useState(chosenDevices());
  const load = () => void listDevices().then(setList, () => setList({ inputs: [], outputs: [], canChooseOutput: false }));
  useEffect(load, []);
  if (!list || !audioSupport().input) return null;
  const choose = (input: string | null, out: string | null) => { setSel({ input, output: out }); void chooseDevices(input, out); };
  return (
    <div class="al-stack al-stack--8">
      <div class="al-row al-row--bottom">
        <SelectField label="Микрофон" value={sel.input ?? ''} onChange={(v) => choose(v || null, sel.output)}
          options={[{ value: '', label: 'По умолчанию' }, ...list.inputs.map((d) => ({ value: d.id, label: d.label }))]} />
        {output && list.canChooseOutput && (
          <SelectField label="Выход" value={sel.output ?? ''} onChange={(v) => choose(sel.input, v || null)}
            options={[{ value: '', label: 'По умолчанию' }, ...list.outputs.map((d) => ({ value: d.id, label: d.label }))]} />
        )}
        <Button small variant="ghost" onClick={load}>Обновить список</Button>
      </div>
      <p class="al-text-small al-text-secondary">{`Названия устройств браузер показывает после разрешения микрофона.${output && !list.canChooseOutput ? ' Выход здесь выбирает система; чтобы играть через другое устройство, скачайте свип в генераторе и обработайте запись в режиме «Из файла WAV».' : ''}`}</p>
    </div>
  );
}

function MicSweep() {
  const [level, setLevel] = useState(-12);
  const [ch, setCh] = useState<Ch>('both');
  const [range, setRange] = useState<SweepRange>('low');
  const [seconds, setSeconds] = useState(6);
  const [repeats, setRepeats] = useState(1);
  const [tail, setTail] = useState(1.5);
  const [takes, setTakes] = useState<Take[]>([]);
  const [device, setDevice] = useState('Микрофон');
  const [progress, setProgress] = useState<string | null>(null);
  const R = SWEEP_RANGES[range];
  // дубли пишутся по одному: остановка не теряет уже записанные
  const t = useTake(async (signal) => {
    const amp = 10 ** (level / 20);
    for (let k = 1; k <= repeats; k++) {
      setProgress(repeats > 1 ? `Дубль ${k} из ${repeats}` : null);
      const r = await playAndRecord(route(logSweep(R.f1, R.f2, seconds, outputRate(), amp), ch), tail, signal);
      setDevice(r.device);
      const sweep = logSweep(R.f1, R.f2, seconds, r.fs, amp);
      if (r.rec.length < sweep.length) throw new Error('Запись короче сигнала: попробуйте ещё раз.');
      const seg = sweepSegment(r.rec, sweep.length, r.fs);
      if (!seg) throw new Error('Свип не найден в записи: проверьте, что колонка звучит и микрофон её слышит.');
      const res = range === 'low' ? analyzeSweep(seg, sweep, R.f1, R.f2, r.fs) : analyzeSweepBand(seg, sweep, R.f1, R.f2, r.fs, R.lo, Math.min(R.hi, r.fs / 2 - 1));
      setTakes((a) => [...a, { ...res, id: (a[a.length - 1]?.id ?? 0) + 1, warn: sweepQuality(res), range }]);
    }
    setProgress(null);
  });
  const shown = takes.filter((x) => x.range === range);
  const avg = shown.length ? { f: shown[0].f, db: powerAverage(shown.map((x) => x.db)) } : null;
  const cols: Column<Take>[] = [
    { key: 'n', title: 'Дубль', numeric: true, render: (x) => String(x.id) },
    { key: 's', title: 'Запас над шумом', numeric: true, render: (x) => `${n0(x.snrDb)} дБ` },
    { key: 'p', title: 'Пик записи', numeric: true, render: (x) => `${n1(20 * Math.log10(Math.max(1e-9, x.peak)))} дБFS` },
    { key: 'q', title: 'Качество', render: (x) => x.warn ?? 'хорошо' },
    { key: 'd', title: 'Удалить', render: (x) => <IconButton icon="trash" small label={`Удалить дубль ${x.id}`} onClick={() => setTakes(takes.filter((y) => y.id !== x.id))} /> },
  ];
  const title = shown.length > 1 ? `АЧХ, среднее по ${shown.length} дублям` : 'АЧХ';
  const method = `Логарифмический свип ${R.short}, ${seconds} с, деконволюция (${range === 'low' ? 'analyzeSweep ядра' : 'порядок analyzeSweep ядра, полоса 20 Гц – 20 кГц'})`;
  return (
    <div class="al-stack al-stack--16">
      {!audioSupport().input && <NoInput />}
      <Notice tone="warning" title="Начните с малой громкости">{`Свип ${R.short} длится ${seconds} с и запускается только кнопкой. Поставьте микрофон на место слушателя.`}</Notice>
      <Block title="Измерение АЧХ свипом" subtitle="Деконволюция записи, окно 1 с после прямого звука, сглаживание 1/24 октавы">
        <Devices output />
        <Inputs>
          <SelectField label="Диапазон свипа" value={range} options={(Object.keys(SWEEP_RANGES) as SweepRange[]).map((k) => ({ value: k, label: SWEEP_RANGES[k].label }))} onChange={setRange} />
          <SelectField label="Длительность свипа" value={String(seconds)} options={SWEEP_SECONDS.map((v) => ({ value: String(v), label: `${v} с` }))} onChange={(v) => setSeconds(Number(v))} />
          <SelectField label="Дублей за запуск" value={String(repeats)} options={[1, 2, 3, 4, 5].map((v) => ({ value: String(v), label: String(v) }))} onChange={(v) => setRepeats(Number(v))} />
          <SelectField label="Запись после свипа" value={String(tail)} options={SWEEP_TAILS.map((v) => ({ value: String(v), label: `${num(v, 1)} с` }))} onChange={(v) => setTail(Number(v))} hint="Хвост затухания комнаты" />
          <NumberField label="Уровень свипа" unit="дБFS" value={level} min={-40} max={-6} decimals={0} onCommit={setLevel} />
          <SelectField label="Каналы" value={ch} options={[...CHANNEL_OPTS]} onChange={setCh} />
        </Inputs>
        <div class="al-row">
          {t.busy ? <Button variant="primary" icon="stop" onClick={t.stop}>Стоп</Button>
            : <Button variant="primary" icon="play" disabled={!audioSupport().input} onClick={() => void t.go(() => undefined)}>{shown.length ? 'Ещё дубль' : 'Измерить'}</Button>}
          {takes.length > 0 && !t.busy && <Button small variant="ghost" onClick={() => setTakes([])}>Начать заново</Button>}
        </div>
        {t.busy && <p class="al-text-secondary">{`${progress ? `${progress}. ` : ''}Идёт измерение: не шумите и не трогайте микрофон.`}</p>}
        {t.error && <Notice tone="danger">{t.error}</Notice>}
        {takes.length > shown.length && <p class="al-text-secondary">Дубли другого диапазона сохранены отдельно и в среднее не входят.</p>}
        <p class="al-text-secondary">Микрофон без калибровки: форма АЧХ относительная, абсолютный уровень неизвестен; во всём диапазоне в неё входит и АЧХ самого микрофона.</p>
      </Block>
      {avg && (
        <Block title={title}>
          <FrequencyChart title={title} fMin={R.lo} fMax={avg.f[avg.f.length - 1]} series={[{ id: 'fr', label: 'Измерение', kind: 'measured', x: avg.f, y: avg.db }]} />
        </Block>
      )}
      {shown.length > 0 && <Block title="Дубли">
        <DataTable caption="Дубли" columns={cols} rows={shown} rowKey={(x) => String(x.id)} />
      </Block>}
      {avg && !t.busy && (
        <Block title="Сохранение">
          <div class="al-row"><Button small icon="download" onClick={() => downloadText('frequency-response.csv', ['f_Hz;dB'].concat(avg.f.map((f, i) => `${f.toFixed(2)};${avg.db[i].toFixed(2)}`)).join('\n') + '\n', 'text/csv')}>АЧХ, CSV</Button></div>
          <SaveToRoom build={() => ({
            kind: 'frequency-response', name: `АЧХ свипом ${R.short}${shown.length > 1 ? `, ${shown.length} дубля` : ''}`, method, device,
            data: { f: avg.f, db: avg.db, ref: 'dB re 1' }, points: shown.length,
            warnings: shown.map((x) => x.warn).filter((w): w is string => !!w), limitations: ['Микрофон без калибровки: уровень относительный.', `Полоса анализа ${range === 'low' ? '15–500 Гц' : '20 Гц – 20 кГц'}.`],
          })} />
        </Block>
      )}
    </div>
  );
}

const RT_LABEL = (b: number) => (b >= 1000 ? `${b / 1000}k` : String(b));
type DecayMethod = 'clap' | 'sweep';
const CLAP_SECONDS = 4;
const DECAY_SWEEP_T = 6;

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
    const r = await playAndRecord(route(logSweep(20, 20000, DECAY_SWEEP_T, outputRate(), amp), 'both'), 2.5, signal);
    setDevice(r.device);
    const sweep = logSweep(20, 20000, DECAY_SWEEP_T, r.fs, amp);
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
        <Devices output={method === 'sweep'} />
        <SegmentedControl label="Источник звука" value={method} onChange={(v) => { setMethod(v); setTakes([]); }} options={[{ value: 'clap', label: 'Хлопок' }, { value: 'sweep', label: 'Свип через колонки' }]} />
        {method === 'sweep' && <Inputs><NumberField label="Уровень свипа" unit="дБFS" value={level} min={-40} max={-6} decimals={0} onCommit={setLevel} /></Inputs>}
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
