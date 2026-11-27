// Подбор (V2-043): поиск мест ядра и согласование сабвуферов в фоновом воркере по запросу. Результат — лучший
// найденный вариант; он временный, по желанию сохраняется отчётом прогона и переносится только в эксперимент после
// подтверждения. Варианты, которые двигают закреплённое или запрещённое ограничениями, не применяются (R44).
import { useState } from 'preact/hooks';
import { Badge, Button, ConfirmDialog, DataTable, FrequencyChart, KeyValue, Notice, useToast, type Series } from '../../design-system';
import { evalPpo } from '../../../core/precision';
import type { IntegrationResult } from '../../../core/integration';
import type { SubFilterResult } from '../../../core/subfilters';
import type { Placement, PlacementResult } from '../../../core/types';
import { toCore, type CoreInputs } from '../../adapters/core';
import { applyProposal } from '../../application/experiment';
import { placementOp, runRecord, runStale, searchKey, subSettingsOp, subsKey, variantConflicts, variantMoves, variantNotes } from '../../application/optimize';
import type { RoomConfiguration } from '../../domain/model';
import { useApp } from '../../shared/context';
import { dateTime } from '../../shared/format';
import { addOptimizationRun } from '../../storage/history';
import { Block, analysisStatus, hz, n0, n1, n2 } from '../analysis/common';
import { useJob } from '../analysis/useJob';
import type { AdviceData } from './useAdvice';

export function OptimizeSection({ d }: { d: AdviceData }) {
  const conv = toCore(d.edit.config);
  if (!conv.ok) return <Notice tone="warning">{conv.reason}</Notice>;
  const subs = d.edit.config.audio.sources.filter((s) => s.kind === 'sub');
  return (
    <div class="al-stack al-stack--24">
      <p class="al-text-secondary">{`${d.label} конфигурация. Найденное переносится только в эксперимент и только после подтверждения.`}</p>
      <PlacementSearch d={d} i={conv.inputs} />
      {subs.length > 0 && <SubAlignment d={d} i={conv.inputs} kind="integrate" />}
      {subs.length > 0 && <SubAlignment d={d} i={conv.inputs} kind="subFilters" />}
    </div>
  );
}

function useApply(d: AdviceData) {
  const { clock } = useApp();
  const toast = useToast();
  return async (op: (c: RoomConfiguration) => RoomConfiguration, label: string) => {
    const ok = await d.h.edit((r) => applyProposal(r, op, clock.newId, clock.now()), label);
    if (ok) { d.h.setRole('experimental'); toast.show('Перенесено в эксперимент; текущая конфигурация не изменилась'); }
    return ok;
  };
}

const confirmText = (d: AdviceData) => `${d.h.room!.experimental ? 'Изменения перенесутся в существующий эксперимент.' : 'Будет создан эксперимент — копия текущей конфигурации.'} Текущая конфигурация не изменится.`;

function PlacementSearch({ d, i }: { d: AdviceData; i: CoreInputs }) {
  const { compute, db, clock } = useApp();
  const toast = useToast();
  const c = d.edit.config;
  const room = d.h.room!;
  const key = searchKey(i);
  const [job, start] = useJob<PlacementResult>(key, (onProgress) => compute().run('optimize', { room: i.room, sources: i.sources, constraints: i.constraints, precision: i.precision }, { onProgress }));
  const saved = (d.records?.optimizations ?? []).filter((r) => r.configId === c.id);
  const [shownRun, setShownRun] = useState<string | null>(null);
  const run = saved.find((r) => r.id === shownRun) ?? null;
  const result = job.status === 'ready' ? job.value : run?.result ?? null;
  const [sel, setSel] = useState(0);
  const [ask, setAsk] = useState<Placement | null>(null);
  const apply = useApply(d);
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const variants = result ? result.best.slice(0, 5) : [];
  const chosen = variants[Math.min(sel, variants.length - 1)] ?? null;
  const save = () => {
    if (job.status !== 'ready') return;
    void addOptimizationRun(db, runRecord(c, room.id, job.value, clock.newId(), clock.now())).then(
      () => { setSavedKey(key); d.reloadRecords(); toast.show('Отчёт прогона сохранён в истории комнаты'); },
      () => toast.show('Не удалось сохранить отчёт', { tone: 'error' }),
    );
  };
  const series: Series[] = result && chosen ? [
    { id: 'base', label: 'Сейчас', kind: 'current', x: result.baseline.response.f, y: result.baseline.response.db },
    { id: 'var', label: `Вариант ${sel + 1}`, kind: 'calculated', x: chosen.response.f, y: chosen.response.db },
    { id: 'target', label: 'Цель', kind: 'target', x: chosen.response.f, y: chosen.response.target },
  ] : [];
  return (
    <Block title="Поиск мест" subtitle="Перебор с уточнением (ядро): места колонок, сабвуферов и основного слушателя по правилам расстановки модели. Глобальная оптимальность не доказана — это лучший найденный вариант.">
      {job.status !== 'ready' && analysisStatus(job, start, run ? 'Показан сохранённый прогон.' : 'Поиск запускается по запросу: от нескольких секунд до минуты.')}
      {run && job.status !== 'ready' && (
        <Notice tone={runStale(run, c) ? 'warning' : 'info'}>{`Сохранённый прогон от ${run.createdAt ? dateTime(run.createdAt) : 'неизвестной даты'}${runStale(run, c) ? ': входы поиска с тех пор изменились, результат устарел — пересчитайте.' : '.'}`}</Notice>
      )}
      {result && (
        <>
          <KeyValue items={[
            ['Проверено вариантов', n0(result.evaluated)], ['Полоса оценки', `${hz(result.fLo)}–${hz(result.fHi)}`],
            ['Неровность сейчас', `${n1(result.baseline.score)} дБ`], ['Лучший найденный', `${n1(result.best[0]?.score ?? NaN)} дБ`],
          ]} />
          {result.notes.map((x) => <p key={x} class="al-text-small al-text-secondary">{x}</p>)}
          <DataTable caption="Найденные варианты" rowKey={(p) => String(variants.indexOf(p))} rows={variants} columns={[
            { key: 'n', title: 'Вариант', render: (p) => <Button small variant={variants.indexOf(p) === sel ? 'secondary' : 'ghost'} aria-pressed={variants.indexOf(p) === sel} onClick={() => setSel(variants.indexOf(p))}>{`Вариант ${variants.indexOf(p) + 1}`}</Button> },
            { key: 's', title: 'Неровность', numeric: true, render: (p) => `${n1(p.score)} дБ` },
            { key: 'r', title: 'Устойчивость', numeric: true, render: (p) => (p.robust === undefined ? '—' : `+${n1(p.robust)} дБ`) },
            { key: 'a', title: 'Стереоугол', numeric: true, render: (p) => (p.angleDeg === null ? '—' : `${n0(p.angleDeg)}°`) },
            { key: 'm', title: 'Что меняет', render: (p) => movesText(c, p) },
          ]} />
          <p class="al-text-small al-text-secondary">Неровность — разброс АЧХ баса в местах слушателей, меньше — ровнее. Устойчивость — насколько хуже при сдвиге на 10 см.</p>
          {chosen && <FrequencyChart title={`АЧХ: сейчас и вариант ${sel + 1}`} fMin={result.fLo} fMax={result.fHi} series={series} />}
          {chosen && <VariantActions d={d} p={chosen} onApply={() => setAsk(chosen)} />}
          <div class="al-row">
            {job.status === 'ready' && <Button small icon="download" disabled={savedKey === key} onClick={save}>{savedKey === key ? 'Отчёт сохранён' : 'Сохранить отчёт прогона'}</Button>}
            {job.status === 'ready' && <Button small variant="ghost" onClick={start}>Искать заново</Button>}
          </div>
        </>
      )}
      {saved.length > 0 && (
        <DataTable caption="Сохранённые прогоны" rowKey={(r) => r.id} rows={saved} columns={[
          { key: 'at', title: 'Когда', render: (r) => (r.createdAt ? dateTime(r.createdAt) : 'время неизвестно') },
          { key: 'b', title: 'Лучший', numeric: true, render: (r) => (r.result.best[0] ? `${n1(r.result.best[0].score)} дБ` : '—') },
          { key: 'st', title: 'Состояние', render: (r) => (runStale(r, c) ? <Badge tone="warning">Устарел</Badge> : <Badge tone="success" icon={false}>Актуален</Badge>) },
          { key: 'o', title: 'Открыть', render: (r) => <Button small variant={r.id === shownRun ? 'secondary' : 'ghost'} aria-label={`Открыть прогон ${r.createdAt ? dateTime(r.createdAt) : ''}`} onClick={() => setShownRun(r.id === shownRun ? null : r.id)}>{r.id === shownRun ? 'Открыт' : 'Открыть'}</Button> },
        ]} />
      )}
      {ask && (
        <ConfirmDialog title="Перенести вариант в эксперимент?" confirmLabel="В эксперимент" onCancel={() => setAsk(null)}
          onConfirm={() => { const p = ask; setAsk(null); void apply(placementOp(p), 'Подбор: вариант мест'); }}
          text={<><p>{`Места: ${movesText(c, ask)}.`}</p><p>{confirmText(d)}</p></>} />
      )}
    </Block>
  );
}

function movesText(c: RoomConfiguration, p: Placement): string {
  const m = variantMoves(c, p);
  const names = m.sources.map((id) => c.audio.sources.find((s) => s.id === id)?.name ?? id);
  const parts = [...(m.listener ? ['слушатель'] : []), ...names.map((x) => x.toLowerCase())];
  return parts.length ? parts.join(', ') : 'ничего — места те же';
}

function VariantActions({ d, p, onApply }: { d: AdviceData; p: Placement; onApply: () => void }) {
  const c = d.edit.config;
  const room = d.h.room!;
  const conflicts = variantConflicts(c, p, room.goals);
  const notes = [...variantNotes(c, p, room.goals), ...(p.notes ?? []), ...p.penalties.map((x) => `Правило расстановки: ${x.name}`)];
  const same = movesText(c, p) === 'ничего — места те же';
  return (
    <div class="al-stack al-stack--8">
      {conflicts.map((x) => <Notice key={x} tone="warning">{`${x} Вариант не переносится: снимите закрепление или ограничение в целях.`}</Notice>)}
      {notes.map((x) => <p key={x} class="al-text-small al-text-secondary">{x}</p>)}
      <div class="al-row"><Button variant="primary" small icon="flask" disabled={!!conflicts.length || same} onClick={onApply}>Перенести в эксперимент</Button></div>
    </div>
  );
}

type SubsKind = 'integrate' | 'subFilters';
const SUBS_TEXT: Record<SubsKind, { title: string; text: string; method: 'optimizeSubs' | 'optimizeSubFilters' }> = {
  integrate: { title: 'Согласование сабвуферов с колонками', text: 'Задержка, фаза, уровень сабвуферов и частота раздела (ядро). Места не меняются.', method: 'optimizeSubs' },
  subFilters: { title: 'Свои фильтры сабвуферов', text: 'PEQ и фазовые фильтры каждого сабвуфера уменьшают разницу баса между местами (ядро). Задержка, фаза и уровень не меняются.', method: 'optimizeSubFilters' },
};

function SubAlignment({ d, i, kind }: { d: AdviceData; i: CoreInputs; kind: SubsKind }) {
  const { compute } = useApp();
  const c = d.edit.config;
  const t = SUBS_TEXT[kind];
  const key = subsKey(t.method, i);
  const [job, start] = useJob<IntegrationResult | SubFilterResult>(key, (onProgress) => (kind === 'integrate'
    ? compute().run('integrate', { room: i.room, sources: i.sources, constraints: i.constraints, setup: i.setup, ppo: evalPpo(i.precision) }, { onProgress })
    : compute().run('subFilters', { room: i.room, sources: i.sources, constraints: i.constraints, setup: i.setup, ppo: evalPpo(i.precision) }, { onProgress })));
  const [ask, setAsk] = useState(false);
  const apply = useApply(d);
  const filterable = c.audio.sources.some((s) => s.kind === 'sub' && ((s.capabilities.peqBands ?? 0) > 0 || s.capabilities.allpass));
  if (kind === 'subFilters' && !filterable) {
    return <Block title={t.title} subtitle={t.text}><p class="al-text-secondary">Нужен сабвуфер со своими PEQ или фазовыми фильтрами: в модели выберите сабвуфер на плане и укажите «Полосы PEQ».</p></Block>;
  }
  if (job.status !== 'ready') return <Block title={t.title} subtitle={t.text}>{analysisStatus(job, start, 'Расчёт по запросу.')}</Block>;
  const r = job.value;
  const xo = 'crossoverHz' in r ? r.crossoverHz : undefined;
  const ids = Object.keys(r.settings);
  const better = r.after < r.before - 0.05;
  return (
    <Block title={t.title} subtitle={t.text}>
      <KeyValue items={[['Неровность до', `${n1(r.before)} дБ`], ['Неровность после', `${n1(r.after)} дБ`], ...(xo !== undefined && xo !== null ? [['Частота раздела', hz(xo)] as [string, string]] : [])]} />
      <DataTable caption={`${t.title}: настройки`} rowKey={(id) => id} rows={ids} columns={[
        { key: 'n', title: 'Сабвуфер', render: (id) => c.audio.sources.find((s) => s.id === id)?.name ?? id },
        { key: 'd', title: 'Задержка', numeric: true, render: (id) => `${n2(r.settings[id].delayMs)} мс` },
        { key: 'p', title: 'Фаза', numeric: true, render: (id) => `${n0(r.settings[id].phaseDeg)}°` },
        { key: 'g', title: 'Уровень', numeric: true, render: (id) => `${n1(r.settings[id].gainDb)} дБ` },
        { key: 'f', title: 'Фильтры', numeric: true, render: (id) => String((r.settings[id].peq?.length ?? 0) + (r.settings[id].allpass?.length ?? 0)) },
      ]} />
      {r.notes.map((x) => <p key={x} class="al-text-small al-text-secondary">{x}</p>)}
      <FrequencyChart title={`${t.title}: АЧХ до и после`} fMin={r.responseBefore.f[0]} fMax={r.responseBefore.f[r.responseBefore.f.length - 1]} series={[
        { id: 'b', label: 'До', kind: 'current', x: r.responseBefore.f, y: r.responseBefore.db },
        { id: 'a', label: 'После', kind: 'calculated', x: r.responseAfter.f, y: r.responseAfter.db },
      ]} />
      <div class="al-row"><Button variant="primary" small icon="flask" disabled={!better || !ids.length} onClick={() => setAsk(true)}>Перенести в эксперимент</Button></div>
      {!better && <p class="al-text-small al-text-secondary">Улучшения не найдено: переносить нечего.</p>}
      {ask && (
        <ConfirmDialog title="Перенести настройки в эксперимент?" confirmLabel="В эксперимент" onCancel={() => setAsk(false)}
          onConfirm={() => { setAsk(false); void apply(subSettingsOp({ settings: r.settings, crossoverHz: xo }), `Подбор: ${t.title.toLowerCase()}`); }}
          text={<><p>{`Настройки ${ids.length} сабвуфер${ids.length === 1 ? 'а' : 'ов'}${xo !== undefined ? ' и частота раздела' : ''}.`}</p><p>{confirmText(d)}</p></>} />
      )}
    </Block>
  );
}
