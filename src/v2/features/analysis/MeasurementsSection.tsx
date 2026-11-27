// Раздел «Измерения» (V2-035): замеры комнаты с привязкой к конфигурации и снимку, исходная АЧХ и сравнение с моделью
// выбранной конфигурации (ядро measure.ts в фоновом воркере). Исходные данные только читаются.
import { useEffect, useState } from 'preact/hooks';
import { Badge, BarChart, Button, DataTable, EmptyState, FrequencyChart, KeyValue, LoadingState, Notice, buttonClass, type Series } from '../../design-system';
import type { Comparison } from '../../../core/measure';
import { toCore } from '../../adapters/core';
import { MEASUREMENT_KIND, configOf } from '../../application/experiment';
import type { MeasurementData, MeasurementRecord } from '../../domain/measurement';
import { hashInputs } from '../../domain/provenance';
import { setupKey } from '../../adapters/calculations';
import { measurementData, roomRecords } from '../../storage/history';
import { useApp } from '../../shared/context';
import { dateTime } from '../../shared/format';
import { href } from '../../shared/router';
import { Block, analysisStatus, hz, n1, type AnalysisProps } from './common';
import { useJob } from './useJob';

export function MeasurementsSection(p: AnalysisProps) {
  const { db } = useApp();
  const room = p.h.room!;
  const [list, setList] = useState<MeasurementRecord[] | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void roomRecords(db, room.id).then((r) => alive && setList(r.measurements), () => alive && setList([]));
    return () => { alive = false; };
  }, [db, room.id]);
  if (!list) return <LoadingState />;
  if (!list.length) {
    return <EmptyState icon="measure" title="Измерений нет" text="Замеры комнаты появятся здесь после записи или импорта. Перенесённые из прежней версии замеры уже были бы в списке."
      action={<a class={buttonClass('secondary')} href={href({ name: 'tools' })}>Инструменты</a>} />;
  }
  const current = list.find((m) => m.id === sel) ?? null;
  return (
    <div class="al-stack al-stack--24">
      <Block title="Замеры комнаты" subtitle="Исходные записи не меняются: сравнение и обработка строятся поверх них.">
        <DataTable caption="Замеры комнаты" rowKey={(m) => m.id} rows={list} columns={[
          { key: 'name', title: 'Замер', render: (m) => `${m.name} · ${MEASUREMENT_KIND[m.kind]}` },
          { key: 'date', title: 'Когда', render: (m) => (m.recordedAt ? dateTime(m.recordedAt) : '—') },
          { key: 'range', title: 'Полоса', numeric: true, render: (m) => `${hz(m.summary.fMin)}–${hz(m.summary.fMax)}` },
          { key: 'cfg', title: 'Конфигурация', render: (m) => configOf(room, m.configId) },
          { key: 'snap', title: 'Снимок модели', render: (m) => (m.snapshotId ? <Badge tone="success" icon={false}>при записи</Badge> : <Badge tone="neutral" icon={false}>{m.lateBinding ? 'нет, привязан позже' : 'нет'}</Badge>) },
          { key: 'show', title: 'График', render: (m) => <Button small variant={m.id === sel ? 'secondary' : 'ghost'} onClick={() => setSel(m.id === sel ? null : m.id)} aria-label={`Открыть замер ${m.name}`}>{m.id === sel ? 'Открыт' : 'Открыть'}</Button> },
        ]} />
      </Block>
      {current && <MeasurementView p={p} m={current} />}
      <Notice title="Другие графики">Фаза, импульсная характеристика, ETC, водопад, спектрограмма, групповая задержка и искажения появятся вместе с записью импульсных характеристик: сейчас замеры хранят только АЧХ.</Notice>
    </div>
  );
}

function MeasurementView({ p, m }: { p: AnalysisProps; m: MeasurementRecord }) {
  const { db, compute } = useApp();
  const [data, setData] = useState<MeasurementData | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    setData(undefined);
    void measurementData(db, m.id).then((d) => alive && setData(d), () => alive && setData(null));
    return () => { alive = false; };
  }, [db, m.id]);
  const c = p.edit.config;
  const conv = toCore(c);
  const canCompare = !!data && conv.ok && m.kind === 'frequency-response';
  const key = canCompare ? hashInputs({ method: 'compareMeasurement', measurement: m.id, input: setupKey(conv.inputs) }) : null;
  const [job, start] = useJob<Comparison>(key, (onProgress) => {
    if (!conv.ok || !data) return Promise.reject(new Error('Нет данных замера.'));
    const i = conv.inputs;
    return compute().run('compare', { room: i.room, sources: i.sources, constraints: i.constraints, setup: i.setup, measurement: { name: m.name, importedAt: m.recordedAt ?? '', f: data.f, db: data.db, points: m.points } }, { onProgress });
  });
  if (data === undefined) return <LoadingState />;
  if (data === null) return <Notice tone="warning">Исходные данные замера не найдены.</Notice>;
  const sameConfig = m.configId === c.id;
  const series: Series[] = [{ id: 'm', label: m.name, kind: 'measured', x: data.f, y: data.db }];
  const cmp: Series[] = job.status === 'ready' ? [
    { id: 'meas', label: 'Замер, сглажено', kind: 'measured', x: job.value.f, y: job.value.measured },
    { id: 'model', label: `Модель: ${p.label.toLowerCase()}`, kind: 'calculated', x: job.value.f, y: job.value.model },
  ] : [];
  return (
    <Block title={`Замер «${m.name}»`} subtitle={data.rt60 ? `${MEASUREMENT_KIND[m.kind]}, секунды.` : `${MEASUREMENT_KIND[m.kind]}, ${data.ref}.`}>
      <div class="al-stack al-stack--16">
        {data.rt60 ? (
          <BarChart title={`Время реверберации по октавам, Гц: ${m.name}`} unit="с" categories={data.rt60.map((b) => (b.band >= 1000 ? `${b.band / 1000}k` : String(b.band)))}
            series={[{ id: 'rt', label: m.name, kind: 'measured', values: data.rt60.map((b) => b.t60) }]} />
        ) : <FrequencyChart title={`Исходный замер ${m.name}`} series={series} fMin={Math.max(15, Math.min(...data.f))} fMax={Math.min(20000, Math.max(...data.f))} />}
        {m.kind === 'frequency-response' && (
          <div class="al-stack al-stack--12">
            <h3 class="al-text-lead">Сравнение с моделью</h3>
            {!sameConfig && <Notice tone="warning">Замер сделан не для выбранной конфигурации ({configOf(p.h.room!, m.configId)}): расхождение может объясняться изменениями модели.</Notice>}
            {!conv.ok ? <Notice tone="warning">{conv.reason}</Notice> : job.status !== 'ready' ? analysisStatus(job, start, 'Сравнение считается по запросу.') : (
              <>
                <FrequencyChart title="Замер и модель" series={cmp} fMin={Math.max(15, job.value.f[0])} fMax={job.value.f[job.value.f.length - 1]} />
                <KeyValue items={[
                  ['Среднее расхождение (RMS)', `${n1(job.value.rms)} дБ`],
                  ['Модель', job.value.averaged ? 'среднее по точкам' : 'в одной точке'],
                ]} />
              </>
            )}
          </div>
        )}
      </div>
    </Block>
  );
}
