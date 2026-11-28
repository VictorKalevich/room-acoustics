// Проектирование конструкций (V2-039): пористые панели и ловушки — поглощение ядра (porousAlpha, porousLowLimit);
// резонаторы и диффузоры — стандартные соотношения из application/tools (R33); упрощения названы на экране (R35).
// Экспертный уровень (V2-052): многослойные конструкции и резонаторы с потерями методом матриц переноса (layers.tsx).
import { useEffect, useMemo, useState } from 'preact/hooks';
import { BarChart, DataTable, FrequencyChart, KeyValue, MetricCard, Notice, NumberField, SegmentedControl, SelectField, type Column, type SeriesVariant } from '../../../design-system';
import { MATERIALS } from '../../../../core/materials';
import { speedOfSound } from '../../../../core/physics';
import { porousLowLimit } from '../../../../core/treatment';
import { porousAlpha } from '../../../../core/treatments';
import type { OctaveValues } from '../../../../core/types';
import { PRIMES, helmholtz, membrane, perforated, qrd } from '../../../application/tools';
import { listCategory } from '../../../storage/library';
import { useApp } from '../../../shared/context';
import { effectiveComplexity } from '../../../application/settings';
import { visibleAt } from '../../../domain/complexity';
import { LayersBlock, ResonatorLosses } from './layers';
import { Block, Inputs, SaveResult, cm, freq, hz, meters, n0, n1, n2 } from './common';

const OCT = [63, 125, 250, 500, 1000, 2000, 4000];
const OCT_LABEL = ['63', '125', '250', '500', '1k', '2k', '4k'];
const SQRT2 = Math.SQRT2;

function AlphaChart({ title, alpha }: { title: string; alpha: OctaveValues }) {
  return <Block title={title}><BarChart title={title} unit="α" categories={OCT_LABEL} series={[{ id: 'a', label: 'Поглощение', kind: 'estimated', values: alpha }]} /></Block>;
}

export function AbsorberTool() {
  const { settings } = useApp();
  const expert = visibleAt('expert', effectiveComplexity(settings, 'tools'));
  const [t, setT] = useState(0.1);
  const [gap, setGap] = useState(0);
  const [area, setArea] = useState(1.2 * 0.6);
  const alpha = porousAlpha(t, gap);
  const low = porousLowLimit(t, gap);
  return (
    <div class="al-stack al-stack--16">
      <Block title="Панель" subtitle="Пористый материал (минеральная вата, пенополиуретан) на стене или с зазором">
        <Inputs>
          <NumberField label="Толщина" unit="см" value={t * 100} min={1} max={60} decimals={1} onCommit={(v) => setT(v / 100)} />
          <NumberField label="Зазор до стены" unit="см" value={gap * 100} min={0} max={60} decimals={1} onCommit={(v) => setGap(v / 100)} />
          <NumberField label="Площадь панели" unit="м²" value={area} min={0.01} max={100} onCommit={setArea} />
        </Inputs>
      </Block>
      <AlphaChart title="Поглощение по октавам, Гц" alpha={alpha} />
      <Block title="Результат">
        <KeyValue items={[
          ['Поглощает почти полностью', `от ${hz(low)}`],
          ['Поглощение на 125 Гц', `${n0(alpha[1] * 100)} %`],
          ['Эквивалентная площадь на 125 Гц', `${n2(alpha[1] * area)} м²`],
          ['Эквивалентная площадь на 500 Гц', `${n2(alpha[3] * area)} м²`],
        ]} />
        <p class="al-text-secondary">Зазор работает примерно как половина толщины: панель 10 см с зазором 10 см поглощает как сплошные 15 см. Ниже указанной частоты панель тоже поглощает, но слабее.</p>
        <p class="al-text-secondary">Оценка по типичным данным пористых материалов, а не по паспорту конкретного: для точности возьмите данные изготовителя.</p>
      </Block>
      <div class="al-row"><SaveResult tool="absorber" name={`Панель ${cm(t)}${gap ? ` + зазор ${cm(gap)}` : ''}`} data={() => ({ input: { thickness: t, gap, area }, result: { alpha, lowLimitHz: low } })} /></div>
      {expert && <LayersBlock initial={[{ kind: 'porous', thickness: t, sigma: 10_000, model: 'delany-bazley', density: null }, ...(gap > 0 ? [{ kind: 'air' as const, thickness: gap }] : [])]} />}
    </div>
  );
}

type TrapKind = 'superchunk' | 'panel';

export function BassTrapTool() {
  const [kind, setKind] = useState<TrapKind>('superchunk');
  const [leg, setLeg] = useState(0.6);
  const [h, setH] = useState(2.5);
  const [board, setBoard] = useState(0.05);
  const [w, setW] = useState(0.6);
  const [t, setT] = useState(0.1);
  const depth = kind === 'superchunk' ? leg / SQRT2 : t;
  const gap = kind === 'superchunk' ? 0 : w / 4;
  const alpha = porousAlpha(depth, gap);
  const low = porousLowLimit(depth, kind === 'superchunk' ? 0 : w / 2);
  const perSlab = 2 * Math.floor(0.6 / leg + 1e-9) * Math.floor(1.2 / leg + 1e-9);
  const triangles = Math.ceil(h / board);
  return (
    <div class="al-stack al-stack--16">
      <Block title="Угловая ловушка">
        <SegmentedControl label="Конструкция" value={kind} onChange={setKind} options={[{ value: 'superchunk', label: 'Заполнение угла' }, { value: 'panel', label: 'Панель под 45°' }]} />
        {kind === 'superchunk' ? (
          <Inputs>
            <NumberField label="Катет треугольника" unit="см" value={leg * 100} min={20} max={120} decimals={0} onCommit={(v) => setLeg(v / 100)} />
            <NumberField label="Высота" unit="м" value={h} min={0.3} max={5} onCommit={setH} />
            <NumberField label="Толщина плиты" unit="см" value={board * 100} min={2} max={20} decimals={0} onCommit={(v) => setBoard(v / 100)} hint="Плита 60 × 120 см режется на треугольники" />
          </Inputs>
        ) : (
          <Inputs>
            <NumberField label="Ширина панели" unit="см" value={w * 100} min={20} max={150} decimals={0} onCommit={(v) => setW(v / 100)} />
            <NumberField label="Толщина панели" unit="см" value={t * 100} min={2} max={30} decimals={0} onCommit={(v) => setT(v / 100)} />
            <NumberField label="Высота" unit="м" value={h} min={0.3} max={5} onCommit={setH} />
          </Inputs>
        )}
      </Block>
      <AlphaChart title="Поглощение лицевой стороны по октавам (оценка), Гц" alpha={alpha} />
      <Block title="Результат">
        {kind === 'superchunk' ? (
          <KeyValue items={[
            ['Объём материала', `${n2((leg * leg) / 2 * h)} м³`],
            ['Лицевая сторона', `${cm(leg * SQRT2)} × ${meters(h)}`],
            ['Треугольников', `${triangles} шт.`],
            ['Плит 60 × 120 см', perSlab ? `${Math.ceil(triangles / perSlab)} шт. (по ${perSlab} треугольника)` : 'катет больше плиты'],
            ['Глубина от угла', cm(leg / SQRT2)],
          ]} />
        ) : (
          <KeyValue items={[
            ['Глубина до угла посередине', cm(w / 2)],
            ['Средний зазор', cm(w / 4)],
            ['Лицевая сторона', `${cm(w)} × ${meters(h)}`],
            ['Поглощает почти полностью', `от ${hz(low)}`],
          ]} />
        )}
        <p class="al-text-secondary">{kind === 'superchunk'
          ? 'Оценка: как пористый слой толщиной от угла до лицевой стороны. В углу сходятся пучности всех мод, поэтому на басу ловушка работает сильнее, чем панель той же площади на стене — это учитывает анализ комнаты.'
          : 'Оценка: зазор за панелью усреднён по ширине (треугольник за панелью). Панель в углу работает на басу сильнее, чем на стене, — это учитывает анализ комнаты.'}</p>
      </Block>
      <div class="al-row"><SaveResult tool="bass-trap" name={kind === 'superchunk' ? `Заполнение угла, катет ${cm(leg)}` : `Панель под 45°, ${cm(w)} × ${cm(t)}`} data={() => ({ input: { kind, leg, h, board, w, t }, result: { alpha, lowLimitHz: low } })} /></div>
    </div>
  );
}

type DiffKind = 'qrd' | 'skyline';

export function DiffuserTool() {
  const [kind, setKind] = useState<DiffKind>('qrd');
  const [N, setN] = useState<(typeof PRIMES)[number]>(7);
  const [f0, setF0] = useState(500);
  const [well, setWell] = useState(0.05);
  const q = qrd(N, f0, well, 20, kind === 'skyline');
  const rows = q.depths.map((row, i) => ({ i, row }));
  const cols: Column<(typeof rows)[number]>[] = [
    ...(kind === 'skyline' ? [{ key: 'r', title: 'Ряд', numeric: true, render: (x: (typeof rows)[number]) => String(x.i + 1) }] : []),
    ...Array.from({ length: N }, (_, j) => ({ key: `c${j}`, title: String(j + 1), numeric: true, render: (x: (typeof rows)[number]) => n1(x.row[j] * 100) })),
  ];
  return (
    <div class="al-stack al-stack--16">
      <Block title="Диффузор квадратичных вычетов" subtitle="Глубины ячеек по последовательности n² mod N">
        <SegmentedControl label="Вид" value={kind} onChange={setKind} options={[{ value: 'qrd', label: 'QRD (ряд ячеек)' }, { value: 'skyline', label: 'Skyline (блоки)' }]} />
        <Inputs>
          <SelectField label="Простое число N" value={String(N)} options={PRIMES.map((p) => ({ value: String(p), label: String(p) }))} onChange={(v) => setN(Number(v) as (typeof PRIMES)[number])} />
          <NumberField label="Расчётная частота" unit="Гц" value={f0} min={100} max={3000} decimals={0} onCommit={setF0} hint="Ниже неё диффузор рассеивает слабо" />
          <NumberField label={kind === 'qrd' ? 'Ширина ячейки' : 'Сторона блока'} unit="см" value={well * 100} min={1} max={30} decimals={1} onCommit={(v) => setWell(v / 100)} />
        </Inputs>
      </Block>
      <div class="al-grid al-grid--metrics" role="list" aria-label="Результат">
        <div role="listitem"><MetricCard label="Рассеивает от" value={n0(f0)} unit="Гц" note="Расчётная частота" /></div>
        <div role="listitem"><MetricCard label="Рассеивает до" value={q.fMax >= 1000 ? n1(q.fMax / 1000) : n0(q.fMax)} unit={q.fMax >= 1000 ? 'кГц' : 'Гц'} note="Ограничено шириной ячейки" /></div>
        <div role="listitem"><MetricCard label="Наибольшая глубина" value={n1(q.maxDepth * 100)} unit="см" /></div>
        <div role="listitem"><MetricCard label="Период" value={n1(q.period * 100)} unit="см" note={kind === 'skyline' ? `Блок ${N} × ${N}` : `${N} ячеек`} /></div>
      </div>
      <Block title={kind === 'qrd' ? 'Глубины ячеек, см' : 'Высоты блоков, см'}>
        <DataTable caption={kind === 'qrd' ? 'Глубины ячеек, см' : 'Высоты блоков, см'} columns={cols} rows={rows} rowKey={(x) => String(x.i)} />
      </Block>
      <p class="al-text-secondary">Толщина перегородок не учитывается; для QRD её обычно берут 2–5 мм и не включают в ширину ячейки.</p>
      <div class="al-row"><SaveResult tool="diffuser" name={`${kind === 'qrd' ? 'QRD' : 'Skyline'} N = ${N}, ${n0(f0)} Гц`} data={() => ({ input: { kind, N, f0, well }, result: q })} /></div>
    </div>
  );
}

type ResKind = 'helmholtz' | 'perforated' | 'membrane';

export function ResonatorTool() {
  const { settings } = useApp();
  const expert = visibleAt('expert', effectiveComplexity(settings, 'tools'));
  const [kind, setKind] = useState<ResKind>('membrane');
  const [neckD, setNeckD] = useState(0.05);
  const [neckL, setNeckL] = useState(0.1);
  const [vol, setVol] = useState(0.02);
  const [holeD, setHoleD] = useState(0.008);
  const [pitch, setPitch] = useState(0.03);
  const [plate, setPlate] = useState(0.012);
  const [depth, setDepth] = useState(0.1);
  const [mass, setMass] = useState(8);
  const [target, setTarget] = useState(80);
  const c = speedOfSound(20);
  const perf = perforated(holeD / 2, pitch, plate, depth);
  const f0 = kind === 'helmholtz' ? helmholtz(neckD / 2, neckL, vol) : kind === 'perforated' ? perf.f0 : membrane(mass, depth);
  // глубина под целевую частоту из тех же соотношений
  const need = kind === 'membrane' ? (60 / target) ** 2 / mass : kind === 'perforated' ? (perf.porosity / (plate + 0.8 * holeD)) * (c / (2 * Math.PI * target)) ** 2 : null;
  return (
    <div class="al-stack al-stack--16">
      <Block title="Резонансный поглотитель" subtitle="Поглощает узкую полосу около собственной частоты">
        <SegmentedControl label="Вид" value={kind} onChange={setKind} options={[{ value: 'membrane', label: 'Мембрана' }, { value: 'perforated', label: 'Перфорированная панель' }, { value: 'helmholtz', label: 'Гельмгольц' }]} />
        <Inputs>
          {kind === 'helmholtz' && [
            <NumberField key="d" label="Диаметр горла" unit="см" value={neckD * 100} min={0.5} max={30} decimals={1} onCommit={(v) => setNeckD(v / 100)} />,
            <NumberField key="l" label="Длина горла" unit="см" value={neckL * 100} min={0.1} max={100} decimals={1} onCommit={(v) => setNeckL(v / 100)} />,
            <NumberField key="v" label="Объём полости" unit="л" value={vol * 1000} min={0.1} max={1000} decimals={1} onCommit={(v) => setVol(v / 1000)} />,
          ]}
          {kind === 'perforated' && [
            <NumberField key="h" label="Диаметр отверстий" unit="мм" value={holeD * 1000} min={1} max={50} decimals={1} onCommit={(v) => setHoleD(v / 1000)} />,
            <NumberField key="p" label="Шаг отверстий" unit="мм" value={pitch * 1000} min={2} max={200} decimals={0} onCommit={(v) => setPitch(v / 1000)} />,
            <NumberField key="t" label="Толщина панели" unit="мм" value={plate * 1000} min={1} max={50} decimals={0} onCommit={(v) => setPlate(v / 1000)} />,
          ]}
          {kind === 'membrane' && <NumberField label="Поверхностная масса панели" unit="кг/м²" value={mass} min={0.5} max={100} decimals={1} onCommit={setMass} hint="Фанера 6 мм ≈ 3,6; МДФ 12 мм ≈ 9" />}
          {kind !== 'helmholtz' && <NumberField label="Глубина полости" unit="см" value={depth * 100} min={1} max={100} decimals={1} onCommit={(v) => setDepth(v / 100)} />}
          {kind !== 'helmholtz' && <NumberField label="Целевая частота" unit="Гц" value={target} min={20} max={1000} decimals={0} onCommit={setTarget} />}
        </Inputs>
      </Block>
      <div class="al-grid al-grid--metrics" role="list" aria-label="Результат">
        <div role="listitem"><MetricCard label="Собственная частота" value={n0(f0)} unit="Гц" /></div>
        {kind === 'perforated' && <div role="listitem"><MetricCard label="Перфорация" value={n1(perf.porosity * 100)} unit="%" note="Квадратная сетка отверстий" /></div>}
        {need !== null && <div role="listitem"><MetricCard label={`Глубина для ${hz(target)}`} value={n1(need * 100)} unit="см" /></div>}
      </div>
      <Notice title="Упрощённая оценка">
        {kind === 'membrane' ? 'Формула f₀ ≈ 60/√(m·d) — для герметичной полости без заполнения; с ватой в полости частота ниже примерно на 15 %.'
          : kind === 'perforated' ? 'Частота по эффективной толщине t + 1,6·r; без учёта вязкости в отверстиях и заполнения полости.'
          : 'Частота с концевой поправкой горла 1,7·r (горло с фланцем); размеры полости должны быть много меньше длины волны.'}
        {` Проверьте результат измерением: ширина полосы зависит от потерь, которые здесь не считаются (${freq(f0)}).`}
      </Notice>
      {expert && kind !== 'helmholtz' && <ResonatorLosses key={kind} f0={f0} depth={depth} front={kind === 'perforated' ? { kind: 'perforated', thickness: plate, holeDiameter: holeD, pitch } : { kind: 'membrane', surfaceMass: mass }} />}
      {expert && kind === 'helmholtz' && <p class="al-text-small al-text-secondary">Одиночный резонатор Гельмгольца — не плоская конструкция: метод матриц переноса к нему не применяется; массив горл на панели считайте как перфорированный лист.</p>}
      <div class="al-row"><SaveResult tool="resonator" name={`Резонатор: ${hz(f0)}`} data={() => ({ input: { kind, neckD, neckL, vol, holeD, pitch, plate, depth, mass }, result: { f0, porosity: perf.porosity } })} /></div>
    </div>
  );
}

interface MatRow { id: string; name: string; alpha: number[]; source: string }
const nrc = (a: readonly number[]) => Math.round(((a[2] + a[3] + a[4] + a[5]) / 4) * 20) / 20;
const validAlpha = (a: unknown): a is number[] => Array.isArray(a) && a.length === 7 && a.every((v) => typeof v === 'number' && v >= 0 && v <= 1.2);

export function MaterialsCompareTool() {
  const { db } = useApp();
  const [mine, setMine] = useState<MatRow[]>([]);
  useEffect(() => {
    let alive = true;
    void listCategory(db, 'materials').then((list) => {
      if (alive) setMine((list as unknown as Record<string, unknown>[]).filter((e) => validAlpha(e.alpha)).map((e) => ({ id: `my:${String(e.id)}`, name: String(e.name), alpha: e.alpha as number[], source: typeof e.source === 'string' ? e.source : 'Мои данные' })));
    }, () => undefined);
    return () => { alive = false; };
  }, [db]);
  const all = useMemo<MatRow[]>(() => [...MATERIALS.map((m) => ({ id: m.id, name: m.name, alpha: [...m.alpha], source: m.extrapolated63 ? `${m.source}; 63 Гц — экстраполяция` : m.source })), ...mine], [mine]);
  const [picked, setPicked] = useState<string[]>(['plaster', 'parquet', 'carpet-thick', '']);
  const rows = picked.map((id) => all.find((m) => m.id === id)).filter((m): m is MatRow => !!m);
  const options = [{ value: '', label: 'Не выбран' }, ...all.map((m) => ({ value: m.id, label: m.name }))];
  const cols: Column<MatRow>[] = [
    { key: 'n', title: 'Материал', render: (m) => m.name },
    ...OCT.map((f, k) => ({ key: String(f), title: freq(f), numeric: true, render: (m: MatRow) => n2(m.alpha[k]) })),
    { key: 'nrc', title: 'NRC', numeric: true, render: (m) => n2(nrc(m.alpha)) },
  ];
  return (
    <div class="al-stack al-stack--16">
      <Block title="Материалы" subtitle="До четырёх материалов из справочника и «Моих данных»">
        <Inputs>
          {picked.map((id, i) => <SelectField key={i} label={`Материал ${i + 1}`} value={id} options={options} onChange={(v) => setPicked(picked.map((x, j) => (j === i ? v : x)))} />)}
        </Inputs>
      </Block>
      {rows.length > 0 && (
        <Block title="Поглощение по октавам" subtitle="Справочные данные: лабораторные измерения из указанных источников">
          <FrequencyChart title="Поглощение материалов по октавам" yUnit="α" yRange={[0, 1.2]} fMin={63} fMax={4000}
            series={rows.map((m, i) => ({ id: m.id, label: m.name, kind: 'imported' as const, variant: i ? ((i + 1) as SeriesVariant) : undefined, x: OCT, y: m.alpha }))} />
        </Block>
      )}
      <Block title="Коэффициенты поглощения по октавам" subtitle="NRC — среднее поглощение на 250 Гц – 2 кГц, округлённое до 0,05">
        <DataTable caption="Коэффициенты поглощения по октавам" columns={cols} rows={rows} rowKey={(m) => m.id} empty="Выберите материалы." />
      </Block>
      {rows.length > 0 && (
        <Block title="Источник данных">
          <ul role="list" class="al-list" aria-label="Источник данных">
            {rows.map((m) => <li key={m.id} class="al-list__item"><div class="al-list__text"><span class="al-list__title">{m.name}</span><span class="al-list__meta">{m.source}</span></div></li>)}
          </ul>
        </Block>
      )}
      <div class="al-row"><SaveResult tool="materials-compare" name={`Сравнение: ${rows.map((m) => m.name).join(', ')}`} data={() => ({ input: { materials: rows.map((m) => m.id) }, result: rows })} /></div>
    </div>
  );
}
