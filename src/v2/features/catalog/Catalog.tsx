// Каталог Acoustic Lab (V2-015): все публичные компоненты на примерах, цвета, текстовые стили и отступы.
// Данные графиков и плана здесь — демонстрационные и помечены так; это не результаты расчёта.
import { useState } from 'preact/hooks';
import {
  Badge, BarChart, Button, Spectrogram, EventChart, HeatLegend, PlanHeat, PlanPath, CalcStatus, Card, Checkbox, ConfirmDialog, DataTable, EmptyState, ErrorState, FrequencyChart, Icon, IconButton, ICON_NAMES,
  KeyValue, LoadingState, MetricCard, Notice, NumberField, PageHead, PlanLegend, PlanView, RangeField, Section, SegmentedControl, SelectField, Sheet, Switch,
  TabPanel, Tabs, TextField, useToast, applyTheme, saveTheme, readTheme, THEME_LABEL, type PlanItem, type ThemeChoice,
} from '../../design-system';
import { colorRoles, families, radii, spacing, textStyles } from '../../design-system/registry';

const DEMO_F = Array.from({ length: 97 }, (_, i) => 20 * 2 ** (i / 24));
// полосы 1/3 октавы 25 Гц – 16 кГц; тон, который поднимается по времени, на фоне розового шума
const DEMO_SG = (() => {
  const edges = Array.from({ length: 29 }, (_, k) => 25 * 2 ** ((k - 0.5) / 3));
  const bands = edges.length - 1, columns = 60;
  const values = Float32Array.from({ length: columns * bands }, (_, i) => {
    const x = Math.floor(i / bands), b = i % bands;
    return -80 + 6 * Math.sin(b / 3) + (Math.abs(b - (4 + x / 3)) < 1 ? 45 : 0) - (x < 6 ? NaN : 0);
  });
  return { edges, columns, values };
})();
const DEMO_HEAT = { x0: 0.25, y0: 0.25, step: 0.5, nx: 9, ny: 8, min: 2, max: 12, values: Array.from({ length: 72 }, (_, k) => 2 + 10 * Math.abs(Math.sin(k * 0.37))) };
const DEMO_EVENTS = [
  { id: 'd', t: 0, db: 0, label: 'Прямой звук', direct: true }, { id: 'f', t: 2.6, db: -3.7, label: 'Передняя стена' },
  { id: 's', t: 4.6, db: -5.8, label: 'Боковая стена' }, { id: 'c', t: 4.8, db: -5.9, label: 'Потолок' }, { id: 'b', t: 17.3, db: -13.1, label: 'Задняя стена' },
];
const demoCurve = (shift: number, depth: number) => DEMO_F.map((f) => 75 + depth * Math.sin(Math.log2(f / 20) * 2.4 + shift) - (f > 150 ? 2 : 0));

export function Catalog() {
  const toast = useToast();
  const [theme, setTheme] = useState<ThemeChoice>(readTheme());
  const [num, setNum] = useState(4.5);
  const [text, setText] = useState('Гостиная');
  const [sel, setSel] = useState<'auto' | 'modal' | 'wave'>('auto');
  const [seg, setSeg] = useState<'simple' | 'advanced' | 'expert'>('simple');
  const [tab, setTab] = useState<'bass' | 'reverb' | 'reflections'>('bass');
  const [on, setOn] = useState(true);
  const [check, setCheck] = useState(false);
  const [range, setRange] = useState(6);
  const [confirm, setConfirm] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [planSel, setPlanSel] = useState<string | null>(null);
  const [items, setItems] = useState<PlanItem[]>([
    { id: 'spkL', type: 'source', label: 'L', x: 0.5, y: 1.0, z: 1.0, dx: 0.25, dy: 0.2, dz: 0.35 },
    { id: 'spkR', type: 'source', label: 'R', x: 0.5, y: 2.8, z: 1.0, dx: 0.25, dy: 0.2, dz: 0.35 },
    { id: 'sub1', type: 'sub', label: 'Sub', x: 0.25, y: 0.25, z: 0.2 },
    { id: 'lst', type: 'listener', label: 'Слушатель', x: 2.6, y: 1.9, z: 1.1 },
    { id: 'sofa', type: 'obstacle', label: 'Диван', x: 3.4, y: 1.9, dx: 0.9, dy: 2.0, dz: 0.8 },
    { id: 'trap', type: 'bass-trap', label: 'Ловушка', x: 0.2, y: 3.6, dx: 0.4, dy: 0.4, dz: 2.4 },
    { id: 'panel', type: 'absorber', label: 'Панель', x: 1.8, y: 0.05, dx: 1.2, dy: 0.1, dz: 1.2 },
    { id: 'diff', type: 'diffuser', label: 'Диффузор', x: 4.4, y: 1.9, dx: 0.15, dy: 1.2, dz: 1.2, locked: true },
  ]);
  const pick = (t: ThemeChoice) => { setTheme(t); applyTheme(t); saveTheme(t); };

  return (
    <div>
      <PageHead overline="Acoustic Lab" title="Каталог дизайн-системы" text="Компоненты, цвета, текстовые стили и отступы Room Acoustics v2. Графики и план — демонстрационные данные." actions={
        <SegmentedControl label="Тема" value={theme} onChange={pick} options={(['system', 'light', 'dark'] as const).map((v) => ({ value: v, label: THEME_LABEL[v] }))} />
      } />
      <div class="al-catalog">
        <Section title="Цвета" id="colors">
          <div class="al-swatches">
            {colorRoles.map(([token, name]) => (
              <div class="al-swatch" key={token}>
                <span class="al-swatch__chip" style={{ background: `var(${token})` }} />
                <span class="al-swatch__text"><strong>{name}</strong><span class="al-mono">{token}</span></span>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Текстовые стили и отступы" id="type">
          <Card>
            <div class="al-stack">
              {textStyles.map(([cls, name]) => <p key={cls} class={cls}>{name}</p>)}
              <hr class="al-divider" />
              {spacing.map((t) => <div class="al-space-demo" key={t}><span class="al-space-demo__bar" style={{ width: `var(${t})` }} /><span class="al-mono">{t}</span></div>)}
              <p class="al-text-small al-text-secondary">Радиусы: {radii.join(', ')}. Высота основных кнопок — 48 px.</p>
            </div>
          </Card>
        </Section>

        <Section title="Кнопки" id="buttons">
          <div class="al-row al-row--12">
            <Button variant="primary" icon="plus">Создать комнату</Button>
            <Button>Вторичная</Button>
            <Button variant="ghost">Текстовая</Button>
            <Button variant="danger" icon="trash">Удалить</Button>
            <Button variant="danger-ghost">Сбросить</Button>
            <Button busy>Сохраняется</Button>
            <Button disabled>Недоступна</Button>
            <Button small icon="copy">Малая</Button>
            <IconButton icon="settings" label="Настройки" />
            <IconButton icon="star" label="В избранное" pressed variant="secondary" />
          </div>
        </Section>

        <Section title="Поля и переключатели" id="fields">
          <div class="al-grid">
            <TextField label="Название" value={text} onInput={setText} hint="Видно в списке комнат" />
            <NumberField label="Длина" unit="м" value={num} min={1} max={50} onCommit={setNum} hint="От 1 до 50 м" />
            <NumberField label="Поле с ошибкой" unit="м" value={null} onCommit={() => undefined} error="Введите число в метрах." />
            <SelectField label="Модель баса" value={sel} onChange={setSel} options={[{ value: 'auto', label: 'Автоматически' }, { value: 'modal', label: 'Прямоугольная' }, { value: 'wave', label: 'Волновая' }]} />
            <RangeField label="Подъём низа" value={range} min={0} max={9} step={3} onInput={setRange} format={(v) => `${v} дБ`} />
          </div>
          <div class="al-row al-row--16">
            <Switch label="Учитывать обработку" checked={on} onChange={setOn} />
            <Checkbox label="Показать сетку" checked={check} onChange={setCheck} />
          </div>
          <SegmentedControl label="Сложность" value={seg} onChange={setSeg} options={[{ value: 'simple', label: 'Простой' }, { value: 'advanced', label: 'Продвинутый' }, { value: 'expert', label: 'Экспертный' }]} />
          <Tabs idPrefix="cat" label="Разделы" value={tab} onChange={setTab} tabs={[{ id: 'bass', label: 'Бас' }, { id: 'reverb', label: 'Реверберация' }, { id: 'reflections', label: 'Отражения' }]} />
          <TabPanel idPrefix="cat" active={tab}><p class="al-text-small al-text-secondary">Вкладка: {tab}</p></TabPanel>
        </Section>

        <Section title="Метки, статусы и сообщения" id="feedback">
          <div class="al-row">
            <Badge tone="calculated">Расчёт</Badge><Badge tone="measured">Измерение</Badge><Badge tone="estimated">Оценка</Badge>
            <Badge tone="demo">Демонстрация</Badge><Badge tone="imported">Импорт</Badge><Badge tone="current">Текущая</Badge><Badge tone="experimental">Эксперимент</Badge>
          </div>
          <div class="al-grid">
            <CalcStatus state="ready" /><CalcStatus state="running" progress={0.42} /><CalcStatus state="queued" />
            <CalcStatus state="stale" onRetry={() => toast.show('Пересчёт запущен')} /><CalcStatus state="error" onRetry={() => undefined} /><CalcStatus state="unavailable" text="Нужен основной слушатель" />
          </div>
          <Notice title="Сведения">Расчёт по аналитической модели прямоугольной комнаты.</Notice>
          <Notice tone="warning" title="Ограничение">Проём к неописанному помещению учтён как открытый.</Notice>
          <Notice tone="danger" title="Ошибка">Не удалось сохранить: нет места на устройстве.</Notice>
          <Notice tone="success">Комната сохранена.</Notice>
          <div class="al-row">
            <Button onClick={() => setConfirm(true)}>Диалог подтверждения</Button>
            <Button onClick={() => setSheet(true)}>Шторка</Button>
            <Button onClick={() => toast.show('Изменение применено', { action: { label: 'Отменить', run: () => toast.show('Отменено') } })}>Уведомление</Button>
          </div>
        </Section>

        <Section title="Состояния" id="states">
          <div class="al-grid">
            <Card><EmptyState icon="rooms" title="Комнат пока нет" text="Создайте первую комнату." action={<Button variant="primary" icon="plus">Создать</Button>} /></Card>
            <Card><LoadingState text="Считаем моды…" /></Card>
            <Card><ErrorState text="Расчёт прервался." onRetry={() => undefined} /></Card>
          </div>
        </Section>

        <Section title="Метрики и таблицы" id="data">
          <div class="al-grid al-grid--metrics">
            <MetricCard label="RT60, 500 Гц" value="0,42" unit="с" kind={{ tone: 'calculated', label: 'Расчёт' }} tone="good" />
            <MetricCard label="Неровность баса" value="7,8" unit="дБ" tone="warning" kind={{ tone: 'measured', label: 'Измерение' }} />
            <MetricCard label="Стоимость" value={null} note="Неизвестна — цена не указана" />
          </div>
          <KeyValue items={[['Объём', '46,2 м³'], ['Частота Шрёдера', '191 Гц'], ['Модель', 'Прямоугольная']]} />
          <DataTable caption="Моды (демонстрация)" rowKey={(r) => r.n} columns={[
            { key: 'n', title: 'Мода', render: (r) => r.n }, { key: 'f', title: 'Частота, Гц', numeric: true, render: (r) => r.f }, { key: 'k', title: 'Тип', render: (r) => r.k },
          ]} rows={[{ n: '1,0,0', f: '38,1', k: 'осевая' }, { n: '0,1,0', f: '45,1', k: 'осевая' }, { n: '0,0,1', f: '63,5', k: 'осевая' }]} />
        </Section>

        <Section title="Графики" id="charts">
          <Card title="Частотная характеристика" subtitle="Демонстрационные кривые">
            <FrequencyChart title="Демонстрация" fMin={20} fMax={200} bands={[{ f0: 35, f1: 50, label: 'Провал' }]} marks={[{ f: 38.1, label: 'Мода 1,0,0' }]} series={[
              { id: 'm', label: 'Замер', kind: 'measured', x: DEMO_F, y: demoCurve(0, 6) },
              { id: 'p', label: 'Модель', kind: 'calculated', x: DEMO_F, y: demoCurve(0.4, 5) },
              { id: 'e', label: 'Эксперимент', kind: 'experimental', x: DEMO_F, y: demoCurve(0.9, 3) },
            ]} />
          </Card>
          <Card title="Реверберация по полосам" subtitle="Демонстрационные значения">
            <BarChart title="RT60" unit="с" categories={['125', '250', '500', '1k', '2k', '4k']} series={[
              { id: 'c', label: 'Расчёт', kind: 'calculated', values: [0.62, 0.55, 0.48, 0.45, 0.44, 0.4] },
              { id: 'm', label: 'Замер', kind: 'measured', values: [0.7, 0.58, null, 0.47, 0.43, 0.41] },
            ]} />
          </Card>
          <Card title="События во времени" subtitle="Демонстрация: расчётные первые отражения относительно прямого звука">
            <EventChart title="Первые отражения (демонстрация)" events={DEMO_EVENTS} />
          </Card>
          <Card title="Несколько рядов одного вида" subtitle="variant 2–4: цвет из палитры рядов, штрих — по виду (демонстрация)">
            <FrequencyChart title="Полосы кроссовера (демонстрация)" fMin={20} fMax={1000} yRange={[-40, 6]} series={[
              { id: 'lp', label: 'Низкие', kind: 'calculated', x: DEMO_F, y: DEMO_F.map((f) => -10 * Math.log10(1 + (f / 100) ** 8)) },
              { id: 'hp', label: 'Высокие', kind: 'calculated', variant: 2, x: DEMO_F, y: DEMO_F.map((f) => -10 * Math.log10(1 + (100 / f) ** 8)) },
              { id: 'sum', label: 'Сумма', kind: 'calculated', variant: 3, x: DEMO_F, y: DEMO_F.map(() => 0) },
            ]} />
          </Card>
          <Card title="Спектрограмма" subtitle="Время по горизонтали, полосы 1/3 октавы, восемь ступеней цвета (демонстрация)">
            <Spectrogram title="Спектрограмма (демонстрация)" columns={DEMO_SG.columns} edgesHz={DEMO_SG.edges} values={DEMO_SG.values} min={-110} max={-30} unit="дБFS" seconds={60} height={160} />
          </Card>
          <FrequencyChart title="Пусто" fMin={20} fMax={200} series={[]} empty="Нет измерений для этой конфигурации." />
        </Section>

        <Section title="План помещения" id="plan">
          <div class="al-split">
            <Card flush>
              <PlanView title="Демонстрационная комната 4,5 × 3,8 × 2,7 м" depth={4.5} width={3.8} height={2.7} items={items} selectedId={planSel} onSelect={setPlanSel}
                openings={[{ id: 'door', wall: 'back', a0: 0.3, a1: 1.1, bottom: 0, top: 2.0, closed: true, label: 'Дверь' }, { id: 'arch', wall: 'right', a0: 3.0, a1: 4.0, bottom: 0, top: 2.1, closed: false, label: 'Проём' }]}
                onMove={(id, to) => setItems((xs) => xs.map((it) => (it.id === id ? { ...it, ...to } : it)))} />
            </Card>
            <div class="al-split__aside">
              <Card title="Вид сбоку"><PlanView title="Сбоку" view="side" depth={4.5} width={3.8} height={2.7} items={items} /></Card>
              <PlanLegend types={['source', 'listener', 'absorber', 'bass-trap', 'diffuser', 'interior']} />
            </div>
          </div>
          <Card title="Карта и путь на плане" subtitle="Наложение renderOverlay: тепловая карта по узлам сетки и путь отражения (демонстрация)">
            <PlanView title="Карта (демонстрация)" depth={4.5} width={3.8} height={2.7} items={items.filter((it) => it.type === 'source' || it.type === 'listener')}
              renderOverlay={(m) => [<PlanHeat key="h" map={m} grid={DEMO_HEAT} />, <PlanPath key="p" map={m} points={[{ x: 0.9, y: 0.8 }, { x: 1.6, y: 0 }, { x: 2.8, y: 1.9 }]} selected label="Отражение от левой стены" />]} />
            <HeatLegend title="Шкала карты (демонстрация)" min={DEMO_HEAT.min} max={DEMO_HEAT.max} unit="дБ" />
          </Card>
        </Section>

        <Section title="Значки" id="icons">
          <div class="al-row al-row--12">{ICON_NAMES.map((n) => <span key={n} title={n}><Icon name={n} label={n} /></span>)}</div>
        </Section>

        <Section title="Реестр" id="registry">
          <DataTable caption="Семейства компонентов" rowKey={(f) => f.id} columns={[
            { key: 't', title: 'Семейство', render: (f) => f.title }, { key: 'c', title: 'Компоненты', render: (f) => f.components.join(', ') }, { key: 'n', title: 'Правило', render: (f) => f.note },
          ]} rows={families} />
        </Section>
      </div>
      {confirm && <ConfirmDialog title="Удалить комнату?" text="Комната и её измерения будут удалены с устройства." confirmLabel="Удалить" danger onConfirm={() => setConfirm(false)} onCancel={() => setConfirm(false)} />}
      {sheet && <Sheet title="Свойства объекта" onClose={() => setSheet(false)}><NumberField label="Высота" unit="м" value={1} onCommit={() => undefined} /></Sheet>}
    </div>
  );
}
