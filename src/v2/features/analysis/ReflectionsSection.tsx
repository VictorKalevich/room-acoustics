// Раздел «Отражения» (V2-033): первые отражения методом мнимых источников (ядро treatment.ts) — пути на плане и
// события во времени связаны выбором; задержка, путь, угол падения, оценка уровня, обработана ли точка.
// Продвинутый уровень (V2-048): мнимые источники до 3-го порядка от всех шести поверхностей с направленностью.
import { useMemo, useState } from 'preact/hooks';
import { Badge, Button, DataTable, EventChart, KeyValue, Notice, PlanPath, SelectField, type TimeEvent } from '../../design-system';
import { toCore } from '../../adapters/core';
import { SURFACE_LABEL } from '../../application/editing';
import { reflectionPaths, type ReflectionPath } from '../../application/analysis';
import { imageSources, type ImageArrival } from '../../application/models';
import { visibleAt } from '../../domain/complexity';
import type { RoomConfiguration } from '../../domain/model';
import { roomHref } from '../../shared/router';
import { Block, AnalysisPlan, Limits, metres, n0, n1, type AnalysisProps } from './common';

const ON: Record<NonNullable<ReflectionPath['on']>, string> = { window: 'окно', door: 'дверь', opening: 'проём' };
const pid = (r: ReflectionPath) => `${r.sourceId}-${r.surface}`;

export function ReflectionsSection(p: AnalysisProps) {
  const c = p.edit.config;
  const conv = toCore(c);
  const paths = useMemo(() => (conv.ok ? reflectionPaths(c) : []), [c, conv.ok]);
  const [sel, setSel] = useState<string | null>(null);
  if (!conv.ok) return <Notice tone="warning">{conv.reason}</Notice>;
  const names = new Map(c.audio.sources.map((s) => [s.id, s.name]));
  const listener = (c.listening.listeners.find((l) => l.primary) ?? c.listening.listeners[0]).position;
  if (!paths.length) return <Notice>Нет колонок — отражений для расчёта нет. Сабвуферы здесь не учитываются: на низких частотах отражения — часть мод.</Notice>;
  const events: TimeEvent[] = [
    { id: 'direct', t: 0, db: 0, label: 'Прямой звук', direct: true },
    ...paths.map((r) => ({ id: pid(r), t: r.delayMs, db: r.levelDb, label: `${names.get(r.sourceId)}: ${SURFACE_LABEL[r.surface].toLowerCase()}` })),
  ];
  const lateral = paths.filter((r) => r.surface !== 'front');
  const itdg = Math.min(...lateral.map((r) => r.delayMs));
  const strong = lateral.filter((r) => !r.treated && r.levelDb > -10);
  const selected = paths.find((r) => pid(r) === sel) ?? null;
  return (
    <div class="al-stack al-stack--24">
      <Block title="Первые отражения на плане" subtitle="Путь колонка → точка отражения → основное место. Выберите путь в таблице или событие на графике — они связаны.">
        <AnalysisPlan config={c} title="Первые отражения" renderOverlay={(m) => paths.filter((r) => r.surface !== 'ceiling').map((r) => (
          <PlanPath key={pid(r)} map={m} points={[c.audio.sources.find((s) => s.id === r.sourceId)!.position, r.point, listener]} selected={pid(r) === sel} label={`${names.get(r.sourceId)}: ${SURFACE_LABEL[r.surface].toLowerCase()}`} />
        ))} />
        <p class="al-text-small al-text-secondary">Отражения от потолка видны в таблице и на графике; на плане сверху их путь совпал бы с прямым.</p>
      </Block>
      <Block title="Отражения во времени" subtitle="Расчётная картина первых отражений (как ETC): задержка относительно прямого звука и оценка уровня. Это не измерение.">
        <EventChart title="Первые отражения во времени" events={events} selectedId={sel} onSelect={setSel} />
        <KeyValue items={[
          ['Первое отражение', `${n1(itdg)} мс`],
          ['Сильных без обработки', `${strong.length} из ${lateral.length}`],
        ]} />
        <p class="al-text-small al-text-secondary">Первое отражение (ITDG) — задержка самого раннего отражения от боковых и задней стен и потолка; отражение от стены за колонками в него не входит. Сильные — уровнем выше −10 дБ относительно прямого звука.{selected ? ` Выбрано: ${names.get(selected.sourceId)}, ${SURFACE_LABEL[selected.surface].toLowerCase()}, угол падения ${n0(selected.incidenceDeg)}°.` : ''}</p>
      </Block>
      <Block title="Точки первых отражений">
        <DataTable caption="Точки первых отражений" rowKey={pid} rows={[...paths].sort((a, b) => a.delayMs - b.delayMs)} columns={[
          { key: 'src', title: 'Колонка', render: (r) => names.get(r.sourceId) ?? r.sourceId },
          { key: 'surface', title: 'Поверхность', render: (r) => SURFACE_LABEL[r.surface] },
          { key: 'point', title: 'Точка', numeric: true, render: (r) => (r.surface === 'ceiling' ? `x ${n1(r.point.x)}, y ${n1(r.point.y)} м` : `${r.surface === 'front' || r.surface === 'back' ? `y ${n1(r.point.y)}` : `x ${n1(r.point.x)}`}, высота ${n1(r.point.z)} м`) },
          { key: 'delay', title: 'Задержка', numeric: true, render: (r) => `${n1(r.delayMs)} мс` },
          { key: 'path', title: 'Путь', numeric: true, render: (r) => metres(r.path) },
          { key: 'angle', title: 'Угол падения', numeric: true, render: (r) => `${n0(r.incidenceDeg)}°` },
          { key: 'level', title: 'Уровень', numeric: true, render: (r) => `${n1(r.levelDb)} дБ` },
          { key: 'state', title: 'Сейчас', render: (r) => (r.treated ? <Badge tone="success" icon={false}>обработано</Badge> : r.on ? <Badge tone="neutral" icon={false}>{`${ON[r.on]}: панель не повесить`}</Badge> : <Badge tone="warning" icon={false}>без обработки</Badge>) },
          { key: 'show', title: 'План', render: (r) => <Button small variant={pid(r) === sel ? 'secondary' : 'ghost'} onClick={() => setSel(pid(r) === sel ? null : pid(r))} aria-label={`Показать: ${names.get(r.sourceId)}, ${SURFACE_LABEL[r.surface].toLowerCase()}`}>{pid(r) === sel ? 'Показано' : 'Показать'}</Button> },
        ]} />
        <p class="al-text-small al-text-secondary">Панели на эти точки — в разделе модели <a href={roomHref(p.h.room!.id, 'model', 'treatment')}>«Обработка»</a>.</p>
      </Block>
      {visibleAt('advanced', p.level) && <HigherOrders c={c} />}
      <Limits title="Ограничения" items={[
        visibleAt('advanced', p.level) ? 'Карта и таблица точек выше — первые отражения от стен и потолка; пол и отражения 2-го и 3-го порядков — в блоке «Отражения до 3-го порядка».'
          : 'Только первые отражения от стен и потолка: пол и отражения высших порядков — на продвинутом уровне.',
        'Уровень — только расхождение по пути и поглощение материала поверхности на 1 кГц; направленность колонок и рассеивание не учитываются.',
        'Обработанной считается точка, которую закрывает включённый элемент обработки.',
        'Измеренный пик ETC нельзя однозначно приписать отражению без дополнительных данных.',
      ]} />
    </div>
  );
}

const BANDS = ['500', '1000', '2000', '4000'] as const;
const kHz = (f: string) => (Number(f) >= 1000 ? `${Number(f) / 1000} кГц` : `${f} Гц`);

/** Откуда приходит отражение к слушателю, смотрящему на переднюю стену. */
function whence(a: ImageArrival): string {
  const az = a.azimuthDeg, abs = Math.abs(az);
  const h = abs <= 20 ? 'спереди' : abs >= 160 ? 'сзади' : `${az > 0 ? 'справа' : 'слева'} ${n0(abs)}°`;
  return a.elevationDeg > 15 ? `${h}, сверху ${n0(a.elevationDeg)}°` : a.elevationDeg < -15 ? `${h}, снизу ${n0(-a.elevationDeg)}°` : h;
}

function HigherOrders({ c }: { c: RoomConfiguration }) {
  const speakers = c.audio.sources.filter((s) => s.kind === 'speaker');
  const [f, setF] = useState<(typeof BANDS)[number]>('1000');
  const [srcId, setSrcId] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  const res = useMemo(() => imageSources(c, Number(f), 3), [c, f]);
  const src = speakers.find((s) => s.id === srcId) ?? speakers[0];
  const title = 'Отражения до 3-го порядка';
  if (!src) return null;
  if (!res.ok) return <Block title={title}><Notice tone="warning">{res.reason}</Notice></Block>;
  const mine = res.arrivals.filter((a) => a.sourceId === src.id);
  const events: TimeEvent[] = [
    { id: 'direct', t: 0, db: 0, label: 'Прямой звук', direct: true },
    ...mine.map((a) => ({ id: a.id, t: a.delayMs, db: a.levelDb, label: route(a) })),
  ];
  const early = mine.filter((a) => a.delayMs <= 20 && a.levelDb > -20);
  const first = mine[0];
  const strongest = [...mine].sort((a, b) => b.levelDb - a.levelDb).slice(0, 12).sort((a, b) => a.delayMs - b.delayMs);
  const selected = mine.find((a) => a.id === sel) ?? null;
  return (
    <Block title={title} subtitle="Метод мнимых источников для прямоугольной комнаты: все шесть поверхностей, включая пол, отражения 1–3-го порядков, поглощение в каждой точке отражения и направленность колонки из профиля. Расчётная картина, а не измерение.">
      <div class="al-grid">
        {speakers.length > 1 && <SelectField label="Колонка" value={src.id} onChange={(v) => { setSrcId(v); setSel(null); }} options={speakers.map((s) => ({ value: s.id, label: s.name }))} />}
        <SelectField label="Полоса" value={f} onChange={(v) => { setF(v); setSel(null); }} options={BANDS.map((b) => ({ value: b, label: kHz(b) }))} />
      </div>
      <EventChart title={`Отражения до 3-го порядка, ${kHz(f)}`} events={events} selectedId={sel} onSelect={setSel} />
      <KeyValue items={[
        ['Первое отражение', first ? `${n1(first.delayMs)} мс · ${route(first)}` : '—'],
        ['Сильнее −20 дБ в первые 20 мс', early.length ? `${early.length}` : <Badge key="rfz" tone="success" icon={false}>нет</Badge>],
        ['Путей рассчитано', `${mine.length}`],
      ]} />
      <p class="al-text-small al-text-secondary">{`Ориентир «зоны без отражений» для студийного прослушивания — в первые 20 мс нет отражений сильнее −20 дБ относительно прямого звука; дома это цель, а не норма.${selected ? ` Выбрано: ${route(selected)}, ${n1(selected.delayMs)} мс, ${n1(selected.levelDb)} дБ, приходит ${whence(selected)}.` : ''}`}</p>
      <DataTable caption="Самые сильные отражения до 3-го порядка" rowKey={(a) => a.id} rows={strongest} columns={[
        { key: 'route', title: 'Путь', render: (a) => route(a) },
        { key: 'order', title: 'Порядок', numeric: true, render: (a) => String(a.order) },
        { key: 'delay', title: 'Задержка', numeric: true, render: (a) => `${n1(a.delayMs)} мс` },
        { key: 'level', title: 'Уровень', numeric: true, render: (a) => `${n1(a.levelDb)} дБ` },
        { key: 'from', title: 'Приходит', render: (a) => whence(a) },
        { key: 'state', title: 'Сейчас', render: (a) => (a.absorbed ? <Badge tone="success" icon={false}>{a.absorbed === a.order ? 'на панелях' : `панелей: ${a.absorbed} из ${a.order}`}</Badge>
          : a.diffused ? <Badge tone="neutral" icon={false}>диффузор</Badge>
          : a.via.length ? <Badge tone="neutral" icon={false}>{a.via.map((k) => (k === 'window' ? 'окно' : 'дверь')).join(', ')}</Badge>
          : <Badge tone="warning" icon={false}>без обработки</Badge>) },
      ]} />
      <p class="al-text-small al-text-secondary">Двенадцать самых сильных путей; остальные — на графике. Путь — поверхности по ходу звука от колонки к месту. Открытые проёмы на пути отражения не дают; закрытые окна и двери считаются материалом стены; на диффузоре зеркальный уровень не снижается — он показывает, куда направлено рассеивание.</p>
      {res.notes.map((t) => <Notice key={t}>{t}</Notice>)}
    </Block>
  );
}

function route(a: ImageArrival): string {
  return a.surfaces.map((s, i) => (i === 0 ? SURFACE_LABEL[s] : SURFACE_LABEL[s].toLowerCase())).join(' → ');
}
