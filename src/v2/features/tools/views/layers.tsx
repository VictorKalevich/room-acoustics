// Многослойные конструкции и резонаторы с потерями (V2-052, экспертный уровень): редактор слоёв от комнаты к стене,
// поглощение при нормальном падении и в диффузном поле методом матриц переноса (application/layers), импеданс,
// применимость моделей, сравнение конструкций. Бесконечная плоская конструкция — ограничение показано на экране.
// Там же — рассеивание одномерного диффузора (оценка Фраунгофера) и подготовка изготовления панелей.
import { useMemo, useState } from 'preact/hooks';
import { Button, DataTable, FrequencyChart, KeyValue, Notice, NumberField, SelectField, Switch, type SeriesVariant } from '../../../design-system';
import { absorption, air, construction, octaveMean, OCTAVES, outOfRange, peak, perforation, type Absorption, type Layer, type PorousModel } from '../../../application/layers';
import { logFreqs } from '../../../application/tools';
import { latticeFloor, normalizedDiffusion } from '../../../application/diffusers';
import { cutMapSvg, panelBom } from '../../../application/fabrication';
import { downloadText, safeFileName } from '../../../shared/files';
import { Block, SaveResult, cm, hz, n0, n1, n2 } from './common';

const FREQS = logFreqs(50, 5000, 24);
const KIND_LABEL: Record<Layer['kind'], string> = { porous: 'Пористый слой', air: 'Воздушный зазор', perforated: 'Перфорированный лист', fabric: 'Ткань', membrane: 'Мембрана (панель)' };
const MODEL_LABEL: Record<PorousModel, string> = { 'delany-bazley': 'Delany–Bazley', miki: 'Miki', jca: 'Johnson–Champoux–Allard' };
const JCA_DEFAULT = { porosity: 0.98, tortuosity: 1.02, viscousUm: 90, thermalUm: 180 };

const fresh = (kind: Layer['kind']): Layer => (
  kind === 'porous' ? { kind, thickness: 0.05, sigma: 10_000, model: 'delany-bazley', density: null }
    : kind === 'air' ? { kind, thickness: 0.05 }
      : kind === 'perforated' ? { kind, thickness: 0.009, holeDiameter: 0.006, pitch: 0.025, surfaceMass: null }
        : kind === 'fabric' ? { kind, resistance: 100, surfaceMass: null }
          : { kind, surfaceMass: 3 });

const layerText = (l: Layer) => (l.kind === 'porous' ? `${KIND_LABEL[l.kind]} ${cm(l.thickness)}, σ ${n1(l.sigma / 1000)} кПа·с/м², ${MODEL_LABEL[l.model]}`
  : l.kind === 'air' ? `${KIND_LABEL[l.kind]} ${cm(l.thickness)}` : l.kind === 'perforated' ? `${KIND_LABEL[l.kind]} ${n1(perforation(l) * 100)} %`
    : l.kind === 'fabric' ? `${KIND_LABEL[l.kind]} ${n0(l.resistance)} Па·с/м` : `${KIND_LABEL[l.kind]} ${n1(l.surfaceMass)} кг/м²`);

/** Необязательное поле: пусто — не указано (null). */
const opt = (v: number) => (Number.isFinite(v) ? v : null);

function LayerFields({ l, set }: { l: Layer; set: (l: Layer) => void }) {
  if (l.kind === 'porous') {
    return (
      <div class="al-grid al-grid--metrics">
        <SelectField<PorousModel> label="Модель материала" value={l.model} onChange={(model) => set({ ...l, model, jca: model === 'jca' ? l.jca ?? JCA_DEFAULT : l.jca })} options={(Object.keys(MODEL_LABEL) as PorousModel[]).map((m) => ({ value: m, label: MODEL_LABEL[m] }))} />
        <NumberField label="Толщина" unit="см" value={l.thickness * 100} min={0.5} max={60} decimals={1} onCommit={(v) => set({ ...l, thickness: v / 100 })} />
        <NumberField label="Сопротивление продуванию σ" unit="кПа·с/м²" value={l.sigma / 1000} min={0.5} max={200} decimals={1} onCommit={(v) => set({ ...l, sigma: v * 1000 })} hint="По паспорту (ISO 9053); вата 30–60 кг/м³ — обычно 5–25" />
        <NumberField label="Плотность" unit="кг/м³" value={l.density ?? null} optional min={1} max={500} decimals={0} onCommit={(v) => set({ ...l, density: opt(v) })} hint="Только для массы конструкции" />
        {l.model === 'jca' && l.jca && [
          <NumberField key="p" label="Пористость" value={l.jca.porosity} min={0.5} max={1} decimals={2} onCommit={(v) => set({ ...l, jca: { ...l.jca!, porosity: v } })} />,
          <NumberField key="t" label="Извилистость α∞" value={l.jca.tortuosity} min={1} max={4} decimals={2} onCommit={(v) => set({ ...l, jca: { ...l.jca!, tortuosity: v } })} />,
          <NumberField key="v" label="Вязкая длина Λ" unit="мкм" value={l.jca.viscousUm} min={1} max={2000} decimals={0} onCommit={(v) => set({ ...l, jca: { ...l.jca!, viscousUm: v } })} />,
          <NumberField key="h" label="Тепловая длина Λ′" unit="мкм" value={l.jca.thermalUm} min={1} max={4000} decimals={0} onCommit={(v) => set({ ...l, jca: { ...l.jca!, thermalUm: v } })} />,
        ]}
      </div>
    );
  }
  if (l.kind === 'air') return <div class="al-grid al-grid--metrics"><NumberField label="Толщина" unit="см" value={l.thickness * 100} min={0.1} max={100} decimals={1} onCommit={(v) => set({ ...l, thickness: v / 100 })} /></div>;
  if (l.kind === 'perforated') {
    return (
      <div class="al-grid al-grid--metrics">
        <NumberField label="Толщина листа" unit="мм" value={l.thickness * 1000} min={0.1} max={50} decimals={1} onCommit={(v) => set({ ...l, thickness: v / 1000 })} />
        <NumberField label="Диаметр отверстий" unit="мм" value={l.holeDiameter * 1000} min={0.05} max={50} decimals={2} onCommit={(v) => set({ ...l, holeDiameter: v / 1000 })} />
        <NumberField label="Шаг отверстий" unit="мм" value={l.pitch * 1000} min={0.5} max={200} decimals={1} onCommit={(v) => set({ ...l, pitch: v / 1000 })} hint={`Перфорация ${n1(perforation(l) * 100)} %, квадратная сетка`} />
        <NumberField label="Поверхностная масса" unit="кг/м²" value={l.surfaceMass ?? null} optional min={0.1} max={100} decimals={1} onCommit={(v) => set({ ...l, surfaceMass: opt(v) })} hint="Только для массы конструкции" />
      </div>
    );
  }
  if (l.kind === 'fabric') {
    return (
      <div class="al-grid al-grid--metrics">
        <NumberField label="Сопротивление продуванию" unit="Па·с/м" value={l.resistance} min={1} max={5000} decimals={0} onCommit={(v) => set({ ...l, resistance: v })} hint="Акустически прозрачная ткань — до ~100" />
        <NumberField label="Поверхностная масса" unit="кг/м²" value={l.surfaceMass ?? null} optional min={0.01} max={5} decimals={2} onCommit={(v) => set({ ...l, surfaceMass: opt(v) })} />
      </div>
    );
  }
  return <div class="al-grid al-grid--metrics"><NumberField label="Поверхностная масса" unit="кг/м²" value={l.surfaceMass} min={0.1} max={100} decimals={1} onCommit={(v) => set({ ...l, surfaceMass: v })} hint="Фанера 6 мм ≈ 3,6; МДФ 12 мм ≈ 9" /></div>;
}

/** Результаты расчёта конструкции: график, октавы, импеданс, применимость. */
function Results({ layers, r, title }: { layers: Layer[]; r: Absorption; title: string }) {
  const k = construction(layers);
  const resonant = layers.some((l) => l.kind === 'perforated' || l.kind === 'membrane');
  const pk = resonant ? peak(r.f, r.diffuse) : null;
  const ranges = layers.map((l, i) => ({ i, r: outOfRange(l, FREQS) })).filter((x) => x.r);
  const oct = (v: readonly number[]) => OCTAVES.map((f) => octaveMean(r.f, v, f));
  const rows = [{ id: 'n', name: 'Нормальное падение', v: oct(r.normal) }, { id: 'd', name: 'Диффузное поле, 0–78°', v: oct(r.diffuse) }];
  const zrows = OCTAVES.map((f) => ({ f, z: r.zs[r.f.reduce((b, x, j) => (Math.abs(Math.log(x / f)) < Math.abs(Math.log(r.f[b] / f)) ? j : b), 0)] }));
  const z0 = air().z0;
  return (
    <>
      <FrequencyChart title={`Поглощение: ${title}`} yUnit="α" yRange={[0, 1]} fMin={50} fMax={5000} series={[
        { id: 'n', label: 'Нормальное падение', kind: 'calculated', x: r.f, y: r.normal },
        { id: 'd', label: 'Диффузное поле', kind: 'calculated', variant: 2, x: r.f, y: r.diffuse },
      ]} />
      <DataTable caption={`Поглощение по октавам: ${title}`} rowKey={(x) => x.id} rows={rows} columns={[
        { key: 'n', title: 'Падение', render: (x) => x.name },
        ...OCTAVES.map((f, j) => ({ key: String(f), title: hz(f), numeric: true, render: (x: (typeof rows)[number]) => (x.v[j] === null ? '—' : n2(x.v[j]!)) })),
      ]} />
      <KeyValue items={[
        ['Глубина конструкции', cm(k.depth)],
        ['Поверхностная масса', k.mass === null ? '—' : `${n1(k.mass)} кг/м²`],
        ...(pk ? [['Максимум поглощения (диффузное поле)', `${n2(pk.value)} на ${hz(pk.f)}`] as [string, string], ['Полоса не ниже половины максимума', `${hz(pk.lo)}–${hz(pk.hi)}`] as [string, string]] : []),
      ]} />
      {k.mass === null && <p class="al-text-small al-text-secondary">Поверхностная масса указана не у всех слоёв — масса конструкции не считается.</p>}
      <DataTable caption={`Поверхностный импеданс при нормальном падении: ${title}`} rowKey={(x) => String(x.f)} rows={zrows} columns={[
        { key: 'f', title: 'Частота', numeric: true, render: (x) => hz(x.f) },
        { key: 'r', title: 'Re Zs/ρc', numeric: true, render: (x) => n2(x.z.re / z0) },
        { key: 'i', title: 'Im Zs/ρc', numeric: true, render: (x) => n2(x.z.im / z0) },
      ]} />
      {ranges.map((x) => <Notice key={x.i} tone="warning">{`Слой ${x.i + 1}: модель ${layers[x.i].kind === 'porous' ? MODEL_LABEL[(layers[x.i] as Extract<Layer, { kind: 'porous' }>).model] : ''} вне области применимости на ${hz(x.r!.lo)}–${hz(x.r!.hi)} (ρ0·f/σ вне 0,01–1). Там результат ненадёжен; Miki и JCA ведут себя лучше на низких частотах.`}</Notice>)}
    </>
  );
}

const LIMITS = 'Бесконечная плоская конструкция на жёсткой стене (метод матриц переноса): у панели конечных размеров поглощение на низких частотах выше расчётного (краевой эффект), изгибные моды листов не учитываются. Диффузное поле — интеграл Пари по углам 0–78°; поглощение в комнате зависит ещё и от площади и расположения.';

export function LayersBlock({ initial }: { initial: Layer[] }) {
  const [layers, setLayers] = useState<Layer[]>(initial);
  const [add, setAdd] = useState<Layer['kind']>('air');
  const [saved, setSaved] = useState<{ name: string; layers: Layer[] }[]>([]);
  const r = useMemo(() => absorption(layers, FREQS), [layers]);
  const compared = useMemo(() => saved.map((s) => ({ ...s, r: absorption(s.layers, FREQS), k: construction(s.layers) })), [saved]);
  const set = (i: number, l: Layer) => setLayers(layers.map((x, j) => (j === i ? l : x)));
  const move = (i: number, d: -1 | 1) => { const n = [...layers]; [n[i], n[i + d]] = [n[i + d], n[i]]; setLayers(n); };
  const name = layers.map(layerText).join(' + ');
  const mean = (x: Absorption) => { const v = [250, 500, 1000, 2000].map((f) => octaveMean(x.f, x.diffuse, f) ?? 0); return v.reduce((s, y) => s + y, 0) / v.length; };
  return (
    <div class="al-stack al-stack--16">
      <Block title="Многослойная конструкция" subtitle="Экспертный уровень. Слои — от комнаты к стене; за последним слоем жёсткая стена. Поглощение — методом матриц переноса (TMM), это способ сложить слои, а не модель материала.">
        <ol role="list" class="al-stack al-stack--12" aria-label="Слои конструкции">
          {layers.map((l, i) => (
            <li key={i} class="al-stack al-stack--8" aria-label={`Слой ${i + 1}: ${KIND_LABEL[l.kind]}`}>
              <div class="al-row al-row--between">
                <span class="al-text-lead">{`${i + 1}. ${KIND_LABEL[l.kind]}`}</span>
                <div class="al-row">
                  <Button small variant="ghost" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Слой ${i + 1} ближе к комнате`}>Выше</Button>
                  <Button small variant="ghost" disabled={i === layers.length - 1} onClick={() => move(i, 1)} aria-label={`Слой ${i + 1} ближе к стене`}>Ниже</Button>
                  <Button small variant="ghost" icon="trash" disabled={layers.length === 1} onClick={() => setLayers(layers.filter((_, j) => j !== i))} aria-label={`Удалить слой ${i + 1}`}>Удалить</Button>
                </div>
              </div>
              <LayerFields l={l} set={(x) => set(i, x)} />
            </li>
          ))}
        </ol>
        <p class="al-text-small al-text-secondary">За последним слоем — жёсткая стена.</p>
        <div class="al-row al-row--bottom">
          <SelectField<Layer['kind']> label="Новый слой" value={add} onChange={setAdd} options={(Object.keys(KIND_LABEL) as Layer['kind'][]).map((k) => ({ value: k, label: KIND_LABEL[k] }))} />
          <Button small icon="plus" disabled={layers.length >= 8} onClick={() => setLayers([...layers, fresh(add)])}>Добавить слой</Button>
        </div>
      </Block>
      <Block title="Поглощение конструкции" subtitle={name}>
        <Results layers={layers} r={r} title="конструкция" />
        <p class="al-text-small al-text-secondary">{LIMITS}</p>
        <div class="al-row">
          <Button small disabled={saved.length >= 3 || saved.some((s) => JSON.stringify(s.layers) === JSON.stringify(layers))} onClick={() => setSaved([...saved, { name, layers }])}>Запомнить для сравнения</Button>
          <SaveResult tool="absorber" name={`Конструкция: ${name}`} data={() => ({ input: { layers }, result: { f: r.f, normal: r.normal, diffuse: r.diffuse, ...construction(layers) } })} />
        </div>
      </Block>
      {compared.length > 0 && (
        <Block title="Сравнение конструкций" subtitle="Диффузное поле. Сравнивайте при одной глубине, расходе материала или стоимости — цену здесь не знают.">
          <FrequencyChart title="Сравнение конструкций: поглощение в диффузном поле" yUnit="α" yRange={[0, 1]} fMin={50} fMax={5000}
            series={compared.map((s, i) => ({ id: String(i), label: `Вариант ${i + 1}`, kind: 'calculated' as const, variant: i ? ((i + 1) as SeriesVariant) : undefined, x: s.r.f, y: s.r.diffuse }))} />
          <DataTable caption="Сравнение конструкций" rowKey={(s) => JSON.stringify(s.layers)} rows={compared} columns={[
            { key: 'n', title: 'Вариант', render: (s) => `Вариант ${compared.indexOf(s) + 1}: ${s.name}` },
            { key: 'd', title: 'Глубина', numeric: true, render: (s) => cm(s.k.depth) },
            { key: 'm', title: 'Масса', numeric: true, render: (s) => (s.k.mass === null ? '—' : `${n1(s.k.mass)} кг/м²`) },
            { key: '125', title: hz(125), numeric: true, render: (s) => { const v = octaveMean(s.r.f, s.r.diffuse, 125); return v === null ? '—' : n2(v); } },
            { key: 'avg', title: 'Среднее 250–2000', numeric: true, render: (s) => n2(mean(s.r)) },
            { key: 'x', title: 'Убрать', render: (s) => <Button small variant="ghost" onClick={() => setSaved(saved.filter((x) => x !== s))} aria-label={`Убрать вариант ${compared.indexOf(s) + 1}`}>Убрать</Button> },
          ]} />
        </Block>
      )}
    </div>
  );
}

/** Резонатор с потерями (перфорированный лист или мембрана над полостью, с ватой или без) — тем же методом. */
export function ResonatorLosses({ front, depth, f0 }: { front: Layer; depth: number; f0: number }) {
  const [fill, setFill] = useState(true);
  const [t, setT] = useState(Math.min(0.05, depth));
  const [sigma, setSigma] = useState(10_000);
  const fillT = Math.min(t, depth);
  const layers: Layer[] = [front, ...(fill ? [{ kind: 'porous', thickness: fillT, sigma, model: 'miki' } as Layer] : []), ...(depth - (fill ? fillT : 0) > 1e-4 ? [{ kind: 'air', thickness: depth - (fill ? fillT : 0) } as Layer] : [])];
  const r = useMemo(() => absorption(layers, FREQS), [JSON.stringify(layers)]); // eslint-disable-line react-hooks/exhaustive-deps
  const pk = peak(r.f, r.diffuse);
  return (
    <Block title="С потерями (метод матриц переноса)" subtitle="Экспертный уровень: лист или панель над полостью с вязкими потерями в отверстиях и, по желанию, ватой у листа (Miki). Частота настройки сама по себе не говорит об эффективности — важны высота и ширина пика.">
      <Switch label="Вата в полости" checked={fill} onChange={setFill} />
      {fill && (
        <div class="al-grid al-grid--metrics">
          <NumberField label="Толщина ваты" unit="см" value={fillT * 100} min={0.5} max={depth * 100} decimals={1} onCommit={(v) => setT(v / 100)} />
          <NumberField label="Сопротивление продуванию σ" unit="кПа·с/м²" value={sigma / 1000} min={0.5} max={200} decimals={1} onCommit={(v) => setSigma(v * 1000)} />
        </div>
      )}
      <Results layers={layers} r={r} title="резонатор" />
      {pk && <p class="al-text-small al-text-secondary">{`Простая оценка выше — ${hz(f0)}; с потерями и точной полостью максимум на ${hz(pk.f)}. ${LIMITS}`}</p>}
    </Block>
  );
}

/** Рассеивание одномерного диффузора (V2-052): нормированный коэффициент диффузии по частотам — оценка Фраунгофера. */
export function DiffusionBlock({ depths, well, f0, fMax }: { depths: readonly number[]; well: number; f0: number; fMax: number }) {
  const [periods, setPeriods] = useState(4);
  const freqs = useMemo(() => logFreqs(100, 5000, 6), []);
  const r = useMemo(() => freqs.map((f) => normalizedDiffusion(depths, well, periods, f)), [depths, well, periods, freqs]);
  const oct = OCTAVES.filter((f) => f >= 125).map((f) => ({ f, ...normalizedDiffusion(depths, well, periods, f) }));
  return (
    <Block title="Рассеивание (оценка)" subtitle="Экспертный уровень. Модель Фраунгофера в дальнем поле: ячейки без потерь и перегородок, падение по нормали; коэффициент диффузии по AES-4id в 37 направлениях, нормированный к плоской панели той же ширины. Оценка, а не измерение по ISO 17497-2.">
      <div class="al-grid al-grid--metrics">
        <NumberField label="Периодов последовательности" value={periods} min={1} max={12} decimals={0} onCommit={setPeriods} hint={`Ширина диффузора ${n2(depths.length * well * periods)} м`} />
      </div>
      <FrequencyChart title="Нормированный коэффициент диффузии" yUnit="d" yRange={[0, 1]} fMin={100} fMax={5000}
        series={[{ id: 'd', label: 'Диффузор', kind: 'calculated', x: freqs, y: r.map((x) => x.norm) }]} />
      <DataTable caption="Коэффициент диффузии по октавам" rowKey={(x) => String(x.f)} rows={oct} columns={[
        { key: 'f', title: 'Частота', numeric: true, render: (x) => hz(x.f) },
        { key: 'd', title: 'Диффузор', numeric: true, render: (x) => n2(x.d) },
        { key: 'p', title: 'Плоская панель', numeric: true, render: (x) => n2(x.flat) },
        { key: 'n', title: 'Нормированный', numeric: true, render: (x) => n2(x.norm) },
      ]} />
      <p class="al-text-small al-text-secondary">{`Рабочая полоса — от расчётной ${hz(f0)} до предела по ширине ячейки ${hz(fMax)}. Пока период ${n2(depths.length * well)} м короче длины волны — ниже ${hz(latticeFloor(depths.length * well))}, — периодический диффузор отражает почти только зеркально, даже выше расчётной частоты. Периодический диффузор на частотах решётки рассеивает в отдельные лепестки — коэффициент там проседает; больше периодов — уже лепестки. Выше предела модель оптимистична: поперечные моды ячеек не учтены.`}</p>
    </Block>
  );
}

const mm = (v: number) => Math.round(v * 1000);

/** Подготовка изготовления пористых панелей (V2-052): раскрой, ведомость, масса, стоимость, карта раскроя SVG. */
export function FabricationBlock({ core }: { core: number }) {
  const [w, setW] = useState(0.6);
  const [h, setH] = useState(1.2);
  const [count, setCount] = useState(4);
  const [bw, setBw] = useState(1.2);
  const [bh, setBh] = useState(0.6);
  const [bt, setBt] = useState(0.05);
  const [perPack, setPerPack] = useState<number | null>(null);
  const [density, setDensity] = useState<number | null>(null);
  const [pricePack, setPricePack] = useState<number | null>(null);
  const [framePrice, setFramePrice] = useState<number | null>(null);
  const [margin, setMargin] = useState(0.05);
  const [fabricPrice, setFabricPrice] = useState<number | null>(null);
  const b = panelBom({ width: w, height: h, count, core, board: { width: bw, height: bh, thickness: bt, perPack, density, pricePack }, framePrice, fabricMargin: margin, fabricPrice });
  const title = `Панель ${mm(w)} × ${mm(h)} мм`;
  const unknown = [...b.missing, ...(b.mass === null ? ['плотность плиты'] : [])];
  return (
    <Block title="Изготовление панелей" subtitle={`Экспертный уровень. Заполнение — пористый слой ${cm(core)} из расчёта выше. Раскрой — сеткой на плите, без ширины пропила; неизвестная цена или плотность не считается нулём.`}>
      <div class="al-grid al-grid--metrics">
        <NumberField label="Ширина панели" unit="см" value={w * 100} min={10} max={300} decimals={0} onCommit={(v) => setW(v / 100)} />
        <NumberField label="Высота панели" unit="см" value={h * 100} min={10} max={300} decimals={0} onCommit={(v) => setH(v / 100)} />
        <NumberField label="Количество панелей" value={count} min={1} max={200} decimals={0} onCommit={setCount} />
        <NumberField label="Длина плиты" unit="см" value={bw * 100} min={10} max={300} decimals={0} onCommit={(v) => setBw(v / 100)} />
        <NumberField label="Ширина плиты" unit="см" value={bh * 100} min={10} max={300} decimals={0} onCommit={(v) => setBh(v / 100)} />
        <NumberField label="Толщина плиты" unit="см" value={bt * 100} min={1} max={30} decimals={1} onCommit={(v) => setBt(v / 100)} />
        <NumberField label="Плит в упаковке" value={perPack} optional min={1} max={100} decimals={0} onCommit={(v) => setPerPack(opt(v))} />
        <NumberField label="Плотность плиты" unit="кг/м³" value={density} optional min={1} max={500} decimals={0} onCommit={(v) => setDensity(opt(v))} />
        <NumberField label="Цена упаковки" unit="₽" value={pricePack} optional min={0} max={1e6} decimals={0} onCommit={(v) => setPricePack(opt(v))} />
        <NumberField label="Цена бруска рамки" unit="₽/м" value={framePrice} optional min={0} max={1e5} decimals={0} onCommit={(v) => setFramePrice(opt(v))} />
        <NumberField label="Запас ткани на подгиб" unit="см" value={margin * 100} min={0} max={30} decimals={0} onCommit={(v) => setMargin(v / 100)} />
        <NumberField label="Цена ткани" unit="₽/м²" value={fabricPrice} optional min={0} max={1e5} decimals={0} onCommit={(v) => setFabricPrice(opt(v))} />
      </div>
      <KeyValue items={[
        ['Слоёв плиты в панели', String(b.layers)],
        ['Кусков всего', String(b.pieces)],
        ['Кусков на плите', b.assembled ? 'из частей' : `${b.plan.across} × ${b.plan.along}${b.plan.rotated ? ', повёрнуты' : ''}`],
        ['Отход плиты', b.assembled ? '—' : `${n0(b.plan.waste * 100)} %`],
        ['Плит', String(b.boards)],
        ['Упаковок', b.packs === null ? '—' : String(b.packs)],
        ['Брусок рамки', `${n1(b.frameLength)} м`],
        ['Ткань', `${n1(b.fabricArea)} м²`],
        ['Масса заполнения', b.mass === null ? '—' : `${n1(b.mass)} кг`],
        ['Стоимость материалов', b.cost === null ? '—' : `${n0(b.cost)} ₽`],
      ]} />
      {b.assembled && <Notice tone="warning">Панель больше плиты: заполнение собирается из частей, плиты посчитаны по площади, карты раскроя нет.</Notice>}
      {unknown.length > 0 && <p class="al-text-small al-text-secondary">{`Не указано: ${unknown.join(', ')}. Неизвестное не считается нулём — ${[b.cost === null && 'стоимость', b.mass === null && 'масса'].filter(Boolean).join(' и ')} не рассчитаны.`}</p>}
      {Math.abs(b.layers * bt - core) > 0.005 && <Notice tone="warning">{`Плиты ${cm(bt)} не дают толщину ${cm(core)} ровно: ${b.layers} × ${cm(bt)} = ${cm(b.layers * bt)}. Поглощение рассчитано для ${cm(core)}.`}</Notice>}
      <div class="al-row">
        <Button small icon="download" disabled={b.assembled} onClick={() => downloadText(`${safeFileName(title)}_раскрой.svg`, cutMapSvg(w, h, bw, bh, b.plan, title), 'image/svg+xml')}>Карта раскроя, SVG</Button>
      </div>
      <p class="al-text-small al-text-secondary">Акустическая эффективность не доказывает безопасность: проверьте горючесть материалов и ткани, защиту от выделения волокон, крепления и массу панели для стены или потолка.</p>
    </Block>
  );
}
