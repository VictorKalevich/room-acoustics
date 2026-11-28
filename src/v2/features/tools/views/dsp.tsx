// Экспертный уровень настройки (V2-053): звенья цепочки сверх RBJ (усиление, задержка, полярность, свой биквад),
// FIR с минимальной, линейной или смешанной фазой и комплексная фазовая коррекция с регуляризацией — по характеристике
// цепочки, кроссовера или замера с фазой из файла. Расчёты — application/iir и application/fir.
import { useMemo, useState } from 'preact/hooks';
import type { Complex } from '../../../../core/types';
import { wavFloat32 } from '../../../../core/dsp';
import { Button, FrequencyChart, KeyValue, Notice, NumberField, SegmentedControl, SelectField, Switch } from '../../../design-system';
import { FIR_LENGTHS, arrivalDelayMs, corrector, correctionCheck, designFir, firCheck, firText, parsePhaseText, phaseDataAt, type FirPhase, type PhaseData } from '../../../application/fir';
import { type ChainExtra } from '../../../application/iir';
import { logFreqs } from '../../../application/tools';
import { downloadBlob, downloadText, safeFileName } from '../../../shared/files';
import { Block, hz, n0, n1, n2 } from './common';

export const EXTRA_LABEL: Record<ChainExtra['type'], string> = { gain: 'Усиление', delay: 'Задержка', polarity: 'Полярность', biquad: 'Свой биквад' };

export function ExtraFields({ x, set }: { x: ChainExtra; set: (x: ChainExtra) => void }) {
  if (x.type === 'gain') return <div class="al-grid al-grid--metrics"><NumberField label="Усиление" unit="дБ" value={x.gainDb} min={-60} max={20} decimals={2} onCommit={(gainDb) => set({ ...x, gainDb })} /></div>;
  if (x.type === 'delay') return <div class="al-grid al-grid--metrics"><NumberField label="Задержка" unit="мс" value={x.ms} min={0} max={1000} decimals={3} onCommit={(ms) => set({ ...x, ms })} /></div>;
  if (x.type === 'polarity') return <p class="al-text-small al-text-secondary">Инверсия полярности: умножение на −1, фаза +180° на всех частотах.</p>;
  const k = x.coeffs;
  const field = (name: keyof typeof k) => <NumberField key={name} label={name} value={k[name]} min={-10} max={10} decimals={12} onCommit={(v) => set({ ...x, coeffs: { ...k, [name]: v } })} />;
  return (
    <>
      <div class="al-grid al-grid--metrics">{(['b0', 'b1', 'b2', 'a1', 'a2'] as const).map(field)}</div>
      <p class="al-text-small al-text-secondary">H(z) = (b0 + b1·z⁻¹ + b2·z⁻²)/(1 + a1·z⁻¹ + a2·z⁻²), a0 = 1. Коэффициенты считаются для выбранной частоты дискретизации.</p>
    </>
  );
}

const RATES = [44100, 48000, 96000];
const PHASE_LABEL: Record<FirPhase, string> = { minimum: 'Минимальная', linear: 'Линейная', mixed: 'Смешанная' };

const exportButtons = (taps: Float64Array, fs: number, name: string) => (
  <div class="al-row">
    <Button small icon="download" onClick={() => downloadBlob(`${safeFileName(name)}_${fs}.wav`, new Blob([wavFloat32([Float32Array.from(taps)], fs)], { type: 'audio/wav' }))}>FIR, WAV 32 бит</Button>
    <Button small icon="download" onClick={() => downloadText(`${safeFileName(name)}_${fs}.txt`, firText(taps), 'text/plain')}>Коэффициенты, TXT</Button>
  </div>
);

/** FIR, реализующий характеристику h (цепочки IIR): модуль точно, фаза — по выбору. */
export function FirBlock({ h, fs, name, hKey }: { h: (f: number) => Complex; fs: number; name: string; hKey: string }) {
  const [phase, setPhase] = useState<FirPhase>('linear');
  const [n, setN] = useState(16384);
  const [split, setSplit] = useState(200);
  const [limit, setLimit] = useState(50);
  const freqs = useMemo(() => logFreqs(20, Math.min(20000, fs * 0.45), 8), [fs]);
  const delaySamples = phase === 'mixed' ? Math.min(n / 2, Math.round((limit / 1000) * fs)) : n / 2;
  const d = useMemo(() => designFir(h, { n, fs, phase, splitHz: split, delaySamples }), [hKey, n, fs, phase, split, delaySamples]); // eslint-disable-line react-hooks/exhaustive-deps
  const r = useMemo(() => firCheck(h, d, freqs), [d, freqs]); // eslint-disable-line react-hooks/exhaustive-deps
  const bad = r.filter((x) => Math.abs(x.errDb) > 1);
  const worst = Math.max(...r.map((x) => Math.abs(x.errDb)));
  return (
    <Block title="FIR из цепочки" subtitle="Экспертный уровень. Модуль — как у цепочки; фаза минимальная (как у IIR, без предзвона), линейная (без фазовых сдвигов, с задержкой n/2 и предзвоном) или смешанная (ниже частоты раздела — минимальная, выше — линейная).">
      <SegmentedControl label="Фаза FIR" value={phase} onChange={setPhase} options={(Object.keys(PHASE_LABEL) as FirPhase[]).map((p) => ({ value: p, label: PHASE_LABEL[p] }))} />
      <div class="al-grid al-grid--metrics">
        <SelectField label="Длина, отсчётов" value={String(n)} options={FIR_LENGTHS.map((x) => ({ value: String(x), label: `${x} (${n1((x / fs) * 1000)} мс)` }))} onChange={(v) => setN(Number(v))} />
        {phase === 'mixed' && <NumberField label="Частота раздела" unit="Гц" value={split} min={20} max={5000} decimals={0} onCommit={setSplit} />}
        {phase === 'mixed' && <NumberField label="Ограничение задержки" unit="мс" value={limit} min={1} max={1000} decimals={0} onCommit={setLimit} />}
      </div>
      <FrequencyChart title="Уровень: цепочка и FIR" fMin={freqs[0]} fMax={freqs[freqs.length - 1]} series={[
        { id: 't', label: 'Цепочка IIR', kind: 'target', x: freqs, y: r.map((x) => x.targetDb) },
        { id: 'f', label: 'FIR', kind: 'calculated', x: freqs, y: r.map((x) => x.firDb) },
      ]} />
      <FrequencyChart title="Групповая задержка FIR без собственной задержки" yUnit="мс" fMin={freqs[0]} fMax={freqs[freqs.length - 1]} series={[{ id: 'g', label: 'FIR', kind: 'calculated', x: freqs, y: r.map((x) => x.firGdMs) }]} />
      <KeyValue items={[
        ['Задержка фильтра', `${n1(d.latencyMs)} мс`],
        ['Разрешение по частоте', `${n2(fs / n)} Гц`],
        ['Предзвон', d.preRingDb === null ? 'нет' : `${n0(d.preRingDb)} дБ`],
        ['Наибольшее отклонение от цепочки', `${n2(worst)} дБ`],
      ]} />
      {bad.length > 0 && <Notice tone="warning">{`FIR отличается от цепочки больше чем на 1 дБ на ${hz(bad[0].f)}–${hz(bad[bad.length - 1].f)}: длины ${n} не хватает для узких или низкочастотных фильтров — увеличьте длину.`}</Notice>}
      {phase === 'mixed' && delaySamples < n / 2 && <p class="al-text-small al-text-secondary">{`Задержка ограничена ${n1(d.latencyMs)} мс: линейная часть выше частоты раздела короче, чем позволяет длина.`}</p>}
      {exportButtons(d.taps, fs, `${name}_FIR_${phase}`)}
    </Block>
  );
}

/** Комплексная коррекция: FIR, после которого характеристика в полосе — чистая задержка (и, по выбору, ровный модуль). */
export function PhaseCorrectionBlock({ h, hKey, name, f1: f1d, f2: f2d, fixedFs, measured }: { h: (f: number) => Complex; hKey: string; name: string; f1: number; f2: number; fixedFs?: number; measured?: boolean }) {
  const [fsSel, setFs] = useState(48000);
  const fs = fixedFs ?? fsSel;
  const [n, setN] = useState(16384);
  const [f1, setF1] = useState(f1d);
  const [f2, setF2] = useState(f2d);
  const [latency, setLatency] = useState<number | null>(null);
  const [mag, setMag] = useState(false);
  const [reg, setReg] = useState(20);
  const [boost, setBoost] = useState(6);
  const maxLat = (n / 2 / fs) * 1000;
  const lat = Math.min(latency ?? maxLat, maxLat);
  const delaySamples = Math.round((lat / 1000) * fs);
  const freqs = useMemo(() => logFreqs(20, Math.min(20000, fs * 0.45), 8), [fs]);
  const c = useMemo(() => corrector(h, { n, fs, f1, f2: Math.min(f2, fs * 0.45), delaySamples, magnitude: mag, regDb: reg, maxBoostDb: boost }), [hKey, n, fs, f1, f2, delaySamples, mag, reg, boost]); // eslint-disable-line react-hooks/exhaustive-deps
  const r = useMemo(() => correctionCheck(h, c, freqs), [c, freqs]); // eslint-disable-line react-hooks/exhaustive-deps
  const inBand = r.filter((x) => x.f >= f1 && x.f <= f2);
  const spread = (v: number[]) => (v.length ? Math.max(...v) - Math.min(...v) : 0);
  const residual = Math.max(0, ...inBand.map((x) => Math.abs(x.afterPhaseDeg)));
  const gdBefore = spread(inBand.map((x) => x.beforeGdMs)), gdAfter = spread(inBand.map((x) => x.afterGdMs));
  const series = (key: 'Db' | 'PhaseDeg' | 'GdMs') => [
    { id: 'b', label: 'До коррекции', kind: (measured ? 'measured' : 'calculated') as 'measured' | 'calculated', x: freqs, y: r.map((x) => x[`before${key}`]) },
    { id: 'a', label: 'После FIR', kind: 'predicted' as const, variant: 2 as const, x: freqs, y: r.map((x) => x[`after${key}`]) },
  ];
  return (
    <Block title="Фазовая коррекция FIR" subtitle={`Экспертный уровень. В полосе ${hz(f1)}–${hz(f2)} фаза выпрямляется до чистой задержки; за полосой коррекция плавно сходит на нет за треть октавы. Это расчёт по ${measured ? 'замеру с фазой в одной точке — в других точках комнаты результат другой' : 'модели электрических фильтров — акустика излучателей не учтена'}.`}>
      <div class="al-grid al-grid--metrics">
        {!fixedFs && <SelectField label="Частота дискретизации" value={String(fs)} options={RATES.map((x) => ({ value: String(x), label: `${n1(x / 1000)} кГц` }))} onChange={(v) => setFs(Number(v))} />}
        <SelectField label="Длина, отсчётов" value={String(n)} options={FIR_LENGTHS.map((x) => ({ value: String(x), label: `${x} (${n1((x / fs) * 1000)} мс)` }))} onChange={(v) => setN(Number(v))} />
        <NumberField label="Полоса коррекции от" unit="Гц" value={f1} min={10} max={f2 / 2} decimals={0} onCommit={setF1} />
        <NumberField label="Полоса коррекции до" unit="Гц" value={f2} min={f1 * 2} max={fs * 0.45} decimals={0} onCommit={setF2} />
        <NumberField label="Задержка коррекции" unit="мс" value={lat} min={0} max={maxLat} decimals={1} onCommit={setLatency} hint={`Не больше половины длины: ${n1(maxLat)} мс`} />
      </div>
      <Switch label="Исправлять и уровень (регуляризованное обращение)" checked={mag} onChange={setMag} />
      {mag && (
        <div class="al-grid al-grid--metrics">
          <NumberField label="Регуляризация" unit="дБ" value={reg} min={0} max={60} decimals={0} onCommit={setReg} hint={`Обращение поднимает не больше чем на ${n1(reg - 20 * Math.log10(2))} дБ`} />
          <NumberField label="Наибольший подъём" unit="дБ" value={boost} min={0} max={20} decimals={1} onCommit={setBoost} hint="Глубокие провалы не вытягиваются" />
        </div>
      )}
      <FrequencyChart title="Групповая задержка до и после коррекции" yUnit="мс" fMin={freqs[0]} fMax={freqs[freqs.length - 1]} bands={[{ f0: f1, f1: f2, label: 'Полоса коррекции' }]} series={series('GdMs')} />
      <FrequencyChart title="Фаза до и после коррекции (без задержки FIR)" yUnit="°" yRange={[-180, 180]} fMin={freqs[0]} fMax={freqs[freqs.length - 1]} series={series('PhaseDeg')} />
      {mag && <FrequencyChart title="Уровень до и после коррекции" fMin={freqs[0]} fMax={freqs[freqs.length - 1]} series={series('Db')} />}
      <KeyValue items={[
        ['Задержка коррекции', `${n1(c.latencyMs)} мс`],
        ['Остаток фазы в полосе', `до ${n0(residual)}°`],
        ['Разброс групповой задержки в полосе', `${n2(gdBefore)} → ${n2(gdAfter)} мс`],
        ['Предзвон', c.preRingDb === null ? 'нет' : `${n0(c.preRingDb)} дБ`],
      ]} />
      {gdAfter > gdBefore + 0.05 && <Notice tone="warning">Групповая задержка в полосе после коррекции ровнее не стала: исходная фаза здесь почти линейна, а длины FIR не хватает на краях полосы. Сузьте полосу до участка, где фаза действительно гнётся.</Notice>}
      {residual > 20 && <Notice tone="warning">Фаза в полосе выпрямлена не полностью: не хватает длины или задержки для нижней границы полосы. Увеличьте длину, задержку или поднимите нижнюю границу.</Notice>}
      {c.preRingDb !== null && c.preRingDb > -30 && <Notice tone="warning">{`Заметный предзвон (${n0(c.preRingDb)} дБ): выпрямление фазы ФВЧ и низких частот переносит часть энергии раньше основного импульса. Слышимость зависит от сигнала — проверяйте прослушиванием.`}</Notice>}
      {exportButtons(c.taps, fs, `${name}_фазовая_коррекция`)}
    </Block>
  );
}

/** Замер с фазой из файла → коррекция. */
export function MeasuredPhaseBlock() {
  const [data, setData] = useState<{ name: string; d: PhaseData } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [remove, setRemove] = useState(true);
  const open = (file: File | undefined) => {
    if (!file) return;
    void file.text().then((t) => {
      const r = parsePhaseText(t);
      if ('error' in r) { setError(r.error); setData(null); } else { setError(null); setData({ name: file.name.replace(/\.[^.]+$/, ''), d: r }); }
    }, () => setError('Не удалось прочитать файл.'));
  };
  const delay = data ? arrivalDelayMs(data.d) : 0;
  const h = useMemo(() => (data ? phaseDataAt(data.d, remove ? delay : 0) : null), [data, remove, delay]);
  const fLo = data ? Math.max(20, data.d.f[0] * 2) : 20, fHi = data ? Math.min(20000, data.d.f[data.d.f.length - 1] / 2) : 20000;
  return (
    <div class="al-stack al-stack--16">
      <Block title="Замер с фазой" subtitle="Экспертный уровень. Текст «частота, уровень, фаза в градусах» — например, экспорт REW «Measurement as text» без сглаживания. Фаза в файле должна быть плотной: между соседними точками — меньше полуоборота; лучше ставить начало отсчёта ИХ на её пик.">
        <div class="al-row al-row--12">
          <label class="al-btn al-btn--secondary al-btn--small">
            <input class="al-visually-hidden" type="file" accept=".txt,.csv,text/plain" aria-label="Файл замера с фазой" onChange={(e) => open(e.currentTarget.files?.[0])} />
            Загрузить замер с фазой
          </label>
        </div>
        {error && <Notice tone="danger">{error}</Notice>}
        {data && (
          <>
            <KeyValue items={[
              ['Файл', data.name],
              ['Точек', String(data.d.f.length)],
              ['Диапазон', `${hz(data.d.f[0])}–${hz(data.d.f[data.d.f.length - 1])}`],
              ['Задержка прихода по наклону фазы', `${n2(delay)} мс`],
            ]} />
            <Switch label="Убрать задержку прихода" checked={remove} onChange={setRemove} />
          </>
        )}
      </Block>
      {data && h && <PhaseCorrectionBlock key={data.name} h={h} hKey={`${data.name}|${data.d.f.length}|${remove}`} name={data.name} f1={Math.max(fLo, 100)} f2={Math.min(fHi, 10000)} measured />}
    </div>
  );
}
