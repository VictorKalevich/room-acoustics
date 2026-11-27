// Акустические калькуляторы (V2-038): работают без комнаты, параметры можно взять из активной комнаты, результат —
// сохранить в «Мои данные». Моды, реверберация и пористое поглощение — функции ядра.
import { useMemo, useState } from 'preact/hooks';
import { BarChart, DataTable, FrequencyChart, KeyValue, MetricCard, Notice, NumberField, SelectField, Switch, type Column } from '../../../design-system';
import { FURNISHING_LABEL, MATERIALS } from '../../../../core/materials';
import { bonelloCheck, computeModes } from '../../../../core/modes';
import { computeReverb } from '../../../../core/reverb';
import { SURFACES, type Furnishing, type Mode, type ModeKind } from '../../../../core/types';
import { toCore } from '../../../adapters/core';
import { SURFACE_LABEL } from '../../../application/editing';
import {
  DEFAULT_CALC_ROOM, calcRoomOf, combNotches, combResponse, coreRoom, delayMs, distanceOf, logFreqs, phaseOfDelay, roomGeometry, wavelength, type CalcRoom,
} from '../../../application/tools';
import { speedOfSound } from '../../../../core/physics';
import { Block, FromRoom, Inputs, SaveResult, cm, freq, hz, meters, n0, n1, n2, n3 } from './common';

const MODE_KIND: Record<ModeKind, string> = { axial: 'Осевая', tangential: 'Тангенциальная', oblique: 'Косая' };

/** Размеры и температура комнаты: общие поля калькуляторов мод, реверберации и геометрии. */
function RoomFields({ r, set, temperature = true }: { r: CalcRoom; set: (r: CalcRoom) => void; temperature?: boolean }) {
  return (
    <Inputs>
      <NumberField label="Длина (от передней стены)" unit="м" value={r.depth} min={1} max={50} onCommit={(depth) => set({ ...r, depth })} />
      <NumberField label="Ширина" unit="м" value={r.width} min={1} max={50} onCommit={(width) => set({ ...r, width })} />
      <NumberField label="Высота" unit="м" value={r.height} min={1} max={20} onCommit={(height) => set({ ...r, height })} />
      {temperature && <NumberField label="Температура воздуха" unit="°C" value={r.temperatureC} min={-30} max={50} decimals={1} onCommit={(temperatureC) => set({ ...r, temperatureC })} />}
    </Inputs>
  );
}

function RoomSource({ set, what }: { set: (r: CalcRoom) => void; what: string }) {
  return <FromRoom what={what} onTake={(c) => { const conv = toCore(c); if (conv.ok) set(calcRoomOf(conv.inputs.room)); }} />;
}

export function WavelengthTool() {
  const [f, setF] = useState(100);
  const [t, setT] = useState(20);
  const w = wavelength(f, t);
  const rows = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000].map((x) => ({ f: x, ...wavelength(x, t) }));
  const cols: Column<(typeof rows)[number]>[] = [
    { key: 'f', title: 'Частота', numeric: true, render: (r) => freq(r.f) },
    { key: 'l', title: 'Длина волны', numeric: true, render: (r) => meters(r.lambda) },
    { key: 'q', title: 'Четверть волны', numeric: true, render: (r) => cm(r.quarter) },
    { key: 'p', title: 'Период', numeric: true, render: (r) => `${n3(r.periodMs)} мс` },
  ];
  return (
    <div class="al-stack al-stack--16">
      <Block title="Параметры">
        <Inputs>
          <NumberField label="Частота" unit="Гц" value={f} min={1} max={40000} decimals={1} onCommit={setF} />
          <NumberField label="Температура воздуха" unit="°C" value={t} min={-30} max={50} decimals={1} onCommit={setT} />
        </Inputs>
        <div class="al-row"><FromRoom what="Температура" onTake={(c) => setT(c.simulation.temperatureC)} /></div>
      </Block>
      <div class="al-grid al-grid--metrics" role="list" aria-label="Результат">
        <div role="listitem"><MetricCard label="Длина волны" value={n2(w.lambda)} unit="м" /></div>
        <div role="listitem"><MetricCard label="Половина волны" value={n2(w.half)} unit="м" /></div>
        <div role="listitem"><MetricCard label="Четверть волны" value={n0(w.quarter * 100)} unit="см" note="Глубина, на которой пористый слой у стены работает в полную силу" /></div>
        <div role="listitem"><MetricCard label="Период" value={n3(w.periodMs)} unit="мс" /></div>
        <div role="listitem"><MetricCard label="Скорость звука" value={n1(w.c)} unit="м/с" /></div>
      </div>
      <Block title="Длина волны для типичных частот">
        <DataTable caption="Длина волны для типичных частот" columns={cols} rows={rows} rowKey={(r) => String(r.f)} />
      </Block>
      <div class="al-row"><SaveResult tool="wavelength" name={`Длина волны: ${freq(f)}`} data={() => ({ input: { f, temperatureC: t }, result: w })} /></div>
    </div>
  );
}

export function RoomModesTool() {
  const [r, setR] = useState<CalcRoom>(DEFAULT_CALC_ROOM);
  const [fMax, setFMax] = useState(200);
  const [all, setAll] = useState(false);
  const modes = useMemo(() => computeModes(coreRoom(r), fMax), [r, fMax]);
  const bonello = useMemo(() => bonelloCheck(modes, Math.min(fMax, 400)), [modes, fMax]);
  const shown = all ? modes : modes.filter((m) => m.kind === 'axial');
  const cols: Column<Mode>[] = [
    { key: 'f', title: 'Частота', numeric: true, render: (m) => hz(m.f) },
    { key: 'n', title: 'Порядок (длина, ширина, высота)', render: (m) => m.n.join(', ') },
    { key: 'k', title: 'Вид', render: (m) => MODE_KIND[m.kind] },
    { key: 'd', title: 'Особенность', render: (m) => [m.degenerate && 'совпадает с другой', m.clustered && 'рядом с другими'].filter(Boolean).join(', ') || '—' },
  ];
  return (
    <div class="al-stack al-stack--16">
      <Block title="Помещение" subtitle="Прямоугольная комната с жёсткими стенами">
        <RoomFields r={r} set={setR} />
        <Inputs><NumberField label="Верхняя частота" unit="Гц" value={fMax} min={40} max={500} decimals={0} onCommit={setFMax} /></Inputs>
        <div class="al-row"><RoomSource set={setR} what="Размеры" /></div>
      </Block>
      <Block title={`Моды до ${hz(fMax)}`} subtitle={`Осевых ${modes.filter((m) => m.kind === 'axial').length}, всего ${modes.length}`}>
        <Switch label={`Показать тангенциальные и косые (${modes.length})`} checked={all} onChange={setAll} />
        <DataTable caption="Моды комнаты" columns={cols} rows={shown} rowKey={(m) => m.n.join('-')} />
      </Block>
      <Block title="Распределение по третям октавы" subtitle="Критерий Бонелло: число мод не убывает с частотой, совпадающих мод нет">
        <BarChart title="Число мод в третях октавы, Гц" unit="мод" categories={bonello.bands.map((b) => n0(b.center))}
          series={[{ id: 'count', label: 'Число мод', kind: 'calculated', values: bonello.bands.map((b) => b.count) }]} />
        <Notice tone={bonello.ok ? 'success' : 'warning'} title={bonello.ok ? 'Распределение равномерное' : 'Распределение неравномерное'}>
          {bonello.ok ? 'Число мод растёт с частотой без провалов, совпадающих мод нет.' : `Нарушения в полосах: ${bonello.violations.map((v) => hz(v)).join(', ') || 'есть совпадающие моды'}.`}
        </Notice>
      </Block>
      <div class="al-row"><SaveResult tool="room-modes" name={`Моды ${n2(r.depth)} × ${n2(r.width)} × ${n2(r.height)} м`} data={() => ({ input: { ...r, fMax }, result: { modes, bonello } })} /></div>
    </div>
  );
}

export function SbirTool() {
  const [d, setD] = useState(0.5);
  const [listener, setListener] = useState(2.5);
  const [alpha, setAlpha] = useState(0.1);
  const [t, setT] = useState(20);
  const c = speedOfSound(t);
  const diff = 2 * d;
  const fs = useMemo(() => logFreqs(20, 500, 48), []);
  const curve = useMemo(() => combResponse(fs, diff, alpha, t), [fs, diff, alpha, t]);
  const notches = combNotches(diff, 500, t);
  const depth = 20 * Math.log10(Math.max(1e-6, 1 - Math.sqrt(1 - alpha)));
  return (
    <div class="al-stack al-stack--16">
      <Block title="Колонка и стена" subtitle="Отражение от стены за колонкой (или сбоку, или пола) приходит с задержкой и гасит часть частот">
        <Inputs>
          <NumberField label="Расстояние от колонки до стены" unit="м" value={d} min={0.02} max={10} onCommit={setD} />
          <NumberField label="Расстояние до слушателя" unit="м" value={listener} min={0.3} max={30} onCommit={setListener} hint="Влияет только на ослабление отражения с расстоянием, здесь не учитывается" />
          <NumberField label="Поглощение стены на низких частотах" value={alpha} min={0} max={0.99} onCommit={setAlpha} hint="0 — жёсткая стена, 1 — отражения нет" />
          <NumberField label="Температура воздуха" unit="°C" value={t} min={-30} max={50} decimals={1} onCommit={setT} />
        </Inputs>
        <div class="al-row"><FromRoom what="Расстояние до передней стены" onTake={(cfg) => {
          const s = cfg.audio.sources.find((x) => x.kind === 'speaker') ?? cfg.audio.sources[0];
          const l = cfg.listening.listeners.find((x) => x.primary) ?? cfg.listening.listeners[0];
          if (s) setD(s.position.x);
          if (s && l) setListener(Math.hypot(l.position.x - s.position.x, l.position.y - s.position.y));
          setT(cfg.simulation.temperatureC);
        }} /></div>
      </Block>
      <Block title="Сумма прямого звука и отражения">
        <FrequencyChart title="Сумма прямого звука и отражения" yUnit="дБ" fMin={20} fMax={500} yRange={[-30, 9]}
          series={[{ id: 'sbir', label: 'Расчёт', kind: 'calculated', x: fs, y: curve }]} marks={notches.slice(0, 6).map((f) => ({ f, label: `Провал ${hz(f)}` }))} />
      </Block>
      <Block title="Результат">
        <KeyValue items={[
          ['Первый провал', notches.length ? hz(notches[0]) : 'выше 500 Гц'],
          ['Глубина провала', `${n1(depth)} дБ`],
          ['Разность путей', meters(diff)],
          ['Задержка отражения', `${n2(delayMs(diff, t))} мс`],
        ]} />
        <p class="al-text-secondary">{`Провал выше 200 Гц — колонка ближе ${cm(c / 800)} к стене; ниже 40 Гц — дальше ${meters(c / 160)}. Между ними провал попадает в важный диапазон баса: помогают поглощение за колонкой или сабвуфер у стены.`}</p>
        <p class="al-text-secondary">Упрощение: одно отражение плоской волны на оси, без направленности колонки и без затухания с расстоянием — реальный провал мельче.</p>
      </Block>
      <div class="al-row"><SaveResult tool="sbir" name={`SBIR: ${cm(d)} до стены`} data={() => ({ input: { d, listener, alpha, temperatureC: t }, result: { notches, depthDb: depth } })} /></div>
    </div>
  );
}

const OCT_LABEL = ['63', '125', '250', '500', '1k', '2k', '4k'];

export function ReverbTool() {
  const [r, setR] = useState<CalcRoom>(DEFAULT_CALC_ROOM);
  const rev = useMemo(() => computeReverb(coreRoom(r)), [r]);
  const options = MATERIALS.map((m) => ({ value: m.id, label: m.name }));
  const rows = rev.bands.map((f, i) => ({ f, i }));
  const cols: Column<(typeof rows)[number]>[] = [
    { key: 'f', title: 'Октава', numeric: true, render: (x) => freq(x.f) },
    { key: 's', title: 'Сэбин', numeric: true, render: (x) => `${n2(rev.sabine[x.i])} с` },
    { key: 'e', title: 'Эйринг', numeric: true, render: (x) => `${n2(rev.eyring[x.i])} с` },
    { key: 'u', title: 'Принято', numeric: true, render: (x) => `${n2(rev.used[x.i])} с` },
    { key: 'a', title: 'Среднее α', numeric: true, render: (x) => n2(rev.meanAlpha[x.i]) },
  ];
  return (
    <div class="al-stack al-stack--16">
      <Block title="Помещение">
        <RoomFields r={r} set={setR} temperature={false} />
        <div class="al-grid al-grid--metrics">
          {SURFACES.map((s) => <SelectField key={s} label={SURFACE_LABEL[s]} value={r.materials[s]} options={options} onChange={(v) => setR({ ...r, materials: { ...r.materials, [s]: v } })} />)}
          <SelectField label="Обстановка" value={r.furnishing} options={(Object.keys(FURNISHING_LABEL) as Furnishing[]).map((k) => ({ value: k, label: FURNISHING_LABEL[k] }))} onChange={(furnishing) => setR({ ...r, furnishing })} />
        </div>
        <div class="al-row"><RoomSource set={setR} what="Размеры и отделка" /></div>
        <p class="al-text-secondary">Проёмы, обработка и покрытия здесь не учитываются: полный расчёт — в анализе комнаты.</p>
      </Block>
      <Block title="Время реверберации по октавам, Гц">
        <BarChart title="Время реверберации по октавам, Гц" unit="с" categories={OCT_LABEL} series={[{ id: 'rt', label: 'Расчёт', kind: 'calculated', values: rev.used }]} />
      </Block>
      <Block title="Результат">
        <KeyValue items={[
          ['Среднее (500 Гц – 1 кГц)', `${n2(rev.tMid)} с`],
          ['Частота Шрёдера', hz(rev.schroeder)],
          ['Объём', `${n1(rev.volume)} м³`],
          ['Площадь поверхностей', `${n1(rev.surfaceArea)} м²`],
        ]} />
        <p class="al-text-secondary">Формула Эйринга принимается, когда среднее поглощение больше 0,2; иначе — Сэбина. Ниже частоты Шрёдера звук определяется модами, а не реверберацией.</p>
      </Block>
      <Block title="Реверберация по октавам">
        <DataTable caption="Реверберация по октавам" columns={cols} rows={rows} rowKey={(x) => String(x.f)} />
      </Block>
      <div class="al-row"><SaveResult tool="reverb" name={`Реверберация ${n2(r.depth)} × ${n2(r.width)} × ${n2(r.height)} м`} data={() => ({ input: r, result: rev })} /></div>
    </div>
  );
}

const RATES = [44100, 48000, 96000] as const;

export function DistanceDelayTool() {
  const [d, setD] = useState(1);
  const [t, setT] = useState(20);
  const [f, setF] = useState(80);
  const [rate, setRate] = useState<(typeof RATES)[number]>(48000);
  const ms = delayMs(d, t);
  return (
    <div class="al-stack al-stack--16">
      <Block title="Пересчёт" subtitle="Измените расстояние или задержку — второе пересчитается">
        <Inputs>
          <NumberField label="Расстояние" unit="м" value={d} min={0} max={1000} decimals={3} onCommit={setD} />
          <NumberField label="Задержка" unit="мс" value={ms} min={0} max={3000} decimals={3} onCommit={(v) => setD(distanceOf(v, t))} />
          <NumberField label="Частота для фазы" unit="Гц" value={f} min={1} max={40000} decimals={1} onCommit={setF} />
          <NumberField label="Температура воздуха" unit="°C" value={t} min={-30} max={50} decimals={1} onCommit={setT} />
          <SelectField label="Частота дискретизации" value={String(rate)} options={RATES.map((x) => ({ value: String(x), label: `${n1(x / 1000)} кГц` }))} onChange={(v) => setRate(Number(v) as (typeof RATES)[number])} />
        </Inputs>
      </Block>
      <div class="al-grid al-grid--metrics" role="list" aria-label="Результат">
        <div role="listitem"><MetricCard label="Задержка" value={n3(ms)} unit="мс" /></div>
        <div role="listitem"><MetricCard label="Отсчётов" value={n0((ms / 1000) * rate)} note={`при ${n1(rate / 1000)} кГц`} /></div>
        <div role="listitem"><MetricCard label="Сдвиг фазы" value={n0(phaseOfDelay(f, ms))} unit="°" note={`на ${freq(f)}`} /></div>
        <div role="listitem"><MetricCard label="Противофаза" value={ms > 0 ? n1(500 / ms) : null} unit="Гц" note="Первая частота, на которой задержка даёт 180°" /></div>
      </div>
      <div class="al-row"><SaveResult tool="distance-delay" name={`Задержка: ${meters(d)}`} data={() => ({ input: { d, temperatureC: t, f, rate }, result: { ms, samples: (ms / 1000) * rate, phaseDeg: phaseOfDelay(f, ms) } })} /></div>
    </div>
  );
}

export function RoomGeometryTool() {
  const [r, setR] = useState<CalcRoom>(DEFAULT_CALC_ROOM);
  const g = roomGeometry(r.depth, r.width, r.height);
  const modes = useMemo(() => computeModes(coreRoom(r), 300), [r]);
  const bonello = useMemo(() => bonelloCheck(modes, 200), [modes]);
  const axial = (['depth', 'width', 'height'] as const).map((k, i) => ({ k, title: ['Длина', 'Ширина', 'Высота'][i], f: modes.filter((m) => m.kind === 'axial' && m.n[i] > 0).map((m) => m.f).slice(0, 4) }));
  const cols: Column<(typeof axial)[number]>[] = [
    { key: 't', title: 'Размер', render: (x) => `${x.title}, ${meters(r[x.k])}` },
    { key: 'f', title: 'Первые осевые моды', render: (x) => x.f.map((f) => hz(f)).join(', ') },
  ];
  const close = modes.filter((m) => m.kind === 'axial' && m.degenerate && m.f < 200);
  return (
    <div class="al-stack al-stack--16">
      <Block title="Размеры">
        <RoomFields r={r} set={setR} />
        <div class="al-row"><RoomSource set={setR} what="Размеры" /></div>
      </Block>
      <div class="al-grid al-grid--metrics" role="list" aria-label="Результат">
        <div role="listitem"><MetricCard label="Объём" value={n1(g.volume)} unit="м³" /></div>
        <div role="listitem"><MetricCard label="Площадь пола" value={n1(g.floor)} unit="м²" /></div>
        <div role="listitem"><MetricCard label="Площадь поверхностей" value={n1(g.surface)} unit="м²" /></div>
        <div role="listitem"><MetricCard label="Соотношение сторон" value={g.ratio.map((v) => n2(v)).join(' : ')} note="Наименьший размер принят за 1" /></div>
      </div>
      <Block title="Осевые моды по размерам">
        <DataTable caption="Осевые моды по размерам" columns={cols} rows={axial} rowKey={(x) => x.k} />
      </Block>
      <Notice tone={bonello.ok && !close.length ? 'success' : 'warning'} title={bonello.ok && !close.length ? 'Пропорции удачные' : 'Пропорции можно улучшить'}>
        {close.length ? `Совпадающие осевые моды: ${close.map((m) => hz(m.f)).join(', ')} — кратные размеры усиливают одни и те же частоты.` : bonello.ok ? 'Моды распределены равномерно (критерий Бонелло до 200 Гц).' : `Неравномерность в третях октавы: ${bonello.violations.map((v) => hz(v)).join(', ')}.`}
      </Notice>
      <div class="al-row"><SaveResult tool="room-geometry" name={`Геометрия ${n2(r.depth)} × ${n2(r.width)} × ${n2(r.height)} м`} data={() => ({ input: r, result: { ...g, bonello } })} /></div>
    </div>
  );
}
