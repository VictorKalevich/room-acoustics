// Разделы размещения (V2-032): колонки — геометрия стереопары, расстояния, направление, SBIR; сабвуферы — места,
// настройки, разброс между слушателями, карта места; места прослушивания — точки оценки, карта качества баса с
// устойчивостью к смещению головы и сценарий «Место для записи» (ядро voice.ts, 013/016). Карты — по запросу.
import { useMemo, useState } from 'preact/hooks';
import {
  Badge, DataTable, EmptyState, HeatLegend, KeyValue, Notice, PlanHeat, SegmentedControl, SelectField, Switch, buttonClass, type HeatGrid,
} from '../../design-system';
import { robustnessMap, type Heatmap } from '../../../core/field';
import { evalPpo } from '../../../core/precision';
import { MOUTH_Z, VOICE_DEFAULTS, facingName, type MicPattern, type Posture, type VoiceGoal, type VoiceMap, type VoiceSettings } from '../../../core/voice';
import { setupKey } from '../../adapters/calculations';
import { toCore, type CoreInputs } from '../../adapters/core';
import { SURFACE_LABEL } from '../../application/editing';
import { sbirNotches, speakerGeometry, stereoPair, surfaceDistances } from '../../application/analysis';
import { hashInputs } from '../../domain/provenance';
import type { RoomConfiguration } from '../../domain/model';
import { useApp } from '../../shared/context';
import { roomHref } from '../../shared/router';
import { Block, AnalysisPlan, analysisStatus, cm, hz, metres, n0, n1, type AnalysisProps } from './common';
import { useJob } from './useJob';

function inputsOf(c: RoomConfiguration): CoreInputs | null {
  const r = toCore(c);
  return r.ok ? r.inputs : null;
}

const heatGrid = (m: { x0: number; y0: number; step: number; nx: number; ny: number; scores: ArrayLike<number>; min: number; max: number; minSpan?: number }): HeatGrid => ({
  x0: m.x0, y0: m.y0, step: m.step, nx: m.nx, ny: m.ny, values: m.scores, min: m.min, max: Math.max(m.max, m.min + (m.minSpan ?? 1)),
});

function Unavailable({ c }: { c: RoomConfiguration }) {
  const r = toCore(c);
  return r.ok ? null : <Notice tone="warning">{r.reason}</Notice>;
}

// ---------- Колонки ----------

export function SpeakersSection(p: AnalysisProps) {
  const c = p.edit.config;
  const ok = !!inputsOf(c);
  const speakers = speakerGeometry(c);
  const pair = ok ? stereoPair(c) : null;
  const notches = ok ? sbirNotches(c, c.audio.sources.filter((s) => s.kind === 'speaker')) : [];
  const roomId = p.h.room!.id;
  if (!ok) return <Unavailable c={c} />;
  if (!speakers.length) return <EmptyState icon="speaker" title="Колонок нет" text="Добавьте колонки в разделе модели «Аудиосистема»." action={<a class={buttonClass('primary')} href={roomHref(roomId, 'model', 'audio')}>Аудиосистема</a>} />;
  const angleTone = pair && Math.abs(pair.angleDeg - 60) <= 10 ? 'success' : 'neutral';
  return (
    <div class="al-stack al-stack--24">
      {pair && (
        <Block title="Стереопара" subtitle="Из основного места слушателя. 60° — начальная цель, а не обязательное значение.">
          <KeyValue items={[
            ['Стереоугол', <Badge key="a" tone={angleTone} icon={false}>{`${n0(pair.angleDeg)}°`}</Badge>],
            ['Расстояние между колонками', metres(pair.spacing)],
            ['Разница расстояний до слушателя', `${cm(pair.pathDiff)} · ${n1(pair.delayMs)} мс`],
            ['Несимметричность по боковым стенам', cm(pair.sideOffset)],
            ['Разница отступов от передней стены', cm(pair.frontOffset)],
          ]} />
        </Block>
      )}
      <Block title="Колонки" subtitle="Расстояния — от акустического центра. Направление: 0° — колонка смотрит точно на основное место.">
        <DataTable caption="Колонки: расстояния и направление" rowKey={(r) => r.id} rows={speakers} columns={[
          { key: 'name', title: 'Колонка', render: (r) => r.name },
          { key: 'listener', title: 'До слушателя', numeric: true, render: (r) => metres(r.toListener) },
          { key: 'front', title: 'До передней стены', numeric: true, render: (r) => metres(r.distances.front) },
          { key: 'side', title: 'До боковой стены', numeric: true, render: (r) => metres(Math.min(r.distances.left, r.distances.right)) },
          { key: 'floor', title: 'Высота', numeric: true, render: (r) => metres(r.distances.floor) },
          { key: 'ear', title: 'Над ушами', numeric: true, render: (r) => cm(r.heightToEar) },
          { key: 'aim', title: 'Направление', numeric: true, render: (r) => (Math.abs(r.aimErrorDeg) < 3 ? 'на слушателя' : `${r.aimErrorDeg > 0 ? 'правее' : 'левее'} на ${n0(Math.abs(r.aimErrorDeg))}°`) },
        ]} />
      </Block>
      <SbirCard notches={notches} names={new Map(c.audio.sources.map((s) => [s.id, s.name]))} />
      <p class="al-text-small al-text-secondary">Первые отражения от стен и потолка — в разделе <a href={roomHref(roomId, 'analysis', 'reflections')}>«Отражения»</a>.</p>
    </div>
  );
}

function SbirCard({ notches, names, title = 'Провалы от ближних поверхностей (SBIR)' }: { notches: ReturnType<typeof sbirNotches>; names: Map<string, string>; title?: string }) {
  return (
    <Block title={title} subtitle="Первый провал — где расстояние до поверхности равно четверти длины волны: f = c / (4·d). Глубину определяют поглощение поверхности и направленность; полный отклик с этими отражениями считает ядро.">
      <DataTable caption={title} rowKey={(r) => `${r.sourceId}-${r.surface}`} rows={notches} empty="В полосе 20–500 Гц провалов нет." columns={[
        { key: 'f', title: 'Частота', numeric: true, render: (r) => hz(r.f) },
        { key: 'src', title: 'Источник', render: (r) => names.get(r.sourceId) ?? r.sourceId },
        { key: 'surface', title: 'Поверхность', render: (r) => SURFACE_LABEL[r.surface] },
        { key: 'd', title: 'Расстояние', numeric: true, render: (r) => metres(r.distance) },
      ]} />
    </Block>
  );
}

// ---------- Сабвуферы ----------

export function SubwoofersSection(p: AnalysisProps) {
  const c = p.edit.config;
  const subs = c.audio.sources.filter((s) => s.kind === 'sub');
  const roomId = p.h.room!.id;
  const i = inputsOf(c);
  if (!i) return <Unavailable c={c} />;
  if (!subs.length) return <EmptyState icon="sub" title="Сабвуферов нет" text="Добавьте сабвуфер в разделе модели «Аудиосистема» или выберите схему 2.1, 2.2." action={<a class={buttonClass('primary')} href={roomHref(roomId, 'model', 'audio')}>Аудиосистема</a>} />;
  const ev = p.state.status === 'ready' ? p.state.value.ev : null;
  const seats = ev && ev.receivers.length > 1 ? ev.receivers.map((r, k) => ({ id: String(k), r, score: ev.perReceiver[k], w: ev.weights[k] })) : [];
  const spread = seats.length ? Math.max(...seats.map((s) => s.score)) - Math.min(...seats.map((s) => s.score)) : null;
  return (
    <div class="al-stack al-stack--24">
      <Block title="Сабвуферы" subtitle={c.audio.crossoverHz ? `Раздел с колонками — ${hz(c.audio.crossoverHz)}.` : 'Раздел с колонками не задан.'}>
        <DataTable caption="Сабвуферы: места и настройки" rowKey={(s) => s.id} rows={subs} columns={[
          { key: 'name', title: 'Сабвуфер', render: (s) => s.name },
          { key: 'pos', title: 'Место (x; y)', numeric: true, render: (s) => `${n1(s.position.x)}; ${n1(s.position.y)} м` },
          { key: 'walls', title: 'До стен: передней · боковой', numeric: true, render: (s) => { const d = surfaceDistances(c, s.position); return `${n1(d.front)} · ${n1(Math.min(d.left, d.right))} м`; } },
          { key: 'level', title: 'Уровень', numeric: true, render: (s) => `${n1(s.settings?.gainDb ?? 0)} дБ` },
          { key: 'delay', title: 'Задержка', numeric: true, render: (s) => `${n1(s.settings?.delayMs ?? 0)} мс` },
          { key: 'phase', title: 'Фаза', numeric: true, render: (s) => `${n0(s.settings?.phaseDeg ?? 0)}°` },
          { key: 'peq', title: 'Фильтры', numeric: true, render: (s) => String((s.settings?.peq?.length ?? 0) + (s.settings?.allpass?.length ?? 0)) },
        ]} />
      </Block>
      <Block title="Разброс между слушателями" subtitle="Неровность баса в каждой точке оценки (меньше — ровнее). Больше сабвуферов не всегда лучше: важны их места и настройки.">
        {p.state.status !== 'ready' ? analysisStatus(p.state) : seats.length === 0 ? <p class="al-text-small al-text-secondary">Оценка ведётся в одной точке — добавьте места или ряд мест в разделе модели «Слушатели».</p> : (
          <>
            <DataTable caption="Неровность по точкам оценки" rowKey={(s) => s.id} rows={seats} columns={[
              { key: 'n', title: 'Точка', render: (s) => `${n1(s.r.x)}; ${n1(s.r.y)} м` },
              { key: 'score', title: 'Неровность', numeric: true, render: (s) => `${n1(s.score)} дБ` },
              { key: 'w', title: 'Вес', numeric: true, render: (s) => n1(s.w) },
            ]} />
            <p class="al-text-small">Разброс: {n1(spread!)} дБ.</p>
          </>
        )}
      </Block>
      <SbirCard title="Провалы от ближних поверхностей у сабвуферов" notches={sbirNotches(c, subs).filter((n) => n.f <= 160)} names={new Map(subs.map((s) => [s.id, s.name]))} />
      <SubMap c={c} i={i} subs={subs} />
    </div>
  );
}

function SubMap({ c, i, subs }: { c: RoomConfiguration; i: CoreInputs; subs: RoomConfiguration['audio']['sources'] }) {
  const { compute } = useApp();
  const [subId, setSubId] = useState(subs[0].id);
  const sid = subs.some((s) => s.id === subId) ? subId : subs[0].id;
  const key = hashInputs({ method: 'subMap', subId: sid, input: setupKey(i) });
  const [job, start] = useJob<Heatmap>(key, (onProgress) => compute().run('subMap', { room: i.room, sources: i.sources, constraints: i.constraints, setup: i.setup, subId: sid, ppo: evalPpo(i.precision) }, { onProgress }));
  return (
    <Block title="Карта места сабвуфера" subtitle="Неровность баса в местах слушателей, если поставить сабвуфер в точку плана; остальные источники — на своих местах.">
      <div class="al-stack al-stack--16">
        {subs.length > 1 && <SelectField label="Сабвуфер" value={sid} onChange={setSubId} options={subs.map((s) => ({ value: s.id, label: s.name }))} />}
        {job.status !== 'ready' ? analysisStatus(job, start, 'Карта считается по запросу: это несколько секунд.') : <MapView c={c} map={job.value} title="Карта места сабвуфера" />}
      </div>
    </Block>
  );
}

function MapView({ c, map, title, robust = false }: { c: RoomConfiguration; map: Heatmap; title: string; robust?: boolean }) {
  const shown = useMemo(() => (robust ? robustnessMap(map, 0.1) : map), [map, robust]);
  const grid = heatGrid(shown);
  return (
    <div class="al-stack al-stack--12">
      <AnalysisPlan config={c} title={title} renderOverlay={(m) => <PlanHeat map={m} grid={grid} />} />
      <HeatLegend title={`Шкала: ${title.toLowerCase()}`} min={grid.min} max={grid.max} unit="дБ" />
      <KeyValue items={[['На текущем месте', `${n1(shown.current)} дБ`]]} />
      <DataTable caption={`Лучшие места: ${title.toLowerCase()}`} rowKey={(b) => `${b.pos.x}-${b.pos.y}`} rows={shown.best} columns={[
        { key: 'x', title: 'x (от передней стены)', numeric: true, render: (b) => metres(b.pos.x) },
        { key: 'y', title: 'y (от левой стены)', numeric: true, render: (b) => metres(b.pos.y) },
        { key: 's', title: 'Неровность', numeric: true, render: (b) => `${n1(b.score)} дБ` },
      ]} />
    </div>
  );
}

// ---------- Места прослушивания ----------

export function ListenersSection(p: AnalysisProps) {
  const c = p.edit.config;
  const i = inputsOf(c);
  if (!i) return <Unavailable c={c} />;
  const ev = p.state.status === 'ready' ? p.state.value.ev : null;
  return (
    <div class="al-stack al-stack--24">
      <Block title="Слушатели" subtitle={`Ряд мест вокруг основного: ${c.listening.seats.count > 1 ? `${c.listening.seats.count} через ${cm(c.listening.seats.spacing)}` : 'нет'}.`}>
        <DataTable caption="Слушатели" rowKey={(l) => l.id} rows={c.listening.listeners} columns={[
          { key: 'name', title: 'Место', render: (l) => `${l.name}${l.primary ? ' · основное' : ''}` },
          { key: 'pos', title: 'x; y', numeric: true, render: (l) => `${n1(l.position.x)}; ${n1(l.position.y)} м` },
          { key: 'z', title: 'Высота ушей', numeric: true, render: (l) => metres(l.position.z) },
          { key: 'w', title: 'Вес', numeric: true, render: (l) => n1(l.weight) },
        ]} />
        {ev && <p class="al-text-small">Неровность баса: {n1(ev.score)} дБ{ev.receivers.length > 1 ? ` (взвешенно по ${ev.receivers.length} точкам)` : ''}.</p>}
      </Block>
      <ListenerMap c={c} i={i} />
      <VoiceSpot p={p} i={i} />
    </div>
  );
}

function ListenerMap({ c, i }: { c: RoomConfiguration; i: CoreInputs }) {
  const { compute } = useApp();
  const [robust, setRobust] = useState(false);
  const key = hashInputs({ method: 'listenerMap', input: setupKey(i) });
  const [job, start] = useJob<Heatmap>(key, (onProgress) => compute().run('listenerMap', { room: i.room, sources: i.sources, constraints: i.constraints, setup: i.setup, ppo: evalPpo(i.precision) }, { onProgress }));
  return (
    <Block title="Карта качества баса" subtitle="Неровность баса, если перенести основное место в точку плана. Устойчивость — худшее значение в круге 10 см вокруг точки (смещение головы).">
      {job.status !== 'ready' ? analysisStatus(job, start, 'Карта считается по запросу: это несколько секунд.') : (
        <div class="al-stack al-stack--16">
          <Switch checked={robust} onChange={setRobust} label="Показать устойчивость к смещению головы" />
          <MapView c={c} map={job.value} title={robust ? 'Карта устойчивости места' : 'Карта качества баса'} robust={robust} />
        </div>
      )}
    </Block>
  );
}

const MIC: { value: MicPattern; label: string }[] = [{ value: 'cardioid', label: 'Кардиоида' }, { value: 'supercardioid', label: 'Суперкардиоида' }];
const POSTURE: { value: Posture; label: string }[] = [{ value: 'standing', label: 'Стоя' }, { value: 'sitting', label: 'Сидя' }];
const GOAL: { value: VoiceGoal; label: string }[] = [{ value: 'flatness', label: 'Ровный тембр' }, { value: 'room', label: 'Меньше комнаты' }];

function VoiceSpot({ p, i }: { p: AnalysisProps; i: CoreInputs }) {
  const { compute } = useApp();
  const v: VoiceSettings = p.edit.config.voice ?? VOICE_DEFAULTS;
  const [goal, setGoal] = useState<VoiceGoal>('flatness');
  const settings = { ...v, spot: null };
  const key = hashInputs({ method: 'voiceMap', goal, settings, room: i.room, precision: i.precision });
  const [job, start] = useJob<VoiceMap>(key, (onProgress) => compute().run('voiceMap', { room: i.room, settings, goal, precision: i.precision }, { onProgress }));
  const set = (patch: Partial<VoiceSettings>, label: string) => void p.edit.apply((c) => ({ ...c, voice: { ...(c.voice ?? VOICE_DEFAULTS), ...patch } }), label);
  return (
    <Block title="Место для записи" subtitle="Где поставить исполнителя с микрофоном, чтобы отражения комнаты меньше окрашивали голос. Учитываются направленность микрофона и голоса, ориентация исполнителя.">
      <div class="al-stack al-stack--16">
        <div class="al-row al-row--16">
          <SegmentedControl label="Микрофон" value={v.mic} options={MIC} onChange={(mic) => set({ mic }, 'Микрофон')} />
          <SegmentedControl label="Исполнитель" value={v.posture} options={POSTURE} onChange={(posture) => set({ posture, mouthZ: MOUTH_Z[posture] }, 'Поза исполнителя')} />
          <SegmentedControl label="Цель" value={goal} options={GOAL} onChange={setGoal} />
        </div>
        {job.status !== 'ready' ? analysisStatus(job, start, 'Карта места для записи считается по запросу.') : (
          <div class="al-stack al-stack--12">
            <AnalysisPlan config={p.edit.config} title="Карта места для записи" renderOverlay={(m) => <PlanHeat map={m} grid={heatGrid(job.value)} />} />
            <HeatLegend title="Шкала места для записи" min={job.value.min} max={job.value.max} unit="дБ" />
            <DataTable caption="Лучшие места для записи" rowKey={(b) => `${b.x}-${b.y}`} rows={job.value.best} columns={[
              { key: 'x', title: 'x', numeric: true, render: (b) => metres(b.x) },
              { key: 'y', title: 'y', numeric: true, render: (b) => metres(b.y) },
              { key: 'f', title: 'Лицом', render: (b) => facingName(b.facing) },
              { key: 's', title: 'Оценка', numeric: true, render: (b) => `${n1(b.score)} дБ` },
            ]} />
          </div>
        )}
        <p class="al-text-small al-text-secondary">«Ровный тембр» — разброс уровня голоса по шестым долям октавы в микрофоне, «меньше комнаты» — средний уровень отражений в микрофоне. Меньше — лучше. Расчёт и метрики — как в прежней версии.</p>
      </div>
    </Block>
  );
}
