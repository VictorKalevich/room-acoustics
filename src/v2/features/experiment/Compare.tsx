// Сравнение (V2-028, V2-030): текущая с экспериментом или снимок истории с текущей. Это просмотр двух конфигураций —
// третьей не создаётся. План (вторая конфигурация, первая — контуром), различия и расчёт ядра для обеих.
import { useState } from 'preact/hooks';
import {
  Badge, Button, CalcStatus, Card, DataTable, EmptyState, FrequencyChart, Notice, PlanView, SelectField, type Series, type SeriesKind,
} from '../../design-system';
import { rtBand } from '../../../core/overview';
import { createExperiment } from '../../domain/operations';
import type { RoomConfiguration } from '../../domain/model';
import { useApp } from '../../shared/context';
import { dateTime } from '../../shared/format';
import { useAnalysis, type Analysis, type AnalysisState } from '../analysis/useAnalysis';
import { LAYERS, planItems } from '../model/planItems';
import type { SectionProps } from '../model/sections';
import { ChangeList } from './ChangeList';

/** Выбранная цель сравнения запоминается на время сессии для каждой комнаты (переход из истории). */
const targetMemory = new Map<string, string>();
export const setCompareTarget = (roomId: string, target: string) => targetMemory.set(roomId, target);

interface Side { label: string; kind: SeriesKind; config: RoomConfiguration }

const ALL_LAYERS = new Set(LAYERS);
const n1 = (v: number) => v.toFixed(1).replace('.', ',');
const n2 = (v: number) => v.toFixed(2).replace('.', ',');

export function CompareSection({ h }: SectionProps) {
  const { clock } = useApp();
  const room = h.room!;
  const options = [
    ...(room.experimental ? [{ value: 'experimental', label: 'Текущая и эксперимент' }] : []),
    ...room.history.map((s) => ({ value: `snapshot:${s.id}`, label: `Снимок от ${dateTime(s.takenAt)} и текущая` })),
  ];
  const remembered = targetMemory.get(room.id);
  const [target, setTarget] = useState(remembered && options.some((o) => o.value === remembered) ? remembered : options[0]?.value ?? '');
  const value = options.some((o) => o.value === target) ? target : options[0]?.value ?? '';

  if (!value) {
    return (
      <EmptyState icon="compare" title="Сравнивать пока не с чем" text="Создайте эксперимент — копию текущей конфигурации, измените его и сравните. Снимки истории тоже можно сравнить с текущей."
        action={<Button variant="primary" icon="flask" onClick={() => void h.edit((r) => createExperiment(r, clock.newId, clock.now()), 'Создание эксперимента').then((ok) => ok && h.setRole('experimental'))}>Создать эксперимент</Button>} />
    );
  }
  const snap = value.startsWith('snapshot:') ? room.history.find((s) => `snapshot:${s.id}` === value) : null;
  const a: Side = snap ? { label: `Снимок ${dateTime(snap.takenAt)}`, kind: 'estimated', config: snap.config } : { label: 'Текущая', kind: 'current', config: room.current };
  const b: Side = snap ? { label: 'Текущая', kind: 'current', config: room.current } : { label: 'Эксперимент', kind: 'experimental', config: room.experimental! };
  return (
    <div class="al-stack al-stack--24">
      <SelectField label="Что сравнить" value={value} onChange={(v) => { setTarget(v); targetMemory.set(room.id, v); }} options={options} />
      <p class="al-text-small al-text-secondary">Сравнение — просмотр двух конфигураций: здесь ничего не меняется. Менять эксперимент — переключателем «Эксперимент» вверху.</p>
      <ComparePlan a={a} b={b} />
      <Card title="Отличия">
        <ChangeList a={a.config} b={b.config} title={`${b.label} относительно: ${a.label.toLowerCase()}`} />
      </Card>
      <CompareMetrics a={a} b={b} />
    </div>
  );
}

function ComparePlan({ a, b }: { a: Side; b: Side }) {
  if (b.config.geometry.kind !== 'rect') return null;
  const g = b.config.geometry;
  const mine = planItems(b.config, ALL_LAYERS);
  const before = planItems(a.config, ALL_LAYERS).items;
  const moved = before.filter((p) => {
    const q = mine.items.find((x) => x.id === p.id);
    return !q || Math.hypot(q.x - p.x, q.y - p.y) >= 0.01 || q.dx !== p.dx || q.dy !== p.dy;
  });
  return (
    <Card title="План" subtitle={`Объекты — ${b.label.toLowerCase()}; контур — где они были: ${a.label.toLowerCase()}.`}>
      <PlanView title={`Сравнение: ${b.label} и ${a.label}`} depth={g.depth} width={g.width} height={g.height} items={[...moved.map((p) => ({ ...p, ghost: true })), ...mine.items]} openings={mine.openings} annexes={mine.annexes} />
    </Card>
  );
}

interface Metric { id: string; title: string; value: (x: Analysis) => number; text: (v: number) => string; better?: 'higher' | 'lower'; note?: string }

const METRICS: Metric[] = [
  { id: 'score', title: 'Общая оценка', value: (x) => x.overview.score, text: (v) => `${Math.round(v)} из 100`, better: 'higher' },
  { id: 'bass', title: 'Неровность баса в месте слушателя', value: (x) => x.ev.score, text: (v) => `${n1(v)} дБ`, better: 'lower' },
  { id: 'high', title: 'Серьёзных проблем', value: (x) => x.overview.problems.filter((p) => p.severity === 'high').length, text: (v) => String(v), better: 'lower' },
  { id: 'rt', title: 'Время реверберации, 500–1000 Гц', value: (x) => x.reverb.tMid, text: (v) => `${n2(v)} с` },
  { id: 'schroeder', title: 'Частота Шрёдера', value: (x) => x.reverb.schroeder, text: (v) => `${Math.round(v)} Гц` },
];

function verdict(m: Metric, va: number, vb: number): { text: string; tone: 'success' | 'warning' | 'neutral' } {
  const d = vb - va;
  if (Math.abs(d) < 1e-6 || m.text(va) === m.text(vb)) return { text: 'без изменений', tone: 'neutral' };
  const sign = d > 0 ? '+' : '−';
  const abs = m.text(Math.abs(d));
  if (!m.better) return { text: `${sign}${abs}`, tone: 'neutral' };
  const good = m.better === 'higher' ? d > 0 : d < 0;
  return { text: `${sign}${abs} · ${good ? 'лучше' : 'хуже'}`, tone: good ? 'success' : 'warning' };
}

function status(s: AnalysisState) {
  if (s.status === 'running') return <CalcStatus state="running" progress={s.progress} />;
  if (s.status === 'error') return <CalcStatus state="error" text={`Ошибка расчёта: ${s.message}`} />;
  if (s.status === 'unavailable') return <CalcStatus state="unavailable" text={s.reason} />;
  return null;
}

function CompareMetrics({ a, b }: { a: Side; b: Side }) {
  const sa = useAnalysis(a.config);
  const sb = useAnalysis(b.config);
  if (sa.status !== 'ready' || sb.status !== 'ready') {
    return <Card title="Расчёт"><div class="al-stack al-stack--12">{status(sa)}{status(sb)}</div></Card>;
  }
  const xa = sa.value, xb = sb.value;
  const band = rtBand(xb.reverb.volume);
  const rows = METRICS.map((m) => ({ m, va: m.value(xa), vb: m.value(xb) }));
  const series: Series[] = [
    { id: 'a', label: a.label, kind: a.kind, x: xa.ev.response.f, y: xa.ev.response.db },
    { id: 'b', label: b.label, kind: b.kind, x: xb.ev.response.f, y: xb.ev.response.db },
    { id: 't', label: 'Цель', kind: 'target', x: xb.ev.response.f, y: xb.ev.response.target },
  ];
  const limits = [...new Set([...xa.provenance.limitations, ...xb.provenance.limitations, ...xa.provenance.warnings, ...xb.provenance.warnings])];
  return (
    <>
      <Card title="Расчёт для обеих конфигураций" subtitle={`Модель: ${xb.model === 'wave' ? 'волновая' : 'прямоугольная'}. Это оценка расчётом, а не измерение.`}>
        <DataTable caption="Показатели расчёта" rowKey={(r) => r.m.id} rows={rows} columns={[
          { key: 'title', title: 'Показатель', render: (r) => r.m.title },
          { key: 'a', title: a.label, numeric: true, render: (r) => r.m.text(r.va) },
          { key: 'b', title: b.label, numeric: true, render: (r) => r.m.text(r.vb) },
          { key: 'd', title: 'Разница', render: (r) => { const v = verdict(r.m, r.va, r.vb); return <Badge tone={v.tone} icon={false}>{v.text}</Badge>; } },
        ]} />
        <p class="al-text-small al-text-secondary">Комфортное время реверберации для этого объёма — {n2(band[0])}–{n2(band[1])} с.</p>
      </Card>
      <Card title="Бас в месте слушателя">
        <FrequencyChart title={`АЧХ в месте слушателя: ${a.label} и ${b.label}`} series={series} fMin={Math.max(15, xb.ev.fLo)} fMax={xb.ev.fHi} />
      </Card>
      {limits.length > 0 && <Notice title="Ограничения расчёта"><ul>{limits.map((l) => <li key={l}>{l}</li>)}</ul></Notice>}
    </>
  );
}
