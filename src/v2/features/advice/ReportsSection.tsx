// Проверочные измерения и отчёты (V2-045): «до и после» по замерам АЧХ вокруг отметки «выполнено» пунктов плана
// и отчёт по комнате в Markdown — скачать или сохранить в «Мои данные → Отчёты». Отчёт собирается из уже
// посчитанного и различает расчёт, измерение и рекомендации.
// V2-055 (экспертный уровень): технический отчёт — самостоятельный HTML с графиками для печати в PDF, JSON и CSV.
import { useEffect, useState } from 'preact/hooks';
import { Button, DataTable, KeyValue, Notice, useToast } from '../../design-system';
import { CORE_VERSION } from '../../adapters/calculations';
import { effectiveComplexity } from '../../application/settings';
import { modesCsv, responseCsv, responseSvg, reverbCsv, technicalHtml, technicalJson, type TechInput } from '../../application/techReport';
import { visibleAt } from '../../domain/complexity';
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

interface RoomReportEntry extends LibraryEntry { kind: 'room-report'; roomId: string; configId: string; revision: number; format: 'markdown' | 'html'; text: string; createdAt: string }

const FORMAT: Record<RoomReportEntry['format'], { ext: string; mime: string; label: string }> = {
  markdown: { ext: 'md', mime: 'text/markdown', label: 'Markdown' }, html: { ext: 'html', mime: 'text/html', label: 'технический, HTML' },
};

export function ReportsSection({ d }: { d: AdviceData }) {
  const { settings } = useApp();
  const [tick, setTick] = useState(0);
  const saved = () => setTick((t) => t + 1);
  return (
    <div class="al-stack al-stack--24">
      <Checks d={d} />
      <Report d={d} tick={tick} onSaved={saved} />
      {visibleAt('expert', effectiveComplexity(settings, 'advice')) && <TechReport d={d} onSaved={saved} />}
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

function Report({ d, tick, onSaved }: { d: AdviceData; tick: number; onSaved: () => void }) {
  const { db, clock } = useApp();
  const toast = useToast();
  const room = d.h.room!;
  const c = d.edit.config;
  const [saved, setSaved] = useState<RoomReportEntry[]>([]);
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
  const file = (at: string, format: RoomReportEntry['format'] = 'markdown') => `${safeFileName(room.name)}_${format === 'html' ? 'технический_отчёт' : 'отчёт'}_${at.slice(0, 10)}.${FORMAT[format].ext}`;
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
          void putEntry(db, 'reports', rec).then(() => { onSaved(); toast.show('Сохранено в «Мои данные» → «Отчёты»'); }, () => toast.show('Не удалось сохранить', { tone: 'error' }));
        }}>Сохранить в «Мои данные»</Button>
      </div>
      {saved.length > 0 && (
        <DataTable caption="Сохранённые отчёты" rowKey={(e) => e.id} rows={saved} columns={[
          { key: 'at', title: 'Когда', render: (e) => dateTime(e.createdAt) },
          { key: 'cfg', title: 'Конфигурация', render: (e) => `${e.configId === room.current.id ? 'текущая' : e.configId === room.experimental?.id ? 'эксперимент' : 'прежняя'}, ревизия ${e.revision}` },
          { key: 'fmt', title: 'Вид', render: (e) => FORMAT[e.format ?? 'markdown'].label },
          { key: 'dl', title: 'Файл', render: (e) => <Button small variant="ghost" icon="download" aria-label={`Скачать отчёт ${dateTime(e.createdAt)}`} onClick={() => downloadText(file(e.createdAt, e.format ?? 'markdown'), e.text, FORMAT[e.format ?? 'markdown'].mime)}>Скачать</Button> },
        ]} />
      )}
    </Block>
  );
}

/** Технический отчёт (V2-055): то же содержание с моделью, графиками, реверберацией, модами и происхождением данных. */
function TechReport({ d, onSaved }: { d: AdviceData; onSaved: () => void }) {
  const { db, clock } = useApp();
  const toast = useToast();
  const room = d.h.room!;
  const c = d.edit.config;
  const a = d.state.status === 'ready' ? d.state.value : null;
  const [busy, setBusy] = useState(false);
  const build = async (): Promise<TechInput> => {
    const now = clock.now();
    const fr = (d.records?.measurements ?? []).filter((m) => m.configId === c.id && m.kind === 'frequency-response').sort((x, y) => (y.recordedAt ?? '').localeCompare(x.recordedAt ?? ''));
    const data = fr[0] ? await measurementData(db, fr[0].id) : null;
    const eq = c.dsp ? { filters: c.dsp.filters, source: c.dsp.source, preamp: c.dsp.preamp } : (() => { const e = lastEq.get(room.id); return e && e.configId === c.id && e.revision === c.revision ? e : null; })();
    return {
      room, config: c, label: d.label, now, recs: d.recs ?? [], plan: d.plan, runs: d.records?.optimizations ?? [], measurements: d.records?.measurements ?? [], eq, coreVersion: CORE_VERSION,
      measured: fr[0] && data && data.f.length ? { m: fr[0], data } : null,
      analysis: a ? { ev: a.ev, reverb: a.reverb, modes: a.modes.modes, provenance: a.provenance, problems: a.overview.problems.map((p) => p.title) } : null,
    };
  };
  const name = (at: string, ext: string) => `${safeFileName(room.name)}_технический_отчёт_${at.slice(0, 10)}.${ext}`;
  const run = (f: (i: TechInput) => void) => { setBusy(true); void build().then(f, () => toast.show('Не удалось собрать отчёт', { tone: 'error' })).finally(() => setBusy(false)); };
  const open = (html: string) => {
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    const w = window.open(url, '_blank');
    if (!w) toast.show('Браузер не открыл вкладку: скачайте HTML и откройте файл', { tone: 'error' });
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };
  const stamp = clock.now();
  return (
    <Block title="Технический отчёт" subtitle="Экспертный уровень. Один файл HTML без скриптов и внешних ресурсов: комната, источники и слушатели с координатами, АЧХ расчёта с целью и последним замером, показатели, реверберация по октавам, моды, рекомендации, план, эквалайзер, метод, версия и отпечаток входных данных. В PDF — печатью браузера.">
      {!a && <Notice tone="warning">Расчёт конфигурации не готов: в отчёте будут только исходные данные и записи. Откройте «Анализ» и дождитесь расчёта.</Notice>}
      <div class="al-row">
        <Button small icon="download" disabled={busy || !d.recs} onClick={() => run((i) => downloadText(name(i.now, 'html'), technicalHtml(i), 'text/html'))}>Скачать HTML</Button>
        <Button small disabled={busy || !d.recs} onClick={() => run((i) => open(technicalHtml(i)))}>Открыть для печати в PDF</Button>
        <Button small disabled={busy || !d.recs} onClick={() => run((i) => {
          const rec: RoomReportEntry = { id: clock.newId(), name: `${room.name}: технический отчёт`, kind: 'room-report', roomId: room.id, configId: c.id, revision: c.revision, format: 'html', text: technicalHtml(i), createdAt: i.now };
          void putEntry(db, 'reports', rec).then(() => { onSaved(); toast.show('Сохранено в «Мои данные» → «Отчёты»'); }, () => toast.show('Не удалось сохранить', { tone: 'error' }));
        })}>Сохранить в «Мои данные»</Button>
      </div>
      <div class="al-row">
        <Button small variant="ghost" icon="download" disabled={busy || !d.recs} onClick={() => run((i) => downloadText(name(i.now, 'json'), JSON.stringify(technicalJson(i), null, 2), 'application/json'))}>Данные, JSON</Button>
        <Button small variant="ghost" icon="download" disabled={!a} onClick={() => a && downloadText(`${safeFileName(room.name)}_АЧХ_расчёт_${stamp.slice(0, 10)}.csv`, responseCsv(a.ev.response), 'text/csv')}>АЧХ, CSV</Button>
        <Button small variant="ghost" icon="download" disabled={busy || !a} onClick={() => run((i) => i.analysis && downloadText(name(i.now, 'svg'), `<?xml version="1.0" encoding="UTF-8"?>
${responseSvg(i.analysis.ev, i.measured?.data ?? null).svg}
`, 'image/svg+xml'))}>График АЧХ, SVG</Button>
        <Button small variant="ghost" icon="download" disabled={!a} onClick={() => a && downloadText(`${safeFileName(room.name)}_моды_${stamp.slice(0, 10)}.csv`, modesCsv(a.modes.modes), 'text/csv')}>Моды, CSV</Button>
        <Button small variant="ghost" icon="download" disabled={!a} onClick={() => a && downloadText(`${safeFileName(room.name)}_реверберация_${stamp.slice(0, 10)}.csv`, reverbCsv(a.reverb), 'text/csv')}>Реверберация, CSV</Button>
      </div>
      <p class="al-text-small al-text-secondary">«Открыть для печати» открывает отчёт в новой вкладке: сохраните его в PDF через печать браузера (на iPhone — «Поделиться → Печать»). Замер в отчёте сдвинут по уровню к расчёту — сравнивается форма АЧХ. Отчёт содержит названия и координаты из комнаты — проверьте, прежде чем пересылать.</p>
    </Block>
  );
}
