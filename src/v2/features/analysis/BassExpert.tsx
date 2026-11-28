// Экспертный уровень раздела «Качество баса» (V2-051): карты поля на высоте ушей (уровень от источников, форма и фаза
// моды, разница конфигураций), сравнение прямоугольной и волновой моделей и параметры сетки волновой модели.
// Расчёты ядра — в воркере по запросу; на плане — двухцветная шкала без оценки «лучше/хуже».
import { useMemo, useState } from 'preact/hooks';
import { Button, DataTable, FrequencyChart, HeatLegend, KeyValue, Notice, NumberField, PlanHeat, SegmentedControl, SelectField, type HeatGrid } from '../../design-system';
import { evalPpo } from '../../../core/precision';
import type { FieldResult } from '../../../core/field3d';
import type { SetupEval } from '../../../core/system';
import { toCore, type CoreInputs } from '../../adapters/core';
import { setupKey } from '../../adapters/calculations';
import { diffMap, fieldGeometry, levelMap, modeShapeMap, symmetricRange, thirdOctave, valueAt, waveGridInfo, withModel, type FieldMap, type GridInfo } from '../../application/roomField';
import type { ModeRow } from '../../application/analysis';
import { hashInputs } from '../../domain/provenance';
import { useApp } from '../../shared/context';
import { AnalysisPlan, Block, analysisStatus, hz, metres, n0, n1, n2, type AnalysisProps } from './common';
import { useJob } from './useJob';
import type { Analysis } from './useAnalysis';

type What = 'level' | 'mode' | 'diff';

const heat = (m: FieldMap, r: number): HeatGrid => ({ x0: m.x0, y0: m.y0, step: m.sx, stepY: m.sy, nx: m.nx, ny: m.ny, values: m.values, min: -r, max: r, diverging: true });

export function BassExpert({ p, a, rows }: { p: AnalysisProps; a: Analysis; rows: ModeRow[] }) {
  const conv = toCore(p.edit.config);
  if (!conv.ok) return null;
  return (
    <>
      <FieldBlock p={p} a={a} rows={rows} i={conv.inputs} />
      <ModelBlock p={p} a={a} i={conv.inputs} />
    </>
  );
}

function FieldBlock({ p, a, rows, i }: { p: AnalysisProps; a: Analysis; rows: ModeRow[]; i: CoreInputs }) {
  const { compute } = useApp();
  const c = p.edit.config;
  const listener = c.listening.listeners.find((l) => l.primary) ?? c.listening.listeners[0];
  const wave = a.model === 'wave';
  const other = p.other ? toCore(p.other.config) : null;
  const comparable = !!other?.ok && fieldGeometry(other.inputs.room) === fieldGeometry(i.room);
  const [what, setWhat] = useState<What>('level');
  const [f, setF] = useState(Math.round(rows[0]?.f ?? 50));
  const [mode, setMode] = useState(rows[0]?.n.join(' ') ?? '');
  const [z, setZ] = useState(listener?.position.z ?? i.constraints.earHeight);
  const row = rows.find((r) => r.n.join(' ') === mode) ?? rows[0];
  const freqs = what === 'mode' && row ? [row.f] : thirdOctave(f);
  const kind = what === 'mode' ? 'shape' : 'excited';
  const field = (x: CoreInputs, onProgress?: (v: number) => void) => compute().run('field', { room: x.room, sources: x.sources, setup: x.setup, freqs, kind, modes: what === 'mode' && row ? [row.n] : undefined }, { onProgress });
  // форма моды прямоугольной модели — формула моды, без воркера
  const analytic = what === 'mode' && !wave && row;
  const key = analytic ? null : hashInputs({ method: 'field', what, input: setupKey(i), other: what === 'diff' && other?.ok ? setupKey(other.inputs) : null, freqs, mode: what === 'mode' ? row?.n : null });
  const [job, start] = useJob<FieldResult[]>(key, (onProgress) => (what === 'diff' && other?.ok
    ? Promise.all([field(i, (v) => onProgress(v / 2)), field(other.inputs, (v) => onProgress(0.5 + v / 2))])
    : field(i, onProgress).then((r) => [r])));
  const map = useMemo((): FieldMap | null => {
    if (analytic) return modeShapeMap(i.room, row.n, z);
    if (job.status !== 'ready') return null;
    const [r0, r1] = job.value;
    if (!r0.freqs.length) return null;
    return what === 'diff' && r1 ? diffMap(levelMap(r0, z), levelMap(r1, z)) : levelMap(r0, z);
  }, [analytic, job, what, z, i.room, row]);
  const range = map ? (analytic ? 1 : symmetricRange(map)) : 0;
  const unit = analytic ? '' : 'дБ';
  const at = map && listener ? valueAt(map, listener.position) : null;
  const skipped = job.status === 'ready' ? job.value[0].skipped : [];
  const title = what === 'level' ? `Уровень на ${hz(f)} (1/3 октавы)` : what === 'mode' ? `Мода ${row ? `${row.n.join(' ')}, ${hz(row.f)}` : ''}` : `Разница ${p.label.toLowerCase()} − ${p.other?.label.toLowerCase() ?? ''} на ${hz(f)}`;
  const legend = what === 'mode' && analytic ? { low: 'противофаза', high: 'синфазно с углом' } : what === 'diff' ? { low: `тише в ${p.label === 'Эксперимент' ? 'эксперименте' : 'текущей'}`, high: `громче в ${p.label === 'Эксперимент' ? 'эксперименте' : 'текущей'}` } : { low: 'тише среднего', high: 'громче среднего' };
  return (
    <Block title="Поле на высоте ушей" subtitle="Срез поля в комнате, а не отклик в одной точке. Уровень — относительно среднего по комнате на этих частотах; общая громкость не показывается.">
      <SegmentedControl label="Что показать" value={what} onChange={setWhat} options={[
        { value: 'level', label: 'Уровень от источников' }, { value: 'mode', label: 'Форма моды' },
        { value: 'diff', label: 'Разница конфигураций', disabled: !comparable },
      ]} />
      {!comparable && <p class="al-text-small al-text-secondary">{p.other ? 'Разница строится, когда у конфигураций одна геометрия и модель: сравниваются одни и те же точки.' : 'Разница появится, когда будет эксперимент с той же геометрией.'}</p>}
      <div class="al-grid al-grid--metrics">
        {what === 'mode'
          ? <SelectField label="Мода" value={mode} onChange={setMode} options={rows.slice(0, 40).map((r) => ({ value: r.n.join(' '), label: `${r.n.join(' ')} — ${hz(r.f)}` }))} />
          : <NumberField label="Частота" unit="Гц" value={f} min={15} max={300} decimals={0} onCommit={setF} />}
        <NumberField label="Высота среза" unit="м" value={z} min={0.05} max={Math.max(0.1, i.room.height - 0.05)} decimals={2} onCommit={setZ} />
      </div>
      {!analytic && job.status !== 'ready' && analysisStatus(job, start, wave ? 'Волновая модель: расчёт поля — от десятков секунд, по запросу.' : 'Расчёт поля по запросу: несколько секунд.')}
      {map === null && job.status === 'ready' && (
        <Notice tone="warning">{skipped.length ? `Частоты выше предела волновой модели (${skipped.map(hz).join(', ')}) не считаются: выберите частоту ниже.` : 'Сетки конфигураций не совпадают — разницу построить нельзя.'}</Notice>
      )}
      {map && (
        <div class="al-stack al-stack--12">
          <AnalysisPlan config={c} title={title} renderOverlay={(m) => <PlanHeat map={m} grid={heat(map, range)} />} />
          <HeatLegend title={`Шкала: ${title.toLowerCase()}`} min={-range} max={range} unit={unit} diverging={legend} />
          <KeyValue items={[
            ['Модель', analytic ? 'форма моды прямоугольной комнаты' : wave ? 'волновая (FDTD)' : 'моды прямоугольной комнаты'],
            ['Шаг сетки', `${metres(map.sx)} × ${metres(map.sy)}`],
            ['У основного слушателя', at === null ? '—' : analytic ? n2(at) : `${at > 0 ? '+' : ''}${n1(at)} дБ`],
          ]} />
          <p class="al-text-small al-text-secondary">{analytic
            ? 'Знак — фаза стоячей волны: соседние области колеблются в противофазе, между ними узловая линия (давление моды ноль). Источник в узле моду не возбуждает, слушатель в узле её не слышит.'
            : what === 'mode'
              ? 'Волновая модель: поле на частоте моды при возбуждении из угла (форма системной моды с учётом проёмов и смежных зон); знак фазы не показывается.'
              : 'Уровень усреднён по третьоктавной полосе. Шаг расчёта не равен физическому разрешению: детали мельче четверти длины волны не значимы.'}</p>
        </div>
      )}
    </Block>
  );
}

function ModelBlock({ p, a, i }: { p: AnalysisProps; a: Analysis; i: CoreInputs }) {
  const { compute } = useApp();
  const ppo = evalPpo(i.precision);
  const ev = (x: CoreInputs) => compute().run('evaluate', { room: x.room, sources: x.sources, constraints: x.constraints, setup: x.setup, ppo });
  const key = hashInputs({ method: 'models-compare', input: setupKey(i) });
  const [job, start] = useJob<{ modal: SetupEval; wave: SetupEval; ms: [number, number] }>(key, async (onProgress) => {
    const t0 = performance.now();
    const modal = await ev(withModel(i, 'modal'));
    onProgress(0.2);
    const t1 = performance.now();
    const wave = await ev(withModel(i, 'wave'));
    return { modal, wave, ms: [t1 - t0, performance.now() - t1] };
  });
  const [grid, setGrid] = useState<GridInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const nonRect = !!i.room.slope || (i.room.extensions ?? []).length > 0;
  const showGrid = () => { setBusy(true); setTimeout(() => { try { setGrid(waveGridInfo(withModel(i, 'wave').room, a.ev.fHi)); } finally { setBusy(false); } }, 0); };
  const r = job.status === 'ready' ? job.value : null;
  const rms = r ? Math.sqrt(r.modal.response.db.reduce((s, v, k) => s + (v - r.wave.response.db[k]) ** 2, 0) / r.modal.response.db.length) : 0;
  return (
    <Block title="Модели расчёта баса" subtitle={`Сейчас используется: ${a.model === 'wave' ? 'волновая модель (FDTD)' : 'моды прямоугольной комнаты'}${p.edit.config.simulation.model === 'auto' ? ' — выбрана автоматически' : ' — выбрана вручную в модели комнаты'}. Сравнение показывает, насколько вывод зависит от модели.`}>
      {nonRect && <p class="al-text-small al-text-secondary">У комнаты скос потолка или смежные зоны: прямоугольная модель их не видит и считает оболочку прямоугольной.</p>}
      {job.status !== 'ready' ? analysisStatus(job, start, 'Обе модели по запросу; волновая — от секунд до минуты.') : r && (
        <>
          <FrequencyChart title="АЧХ в месте слушателя: прямоугольная и волновая модели" fMin={Math.max(15, r.modal.fLo)} fMax={r.modal.fHi} series={[
            { id: 'm', label: 'Прямоугольная', kind: 'calculated', x: r.modal.response.f, y: r.modal.response.db },
            { id: 'w', label: 'Волновая', kind: 'calculated', variant: 2, x: r.wave.response.f, y: r.wave.response.db },
            { id: 't', label: 'Цель', kind: 'target', x: r.modal.response.f, y: r.modal.response.target },
          ]} />
          <DataTable caption="Модели расчёта баса" rowKey={(x) => x.id} rows={[{ id: 'modal', name: 'Прямоугольная (моды)', e: r.modal, ms: r.ms[0] }, { id: 'wave', name: 'Волновая (FDTD)', e: r.wave, ms: r.ms[1] }]} columns={[
            { key: 'n', title: 'Модель', render: (x) => x.name },
            { key: 's', title: 'Неровность', numeric: true, render: (x) => `${n1(x.e.score)} дБ` },
            { key: 'b', title: 'Полоса', numeric: true, render: (x) => `${hz(x.e.fLo)}–${hz(x.e.fHi)}` },
            { key: 't', title: 'Время расчёта', numeric: true, render: (x) => `${n0(x.ms)} мс` },
          ]} />
          <KeyValue items={[['Расхождение моделей (СКО)', `${n1(rms)} дБ`]]} />
          <p class="al-text-small al-text-secondary">{rms > 3 ? 'Модели заметно расходятся: выводы о конкретных частотах ненадёжны, проверьте замером.' : 'Модели согласуются: вывод мало зависит от выбора модели.'} Время расчёта — с учётом кэша ядра: повторный расчёт быстрее.</p>
        </>
      )}
      <div class="al-stack al-stack--8">
        {!grid ? <div class="al-row"><Button small variant="ghost" disabled={busy} onClick={showGrid}>{busy ? 'Строится сетка…' : 'Параметры сетки волновой модели'}</Button></div> : (
          <>
            <KeyValue items={[
              ['Верхняя частота сетки', hz(grid.fMax)], ['Шаг сетки', metres(grid.h)], ['Узлов на длину волны на верхней частоте оценки', n1(grid.perWave)],
              ['Ячеек', grid.cells.join(' × ')], ['Узлов воздуха', n0(grid.nodes)], ['Шаг по времени', `${n2(grid.dt * 1e6)} мкс`],
              ['Число Куранта', grid.courant.toFixed(3).replace('.', ',')], ['Длительность расчёта', `${n1(grid.duration)} с, ${n0(grid.steps)} шагов`],
            ]} />
            <p class="al-text-small al-text-secondary">Схема FDTD ядра (fdtd.ts): число Куранта чуть меньше 1/√3 — условие устойчивости; не меньше 10 узлов на длину волны на верхней частоте сетки. Длительность — по оценке самого долгого затухания осевых мод.</p>
          </>
        )}
      </div>
    </Block>
  );
}
