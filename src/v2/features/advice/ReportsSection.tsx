// Проверочные измерения и отчёты (V2-045): «до и после» по замерам АЧХ вокруг отметки «выполнено» пунктов плана
// и отчёт по комнате в Markdown — скачать или сохранить в «Мои данные → Отчёты». Отчёт собирается из уже
// посчитанного и различает расчёт, измерение и рекомендации.
import { useEffect, useState } from 'preact/hooks';
import { Button, DataTable, KeyValue, useToast } from '../../design-system';
import { doneAt } from '../../application/plan';
import { roomReport, verification, type Verification } from '../../application/report';
import type { MeasurementData, MeasurementRecord } from '../../domain/measurement';
import type { PlanItem } from '../../domain/advice';
import { useApp } from '../../shared/context';
import { downloadText, safeFileName } from '../../shared/files';
import { dateTime } from '../../shared/format';
import { measurementData } from '../../storage/history';
import { listCategory, putEntry, type LibraryEntry } from '../../storage/library';
import { Block, n1 } from '../analysis/common';
import { lastEq } from './DspSection';
import type { AdviceData } from './useAdvice';

interface RoomReportEntry extends LibraryEntry { kind: 'room-report'; roomId: string; configId: string; revision: number; format: 'markdown'; text: string; createdAt: string }

export function ReportsSection({ d }: { d: AdviceData }) {
  return (
    <div class="al-stack al-stack--24">
      <Checks d={d} />
      <Report d={d} />
    </div>
  );
}

function Checks({ d }: { d: AdviceData }) {
  const { db } = useApp();
  const fr = (d.records?.measurements ?? []).filter((m) => m.kind === 'frequency-response' && m.recordedAt);
  const [data, setData] = useState<{ m: MeasurementRecord; data: MeasurementData }[] | null>(null);
  const ids = fr.map((m) => m.id).join();
  useEffect(() => {
    let alive = true;
    void Promise.all(fr.map((m) => measurementData(db, m.id).then((x) => (x ? { m, data: x } : null)))).then(
      (xs) => alive && setData(xs.filter((x): x is { m: MeasurementRecord; data: MeasurementData } => !!x)), () => alive && setData([]));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, ids]);
  const done = d.plan.items.filter((x) => x.status === 'done' || x.status === 'verified');
  const rows = data ? done.map((x) => ({ x, v: doneAt(x) ? verification(doneAt(x)!, data) : null })) : [];
  return (
    <Block title="Проверка до и после" subtitle="Разброс АЧХ замера в полосе 20–200 Гц (СКО от медианы): меньше — ровнее. Сравнивайте замеры в одной точке и на одной громкости.">
      {!done.length ? <p class="al-text-secondary">Выполненных пунктов плана нет: проверять пока нечего.</p>
        : !data ? <p class="al-text-small al-text-secondary">Загрузка замеров…</p> : (
          <DataTable caption="Проверка до и после" rowKey={(r) => r.x.id} rows={rows} columns={[
            { key: 't', title: 'Пункт плана', render: (r) => r.x.title },
            { key: 'b', title: 'До', numeric: true, render: (r) => (r.v?.before ? `${n1(r.v.before.spread)} дБ` : '—') },
            { key: 'a', title: 'После', numeric: true, render: (r) => (r.v ? `${n1(r.v.after.spread)} дБ` : '—') },
            { key: 'r', title: 'Итог', render: (r) => verdict(r.x, r.v) },
          ]} />
        )}
      <p class="al-text-small al-text-secondary">Итог — сравнение замеров, а не расчёт; подтверждённым пункт становится, когда к нему привязан замер в плане работ.</p>
    </Block>
  );
}

function verdict(x: PlanItem, v: Verification | null): string {
  if (!v) return 'Нет замера после выполнения';
  if (v.delta === null) return `Замер после: «${v.after.m.name}»; замера до нет — сравнить не с чем`;
  if (Math.abs(v.delta) < 0.5) return 'Без заметной разницы (меньше 0,5 дБ)';
  return v.delta < 0 ? `Ровнее на ${n1(-v.delta)} дБ` : `Неровнее на ${n1(v.delta)} дБ${x.status === 'verified' ? ' — пересмотрите пункт' : ''}`;
}

function Report({ d }: { d: AdviceData }) {
  const { db, clock } = useApp();
  const toast = useToast();
  const room = d.h.room!;
  const c = d.edit.config;
  const [saved, setSaved] = useState<RoomReportEntry[]>([]);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    void listCategory(db, 'reports').then((l) => alive && setSaved((l as RoomReportEntry[]).filter((e) => e.kind === 'room-report' && e.roomId === room.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt))), () => undefined);
    return () => { alive = false; };
  }, [db, room.id, tick]);
  /** Сохранённая в конфигурации коррекция, иначе подобранная в этом сеансе для той же ревизии. */
  const sessionEq = () => {
    if (c.dsp) return { filters: c.dsp.filters, source: c.dsp.source, preamp: c.dsp.preamp, configId: c.id, revision: c.revision };
    const eq = lastEq.get(room.id);
    return eq && eq.configId === c.id && eq.revision === c.revision ? eq : null;
  };
  const build = () => {
    const now = clock.now();
    const a = d.state.status === 'ready' ? d.state.value : null;
    const eq = sessionEq();
    return {
      now,
      text: roomReport({
        room, config: c, label: d.label, now, recs: d.recs ?? [], plan: d.plan, runs: d.records?.optimizations ?? [], measurements: d.records?.measurements ?? [],
        analysis: a ? { score: a.ev.score, rt60: a.reverb.tMid, volume: a.reverb.volume, problems: a.overview.problems.map((p) => p.title), limitations: [...a.provenance.limitations, ...a.provenance.warnings] } : null,
        eq,
      }),
    };
  };
  const file = (at: string) => `${safeFileName(room.name)}_отчёт_${at.slice(0, 10)}.md`;
  const eq = sessionEq();
  return (
    <Block title="Отчёт по комнате" subtitle="Markdown: комната, расчёт, замеры, рекомендации с причинами и проверкой, план работ, подбор и эквалайзер. Расчёт помечен расчётом, замеры — измерением.">
      <KeyValue items={[
        ['Конфигурация', `${d.label}, ревизия ${c.revision}`], ['Рекомендаций', String(d.recs?.length ?? 0)], ['Пунктов плана', String(d.plan.items.length)],
        ['Эквалайзер', eq ? `${eq.filters.filter((p) => p.enabled).length} фильтров${c.dsp ? ', сохранён в конфигурации' : ''}` : 'не подбирался в этом сеансе и не сохранён'],
      ]} />
      <div class="al-row">
        <Button small icon="download" disabled={!d.recs} onClick={() => { const r = build(); downloadText(file(r.now), r.text, 'text/markdown'); }}>Скачать отчёт</Button>
        <Button small disabled={!d.recs} onClick={() => {
          const r = build();
          const rec: RoomReportEntry = { id: clock.newId(), name: `${room.name}: отчёт`, kind: 'room-report', roomId: room.id, configId: c.id, revision: c.revision, format: 'markdown', text: r.text, createdAt: r.now };
          void putEntry(db, 'reports', rec).then(() => { setTick((t) => t + 1); toast.show('Сохранено в «Мои данные» → «Отчёты»'); }, () => toast.show('Не удалось сохранить', { tone: 'error' }));
        }}>Сохранить в «Мои данные»</Button>
      </div>
      {saved.length > 0 && (
        <DataTable caption="Сохранённые отчёты" rowKey={(e) => e.id} rows={saved} columns={[
          { key: 'at', title: 'Когда', render: (e) => dateTime(e.createdAt) },
          { key: 'cfg', title: 'Конфигурация', render: (e) => `${e.configId === room.current.id ? 'текущая' : e.configId === room.experimental?.id ? 'эксперимент' : 'прежняя'}, ревизия ${e.revision}` },
          { key: 'dl', title: 'Файл', render: (e) => <Button small variant="ghost" icon="download" aria-label={`Скачать отчёт ${dateTime(e.createdAt)}`} onClick={() => downloadText(file(e.createdAt), e.text, 'text/markdown')}>Скачать</Button> },
        ]} />
      )}
    </Block>
  );
}
