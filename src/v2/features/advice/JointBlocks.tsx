// Экспертный уровень подбора (V2-054): неопределённость варианта (парное Монте-Карло против нынешней расстановки)
// и совместный подбор мест, плана обработки, согласования сабвуферов и эквалайзера по модели. Расчёты —
// application/joint, каждую оценку считает ядро в фоновом воркере.
import { useState } from 'preact/hooks';
import { Button, ConfirmDialog, DataTable, FrequencyChart, KeyValue, Notice, NumberField } from '../../design-system';
import { evalPpo } from '../../../core/precision';
import type { CoreInputs } from '../../adapters/core';
import { setupKey } from '../../adapters/calculations';
import { DEFAULT_TOL, jointSearch, monteCarlo, type JointRow, type MonteCarlo, type Tolerances } from '../../application/joint';
import { setRoomDsp } from '../../application/measure';
import { subSettingsOp } from '../../application/optimize';
import { paretoOp, type ParetoPoint } from '../../application/pareto';
import { hashInputs } from '../../domain/provenance';
import type { RoomConfiguration } from '../../domain/model';
import { useApp } from '../../shared/context';
import { analysisStatus, n0, n1, n2 } from '../analysis/common';
import { useJob } from '../analysis/useJob';

const pct = (v: number) => `${n0(v * 100)} %`;
const range = (s: { p10: number; median: number; p90: number }) => `${n1(s.median)} дБ (${n1(s.p10)}…${n1(s.p90)})`;

/** Монте-Карло: вариант против «как сейчас» на одних и тех же возмущениях. */
export function UncertaintyBlock({ i, a, b, title }: { i: CoreInputs; a: ParetoPoint; b: ParetoPoint; title: string }) {
  const { compute } = useApp();
  const [tol, setTol] = useState<Tolerances>(DEFAULT_TOL);
  const [n, setN] = useState(60);
  const [seed, setSeed] = useState(1);
  const same = a.key === b.key;
  const key = hashInputs({ method: 'monte-carlo', input: setupKey(i), a: a.layout, b: b.layout, tol, n, seed });
  const evaluate = (room: CoreInputs['room'], setup: CoreInputs['setup']) => compute().run('evaluate', { room, sources: i.sources, constraints: i.constraints, setup, ppo: evalPpo(i.precision) });
  const [job, start] = useJob<MonteCarlo>(key, (onProgress) => monteCarlo(i, a.layout, b.layout, tol, n, seed, evaluate, onProgress));
  const r = job.status === 'ready' ? job.value : null;
  const verdict = !r || same ? null : r.better >= 0.8 ? `Вывод устойчив: при заданных допусках «${title}» лучше нынешней расстановки в ${pct(r.better)} выборок.`
    : r.worse >= 0.2 ? `Вывод неустойчив: «${title}» хуже нынешней расстановки в ${pct(r.worse)} выборок — выигрыш может не подтвердиться.`
      : `Разница в пределах разброса: «${title}» лучше в ${pct(r.better)} выборок, хуже в ${pct(r.worse)}.`;
  const cm = (v: number) => v * 100;
  return (
    <div class="al-stack al-stack--12" aria-label="Неопределённость">
      <span class="al-text-lead">Неопределённость (Монте-Карло)</span>
      <p class="al-text-small al-text-secondary">Экспертный уровень. Каждая выборка случайно меняет входные данные в пределах допусков (равномерно), и ядро заново оценивает {same ? 'нынешнюю расстановку' : 'обе расстановки на одних и тех же изменениях'}. Это разброс расчёта при неточно известных данных, а не погрешность самой модели.</p>
      <div class="al-grid al-grid--metrics">
        <NumberField label="Размеры комнаты, ±" unit="см" value={cm(tol.dims)} min={0} max={20} decimals={1} onCommit={(v) => setTol({ ...tol, dims: v / 100 })} hint={r && !r.dims ? 'В волновой модели размеры не меняются' : 'Точность обмера'} />
        <NumberField label="Поглощение границ, ±" unit="%" value={tol.absorption * 100} min={0} max={80} decimals={0} onCommit={(v) => setTol({ ...tol, absorption: v / 100 })} hint="Множитель затухания мод" />
        <NumberField label="Место слушателя, ±" unit="см" value={cm(tol.listener)} min={0} max={50} decimals={0} onCommit={(v) => setTol({ ...tol, listener: v / 100 })} />
        <NumberField label="Колонки и сабвуферы, ±" unit="см" value={cm(tol.sources)} min={0} max={50} decimals={0} onCommit={(v) => setTol({ ...tol, sources: v / 100 })} />
        <NumberField label="Выборок" value={n} min={10} max={300} decimals={0} onCommit={setN} />
      </div>
      {job.status !== 'ready' ? analysisStatus(job, start, `Монте-Карло по запросу: ${same ? n : 2 * n} оценок ядра.`) : r && (
        <>
          <KeyValue items={[
            ['Оценка сейчас: медиана (10–90 %)', range(r.a)],
            ...(same ? [] : [[`Оценка «${title}»`, range(r.b)] as [string, string], ['Разница: медиана (10–90 %)', `${n2(r.diff.median)} дБ (${n2(r.diff.p10)}…${n2(r.diff.p90)})`] as [string, string]]),
            ['Выборок', String(r.n)],
          ]} />
          {verdict && <Notice tone={r.better >= 0.8 ? 'success' : r.worse >= 0.2 ? 'warning' : 'info'}>{verdict}</Notice>}
          <FrequencyChart title={`Разброс АЧХ: ${same ? 'сейчас' : title.toLowerCase()}`} fMin={r.bandB.f[0]} fMax={r.bandB.f[r.bandB.f.length - 1]} series={[
            { id: 'p10', label: '10 %', kind: 'estimated', x: r.bandB.f, y: r.bandB.p10 },
            { id: 'p50', label: 'Медиана', kind: 'calculated', x: r.bandB.f, y: r.bandB.p50 },
            { id: 'p90', label: '90 %', kind: 'estimated', variant: 2, x: r.bandB.f, y: r.bandB.p90 },
            ...(same ? [] : [{ id: 'a', label: 'Сейчас, медиана', kind: 'current' as const, x: r.bandA.f, y: r.bandA.p50 }]),
          ]} />
          <div class="al-row"><Button small variant="ghost" onClick={() => setSeed(seed + 1)}>Другая выборка</Button></div>
        </>
      )}
    </div>
  );
}

/** Совместный подбор: места × план обработки × сабвуферы × эквалайзер, одна мера — неровность. */
export function JointBlock({ i, c, points, label, apply, confirm }: {
  i: CoreInputs; c: RoomConfiguration; points: readonly ParetoPoint[]; label: (p: ParetoPoint) => string;
  apply: (op: (c: RoomConfiguration) => RoomConfiguration, label: string) => Promise<boolean>; confirm: string;
}) {
  const { compute, clock } = useApp();
  const plan = (i.room.treatments?.length ?? 0) > 0;
  const subs = c.audio.sources.some((s) => s.kind === 'sub');
  const ppo = evalPpo(i.precision);
  const key = hashInputs({ method: 'joint', input: setupKey(i), points: points.map((p) => p.key), plan, subs });
  const [job, start] = useJob<JointRow[]>(key, (onProgress) => jointSearch(i, points, plan, {
    evaluate: (room, setup) => compute().run('evaluate', { room, sources: i.sources, constraints: i.constraints, setup, ppo }),
    integrate: subs ? (room, setup) => compute().run('integrate', { room, sources: i.sources, constraints: i.constraints, setup, ppo }) : null,
  }, clock.newId, onProgress));
  const [sel, setSel] = useState(0);
  const [ask, setAsk] = useState<JointRow | null>(null);
  const rows = job.status === 'ready' ? job.value : [];
  const chosen = rows[Math.min(sel, rows.length - 1)] ?? null;
  const name = (x: JointRow) => `${label(x.point)}${plan ? (x.treatments ? ', с обработкой' : ', без обработки') : ''}`;
  const byRaw = rows.length ? rows.reduce((m, x) => (x.raw < m.raw ? x : m), rows[0]) : null;
  const op = (x: JointRow) => (cfg: RoomConfiguration): RoomConfiguration => {
    let out = paretoOp(x.point.layout)(cfg);
    if (Object.keys(x.settings).length) out = subSettingsOp({ settings: x.settings, crossoverHz: x.crossoverHz })(out);
    if (plan) out = { ...out, treatment: { ...out.treatment, enabled: x.treatments } };
    if (x.filters.length) out = setRoomDsp(out, { filters: x.filters, preamp: x.preamp, source: 'модели (совместный подбор)', scenario: 'gentle', savedAt: clock.now() });
    return out;
  };
  return (
    <div class="al-stack al-stack--12" aria-label="Совместный подбор">
      <span class="al-text-lead">Совместный подбор: места, обработка, сабвуферы и эквалайзер</span>
      <p class="al-text-small al-text-secondary">{`Экспертный уровень. Для каждого варианта фронта${plan ? ' — с планом обработки и без,' : ''}${subs ? ' согласование сабвуферов ядром,' : ''} затем осторожный эквалайзер по модели (без больших подъёмов). Сравнение — по неровности баса в полосе эквалайзера: срезать пик проще, чем поднять провал, поэтому лучший вариант с коррекцией может быть не лучшим без неё.`}</p>
      {job.status !== 'ready' ? analysisStatus(job, start, `Совместный подбор по запросу: ${points.length * (plan ? 2 : 1)} сочетаний.`) : chosen && (
        <>
          <DataTable caption="Совместный подбор: неровность по шагам" rowKey={(x) => x.key} rows={rows} columns={[
            { key: 'n', title: 'Сочетание', render: (x) => <Button small variant={x === chosen ? 'secondary' : 'ghost'} aria-pressed={x === chosen} onClick={() => setSel(rows.indexOf(x))}>{name(x)}</Button> },
            { key: 'm', title: 'Перестановка', numeric: true, render: (x) => (x.point.shift === 0 ? '—' : `${n2(x.point.shift)} м`) },
            { key: 'r', title: 'Только места', numeric: true, render: (x) => `${n1(x.raw)} дБ` },
            ...(subs ? [{ key: 's', title: '+ сабвуферы', numeric: true, render: (x: JointRow) => `${n1(x.subs ?? x.raw)} дБ` }] : []),
            { key: 'e', title: '+ эквалайзер', numeric: true, render: (x) => `${n1(x.eq)} дБ` },
          ]} />
          {byRaw && byRaw !== rows[0] && byRaw.eq - rows[0].eq >= 0.3 && <Notice>{`Без коррекции лучше всех «${name(byRaw)}», а с коррекцией — «${name(rows[0])}» (на ${n1(byRaw.eq - rows[0].eq)} дБ): у него неровность легче исправить эквалайзером.`}</Notice>}
          {rows.length > 1 && rows[1].eq - rows[0].eq < 0.1 && <p class="al-text-small al-text-secondary">Первые сочетания различаются меньше чем на 0,1 дБ — это в пределах точности модели; выбирайте по объёму перестановки.</p>}
          <FrequencyChart title={`После всей цепочки: ${name(chosen).toLowerCase()}`} fMin={chosen.response.f[0]} fMax={chosen.response.f[chosen.response.f.length - 1]} series={[
            { id: 'a', label: 'После цепочки', kind: 'calculated', x: chosen.response.f, y: chosen.response.db },
            { id: 't', label: 'Цель', kind: 'target', x: chosen.response.f, y: chosen.response.target },
          ]} />
          <KeyValue items={[
            ['Фильтров эквалайзера', String(chosen.filters.length)],
            ['Предусилитель', `${n1(chosen.preamp)} дБ`],
            ...(subs ? [['Сабвуферов с новыми настройками', String(Object.keys(chosen.settings).length)] as [string, string]] : []),
          ]} />
          <p class="al-text-small al-text-secondary">Неровность — СКО отклонения от цели в полосе эквалайзера, меньше — лучше; это не та же мера, что оценка поиска выше. Результат по модели, временный; проверочный замер покажет, что получилось на деле.</p>
          <div class="al-row"><Button variant="primary" small icon="flask" onClick={() => setAsk(chosen)}>Перенести сочетание в эксперимент</Button></div>
        </>
      )}
      {ask && (
        <ConfirmDialog title="Перенести сочетание в эксперимент?" confirmLabel="В эксперимент" onCancel={() => setAsk(null)}
          onConfirm={() => { const x = ask; setAsk(null); void apply(op(x), 'Совместный подбор'); }}
          text={<><p>{`Места: ${name(ask).toLowerCase()}${Object.keys(ask.settings).length ? '; настройки сабвуферов' : ''}${ask.filters.length ? `; коррекция комнаты — фильтров ${ask.filters.length}` : ''}${plan ? `; план обработки ${ask.treatments ? 'учитывается' : 'не учитывается'}` : ''}.`}</p><p>{confirm}</p></>} />
      )}
    </div>
  );
}
