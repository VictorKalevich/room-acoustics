// Раздел «Эхо и реверберация» (V2-033): Сэбин и Эйринг по октавам (ядро reverb.ts), эквивалентная площадь
// поглощения и вклад поверхностей, частота Шрёдера, ориентир времени реверберации, риск порхающего эха.
import { useMemo, useState } from 'preact/hooks';
import { BarChart, Badge, DataTable, KeyValue, Notice, SelectField, type BarSeries } from '../../design-system';
import { rtBand } from '../../../core/overview';
import { calcReverb } from '../../adapters/calculations';
import { SURFACE_LABEL } from '../../application/editing';
import { absorptionShares, flutterRisk } from '../../application/analysis';
import { useApp } from '../../shared/context';
import { Block, Limits, hz, n0, n1, n2, type AnalysisProps } from './common';

const band = (f: number) => (f >= 1000 ? `${f / 1000} кГц` : `${f} Гц`);
const SHARE_F = ['125', '500', '2000'] as const;

export function ReverbSection(p: AnalysisProps) {
  const { clock } = useApp();
  const c = p.edit.config;
  const rev = useMemo(() => calcReverb(c, clock.now()), [c, clock]);
  const other = useMemo(() => (p.other ? calcReverb(p.other.config, clock.now()) : null), [p.other, clock]);
  const [shareF, setShareF] = useState<(typeof SHARE_F)[number]>('500');
  const shares = useMemo(() => (rev.ok ? absorptionShares(c, Number(shareF)) : []), [c, rev.ok, shareF]);
  if (!rev.ok) return <Notice tone="warning">{rev.reason}</Notice>;
  const r = rev.result.value;
  const o = other?.ok ? other.result.value : null;
  const [lo, hi] = rtBand(r.volume);
  const flutter = flutterRisk(c);
  const total = shares.reduce((s, x) => s + x.area, 0);
  const series: BarSeries[] = [
    { id: 'sel', label: p.label, kind: 'calculated', values: r.used },
    ...(o && p.other ? [{ id: 'other', label: p.other.label, kind: 'estimated' as const, values: o.used }] : []),
  ];
  const tone = r.tMid > hi || r.tMid < lo ? 'warning' : 'success';
  return (
    <div class="al-stack al-stack--24">
      <Block title="Время реверберации" subtitle="Статистический расчёт для диффузного поля. Ниже частоты Шрёдера время спада определяют отдельные моды (раздел «Качество баса»).">
        <BarChart title="Время реверберации по октавам, Гц" unit="с" categories={r.bands.map((f) => (f >= 1000 ? `${f / 1000}k` : String(f)))} series={series} />
        <KeyValue items={[
          [`500–1000 Гц${o ? `: ${p.label.toLowerCase()}` : ''}`, <Badge key="t" tone={tone} icon={false}>{`${n2(r.tMid)} с`}</Badge>],
          ...(o && p.other ? [[`500–1000 Гц: ${p.other.label.toLowerCase()}`, `${n2(o.tMid)} с`] as [string, string]] : []),
          ['Ориентир', `${n2(lo)}–${n2(hi)} с`],
          ['Частота Шрёдера', `≈ ${hz(r.schroeder)}`],
          ['Объём', `${n1(r.volume)} м³`],
          ['Площадь поверхностей', `${n1(r.surfaceArea)} м²`],
        ]} />
        <p class="al-text-small al-text-secondary">Ориентир — для домашнего прослушивания в комнате такого объёма, по EBU Tech 3276; это не обязательная норма. Частота Шрёдера — приблизительная переходная область, а не граница.</p>
      </Block>
      <Block title="По октавам">
        <DataTable caption="Реверберация по октавам" rowKey={(k) => String(k)} rows={r.bands.map((_, k) => k)} columns={[
          { key: 'f', title: 'Полоса', render: (k) => band(r.bands[k]) },
          { key: 's', title: 'Сэбин', numeric: true, render: (k) => `${n2(r.sabine[k])} с` },
          { key: 'e', title: 'Эйринг', numeric: true, render: (k) => `${n2(r.eyring[k])} с` },
          { key: 'u', title: 'Принято', numeric: true, render: (k) => `${n2(r.used[k])} с · ${r.formula[k] === 'sabine' ? 'Сэбин' : 'Эйринг'}` },
          { key: 'a', title: 'Средний α', numeric: true, render: (k) => n2(r.meanAlpha[k]) },
          { key: 'A', title: 'Поглощение A', numeric: true, render: (k) => `${n1(r.absorptionArea[k])} м²` },
        ]} />
        <p class="al-text-small al-text-secondary">Ядро берёт Эйринга, когда средний коэффициент поглощения больше 0,2, иначе — Сэбина; поглощение воздуха учитывается на 1–4 кГц.</p>
      </Block>
      <Block title="Вклад поверхностей в поглощение">
        <SelectField label="Частота" value={shareF} onChange={setShareF} options={SHARE_F.map((f) => ({ value: f, label: band(Number(f)) }))} />
        <DataTable caption="Вклад поверхностей в поглощение" rowKey={(x) => x.id} rows={[...shares].sort((a, b) => b.area - a.area)} columns={[
          { key: 's', title: 'Поверхность', render: (x) => x.label },
          { key: 'a', title: 'A, м²', numeric: true, render: (x) => n1(x.area) },
          { key: 'p', title: 'Доля', numeric: true, render: (x) => `${n0((x.area / (total || 1)) * 100)} %` },
        ]} />
        <p class="al-text-small al-text-secondary">Отделка, доля обстановки, окна, двери, проёмы и обработка на поверхности.</p>
      </Block>
      <Block title="Порхающее эхо" subtitle="Повторяющееся эхо между параллельными отражающими поверхностями. Оценка по материалам; проверяется хлопком в комнате.">
        {flutter.length === 0 ? <p class="al-text-small">Пар параллельных голых отражающих поверхностей нет.</p> : (
          <DataTable caption="Пары, где возможно порхающее эхо" rowKey={(f) => `${f.a}-${f.b}`} rows={flutter} columns={[
            { key: 'pair', title: 'Поверхности', render: (f) => `${SURFACE_LABEL[f.a]} — ${SURFACE_LABEL[f.b].toLowerCase()}` },
            { key: 'd', title: 'Расстояние', numeric: true, render: (f) => `${n2(f.distance)} м` },
            { key: 'rep', title: 'Повтор', numeric: true, render: (f) => `каждые ${n1(f.repeatMs)} мс` },
            { key: 'a', title: 'α на 2 кГц', numeric: true, render: (f) => `${n2(f.alphaA)} · ${n2(f.alphaB)}` },
          ]} />
        )}
      </Block>
      <Limits items={[
        ...rev.result.provenance.limitations,
        'В небольших комнатах и на низких частотах поле не диффузное: статистические формулы дают ориентир, а не точное значение.',
        'Модели Фицроя и Арау-Пучадеса, EDT, T20 и T30 по измерению — в следующих версиях.',
      ]} />
    </div>
  );
}
