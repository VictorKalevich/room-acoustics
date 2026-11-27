// Раздел «Качество баса» (V2-031): отклик в месте слушателя (выбранная конфигурация, вторая для сравнения, цель),
// моды прямоугольной комнаты с длиной волны, затуханием отдельного резонанса, добротностью и полосой; пропорции.
import { useMemo, useState } from 'preact/hooks';
import { Badge, DataTable, FrequencyChart, KeyValue, Switch, type Series } from '../../design-system';
import { bonelloCheck, proportionsNotes } from '../../../core/modes';
import { coreInputs } from '../../adapters/core';
import { modeRows, type ModeRow } from '../../application/analysis';
import { roomHref } from '../../shared/router';
import { Block, Gate, Limits, hz, metres, n1, n2, type AnalysisProps } from './common';
import type { Analysis } from './useAnalysis';

const KIND: Record<ModeRow['kind'], string> = { axial: 'осевая', tangential: 'тангенциальная', oblique: 'косая' };

export function BassSection(p: AnalysisProps) {
  return <Gate state={p.state}>{(a) => <Bass p={p} a={a} />}</Gate>;
}

function Bass({ p, a }: { p: AnalysisProps; a: Analysis }) {
  const c = p.edit.config;
  const [all, setAll] = useState(p.level !== 'simple');
  const fTop = Math.max(a.ev.fHi, 120);
  const rows = useMemo(() => modeRows(c, a.modes.modes.filter((m) => m.f <= fTop), a.overview.decays), [c, a, fTop]);
  const shown = useMemo(() => {
    if (all) return rows;
    const worst = rows.filter((r) => r.kind !== 'axial' && r.t60 !== null && r.limit !== null && r.t60 > r.limit)
      .sort((x, y) => y.t60! / y.limit! - x.t60! / x.limit!).slice(0, 6);
    return rows.filter((r) => r.kind === 'axial' || worst.includes(r));
  }, [rows, all]);
  const room = useMemo(() => coreInputs(c).room, [c]);
  const notes = useMemo(() => proportionsNotes(room), [room]);
  const bonello = useMemo(() => bonelloCheck(a.modes.modes), [a]);
  const o = p.other?.state.status === 'ready' ? p.other.state.value : null;
  const series: Series[] = [
    { id: 'sel', label: p.label, kind: p.kind, x: a.ev.response.f, y: a.ev.response.db },
    ...(o && p.other ? [{ id: 'other', label: p.other.label, kind: p.other.kind, x: o.ev.response.f, y: o.ev.response.db }] : []),
    { id: 'target', label: 'Цель', kind: 'target', x: a.ev.response.f, y: a.ev.response.target },
  ];
  const over = rows.filter((r) => r.t60 !== null && r.limit !== null && r.t60 > r.limit);
  return (
    <div class="al-stack al-stack--24">
      <Block title="Отклик в месте слушателя" subtitle={`Расчёт ядра: ${a.model === 'wave' ? 'волновая модель' : 'моды прямоугольной комнаты'}, комплексная сумма всех источников с их настройками. Это не измерение.`}>
        <FrequencyChart title={`АЧХ в месте слушателя: ${series.filter((s) => s.kind !== 'target').map((s) => s.label).join(' и ')}`} series={series} fMin={Math.max(15, a.ev.fLo)} fMax={a.ev.fHi}
          marks={over.slice(0, 6).map((r) => ({ f: r.f, label: `Затянутый резонанс ${hz(r.f)}` }))} />
        <KeyValue items={[
          [`Неровность баса${o ? `: ${p.label.toLowerCase()}` : ''}`, `${n1(a.ev.score)} дБ`],
          ...(o && p.other ? [[`Неровность баса: ${p.other.label.toLowerCase()}`, `${n1(o.ev.score)} дБ`] as [string, string]] : []),
          ['Полоса оценки', `${hz(a.ev.fLo)}–${hz(a.ev.fHi)}`],
          ['Частота Шрёдера', `≈ ${hz(a.reverb.schroeder)}`],
        ]} />
        <p class="al-text-small al-text-secondary">Неровность — разброс уровня относительно цели в полосе оценки: меньше — ровнее. Выше частоты Шрёдера бас ведёт себя ближе к диффузному полю, ниже — его определяют отдельные моды.</p>
      </Block>

      <Block title="Моды комнаты" subtitle={`До ${hz(fTop)}. Время затухания — для отдельного резонанса по расчёту ядра; это не общее время реверберации комнаты.`}>
        <Switch checked={all} onChange={setAll} label={`Все моды (${rows.length})`} hint="Иначе — осевые и шесть самых затянутых остальных" />
        <DataTable caption="Моды комнаты" rowKey={(r) => r.n.join('-')} rows={shown} columns={[
          { key: 'f', title: 'Частота', numeric: true, render: (r) => hz(r.f) },
          { key: 'where', title: 'Где', render: (r) => r.where },
          { key: 'kind', title: 'Вид', render: (r) => `${KIND[r.kind]}${r.degenerate ? ', совпадает с соседней' : ''}` },
          { key: 'n', title: 'Индексы', render: (r) => r.n.join(' ') },
          { key: 'lambda', title: 'Длина волны', numeric: true, render: (r) => metres(r.lambda) },
          { key: 't60', title: 'Затухание', numeric: true, render: (r) => (r.t60 === null ? '—' : r.limit !== null && r.t60 > r.limit
            ? <Badge tone="warning" icon={false}>{`${n2(r.t60)} с > ${n2(r.limit)} с`}</Badge> : `${n2(r.t60)} с`) },
          { key: 'q', title: 'Добротность', numeric: true, render: (r) => (r.q === null ? '—' : n1(r.q)) },
          { key: 'bw', title: 'Полоса −3 дБ', numeric: true, render: (r) => (r.bandwidth === null ? '—' : hz(r.bandwidth)) },
        ]} />
        <p class="al-text-small al-text-secondary">
          Добротность и полоса — по затуханию изолированного резонанса: Q = π·f·T60/6,91 (≈ T60·f/2,2), полоса = f/Q. Для близко расположенных мод это приближение. Допуск — больше из допуска EBU Tech 3276 для объёма комнаты и порога заметности затянутой моды.
        </p>
      </Block>

      <Block title="Пропорции комнаты">
        {notes.length ? <ul>{notes.map((n) => <li key={n}>{n}</li>)}</ul> : <p class="al-text-small al-text-secondary">Кратных и почти равных размеров нет.</p>}
        <p class="al-text-small">
          Критерий Бонелло (число мод в третьоктавных полосах не убывает с частотой): {bonello.ok ? <Badge tone="success" icon={false}>выполняется</Badge> : <Badge tone="warning" icon={false}>{`нарушен на ${bonello.violations.map((f) => hz(f)).join(', ')}`}</Badge>}
        </p>
      </Block>

      <p class="al-text-small al-text-secondary">
        Карта качества баса по месту слушателя — в разделе <a href={roomHref(p.h.room!.id, 'analysis', 'listeners')}>«Места прослушивания»</a>, по месту сабвуфера — в разделе <a href={roomHref(p.h.room!.id, 'analysis', 'subwoofers')}>«Сабвуферы»</a>.
      </p>
      <Limits items={[...a.provenance.limitations, ...a.provenance.warnings, 'Моды — аналитические, для прямоугольной оболочки; скос, проёмы и смежные зоны учитывает волновая модель отклика.']} />
    </div>
  );
}
