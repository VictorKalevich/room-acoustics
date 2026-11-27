// Раздел «Отражения» (V2-033): первые отражения методом мнимых источников (ядро treatment.ts) — пути на плане и
// события во времени связаны выбором; задержка, путь, угол падения, оценка уровня, обработана ли точка.
import { useMemo, useState } from 'preact/hooks';
import { Badge, Button, DataTable, EventChart, KeyValue, Notice, PlanPath, type TimeEvent } from '../../design-system';
import { toCore } from '../../adapters/core';
import { SURFACE_LABEL } from '../../application/editing';
import { reflectionPaths, type ReflectionPath } from '../../application/analysis';
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
        <EventChart title="Первые отражения во времени" events={events} selectedId={sel} onSelect={(id) => setSel(id === 'direct' ? null : id)} />
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
      <Limits title="Ограничения" items={[
        'Только первые отражения от стен и потолка: пол и отражения высших порядков пока не считаются.',
        'Уровень — только расхождение по пути и поглощение материала поверхности на 1 кГц; направленность колонок и рассеивание не учитываются.',
        'Обработанной считается точка, которую закрывает включённый элемент обработки.',
        'Измеренный пик ETC нельзя однозначно приписать отражению без дополнительных данных.',
      ]} />
    </div>
  );
}
