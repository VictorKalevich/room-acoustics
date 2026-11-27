// Раздел «Эхо и реверберация» (V2-033): Сэбин и Эйринг по октавам (ядро reverb.ts), эквивалентная площадь
// поглощения и вклад поверхностей, частота Шрёдера, ориентир времени реверберации, риск порхающего эха.
// Продвинутый уровень (V2-048): модели Фицроя и Арау-Пучадеса, ясность и прямой звук по Баррону.
import { useMemo, useState } from 'preact/hooks';
import { BarChart, Badge, DataTable, FrequencyChart, KeyValue, Notice, SelectField, type BarSeries } from '../../design-system';
import { rtBand } from '../../../core/overview';
import { calcReverb } from '../../adapters/calculations';
import { SURFACE_LABEL } from '../../application/editing';
import { absorptionShares, flutterRisk } from '../../application/analysis';
import { clarity, reverbModels, type ReverbModels } from '../../application/models';
import { visibleAt } from '../../domain/complexity';
import type { RoomConfiguration } from '../../domain/model';
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
  const adv = visibleAt('advanced', p.level);
  const models = useMemo(() => (rev.ok && adv ? reverbModels(c) : null), [c, rev.ok, adv]);
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
      {models && <ModelsBlock m={models} />}
      {models && <ClarityBlock c={c} m={models} />}
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
        adv ? 'Фицрой и Арау-Пучадес — тоже статистические модели прямоугольной комнаты: они учитывают распределение поглощения по парам поверхностей, но не моды и не рассеивание. Ясность по Баррону — для диффузного поля, ниже частоты Шрёдера не считается.'
          : 'Модели Фицроя и Арау-Пучадеса, ясность C50 и C80 и отношение прямого звука к отражённому — на продвинутом уровне.',
        'Расчётные EDT и T30 не выводятся. RT60 (T20) измеряет инструмент «Измерение затухания»: замер появляется в разделе «Измерения».',
      ]} />
    </div>
  );
}

const pct = (v: number) => `${n0((v - 1) * 100)} %`;

function ModelsBlock({ m }: { m: ReverbModels }) {
  const i500 = m.bands.indexOf(500);
  const top = Math.max(0.5, Math.ceil(Math.max(...m.sabine, ...m.eyring, ...m.fitzroy, ...m.arau) * 1.2 * 4) / 4);
  return (
    <Block title="Модели реверберации" subtitle="Сэбин и Эйринг предполагают равномерное поглощение. Фицрой и Арау-Пучадес учитывают, на каких парах поверхностей оно сосредоточено — например, ковёр и акустический потолок при голых стенах.">
      <FrequencyChart title="Время реверберации по моделям" fMin={50} fMax={5000} yUnit="с" yRange={[0, top]} series={[
        { id: 's', label: 'Сэбин', kind: 'calculated', x: m.bands, y: m.sabine },
        { id: 'e', label: 'Эйринг', kind: 'calculated', variant: 2, x: m.bands, y: m.eyring },
        { id: 'f', label: 'Фицрой', kind: 'calculated', variant: 3, x: m.bands, y: m.fitzroy },
        { id: 'a', label: 'Арау-Пучадес', kind: 'calculated', variant: 4, x: m.bands, y: m.arau },
      ]} />
      <DataTable caption="Модели реверберации по октавам" rowKey={(k) => String(k)} rows={m.bands.map((_, k) => k)} columns={[
        { key: 'f', title: 'Полоса', render: (k) => band(m.bands[k]) },
        { key: 's', title: 'Сэбин', numeric: true, render: (k) => `${n2(m.sabine[k])} с` },
        { key: 'e', title: 'Эйринг', numeric: true, render: (k) => `${n2(m.eyring[k])} с` },
        { key: 'fz', title: 'Фицрой', numeric: true, render: (k) => `${n2(m.fitzroy[k])} с` },
        { key: 'ap', title: 'Арау-Пучадес', numeric: true, render: (k) => `${n2(m.arau[k])} с` },
        { key: 'd', title: 'Разброс', numeric: true, render: (k) => (m.spread[k] > 1.25 ? <Badge tone="warning" icon={false}>{pct(m.spread[k])}</Badge> : pct(m.spread[k])) },
      ]} />
      <KeyValue items={[
        ['Передняя и задняя стены', `ᾱ ${n2(m.pairAlpha.x[i500])} · ${n0(m.pairShare.x * 100)} % площади`],
        ['Левая и правая стены', `ᾱ ${n2(m.pairAlpha.y[i500])} · ${n0(m.pairShare.y * 100)} % площади`],
        ['Пол и потолок', `ᾱ ${n2(m.pairAlpha.z[i500])} · ${n0(m.pairShare.z * 100)} % площади`],
      ]} />
      <p class="al-text-small al-text-secondary">ᾱ — средний коэффициент поглощения пары на 500 Гц (по ядру: отделка, обстановка, окна, двери, проёмы, обработка). Разброс — насколько самая длинная оценка больше самой короткой; больше 25 % — поглощение распределено неравномерно, и ориентиром служит диапазон моделей, а не одно число. В остальных разделах используется время, принятое ядром.</p>
    </Block>
  );
}

function ClarityBlock({ c, m }: { c: RoomConfiguration; m: ReverbModels }) {
  const speakers = c.audio.sources.filter((s) => s.kind === 'speaker');
  const [sel, setSel] = useState('');
  const src = speakers.find((s) => s.id === sel) ?? speakers[0];
  const cl = useMemo(() => (src ? clarity(c, m, src.id) : null), [c, m, src]);
  if (!src || !cl) return <Block title="Ясность и прямой звук"><p class="al-text-small">Нет колонок — показатели не считаются.</p></Block>;
  const db = (v: number | null) => (v === null ? '—' : `${v > 0 ? '+' : ''}${n1(v)} дБ`);
  return (
    <Block title="Ясность и прямой звук" subtitle="Оценка на основном месте по пересмотренной теории Баррона: прямой звук колонки и отражённое поле с временем реверберации, принятым ядром. Это расчёт для диффузного поля, а не измерение.">
      {speakers.length > 1 && <SelectField label="Колонка" value={src.id} onChange={setSel} options={speakers.map((s) => ({ value: s.id, label: s.name }))} />}
      <DataTable caption="Ясность и прямой звук по октавам" rowKey={(b) => String(b.f)} rows={cl.bands} columns={[
        { key: 'f', title: 'Полоса', render: (b) => band(b.f) },
        { key: 'c50', title: 'C50', numeric: true, render: (b) => db(b.c50) },
        { key: 'c80', title: 'C80', numeric: true, render: (b) => db(b.c80) },
        { key: 'd50', title: 'D50', numeric: true, render: (b) => (b.d50 === null ? '—' : `${n0(b.d50 * 100)} %`) },
        { key: 'drr', title: 'Прямой / отражённый', numeric: true, render: (b) => db(b.drr) },
        { key: 'rc', title: 'Радиус гулкости', numeric: true, render: (b) => (b.critical === null ? '—' : `${n2(b.critical)} м`) },
      ]} />
      <p class="al-text-small al-text-secondary">{`До колонки ${n2(cl.distance)} м. C50 и C80 — отношение энергии первых 50 и 80 мс к остальной, D50 — доля первых 50 мс. Радиус гулкости — расстояние, где прямой звук равен отражённому; дальше него преобладает комната. «—» — полоса ниже частоты Шрёдера (≈ ${hz(m.schroeder)}), где поле не диффузное.${src.directivity?.kind === 'parametric' ? ' Учтена направленность колонки из её профиля.' : ' Колонка считается всенаправленной; направленность задаётся в профиле оборудования.'}`}</p>
    </Block>
  );
}
