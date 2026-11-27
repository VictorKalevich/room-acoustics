// Настройка аудиосистемы (V2-040): эквалайзер (биквады RBJ, экспорт), кроссовер, сумма двух источников,
// стереотреугольник, запас по звуковому давлению (оценка, не гарантия), направленность упрощённой модели.
import { useCallback, useEffect, useMemo, useState } from 'preact/hooks';
import {
  Button, DataTable, FrequencyChart, IconButton, KeyValue, MetricCard, Notice, NumberField, SegmentedControl, SelectField, Switch, TextField, useToast, type Column, type Series,
} from '../../../design-system';
import { exportREW } from '../../../../core/eq';
import { speedOfSound } from '../../../../core/physics';
import {
  CROSSOVER_ORDERS, EQ_HAS_GAIN, EQ_TYPES, beamwidth6, crossoverResponse, delayMs, distanceForAngle, eqChain, eqIssues, exportApo, exportBiquads, logFreqs,
  pistonDb, splBudget, stereoTriangle, twoSourceSum, type CrossoverFamily, type EqFilter, type EqType,
} from '../../../application/tools';
import { listCategory, putEntry } from '../../../storage/library';
import { useApp } from '../../../shared/context';
import { downloadText, safeFileName } from '../../../shared/files';
import { Block, FromRoom, Inputs, SaveResult, cm, freq, hz, meters, n0, n1, n2 } from './common';

const EQ_LABEL: Record<EqType, string> = {
  peaking: 'Пиковый', lowshelf: 'Полка НЧ', highshelf: 'Полка ВЧ', lowpass: 'ФНЧ', highpass: 'ФВЧ', bandpass: 'Полосовой', notch: 'Режекторный', allpass: 'Фазовый',
};
const RATES = [44100, 48000, 96000];
const MAX_FILTERS = 20;

interface EqPreset { id: string; name: string; kind: 'eq'; filters: EqFilter[]; fs: number; createdAt: string }

export function EqualizerTool() {
  const { db, clock } = useApp();
  const toast = useToast();
  const [filters, setFilters] = useState<EqFilter[]>([{ id: 'f1', type: 'peaking', f: 63, gainDb: -6, q: 4, enabled: true }]);
  const [fs, setFs] = useState(48000);
  const [name, setName] = useState('Эквалайзер');
  const [presets, setPresets] = useState<EqPreset[]>([]);
  const [pick, setPick] = useState('');
  const reload = useCallback(() => listCategory(db, 'presets').then((l) => setPresets((l as unknown as EqPreset[]).filter((p) => p.kind === 'eq' && Array.isArray(p.filters))), () => undefined), [db]);
  useEffect(() => { void reload(); }, [reload]);
  const freqs = useMemo(() => logFreqs(10, Math.min(20000, fs * 0.45), 48), [fs]);
  const chain = useMemo(() => eqChain(filters, freqs, fs), [filters, freqs, fs]);
  const boost = Math.max(0, ...chain.map((r) => r.db));
  const preamp = -Math.ceil(boost * 10) / 10;
  const upd = (id: string, patch: Partial<EqFilter>) => setFilters(filters.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  const add = () => setFilters([...filters, { id: `f${Date.now().toString(36)}${filters.length}`, type: 'peaking', f: 100, gainDb: 0, q: 1, enabled: true }]);
  const allPeaking = filters.every((p) => p.type === 'peaking');
  const file = safeFileName(name);
  return (
    <div class="al-stack al-stack--16">
      <Block title="Фильтры" subtitle="Порядок не важен: характеристика — произведение фильтров">
        <Inputs>
          <TextField label="Название" value={name} onInput={setName} maxLength={80} />
          <SelectField label="Частота дискретизации" value={String(fs)} options={RATES.map((r) => ({ value: String(r), label: `${n1(r / 1000)} кГц` }))} onChange={(v) => setFs(Number(v))} />
        </Inputs>
        <ol role="list" class="al-stack al-stack--12" aria-label="Цепочка фильтров">
          {filters.map((p, i) => {
            const issues = eqIssues(p, fs);
            return (
              <li key={p.id} class="al-stack al-stack--8">
                <div class="al-row al-row--between">
                  <Switch label={`Фильтр ${i + 1}`} checked={p.enabled} onChange={(enabled) => upd(p.id, { enabled })} />
                  <IconButton icon="trash" label={`Удалить фильтр ${i + 1}`} onClick={() => setFilters(filters.filter((x) => x.id !== p.id))} />
                </div>
                <Inputs>
                  <SelectField label="Тип" value={p.type} options={EQ_TYPES.map((t) => ({ value: t, label: EQ_LABEL[t] }))} onChange={(type) => upd(p.id, { type })} />
                  <NumberField label="Частота" unit="Гц" value={p.f} min={1} max={fs / 2} decimals={1} onCommit={(f) => upd(p.id, { f })} error={issues.find((x) => x.startsWith('Частота')) ?? null} />
                  {EQ_HAS_GAIN[p.type] && <NumberField label="Усиление" unit="дБ" value={p.gainDb} min={-30} max={15} decimals={1} onCommit={(gainDb) => upd(p.id, { gainDb })} />}
                  <NumberField label="Добротность Q" value={p.q} min={0.1} max={30} decimals={2} onCommit={(q) => upd(p.id, { q })} />
                </Inputs>
                {issues.filter((x) => !x.startsWith('Частота')).map((x) => <Notice key={x} tone="danger">{x}</Notice>)}
              </li>
            );
          })}
        </ol>
        <div class="al-row"><Button small icon="plus" onClick={add} disabled={filters.length >= MAX_FILTERS}>Добавить фильтр</Button></div>
      </Block>
      <Block title="Суммарная АЧХ эквалайзера">
        <FrequencyChart title="Суммарная АЧХ эквалайзера" fMin={freqs[0]} fMax={freqs[freqs.length - 1]} series={[{ id: 'eq', label: 'Расчёт', kind: 'calculated', x: freqs, y: chain.map((r) => r.db) }]} />
      </Block>
      <Block title="Фаза эквалайзера">
        <FrequencyChart title="Фаза эквалайзера" yUnit="°" yRange={[-180, 180]} fMin={freqs[0]} fMax={freqs[freqs.length - 1]} series={[{ id: 'ph', label: 'Расчёт', kind: 'calculated', x: freqs, y: chain.map((r) => r.phaseDeg) }]} />
      </Block>
      <Block title="Экспорт и библиотека">
        <KeyValue items={[['Наибольший подъём', `${n1(boost)} дБ`], ['Предусилитель против перегрузки', `${n1(preamp)} дБ`]]} />
        <div class="al-row">
          <Button small icon="download" onClick={() => downloadText(`${file}_EqualizerAPO.txt`, exportApo(filters, preamp), 'text/plain')}>Equalizer APO</Button>
          <Button small icon="download" onClick={() => downloadText(`${file}_biquads_${fs}.txt`, exportBiquads(filters, fs), 'text/plain')}>Коэффициенты биквадов</Button>
          {allPeaking && <Button small icon="download" onClick={() => downloadText(`${file}_REW.txt`, exportREW(filters.filter((p) => p.enabled)), 'text/plain')}>REW</Button>}
        </div>
        {!allPeaking && <p class="al-text-secondary">Файл REW — только для пиковых фильтров.</p>}
        <div class="al-row al-row--bottom">
          <Button small icon="download" onClick={() => {
            const rec: EqPreset = { id: clock.newId(), name: name.trim() || 'Эквалайзер', kind: 'eq', filters, fs, createdAt: clock.now() };
            void putEntry(db, 'presets', rec).then(() => { toast.show('Сохранено в «Мои данные» → «Пресеты DSP»'); void reload(); }, () => toast.show('Не удалось сохранить', { tone: 'error' }));
          }}>Сохранить пресет</Button>
          {presets.length > 0 && [
            <SelectField key="s" label="Пресет из библиотеки" value={pick} options={[{ value: '', label: 'Выберите' }, ...presets.map((p) => ({ value: p.id, label: p.name }))]} onChange={setPick} />,
            <Button key="b" small disabled={!pick} onClick={() => { const p = presets.find((x) => x.id === pick); if (p) { setFilters(p.filters); setFs(p.fs); setName(p.name); } }}>Загрузить</Button>,
          ]}
        </div>
      </Block>
    </div>
  );
}

export function CrossoverTool() {
  const [family, setFamily] = useState<CrossoverFamily>('linkwitz-riley');
  const [order, setOrder] = useState(4);
  const [fc, setFc] = useState(80);
  const [invert, setInvert] = useState(false);
  const orders = CROSSOVER_ORDERS[family];
  const ord = orders.includes(order) ? order : orders[orders.length - 1];
  const freqs = useMemo(() => logFreqs(fc / 10, Math.min(20000, fc * 10), 48), [fc]);
  const resp = crossoverResponse(family, ord, fc, freqs, invert);
  const flatness = (inv: boolean) => Math.max(...crossoverResponse(family, ord, fc, freqs, inv).map((r) => Math.abs(r.sum)));
  const better = flatness(true) < flatness(false) - 0.1;
  const [atFc] = crossoverResponse(family, ord, fc, [fc], invert);
  const series: Series[] = [
    { id: 'lp', label: 'Низкие частоты', kind: 'calculated', x: freqs, y: resp.map((r) => r.lp) },
    { id: 'hp', label: 'Высокие частоты', kind: 'calculated', variant: 2, x: freqs, y: resp.map((r) => r.hp) },
    { id: 'sum', label: 'Сумма', kind: 'calculated', variant: 3, x: freqs, y: resp.map((r) => r.sum) },
  ];
  return (
    <div class="al-stack al-stack--16">
      <Block title="Кроссовер" subtitle="Полосы с общей точкой: идеальные фильтры без задержки между излучателями">
        <SegmentedControl label="Семейство" value={family} onChange={setFamily} options={[{ value: 'linkwitz-riley', label: 'Linkwitz–Riley' }, { value: 'butterworth', label: 'Butterworth' }]} />
        <Inputs>
          <SelectField label="Порядок" value={String(ord)} options={orders.map((o) => ({ value: String(o), label: `${o}-й (${o * 6} дБ/окт)` }))} onChange={(v) => setOrder(Number(v))} />
          <NumberField label="Частота раздела" unit="Гц" value={fc} min={20} max={10000} decimals={0} onCommit={setFc} />
        </Inputs>
        <Switch label="Высокочастотная полоса в противофазе" checked={invert} onChange={setInvert} />
      </Block>
      <Block title="Полосы и сумма кроссовера">
        <FrequencyChart title="Полосы и сумма кроссовера" fMin={freqs[0]} fMax={freqs[freqs.length - 1]} yRange={[-40, 9]} series={series} />
      </Block>
      <Block title="Результат">
        <KeyValue items={[
          ['Уровень полос на частоте раздела', `${n1(atFc.lp)} дБ`],
          ['Сумма на частоте раздела', atFc.sum < -60 ? 'полное гашение' : `${n1(atFc.sum)} дБ`],
          ['Наибольшее отклонение суммы', `${n1(flatness(invert))} дБ`],
        ]} />
        <Notice tone={better !== invert ? 'warning' : 'success'} title={better ? 'Нужна противофаза высокой полосы' : 'Противофаза не нужна'}>
          {better ? 'У этого кроссовера полосы на частоте раздела сдвинуты на 180°: без инверсии сумма проваливается.' : 'Сумма ровнее без инверсии полярности высокой полосы.'}
        </Notice>
      </Block>
      <div class="al-row"><SaveResult tool="crossover" name={`Кроссовер ${family === 'linkwitz-riley' ? 'LR' : 'BW'}${ord}, ${hz(fc)}`} data={() => ({ input: { family, order: ord, fc, invertHigh: invert }, result: { atFc, maxDeviationDb: flatness(invert) } })} /></div>
    </div>
  );
}

export function PhaseDelayTool() {
  const [gain, setGain] = useState(0);
  const [ms, setMs] = useState(2);
  const [invert, setInvert] = useState(false);
  const t = 20;
  const freqs = useMemo(() => logFreqs(10, 2000, 48), []);
  const sum = twoSourceSum(freqs, gain, ms, invert);
  const g = 10 ** (gain / 20);
  const first = ms > 0 ? (invert ? 1000 / ms : 500 / ms) : null;
  const depth = Math.abs(1 - g) < 1e-6 ? null : 20 * Math.log10(Math.abs(1 - g));
  return (
    <div class="al-stack al-stack--16">
      <Block title="Два источника" subtitle="Второй источник относительно первого: уровень, задержка, полярность">
        <Inputs>
          <NumberField label="Уровень второго" unit="дБ" value={gain} min={-40} max={20} decimals={1} onCommit={setGain} />
          <NumberField label="Задержка второго" unit="мс" value={ms} min={0} max={100} decimals={3} onCommit={setMs} />
          <NumberField label="Или разность расстояний" unit="м" value={(ms / 1000) * speedOfSound(t)} min={0} max={30} decimals={3} onCommit={(d) => setMs(delayMs(d, t))} />
        </Inputs>
        <Switch label="Второй источник в противофазе" checked={invert} onChange={setInvert} />
        <div class="al-row"><FromRoom what="Разность расстояний колонки и сабвуфера" onTake={(c) => {
          const l = c.listening.listeners.find((x) => x.primary) ?? c.listening.listeners[0];
          const sp = c.audio.sources.find((s) => s.kind === 'speaker'), sub = c.audio.sources.find((s) => s.kind === 'sub');
          if (!l || !sp || !sub) return;
          const dist = (p: { x: number; y: number; z: number }) => Math.hypot(p.x - l.position.x, p.y - l.position.y, p.z - l.position.z);
          setMs(Math.abs(delayMs(dist(sub.position) - dist(sp.position), c.simulation.temperatureC)));
        }} /></div>
      </Block>
      <Block title="Уровень суммы относительно первого источника">
        <FrequencyChart title="Уровень суммы относительно первого источника" fMin={10} fMax={2000} yRange={[-40, 12]} series={[{ id: 'sum', label: 'Расчёт', kind: 'calculated', x: freqs, y: sum.map((r) => r.db) }]} />
      </Block>
      <Block title="Результат">
        <KeyValue items={[
          ['Первый провал', first === null ? (invert ? 'на всех частотах' : 'нет') : hz(first)],
          ['Глубина провалов', depth === null ? 'полное гашение' : `${n1(depth)} дБ`],
          ['Подъём на совпадении', `${n1(20 * Math.log10(1 + g))} дБ`],
        ]} />
        <p class="al-text-secondary">{invert ? 'В противофазе источники гасят друг друга на низких частотах, где задержка мала по сравнению с периодом.' : 'Провалы повторяются через каждые 1/задержку Гц: задержкой или полярностью их можно сдвинуть выше рабочей полосы сабвуфера.'}</p>
      </Block>
      <div class="al-row"><SaveResult tool="phase-delay" name={`Два источника: ${n2(ms)} мс${invert ? ', противофаза' : ''}`} data={() => ({ input: { gainDb: gain, ms, invert }, result: { firstNotchHz: first, depthDb: depth } })} /></div>
    </div>
  );
}

export function StereoTriangleTool() {
  const [base, setBase] = useState(2);
  const [dist, setDist] = useState(1.8);
  const [target, setTarget] = useState(60);
  const tri = stereoTriangle(base, dist);
  return (
    <div class="al-stack al-stack--16">
      <Block title="Колонки и слушатель">
        <Inputs>
          <NumberField label="Расстояние между колонками" unit="м" value={base} min={0.3} max={10} onCommit={setBase} />
          <NumberField label="От линии колонок до слушателя" unit="м" value={dist} min={0.3} max={15} onCommit={setDist} />
          <NumberField label="Желаемый угол" unit="°" value={target} min={20} max={120} decimals={0} onCommit={setTarget} hint="Обычно 60°" />
        </Inputs>
        <div class="al-row"><FromRoom what="Расстановка" onTake={(c) => {
          const L = c.audio.sources.find((s) => s.channel === 'L'), R = c.audio.sources.find((s) => s.channel === 'R');
          const l = c.listening.listeners.find((x) => x.primary) ?? c.listening.listeners[0];
          if (!L || !R || !l) return;
          setBase(Math.hypot(L.position.x - R.position.x, L.position.y - R.position.y));
          setDist(Math.hypot(l.position.x - (L.position.x + R.position.x) / 2, l.position.y - (L.position.y + R.position.y) / 2));
        }} /></div>
      </Block>
      <div class="al-grid al-grid--metrics" role="list" aria-label="Результат">
        <div role="listitem"><MetricCard label="Угол между колонками" value={n0(tri.angleDeg)} unit="°" tone={Math.abs(tri.angleDeg - target) > 10 ? 'warning' : 'neutral'} /></div>
        <div role="listitem"><MetricCard label="Разворот колонок" value={n0(tri.toeInDeg)} unit="°" note="Каждая колонка — на слушателя" /></div>
        <div role="listitem"><MetricCard label="До каждой колонки" value={n2(tri.toSpeaker)} unit="м" /></div>
        <div role="listitem"><MetricCard label={`Слушатель для ${n0(target)}°`} value={n2(distanceForAngle(base, target))} unit="м" note="От линии колонок" /></div>
        <div role="listitem"><MetricCard label={`База для ${n0(target)}°`} value={n2(2 * dist * Math.tan((target * Math.PI) / 360))} unit="м" /></div>
      </div>
      <div class="al-row"><SaveResult tool="stereo-triangle" name={`Стереотреугольник: ${meters(base)}, ${n0(tri.angleDeg)}°`} data={() => ({ input: { base, distance: dist, targetDeg: target }, result: tri })} /></div>
    </div>
  );
}

const CREST = [{ value: '12', label: 'Сжатая поп-музыка, 12 дБ' }, { value: '18', label: 'Обычная музыка, 18 дБ' }, { value: '20', label: 'Кино и классика, 20 дБ' }];

export function SplHeadroomTool() {
  const [sens, setSens] = useState(87);
  const [power, setPower] = useState(100);
  const [dist, setDist] = useState(2.5);
  const [speakers, setSpeakers] = useState(2);
  const [crest, setCrest] = useState(18);
  const [target, setTarget] = useState(75);
  const [limit, setLimit] = useState<number>(NaN);
  const b = splBudget({ sensitivity: sens, powerW: power, distance: dist, speakers, crestDb: crest, targetDb: target, limitAt1m: Number.isFinite(limit) ? limit : null });
  return (
    <div class="al-stack al-stack--16">
      <Block title="Система и цель">
        <Inputs>
          <NumberField label="Чувствительность" unit="дБ (1 Вт, 1 м)" value={sens} min={70} max={115} decimals={1} onCommit={setSens} />
          <NumberField label="Мощность на канал" unit="Вт" value={power} min={0.1} max={5000} decimals={1} onCommit={setPower} />
          <NumberField label="Предел активной колонки" unit="дБ на 1 м" value={Number.isFinite(limit) ? limit : null} optional min={70} max={140} decimals={1} onCommit={setLimit} hint="Из паспорта или измерения; пусто — нет" />
          <NumberField label="Расстояние до слушателя" unit="м" value={dist} min={0.3} max={50} onCommit={setDist} />
          <NumberField label="Колонок одновременно" value={speakers} min={1} max={16} decimals={0} onCommit={(v) => setSpeakers(Math.round(v))} />
          <NumberField label="Средний уровень у слушателя" unit="дБ SPL" value={target} min={50} max={110} decimals={0} onCommit={setTarget} />
          <SelectField label="Пик-фактор программы" value={String(crest)} options={CREST} onChange={(v) => setCrest(Number(v))} />
        </Inputs>
        <div class="al-row"><FromRoom what="Расстояние до слушателя" onTake={(c) => {
          const l = c.listening.listeners.find((x) => x.primary) ?? c.listening.listeners[0];
          const s = c.audio.sources.filter((x) => x.kind === 'speaker');
          if (!l || !s.length) return;
          setDist(Math.hypot(s[0].position.x - l.position.x, s[0].position.y - l.position.y, s[0].position.z - l.position.z));
          setSpeakers(s.length);
        }} /></div>
      </Block>
      <div class="al-grid al-grid--metrics" role="list" aria-label="Результат">
        <div role="listitem"><MetricCard label="Пик у слушателя (оценка)" value={n0(b.peak)} unit="дБ SPL" kind={{ tone: 'estimated', label: 'Оценка' }} /></div>
        <div role="listitem"><MetricCard label="Нужно для пиков" value={n0(b.needed)} unit="дБ SPL" note={`${n0(target)} + ${n0(crest)} дБ`} /></div>
        <div role="listitem"><MetricCard label="Запас" value={n1(b.headroom)} unit="дБ" tone={b.headroom < 0 ? 'danger' : b.headroom < 3 ? 'warning' : 'good'} /></div>
      </div>
      <Block title="Из чего складывается">
        <KeyValue items={[
          ['По мощности и чувствительности на 1 м', `${n1(b.byPower)} дБ`],
          ...(Number.isFinite(limit) ? [['С учётом предела колонки на 1 м', `${n1(b.at1m)} дБ`] as [string, string]] : []),
          ['Ослабление до слушателя', `−${n1(b.lossDb)} дБ`],
          ['Сложение колонок', `+${n1(b.sumDb)} дБ`],
        ]} />
      </Block>
      <Notice tone="warning" title="Это оценка, а не гарантированный максимум">
        Мощность усилителя сама по себе не определяет максимальный уровень: его снижают тепловая компрессия, предельный ход диффузора, ограничители и перегрузка усилителя. Комната на низких частотах добавляет уровень, на высоких — нет; это здесь не учтено. Надёжный предел — заявленный изготовителем максимальный уровень или измерение.
      </Notice>
      <div class="al-row"><SaveResult tool="spl-headroom" name={`Запас SPL: ${n1(b.headroom)} дБ`} data={() => ({ input: { sens, power, dist, speakers, crest, target, limit: Number.isFinite(limit) ? limit : null }, result: b })} /></div>
    </div>
  );
}

const ANGLES = [15, 30, 45, 60] as const;
const BW_FREQS = [500, 1000, 2000, 4000, 8000, 16000];

export function DirectivityTool() {
  const [diam, setDiam] = useState(0.13);
  const radius = diam / 2;
  const freqs = useMemo(() => logFreqs(100, 20000, 24), []);
  const series: Series[] = ANGLES.map((a, i) => ({
    id: String(a), label: `${a}° от оси`, kind: 'calculated', variant: i ? ((i + 1) as 2 | 3 | 4) : undefined, x: freqs, y: freqs.map((f) => pistonDb(f, radius, a)),
  }));
  const rows = BW_FREQS.map((f) => ({ f, bw: beamwidth6(f, radius) }));
  const cols: Column<(typeof rows)[number]>[] = [
    { key: 'f', title: 'Частота', numeric: true, render: (r) => freq(r.f) },
    { key: 'bw', title: 'Ширина диаграммы по −6 дБ', numeric: true, render: (r) => (r.bw === null ? 'шире 180°' : `${n0(2 * r.bw)}°`) },
  ];
  const ka1 = speedOfSound(20) / (2 * Math.PI * radius);
  return (
    <div class="al-stack al-stack--16">
      <Block title="Излучатель" subtitle="Плоский поршень в бесконечном экране">
        <Inputs><NumberField label="Эффективный диаметр излучателя" unit="см" value={diam * 100} min={1} max={60} decimals={1} onCommit={(v) => setDiam(v / 100)} hint="Диффузор без подвеса: у динамика 16 см ≈ 13 см" /></Inputs>
      </Block>
      <Block title="Ослабление вне оси">
        <FrequencyChart title="Ослабление вне оси" fMin={100} fMax={20000} yRange={[-30, 3]} series={series} />
      </Block>
      <Block title="Ширина диаграммы направленности">
        <DataTable caption="Ширина диаграммы направленности" columns={cols} rows={rows} rowKey={(r) => String(r.f)} />
      </Block>
      <Block title="Пояснение">
        <p class="al-text-secondary">{`Излучатель начинает сужать диаграмму примерно с ${freq(ka1)} (длина волны сравнима с окружностью диффузора). Модель не учитывает корпус, рупор, фазовые пробки и разделение полос — у реальной колонки ниже этой частоты корпус делает излучение шире, а над разделом полос диаграмма определяется следующим излучателем.`}</p>
        <KeyValue items={[['Радиус', cm(radius)], ['Начало сужения', freq(ka1)]]} />
      </Block>
      <div class="al-row"><SaveResult tool="directivity" name={`Направленность: ${cm(diam)}`} data={() => ({ input: { diameter: diam }, result: rows })} /></div>
    </div>
  );
}
