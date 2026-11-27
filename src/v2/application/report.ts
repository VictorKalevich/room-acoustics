// Проверочные измерения и отчёт комнаты (V2-045). Проверка «до и после» сравнивает разброс замеров АЧХ в полосе
// баса — это показатель ровности, а не оценка ядра. Отчёт — Markdown из уже посчитанных данных: в нём явно
// различаются расчёт, измерение и рекомендации; новых расчётов отчёт не делает.
import { measurementAt } from '../../core/measure';
import type { ActionPlan, Recommendation } from '../domain/advice';
import type { MeasurementData, MeasurementRecord, OptimizationRun } from '../domain/measurement';
import type { Room, RoomConfiguration } from '../domain/model';
import { EFFORT_LABEL, EVIDENCE_LABEL, GOAL_LABEL, GROUP_LABEL, sortAdvice } from './advice';
import { PLAN_STATUS_LABEL, sortPlan } from './plan';
import { logFreqs, type EqFilter } from './tools';
import { isKnown } from '../domain/units';

const n1 = (v: number) => v.toFixed(1).replace('.', ',').replace('-', '−');
const n2 = (v: number) => v.toFixed(2).replace('.', ',');

/** Разброс АЧХ замера в полосе (СКО от медианы, дБ, сетка 1/24 октавы); null — замер не покрывает полосу. */
export function spreadDb(d: Pick<MeasurementData, 'f' | 'db'>, fLo = 20, fHi = 200): number | null {
  if (!d.f.length) return null;
  const grid = logFreqs(fLo, fHi, 24);
  const v = measurementAt({ name: '', importedAt: '', f: d.f, db: d.db }, grid).filter((x): x is number => x !== null);
  if (v.length < grid.length * 0.8) return null;
  const s = [...v].sort((a, b) => a - b);
  const med = s[Math.floor(s.length / 2)];
  return Math.sqrt(v.reduce((a, x) => a + (x - med) ** 2, 0) / v.length);
}

export interface Verification { before: { m: MeasurementRecord; spread: number } | null; after: { m: MeasurementRecord; spread: number }; delta: number | null }

/** «До и после»: последний замер АЧХ до момента и первый после; меньше разброс — ровнее. */
export function verification(at: string, list: readonly { m: MeasurementRecord; data: MeasurementData }[]): Verification | null {
  const fr = list.filter((x) => x.m.kind === 'frequency-response' && x.m.recordedAt).sort((a, b) => a.m.recordedAt!.localeCompare(b.m.recordedAt!));
  const after = fr.find((x) => x.m.recordedAt! > at);
  const before = fr.filter((x) => x.m.recordedAt! <= at).pop();
  const sa = after ? spreadDb(after.data) : null;
  if (!after || sa === null) return null;
  const sb = before ? spreadDb(before.data) : null;
  return { before: before && sb !== null ? { m: before.m, spread: sb } : null, after: { m: after.m, spread: sa }, delta: sb !== null ? sa - sb : null };
}

export interface ReportInput {
  room: Room;
  config: RoomConfiguration;
  label: string;
  now: string;
  analysis: { score: number; rt60: number; volume: number; problems: string[]; limitations: string[] } | null;
  recs: readonly Recommendation[];
  plan: ActionPlan;
  runs: readonly OptimizationRun[];
  eq: { filters: readonly EqFilter[]; source: string; preamp: number } | null;
  measurements: readonly MeasurementRecord[];
}

export function roomReport(i: ReportInput): string {
  const c = i.config;
  const g = c.geometry.kind === 'rect' ? c.geometry : null;
  const L: string[] = [];
  L.push(`# Отчёт по комнате «${i.room.name}»`, '');
  L.push(`Составлен: ${i.now.slice(0, 16).replace('T', ' ')} (UTC). Конфигурация: ${i.label.toLowerCase()}, ревизия ${c.revision}.`, '');
  L.push('Обозначения: **расчёт** — модель приложения, **измерение** — замер в комнате, **рекомендация** — вывод правил советов. Расчёт не заменяет измерение.', '');
  L.push('## Комната', '');
  if (g) L.push(`- Размеры: ${n2(g.depth)} × ${n2(g.width)} × ${n2(g.height)} м`);
  L.push(`- Источники: ${c.audio.sources.map((s) => s.name).join(', ') || 'нет'}`);
  L.push(`- Слушатели: ${c.listening.listeners.length}`);
  L.push(`- Элементы обработки: ${c.treatment.enabled ? c.treatment.items.filter((t) => t.enabled !== false).length : 0}`);
  const goals = i.room.goals;
  L.push(`- Цель: ${GOAL_LABEL[goals.primary]}; бюджет: ${isKnown(goals.budget) ? String(goals.budget) : 'не задан'}`, '');
  if (i.analysis) {
    L.push('## Расчёт', '');
    L.push(`- Неровность баса в месте слушателя: ${n1(i.analysis.score)} дБ (меньше — ровнее)`);
    L.push(`- Время реверберации 500–1000 Гц: ${n2(i.analysis.rt60)} с; объём ${n1(i.analysis.volume)} м³`);
    for (const p of i.analysis.problems) L.push(`- ${p}`);
    L.push('');
  }
  const mine = i.measurements.filter((m) => m.configId === c.id);
  L.push('## Измерения', '');
  if (!mine.length) L.push('Замеров этой конфигурации нет: выводы ниже опираются на модель.');
  for (const m of mine) L.push(`- ${m.recordedAt ? m.recordedAt.slice(0, 16).replace('T', ' ') : 'время неизвестно'} — ${m.name}`);
  L.push('');
  const s = sortAdvice(i.recs);
  L.push('## Рекомендации', '');
  if (!s.active.length) L.push('Активных рекомендаций нет.');
  for (const r of s.active) {
    L.push(`### ${r.title}`, '');
    L.push(`${GROUP_LABEL[r.group]} · ${EVIDENCE_LABEL[r.evidence]} · ${r.cost.kind === 'free' ? 'бесплатно' : `покупка: ${r.cost.what}, стоимость неизвестна`} · трудоёмкость: ${EFFORT_LABEL[r.effort]}`, '');
    L.push(`- Причина: ${r.cause}`, `- Источник и метод: ${r.source}; ${r.method}`, `- Применимость: ${r.applicability}`, `- Эффект: ${r.effect}`, `- Побочные последствия: ${r.sideEffects}`);
    for (const a of r.actions) L.push(`- Действие: ${a}`);
    L.push(`- Проверка: ${r.verify}`);
    for (const n of r.notes) L.push(`- Оговорка: ${n}`);
    L.push('');
  }
  if (s.blocked.length) {
    L.push('Не предлагаются из-за ограничений:', '');
    for (const r of s.blocked) L.push(`- ${r.title} — ${r.conflicts.join(' ')}`);
    L.push('');
  }
  L.push('## План работ', '');
  if (!i.plan.items.length) L.push('План пуст.');
  for (const x of sortPlan(i.plan.items)) {
    const by = x.verifiedBy ? i.measurements.find((m) => m.id === x.verifiedBy)?.name : null;
    L.push(`- [${x.status === 'verified' || x.status === 'done' ? 'x' : ' '}] ${x.title} — ${PLAN_STATUS_LABEL[x.status]}${by ? ` (замер «${by}»)` : ''}`);
  }
  L.push('');
  const run = i.runs.find((r) => r.configId === c.id);
  if (run && run.result.best[0]) {
    L.push('## Подбор расстановки', '');
    L.push(`Лучший найденный вариант (расчёт, ${run.createdAt ? run.createdAt.slice(0, 10) : 'дата неизвестна'}): неровность ${n1(run.result.best[0].score)} дБ против ${n1(run.result.baseline.score)} дБ у исходной; проверено вариантов: ${run.result.evaluated}. Глобальная оптимальность не доказана.`, '');
  }
  if (i.eq && i.eq.filters.length) {
    L.push('## Эквалайзер', '');
    L.push(`По ${i.eq.source}; предусилитель ${n1(i.eq.preamp)} дБ.`, '');
    L.push('| № | Частота, Гц | Усиление, дБ | Q | Включён |', '| --- | --- | --- | --- | --- |');
    i.eq.filters.forEach((p, k) => L.push(`| ${k + 1} | ${n1(p.f)} | ${n1(p.gainDb)} | ${n2(p.q)} | ${p.enabled ? 'да' : 'нет'} |`));
    L.push('');
  }
  if (i.analysis?.limitations.length) {
    L.push('## Ограничения', '');
    for (const x of i.analysis.limitations) L.push(`- ${x}`);
    L.push('');
  }
  return L.join('\n');
}
