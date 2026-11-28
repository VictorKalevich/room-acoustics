// DSP комнаты (V2-043, V2-045): автоматическая эквализация по модели или последнему замеру этой конфигурации в
// четырёх сценариях с пределами частот, Gain, Q и числа фильтров; сравнение до и после, отключение фильтров,
// предусилитель против перегрузки; экспорт в Equalizer APO, REW, miniDSP, CamillaDSP, JSON и CSV и пресет для
// инструмента «Эквалайзер». Приложение звук системы не обрабатывает.
// V2-049: подобранная коррекция сохраняется в конфигурации (для текущей — через эксперимент) и попадает в отчёт.
import { useEffect, useState } from 'preact/hooks';
import { Button, FrequencyChart, KeyValue, Notice, NumberField, SegmentedControl, SelectField, Switch, buttonClass, useToast, type Series } from '../../design-system';
import { exportCamillaDSP } from '../../../core/camilla';
import { exportMiniDSP, exportREW } from '../../../core/eq';
import { measurementAt } from '../../../core/measure';
import { firLinearPhase, firMinPhase, linearPhaseLength, wavFloat32 } from '../../../core/dsp';
import { HOUSE_RISES } from '../../../core/houseCurve';
import type { HouseRise } from '../../../core/types';
import { toCore } from '../../adapters/core';
import { measuredOnGrid } from '../../application/advice';
import type { MeasurementData } from '../../domain/measurement';
import { measurementData } from '../../storage/history';
import { DEFAULT_LIMITS, EQ_SCENARIOS, EQ_SCENARIO_LABEL, autoEq, averageOnGrid, limitIssues, preampFor, toPeq, withFilters, type AutoEqResult, type EqLimits, type EqScenario } from '../../application/autoeq';
import { exportApo, type EqFilter } from '../../application/tools';
import { applyProposal } from '../../application/experiment';
import { setRoomDsp } from '../../application/measure';
import type { RoomDsp } from '../../domain/model';
import { dateTime } from '../../shared/format';
import { useApp } from '../../shared/context';
import { downloadBlob, downloadText, safeFileName } from '../../shared/files';
import { href } from '../../shared/router';
import { putEntry } from '../../storage/library';
import { Block, Gate, hz, n1, n2 } from '../analysis/common';
import type { AdviceData } from './useAdvice';

export interface DesignedEq { filters: EqFilter[]; source: string; preamp: number; configId: string; revision: number }
/** Последняя подобранная коррекция комнаты за сеанс — для отчёта. */
export const lastEq = new Map<string, DesignedEq>();

const SCENARIO_TEXT: Record<EqScenario, string> = {
  cut: 'Только срезы пиков: безопасно для запаса усилителя, провалы не трогаются.',
  gentle: 'Срезы пиков и небольшой подъём широких неглубоких провалов; глубокие и узкие провалы не поднимаются.',
  target: 'Как осторожная, но к выбранной целевой кривой с подъёмом низа.',
  multi: 'Осторожная коррекция по средней АЧХ нескольких замеров этой конфигурации (разные места): компромисс для всех мест.',
};
const RATES = [44100, 48000, 96000] as const;

export function DspSection({ d }: { d: AdviceData }) {
  return <Gate state={d.state}>{() => <DspBody d={d} />}</Gate>;
}

function DspBody({ d }: { d: AdviceData }) {
  const { clock, db } = useApp();
  const toast = useToast();
  const room = d.h.room!;
  const c = d.edit.config;
  const conv = toCore(c);
  const ev = d.state.status === 'ready' ? d.state.value.ev : null;
  const frs = (d.records?.measurements ?? []).filter((m) => m.configId === c.id && m.kind === 'frequency-response');
  const multiOk = frs.length >= 2;
  const [source, setSource] = useState<'model' | 'measured'>(d.measured ? 'measured' : 'model');
  const [scenario, setScenario] = useState<EqScenario>('cut');
  const [rise, setRise] = useState<HouseRise | 0>(c.simulation.houseCurve ?? 0);
  const [l, setL] = useState<EqLimits>({ ...DEFAULT_LIMITS, fLo: Math.max(DEFAULT_LIMITS.fLo, Math.round(ev?.fLo ?? 20)), fHi: Math.min(DEFAULT_LIMITS.fHi, Math.round(ev?.fHi ?? 200)) });
  const [res, setRes] = useState<AutoEqResult | null>(null);
  const [filters, setFilters] = useState<EqFilter[]>([]);
  const [fs, setFs] = useState<(typeof RATES)[number]>(48000);
  const [xo, setXo] = useState(false);
  const [all, setAll] = useState<MeasurementData[] | null>(null);
  useEffect(() => {
    let alive = true;
    if (scenario !== 'multi' || !multiOk) { setAll(null); return; }
    void Promise.all(frs.map((m) => measurementData(db, m.id))).then((xs) => alive && setAll(xs.filter((x): x is MeasurementData => !!x && x.f.length > 0)), () => alive && setAll([]));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, scenario, frs.map((m) => m.id).join()]);
  if (!ev || !conv.ok) return null;
  const multi = scenario === 'multi';
  const avg = multi && all && all.length >= 2 ? measuredOnGrid(ev.response, averageOnGrid(all.map((x) => measurementAt({ name: '', importedAt: '', f: x.f, db: x.db }, ev.response.f)))) : null;
  const useMeasured = multi || (source === 'measured' && !!d.measured);
  const issues = limitIssues(l);
  const sourceText = multi ? `среднему ${all?.length ?? frs.length} замеров` : useMeasured ? `замеру «${d.measured!.name}»` : 'модели';
  const run = () => {
    const resp = multi ? avg : useMeasured ? d.measured!.response : ev.response;
    if (!resp) return;
    const r = autoEq(resp, multi ? 'gentle' : scenario, l, { measured: useMeasured, rise, newId: clock.newId });
    setRes(r);
    setFilters(r.filters);
    lastEq.set(room.id, { filters: r.filters, source: sourceText, preamp: preampFor(r.filters), configId: c.id, revision: c.revision });
  };
  const update = (next: EqFilter[]) => {
    setFilters(next);
    lastEq.set(room.id, { filters: next, source: sourceText, preamp: preampFor(next), configId: c.id, revision: c.revision });
  };
  const after = res ? withFilters(res.f, res.before, filters) : [];
  const preamp = preampFor(filters);
  const name = safeFileName(`${room.name} EQ`);
  const peq = toPeq(filters);
  const series: Series[] = res ? [
    { id: 'b', label: 'До', kind: useMeasured ? 'measured' : 'current', x: res.f, y: res.before },
    { id: 'a', label: 'После', kind: 'calculated', x: res.f, y: after },
    { id: 't', label: 'Цель', kind: 'target', x: res.f, y: res.target },
  ] : [];
  const set = (patch: Partial<EqLimits>) => { setL({ ...l, ...patch }); setRes(null); };
  const exp = d.edit.role === 'experimental';
  const store = async (dsp: RoomDsp | null, label: string) => {
    const op = (x: typeof c) => setRoomDsp(x, dsp);
    const ok = exp || !dsp ? await d.edit.apply(op, label) : await d.h.edit((r) => applyProposal(r, op, clock.newId, clock.now()), label);
    if (ok) toast.show(!dsp ? 'Коррекция убрана из конфигурации' : exp ? 'Коррекция сохранена в эксперименте' : 'Коррекция сохранена в эксперимент: подтвердите его, когда загрузите фильтры в DSP');
  };
  return (
    <div class="al-stack al-stack--24">
      {c.dsp && <StoredDsp dsp={c.dsp} name={name} onRemove={() => void store(null, 'Коррекция комнаты убрана')} />}
      <Block title="Автоматическая эквализация" subtitle={`${d.label} конфигурация. Точные Gain и Q даёт только замер: по модели фильтры — начальная оценка.`}>
        {d.measured
          ? !multi && <SegmentedControl label="По чему подбирать" value={source} onChange={(v) => { setSource(v); setRes(null); }} options={[{ value: 'measured', label: 'По замеру' }, { value: 'model', label: 'По модели' }]} />
          : <p class="al-text-small al-text-secondary">Замера АЧХ этой конфигурации нет — подбор по модели. Замер сделайте инструментом «Измерение АЧХ свипом».</p>}
        <SegmentedControl label="Сценарий" value={scenario} onChange={(v) => { setScenario(v); setRes(null); }}
          options={EQ_SCENARIOS.map((x) => ({ value: x, label: EQ_SCENARIO_LABEL[x], disabled: x === 'multi' && !multiOk }))} />
        <p class="al-text-secondary">{SCENARIO_TEXT[scenario]}</p>
        {!multiOk && <p class="al-text-small al-text-secondary">«Несколько мест» — по двум и более замерам АЧХ этой конфигурации в разных точках. Модель и так усредняет места слушателей и точки вокруг головы.</p>}
        {multi && all && !avg && <Notice tone="warning">Замеры не перекрывают полосу расчёта — среднее не построить.</Notice>}
        <div class="al-grid al-grid--metrics">
          {scenario === 'target' && <SelectField label="Подъём низа цели" value={String(rise)} options={[{ value: '0', label: 'Ровная' }, ...HOUSE_RISES.map((r) => ({ value: String(r), label: `+${r} дБ` }))]} onChange={(v) => { setRise(Number(v) as HouseRise | 0); setRes(null); }} />}
          <NumberField label="От" unit="Гц" value={l.fLo} min={10} max={500} decimals={0} onCommit={(fLo) => set({ fLo })} />
          <NumberField label="До" unit="Гц" value={l.fHi} min={20} max={1000} decimals={0} onCommit={(fHi) => set({ fHi })} />
          <NumberField label="Фильтров не больше" value={l.maxFilters} min={1} max={20} decimals={0} onCommit={(maxFilters) => set({ maxFilters })} />
          <NumberField label="Срез не глубже" unit="дБ" value={l.maxCut} min={1} max={24} decimals={0} onCommit={(maxCut) => set({ maxCut })} />
          {scenario !== 'cut' && <NumberField label="Подъём не больше" unit="дБ" value={l.maxBoost} min={0} max={6} decimals={1} onCommit={(maxBoost) => set({ maxBoost })} />}
          <NumberField label="Добротность не больше" value={l.maxQ} min={0.5} max={20} decimals={1} onCommit={(maxQ) => set({ maxQ })} />
        </div>
        {issues.map((x) => <Notice key={x} tone="danger">{x}</Notice>)}
        <div class="al-row"><Button variant="primary" icon="play" disabled={!!issues.length || (multi && !avg)} onClick={run}>Подобрать фильтры</Button></div>
      </Block>
      {res && (
        <>
          <Block title="До и после" subtitle={`По ${sourceText}, ${hz(res.f[0])}–${hz(res.f[res.f.length - 1])}. Отклонение — СКО от цели; меньше — ровнее.`}>
            <KeyValue items={[['Отклонение до', `${n1(res.stdBefore)} дБ`], ['Отклонение после', `${n1(res.f.length ? std(after.map((v, k) => v - res.target[k])) : NaN)} дБ`], ['Предусилитель против перегрузки', `${n1(preamp)} дБ`]]} />
            <FrequencyChart title="Коррекция: до и после" fMin={res.f[0]} fMax={res.f[res.f.length - 1]} series={series} />
            {res.skipped.length > 0 && <p class="al-text-small al-text-secondary">{`Не поднимаются — узкие, глубже предела или подъём не улучшает отклик: ${res.skipped.map((s) => `${hz(s.f)} (${n1(s.depth)} дБ)`).join(', ')}. Их исправляет расстановка, а не эквалайзер.`}</p>}
            {res.notes.map((x) => <p key={x} class="al-text-small al-text-secondary">{x}</p>)}
          </Block>
          <Block title="Фильтры" subtitle="Пиковые фильтры RBJ; порядок не влияет на результат. Выключенный фильтр не экспортируется.">
            {filters.length > 0 && (
              <div class="al-row">
                <Button small variant="primary" icon="download" onClick={() => void store({ filters, preamp, source: sourceText, scenario, savedAt: clock.now() }, 'Коррекция комнаты')}>
                  {exp ? 'Сохранить в эксперименте' : 'Сохранить в эксперимент'}
                </Button>
              </div>
            )}
            {!filters.length ? <p class="al-text-secondary">Корректировать нечего: пиков выше порога нет.</p> : (
              <ol role="list" class="al-stack al-stack--8" aria-label="Фильтры коррекции">
                {filters.map((p, k) => (
                  <li key={p.id} class="al-row al-row--between">
                    <Switch label={`Фильтр ${k + 1}: ${hz(p.f)}, ${p.gainDb > 0 ? '+' : ''}${n1(p.gainDb)} дБ, Q ${n2(p.q)}`} checked={p.enabled} onChange={(enabled) => update(filters.map((x) => (x.id === p.id ? { ...x, enabled } : x)))} />
                  </li>
                ))}
              </ol>
            )}
          </Block>
          {peq.length > 0 && (
            <Block title="Экспорт" subtitle="Приложение не является системным эквалайзером: загрузите фильтры в свой эквалайзер или DSP. Перед прослушиванием уменьшите громкость.">
              <div class="al-grid al-grid--metrics">
                <SelectField label="Частота дискретизации устройства" value={String(fs)} options={RATES.map((r) => ({ value: String(r), label: `${n1(r / 1000)} кГц` }))} onChange={(v) => setFs(Number(v) as (typeof RATES)[number])} />
              </div>
              <div class="al-row">
                <Button small icon="download" onClick={() => downloadText(`${name}_EqualizerAPO.txt`, exportApo(filters.filter((p) => p.enabled), preamp), 'text/plain')}>Equalizer APO</Button>
                <Button small icon="download" onClick={() => downloadText(`${name}_REW.txt`, exportREW(peq), 'text/plain')}>REW</Button>
                <Button small icon="download" onClick={() => downloadText(`${name}_miniDSP_${fs / 1000}k.txt`, exportMiniDSP(peq, fs), 'text/plain')}>{`miniDSP, ${n1(fs / 1000)} кГц`}</Button>
                <Button small icon="download" onClick={() => downloadText(`${name}_CamillaDSP.yml`, exportCamillaDSP({ sources: conv.inputs.sources, eq: peq, subSettings: conv.inputs.setup.subSettings, crossoverHz: conv.inputs.setup.crossoverHz, withCrossover: xo }), 'text/yaml')}>CamillaDSP</Button>
                <Button small icon="download" onClick={() => downloadText(`${name}.json`, JSON.stringify({ app: 'Room Acoustics v2', source: sourceText, scenario, fs, preampDb: preamp, filters: peq.map((p) => ({ type: 'peaking', ...p })) }, null, 2))}>JSON</Button>
                <Button small icon="download" onClick={() => downloadBlob(`${name}_FIR_min_${fs / 1000}k.wav`, new Blob([wavFloat32([firMinPhase(peq, fs)], fs)], { type: 'audio/wav' }))}>FIR WAV, минимальная фаза</Button>
                <Button small icon="download" onClick={() => downloadBlob(`${name}_FIR_lin_${fs / 1000}k.wav`, new Blob([wavFloat32([firLinearPhase(peq, fs)], fs)], { type: 'audio/wav' }))}>FIR WAV, линейная фаза</Button>
                <Button small icon="download" onClick={() => downloadText(`${name}.csv`, ['f_hz;gain_db;q', ...peq.map((p) => `${p.f};${p.gainDb};${p.q}`)].join('\n') + '\n', 'text/csv')}>CSV</Button>
              </div>
              <Switch label="CamillaDSP: раздел частот LR4 на сабвуфер и колонки" checked={xo} onChange={setXo} hint="Только если раздел частот делает CamillaDSP, а не ресивер." />
              <p class="al-text-small al-text-secondary">{`Peace работает поверх Equalizer APO и читает тот же файл. Отдельного файла для Roon нет: совместимость формата не подтверждена. Предусилитель ${n1(preamp)} дБ записан в файл Equalizer APO; в остальные форматы его вносят вручную. В CamillaDSP — также задержки, уровни и фильтры сабвуферов этой конфигурации. FIR — те же фильтры импульсной характеристикой (ядро dsp.ts); линейная фаза добавляет задержку ${n1(linearPhaseLength(peq, fs) / 2 / fs * 1000)} мс.`}</p>
              <div class="al-row">
                <Button small onClick={() => void putEntry(db, 'presets', { id: clock.newId(), name: `${room.name}: коррекция по ${sourceText}`, kind: 'eq', filters: filters.filter((p) => p.enabled), fs, createdAt: clock.now(), roomId: room.id }).then(
                  () => toast.show('Сохранено в «Мои данные» → «Пресеты DSP»; откройте в инструменте «Эквалайзер»'),
                  () => toast.show('Не удалось сохранить', { tone: 'error' }),
                )}>Сохранить пресет</Button>
                <a class={buttonClass('ghost', true)} href={href({ name: 'tool', toolId: 'equalizer' })}>Открыть эквалайзер</a>
              </div>
            </Block>
          )}
        </>
      )}
    </div>
  );
}

function std(a: readonly number[]): number {
  const m = a.reduce((x, y) => x + y, 0) / a.length;
  return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length);
}

/** Коррекция, сохранённая в конфигурации (V2-049). */
function StoredDsp({ dsp, name, onRemove }: { dsp: RoomDsp; name: string; onRemove: () => void }) {
  const on = dsp.filters.filter((p) => p.enabled);
  return (
    <Block title="Коррекция в конфигурации" subtitle={`Подобрана по ${dsp.source}, сохранена ${dateTime(dsp.savedAt)}. Это фильтры вашего эквалайзера или DSP; расчёты модели показывают комнату без них.`}>
      <ol role="list" class="al-stack al-stack--8" aria-label="Сохранённые фильтры">
        {on.map((p, k) => <li key={p.id} class="al-text-small">{`Фильтр ${k + 1}: ${hz(p.f)}, ${p.gainDb > 0 ? '+' : ''}${n1(p.gainDb)} дБ, Q ${n2(p.q)}`}</li>)}
      </ol>
      <KeyValue items={[['Фильтров', String(on.length)], ['Предусилитель', `${n1(dsp.preamp)} дБ`]]} />
      <div class="al-row">
        <Button small icon="download" onClick={() => downloadText(`${name}_EqualizerAPO.txt`, exportApo(on, dsp.preamp), 'text/plain')}>Equalizer APO</Button>
        <Button small variant="ghost" icon="trash" onClick={onRemove}>Убрать из конфигурации</Button>
      </div>
    </Block>
  );
}
