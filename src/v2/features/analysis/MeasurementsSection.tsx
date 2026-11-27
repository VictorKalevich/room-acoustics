// Раздел «Измерения» (V2-035): замеры комнаты с привязкой к конфигурации и снимку, исходная АЧХ и сравнение с моделью
// выбранной конфигурации (ядро measure.ts в фоновом воркере). Исходные данные только читаются.
// V2-049: точка и источники замера, поздняя привязка, среднее по точкам, время прихода по петле.
import { useEffect, useState } from 'preact/hooks';
import { Badge, BarChart, Button, Checkbox, DataTable, Dialog, EmptyState, FrequencyChart, KeyValue, LoadingState, Notice, SelectField, buttonClass, useToast, type Series } from '../../design-system';
import type { CalibrationResult, Comparison } from '../../../core/measure';
import { toCore } from '../../adapters/core';
import { MEASUREMENT_KIND, configOf } from '../../application/experiment';
import type { MeasurementData, MeasurementRecord } from '../../domain/measurement';
import { hashInputs } from '../../domain/provenance';
import { setupKey } from '../../adapters/calculations';
import { addMeasurement, measurementData, roomRecords, updateMeasurement } from '../../storage/history';
import { applyCalibration, pointOptions, resetCalibration } from '../../application/measure';
import { applyProposal } from '../../application/experiment';
import { visibleAt } from '../../domain/complexity';
import { alignment, averagePoints, averageRecord, rebind, type PointAverage } from '../../application/offline';
import type { Room } from '../../domain/model';
import { useApp } from '../../shared/context';
import { dateTime } from '../../shared/format';
import { href } from '../../shared/router';
import { Block, analysisStatus, hz, n1, n2, type AnalysisProps } from './common';
import type { Leakage } from '../../../core/types';

const LEAK: Record<Leakage, string> = { sealed: 'закрыта наглухо', typical: 'обычная, двери закрыты', door: 'открытая дверь', open: 'открытая планировка' };
import { useJob } from './useJob';

export function MeasurementsSection(p: AnalysisProps) {
  const { db } = useApp();
  const room = p.h.room!;
  const [list, setList] = useState<MeasurementRecord[] | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [binding, setBinding] = useState<MeasurementRecord | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    void roomRecords(db, room.id).then((r) => alive && setList(r.measurements), () => alive && setList([]));
    return () => { alive = false; };
  }, [db, room.id, tick]);
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
          { key: 'point', title: 'Точка', render: (m) => m.point?.label ?? '—' },
          { key: 'src', title: 'Звучало', render: (m) => sourceNames(room, m.sourceIds) },
          { key: 'snap', title: 'Снимок модели', render: (m) => (m.snapshotId ? <Badge tone="success" icon={false}>при записи</Badge> : <Badge tone="neutral" icon={false}>{m.lateBinding ? 'нет, привязан позже' : 'нет'}</Badge>) },
          { key: 'show', title: 'График', render: (m) => <Button small variant={m.id === sel ? 'secondary' : 'ghost'} onClick={() => setSel(m.id === sel ? null : m.id)} aria-label={`Открыть замер ${m.name}`}>{m.id === sel ? 'Открыт' : 'Открыть'}</Button> },
          { key: 'bind', title: 'Привязка', render: (m) => <Button small variant="ghost" onClick={() => setBinding(m)} aria-label={`Привязать замер ${m.name}`}>Привязать</Button> },
        ]} />
      </Block>
      {current && <MeasurementView p={p} m={current} />}
      <PointsBlock room={room} list={list} onSaved={() => setTick((t) => t + 1)} />
      <AlignmentBlock room={room} list={list} />
      {binding && <BindDialog room={room} m={binding} onClose={() => setBinding(null)} onSaved={() => { setBinding(null); setTick((t) => t + 1); }} />}
      <Notice title="Другие графики">Фаза, импульсная характеристика, ETC, водопад, спектрограмма, групповая задержка и искажения появятся вместе с записью импульсных характеристик: сейчас замеры хранят только АЧХ.</Notice>
    </div>
  );
}

function MeasurementView({ p, m }: { p: AnalysisProps; m: MeasurementRecord }) {
  const { db, compute, clock } = useApp();
  const toast = useToast();
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
  const calKey = canCompare ? hashInputs({ method: 'calibrate', measurement: m.id, input: setupKey(conv.inputs) }) : null;
  const [cal, startCal] = useJob<CalibrationResult>(calKey, (onProgress) => {
    if (!conv.ok || !data) return Promise.reject(new Error('Нет данных замера.'));
    const i = conv.inputs;
    return compute().run('calibrate', { room: i.room, sources: i.sources, constraints: i.constraints, setup: i.setup, measurement: { name: m.name, importedAt: m.recordedAt ?? '', f: data.f, db: data.db, points: m.points } }, { onProgress });
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
        {m.kind === 'frequency-response' && conv.ok && visibleAt('advanced', p.level) && (
          <div class="al-stack al-stack--12">
            <h3 class="al-text-lead">Подстройка модели по замеру</h3>
            <p class="al-text-small al-text-secondary">Ядро подбирает множитель затухания мод (0,3–3,2) и, в прямоугольной модели, герметичность так, чтобы модель на месте слушателя ближе совпала с замером. Подстройка меняет поглощение модели, а не геометрию; применяется к эксперименту, текущая конфигурация не меняется.</p>
            {m.point && m.point.listenerId !== c.listening.listeners.find((x) => x.primary)?.id && <Notice tone="warning">{`Замер сделан не на основном месте («${m.point.label}»), а модель сравнивается на основном: подстройка может быть неверной.`}</Notice>}
            {c.simulation.calibration && (
              <Notice title="Модель уже подстроена" action={<Button small onClick={() => void p.edit.apply(resetCalibration, 'Сброс подстройки')}>Сбросить подстройку</Button>}>
                {`${c.simulation.calibration.source ? `По замеру «${c.simulation.calibration.source}». ` : ''}Множитель затухания ×${n2(c.simulation.calibration.dampingScale)}.`}
              </Notice>
            )}
            {cal.status !== 'ready' ? analysisStatus(cal, startCal, 'Подстройка считается по запросу: несколько расчётов модели в фоне.') : (
              <>
                <KeyValue items={[
                  ['Множитель затухания', `×${n2(cal.value.dampingScale)}`],
                  ['Герметичность', LEAK[cal.value.leakage]],
                  ['Расхождение до', `${n1(cal.value.rmsBefore)} дБ`],
                  ['Расхождение после', `${n1(cal.value.rmsAfter)} дБ`],
                ]} />
                {(cal.value.dampingScale <= 0.32 || cal.value.dampingScale >= 3.1) && <Notice tone="warning">Множитель у границы диапазона: замер, вероятно, плохо соответствует модели — другое место микрофона, другая комната или сильное сглаживание. Проверьте модель, прежде чем применять.</Notice>}
                {cal.value.rmsAfter >= cal.value.rmsBefore - 0.2
                  ? <Notice>Подстройка почти не уменьшает расхождение: применять её незачем. Расхождение, вероятно, из-за геометрии, положения или замера.</Notice>
                  : (
                    <div class="al-row">
                      <Button variant="primary" onClick={() => void (async () => {
                        const apply = (x: typeof c) => applyCalibration(x, cal.value, m.name);
                        const ok = p.h.role === 'experimental' ? await p.edit.apply(apply, 'Подстройка по замеру') : await p.h.edit((r) => applyProposal(r, apply, clock.newId, clock.now()), 'Подстройка по замеру');
                        if (ok) toast.show(p.h.role === 'experimental' ? 'Подстройка применена к эксперименту' : 'Подстройка применена в эксперимент: сравните его с текущей');
                      })()}>{p.h.role === 'experimental' ? 'Применить к эксперименту' : 'Применить в эксперимент'}</Button>
                    </div>
                  )}
              </>
            )}
          </div>
        )}
      </div>
    </Block>
  );
}

function sourceNames(room: Room, ids: readonly string[] | undefined): string {
  if (!ids?.length) return '—';
  const all = [...room.current.audio.sources, ...(room.experimental?.audio.sources ?? [])];
  return ids.map((id) => all.find((s) => s.id === id)?.name ?? 'удалён').join(', ');
}

/** Поздняя привязка: конфигурация, точка микрофона и источники; исходные данные не меняются. */
function BindDialog({ room, m, onClose, onSaved }: { room: Room; m: MeasurementRecord; onClose: () => void; onSaved: () => void }) {
  const { db, clock } = useApp();
  const toast = useToast();
  const [configId, setConfigId] = useState(m.configId ?? '');
  const config = configId === room.experimental?.id ? room.experimental : room.current;
  const points = pointOptions(config);
  const [point, setPoint] = useState(m.point ? (m.point.listenerId ?? '__keep') : '');
  const [src, setSrc] = useState(m.sourceIds?.length === 1 ? m.sourceIds[0] : m.sourceIds?.length ? 'all' : '');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const p = points.find((x) => x.listenerId === point);
      const sourceIds = src === 'all' ? config.audio.sources.map((s) => s.id) : src ? [src] : [];
      const next = rebind(m, { configId: configId || null, sourceIds }, clock.now());
      if (p) next.point = p;
      else if (!point) delete next.point;
      await updateMeasurement(db, next);
      toast.show('Привязка замера сохранена');
      onSaved();
    } catch (e) {
      toast.show((e as Error).message, { tone: 'error' });
      setBusy(false);
    }
  };
  return (
    <Dialog title={`Привязка замера «${m.name}»`} onClose={onClose} actions={<>
      <Button variant="ghost" onClick={onClose}>Отмена</Button>
      <Button variant="primary" busy={busy} onClick={() => void save()}>Сохранить</Button>
    </>}>
      <div class="al-stack al-stack--12">
        <p class="al-text-small al-text-secondary">Исходные данные замера не меняются. Привязка отмечается как поздняя: снимок модели на момент записи не появляется.</p>
        <SelectField label="Конфигурация" value={configId} onChange={(v) => { setConfigId(v); setPoint(''); setSrc(''); }}
          options={[{ value: '', label: 'Неизвестна' }, { value: room.current.id, label: 'Текущая' }, ...(room.experimental ? [{ value: room.experimental.id, label: 'Эксперимент' }] : [])]} />
        <SelectField label="Точка микрофона" value={point} onChange={setPoint} options={[
          { value: '', label: 'Не указана' }, ...points.map((x) => ({ value: x.listenerId!, label: x.label })),
          ...(m.point && !m.point.listenerId ? [{ value: '__keep', label: `${m.point.label} (как было)` }] : []),
        ]} />
        <SelectField label="Что звучало" value={src} onChange={setSrc} options={[{ value: '', label: 'Не указано' }, { value: 'all', label: 'Все источники' }, ...config.audio.sources.map((s) => ({ value: s.id, label: s.name }))]} />
      </div>
    </Dialog>
  );
}

/** Среднее по точкам (V2-049): выбранные АЧХ усредняются по мощности; результат — новый замер. */
function PointsBlock({ room, list, onSaved }: { room: Room; list: MeasurementRecord[]; onSaved: () => void }) {
  const { db, clock } = useApp();
  const toast = useToast();
  const fr = list.filter((m) => m.kind === 'frequency-response' && m.source.kind !== 'derived');
  const [picked, setPicked] = useState<string[]>([]);
  const [avg, setAvg] = useState<PointAverage | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (fr.length < 2) return null;
  const chosen = fr.filter((m) => picked.includes(m.id));
  const toggle = (id: string, on: boolean) => { setPicked(on ? [...picked, id] : picked.filter((x) => x !== id)); setAvg(null); setError(null); };
  const build = async () => {
    try {
      const datas = await Promise.all(chosen.map((m) => measurementData(db, m.id)));
      if (datas.some((d) => !d)) throw new Error('Исходные данные одного из замеров не найдены.');
      setAvg(averagePoints(datas as MeasurementData[]));
      setError(null);
    } catch (e) {
      setAvg(null);
      setError((e as Error).message);
    }
  };
  const save = async () => {
    if (!avg) return;
    const { rec, data } = averageRecord(chosen, avg, clock.newId(), clock.now());
    await addMeasurement(db, rec, data);
    toast.show(`Сохранено: ${rec.name}`);
    setPicked([]);
    setAvg(null);
    onSaved();
  };
  const spread = avg ? Math.max(...avg.max.map((v, i) => v - avg.min[i])) : 0;
  const configs = new Set(chosen.map((m) => m.configId));
  return (
    <Block title="Несколько точек" subtitle="Среднее по мощности АЧХ из разных точек — оценка для зоны прослушивания, а не для одного места. Исходные замеры не меняются.">
      <div class="al-stack al-stack--8" role="group" aria-label="Замеры для среднего">
        {fr.map((m) => <Checkbox key={m.id} label={`${m.name}${m.point ? ` · ${m.point.label}` : ''}${m.recordedAt ? ` · ${dateTime(m.recordedAt)}` : ''}`} checked={picked.includes(m.id)} onChange={(v) => toggle(m.id, v)} />)}
      </div>
      {configs.size > 1 && <Notice tone="warning">Выбраны замеры разных конфигураций: среднее смешает их.</Notice>}
      <div class="al-row">
        <Button disabled={chosen.length < 2} onClick={() => void build()}>{`Усреднить (${chosen.length})`}</Button>
        {avg && <Button variant="primary" icon="download" onClick={() => void save()}>Сохранить среднее</Button>}
      </div>
      {error && <Notice tone="warning">{error}</Notice>}
      {avg && (
        <>
          <FrequencyChart title="Среднее по точкам и разброс" fMin={Math.max(15, avg.f[0])} fMax={avg.f[avg.f.length - 1]} series={[
            { id: 'avg', label: `Среднее по ${avg.count} точкам`, kind: 'measured', x: avg.f, y: avg.db },
            { id: 'min', label: 'Наименьший уровень', kind: 'measured', variant: 3, x: avg.f, y: avg.min },
            { id: 'max', label: 'Наибольший уровень', kind: 'measured', variant: 2, x: avg.f, y: avg.max },
          ]} />
          <KeyValue items={[['Точек', String(avg.count)], ['Наибольший разброс', `${n1(spread)} дБ`], ['Полоса', `${hz(avg.f[0])}–${hz(avg.f[avg.f.length - 1])}`]]} />
          <p class="al-text-small al-text-secondary">Уровни не выравниваются: среднее верно, если громкость и усиление между точками не менялись. Большой разброс на басу — признак мод: место слушателя важнее эквализации.</p>
        </>
      )}
      <p class="al-text-small al-text-secondary">{`Замеров АЧХ в комнате: ${fr.length}. Точку и источник замера можно указать кнопкой «Привязать».`}{room.current.listening.listeners.length > 1 ? '' : ' Места слушателей добавляются в модели, раздел «Места».'}</p>
    </Block>
  );
}

/** Время прихода по петле (V2-049): какие источники выровнять задержкой в каждой точке. */
function AlignmentBlock({ room, list }: { room: Room; list: MeasurementRecord[] }) {
  const groups = alignment(list);
  if (!groups.length) return null;
  const model = (m: MeasurementRecord | undefined) => {
    if (!m?.point?.position || m.sourceIds?.length !== 1) return null;
    const cfg = m.configId === room.experimental?.id ? room.experimental : room.current;
    const s = cfg.audio.sources.find((x) => x.id === m.sourceIds![0]);
    if (!s) return null;
    const a = s.position, b = m.point.position;
    return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  };
  return (
    <Block title="Время прихода" subtitle="По замерам с петлёй (loopback): время пролёта звука от источника до микрофона. Чтобы звук приходил одновременно, ранним источникам добавляют задержку.">
      {groups.map((g) => (
        <div key={g.point} class="al-stack al-stack--8">
          <h3 class="al-text-lead">{g.point}</h3>
          <DataTable caption={`Время прихода: ${g.point}`} rowKey={(r) => r.id} rows={g.rows} columns={[
            { key: 'name', title: 'Замер', render: (r) => r.name },
            { key: 'src', title: 'Звучало', render: (r) => sourceNames(room, r.sourceIds) },
            { key: 't', title: 'Время пролёта', numeric: true, render: (r) => `${n2(r.arrivalMs)} мс` },
            { key: 'd', title: 'Расстояние', numeric: true, render: (r) => `${n2(r.distance)} м` },
            { key: 'model', title: 'По модели', numeric: true, render: (r) => { const d = model(list.find((m) => m.id === r.id)); return d === null ? '—' : `${n2(d)} м`; } },
            { key: 'add', title: 'Добавить задержку', numeric: true, render: (r) => (r.addMs > 0.05 ? `${n2(r.addMs)} мс` : 'не нужно') },
          ]} />
        </div>
      ))}
      <p class="al-text-small al-text-secondary">Расстояние — по времени пролёта при 20 °C. У сабвуфера в пик входит групповая задержка его фильтров, поэтому он кажется дальше, чем стоит: выравнивают именно это время. Если расстояние колонки сильно отличается от модели — проверьте её положение в модели.</p>
    </Block>
  );
}
