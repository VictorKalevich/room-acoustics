/** Development-only catalog: npm run dev, then /design-system.html. No app state or audio. */
import { render } from 'preact';
import { useState } from 'preact/hooks';
import '@fontsource/golos-text/cyrillic-400.css';
import '@fontsource/golos-text/cyrillic-500.css';
import '@fontsource/golos-text/cyrillic-600.css';
import '@fontsource/golos-text/latin-400.css';
import '@fontsource/golos-text/latin-500.css';
import '@fontsource/golos-text/latin-600.css';
import '../../styles.css';
import { ActionBar, DetailPanel, ActionMenu, CalculationStatus, ConfirmSheet, Details, FailurePanel, Note, NumberField, Panel, SectionNav, Segmented, SelectField, Toast } from './index';
import { RmsHistoryChart } from './RmsHistoryChart';
import { componentFamilies } from './registry';
import { WallView } from '../components/WallView';
import { ResponseChart } from '../components/Charts';
import { defaultRoom } from '../../state/project';
import type { Room } from '../../core/types';

/** Пример для каталога: стена с окном, шторами, ковром и шкафом (без расчётов). */
const sampleRoom: Room = {
  ...defaultRoom(),
  features: [{ id: 'w', kind: 'window', wall: 'front', a0: 1.35, a1: 2.65, bottom: 0.9, top: 2.3 }],
  coverings: [
    { id: 'c', kind: 'curtain', grade: 'heavy', surface: 'front', u0: 1.2, u1: 2.8, v0: 0, v1: 2.45 },
    { id: 'k', kind: 'carpet', grade: 'thin', surface: 'front', u0: 3.0, u1: 3.9, v0: 0.6, v1: 1.8 },
  ],
  zones: [{ id: 'z', kind: 'furniture', furniture: 'wardrobe', name: 'Шкаф (МДФ)', height: 2.2, canSit: false, x0: 0, x1: 0.6, y0: 0.1, y1: 1.1 }],
};

/** Пример для каталога: АЧХ с продолжением ниже полосы оценки 30–200 Гц (спад 24 дБ на октаву, без расчётов). */
const sampleChart = (() => {
  const f = Array.from({ length: 73 }, (_, i) => 20 * Math.pow(10, i / 72));
  const target = f.map((x) => -10 * Math.log10(1 + Math.pow(30 / x, 8)));
  return { f, target, db: target.map((v, i) => v + 4 * Math.sin(i / 4) + (f[i] < 45 ? 3 : 0)) };
})();

function Catalog() {
  const [number, setNumber] = useState(160);
  const [distance, setDistance] = useState(20);
  const [optional, setOptional] = useState(27);
  const [mode, setMode] = useState('first');
  const [section, setSection] = useState('one');
  const [theme, setTheme] = useState('light');
  const [checked, setChecked] = useState(true);
  const [confirm, setConfirm] = useState(false);
  const [choice, setChoice] = useState(false);
  const [dock, setDock] = useState(false);
  const [actionState, setActionState] = useState('stale');
  const [message, setMessage] = useState('Выберите действие');
  const [notice, setNotice] = useState(0);
  const options = [{ value: 'first', label: 'Первый' }, { value: 'second', label: 'Второй' }];
  return <main class="content screen">
    <h1 class="text-title">Дизайн-система</h1>
    <DetailPanel title="Рабочий экран: настройки" summary="Возврат сохраняет состояние">
      <Panel title="Настройки"><NumberField label="Высота" value={number} onChange={setNumber} unit="см" min={10} max={250} /></Panel>
      <DetailPanel title="Вложенная страница" summary="Независимая прокрутка длинного содержимого">
        {Array.from({ length: 20 }, (_, i) => <Note key={i}>Строка {i + 1}: прокрутите до конца и вернитесь назад.</Note>)}
      </DetailPanel>
      <Note>Изменения применяются сразу. «Назад» возвращает к рабочему экрану.</Note>
    </DetailPanel>
    <Panel title="Основное действие">
      <p class="small">Панель над нижней навигацией. Это демонстрация состояний, без расчёта.</p>
      <Segmented label="Состояние панели" value={actionState} onChange={setActionState} options={[
        { value: 'idle', label: 'Первый запуск' }, { value: 'stale', label: 'Изменились данные' },
        { value: 'busy', label: 'Считаем' }, { value: 'done', label: 'Готово' }, { value: 'error', label: 'Ошибка' },
      ]} />
      <button type="button" class="btn" aria-pressed={dock} onClick={() => setDock(!dock)}>{dock ? 'Скрыть панель' : 'Показать панель'}</button>
    </Panel>
    <p class="small muted">Существующие элементы Room Acoustics. Каталог разработчика, без акустических расчётов.</p>
    <SelectField label="Тема каталога" value={theme} options={[{ value: 'light', label: 'Светлая' }, { value: 'dark', label: 'Тёмная' }]}
      onChange={value => { setTheme(value); document.documentElement.dataset.theme = value; }} />
    <Panel title="Текстовые стили">
      <p class="text-title">Заголовок страницы</p>
      <p class="text-heading">Заголовок панели</p>
      <p class="subhead">Подзаголовок</p>
      <p class="text-body">Основной текст — 16 px</p>
      <p class="text-small">Пояснение — 14 px</p>
      <p class="text-label">Подпись поля — 14 px, medium</p>
      <p class="text-caption muted">Вспомогательная подпись — 12 px</p>
      <p class="text-metric">30,0 <span class="text-small">дБ</span></p>
    </Panel>
    <Panel title="Отклик и уведомление">
      <p class="small">Все кнопки реагируют на нажатие. При уменьшенном движении остаётся изменение яркости.</p>
      <button type="button" class="btn" onClick={() => setNotice((n) => n + 1)}>Показать уведомление</button>
      <Toast message="Позиция на плане обновлена" trigger={notice} />
    </Panel>
    <Panel title="Кнопки и состояния">
      <div class="btn-row"><button type="button" class="btn btn--primary">Основная</button><button type="button" class="btn">Обычная</button></div>
      <div class="btn-row"><button type="button" class="btn btn--ghost">Без фона</button><button type="button" class="btn" disabled>Недоступна</button></div>
      <div class="btn-row"><button type="button" class="btn btn--small">Компактная</button><button type="button" class="btn btn--danger" onClick={() => setConfirm(true)}>Подтверждение</button><button type="button" class="btn" onClick={() => setChoice(true)}>Три действия</button></div>
      <div class="btn-row"><button type="button" class="btn btn--primary">Основное</button><button type="button" class="btn btn--tonal">Заметное второе</button></div>
      <button type="button" class="btn btn--primary btn--wide">Широкая</button>
      <ActionMenu label="Добавить проём" actions={['Окно', 'Дверь', 'Проём без двери'].map(label => ({ label, onSelect: () => setMessage(label) }))} />
      <p class="small" role="status">{message}</p>
    </Panel>
    <Panel title="Поля и выравнивание">
      <div class="grid-2">
        <NumberField label="Высота микрофона с длинной подписью" value={number} min={60} max={220} unit="см" onChange={setNumber} hint="Введите 1, чтобы увидеть ошибку" />
        <NumberField label="Расстояние" value={distance} min={5} max={100} unit="см" onChange={setDistance} />
      </div>
      <SelectField label="Выбор" value={mode} options={options} onChange={setMode} />
      <SelectField disabled label="Выбор во время сохранения" value={mode} options={options} onChange={setMode} />
      <SelectField label="Выбор с подсказкой" value={mode} options={options} onChange={setMode} hint="Значение по умолчанию — если у вас другое, выберите." />
      <NumberField label="Пустое поле (ещё не введено)" value={NaN} min={1} max={50} unit="м" onChange={() => undefined} />
      <NumberField optional label="Необязательное: очистите — «не указано»" value={optional} min={10} max={200} unit="Гц" digits={0} onChange={setOptional} hint={Number.isNaN(optional) ? 'Не указано' : undefined} />
      <label class="check"><input type="checkbox" checked={checked} onChange={e => setChecked(e.currentTarget.checked)} />Общее оформление флажка</label>
      <div class="field"><label for="catalog-text">Многострочный ввод</label><div class="field__box"><textarea id="catalog-text" rows={2} placeholder="Текст" /></div></div>
    </Panel>
    <Panel title="Выбор и навигация">
      <Segmented label="Значение настройки" value={mode} options={options} onChange={setMode} />
      <div class="tabs" role="group" aria-label="Варианты">{options.map(o => <button type="button" key={o.value} class={mode === o.value ? 'is-on' : ''} aria-pressed={mode === o.value} onClick={() => setMode(o.value)}>{o.label}</button>)}</div>
      <SectionNav label="Раздел каталога" value={section} onChange={setSection} options={[{ value: 'one', label: 'Первый', hint: 'Раздел' }, { value: 'two', label: 'Второй', hint: 'Другой раздел' }]} />
      <div class="chips"><button type="button" class={checked ? 'chip is-on' : 'chip'} aria-pressed={checked} onClick={() => setChecked(!checked)}>Фильтр</button><button type="button" class="chip chip--more">Другой вариант</button></div>
      <label class="field__label" for="catalog-range">Ползунок</label><input class="smoothing-slider" id="catalog-range" type="range" min="0" max="4" step="1" />
    </Panel>
    <Panel title="Сообщения и метки">
      <Note>Информация</Note><Note tone="good">Успешное действие</Note><Note tone="warn">Предупреждение</Note>
      <CalculationStatus busy label="Идёт расчёт…" />
      <CalculationStatus error="Пример ошибки" />
      <div class="btn-row"><span class="tag">Пометка</span><span class="model-tag">Модель</span><span class="sev sev--high">Важно</span><span class="robust-tag is-good">Устойчиво</span></div>
      <Details summary="Пояснение"><p class="small">Единое раскрытие дополнительных сведений.</p></Details>
    </Panel>
    <FailurePanel title="Раздел не открылся" text="Пример сообщения о сбое (028): заголовок, пояснение, действия и итог действия."
      actions={<><button type="button" class="btn btn--primary" onClick={() => setMessage('Попробовать снова')}>Попробовать снова</button><button type="button" class="btn" onClick={() => setMessage('Экспорт')}>Экспортировать проект</button><button type="button" class="btn" onClick={() => setMessage('Отчёт')}>Сообщить о проблеме</button></>}>
      <Note tone="good">Итог действия, например экспорта</Note>
    </FailurePanel>
    <FailurePanel title="Не удалось открыть сохранённый проект" text="Пример сообщения при запуске (029, DraftFailure): данные на устройстве не тронуты, рабочий проект не перезаписывается до выбора."
      actions={<><button type="button" class="btn btn--primary" onClick={() => setMessage('Повторить')}>Повторить</button><button type="button" class="btn" onClick={() => setConfirm(true)}>Начать новый проект</button></>} />
    <Panel title="Отступы и вложенные карточки">
      <p class="small">Между секциями — 14 px, внутри панели — 12 px, поля панели — 16 px, между подписью и вводом — 4 px.</p>
      <div class="wall-items"><div class="zone-card"><strong>Первая карточка</strong><p class="small">Единый фон, радиус и отступы</p></div><div class="zone-card"><strong>Вторая карточка</strong><p class="small">Интервал 12 px сохраняется</p></div></div>
    </Panel>
    <Panel title="Объект не помещается в комнату">
      <ul class="problems">
        <li class="problem is-high">
          <div class="problem__head"><strong>Стол (Что это 2)</strong><button type="button" class="btn btn--small btn--ghost" onClick={() => setMessage('Показать')}>Показать</button></div>
          <p class="small muted">За задней стеной на 12 см. При сохранении лишнее обрежется по стенам.</p>
        </li>
      </ul>
      <div class="zone-card is-error">
        <strong>Что это 2</strong>
        <Note tone="warn">За задней стеной на 12 см. При сохранении лишнее обрежется по стенам.</Note>
        <div class="grid-2">
          <NumberField compact label="От передней стены" value={3.4} unit="м" min={0} max={4.13} error="Допустимо до 3,28 м при глубине 0,85 м" onChange={() => undefined} />
          <NumberField compact label="Глубина" value={0.85} unit="м" min={0.1} max={4.13} error="Допустимо до 0,73 м при отступе 3,4 м" onChange={() => undefined} />
        </div>
      </div>
    </Panel>
    <Panel title="Развёртка стены">
      <WallView room={sampleRoom} wall="front" />
      <p class="small muted">Вид изнутри комнаты: окно, плотные шторы, ковёр на стене и шкаф у стены.</p>
    </Panel>
    <Panel title="График: часть ниже полосы оценки">
      <ResponseChart fLo={sampleChart.f[0]} fHi={200} scoredFrom={30} lines={[
        { f: sampleChart.f, db: sampleChart.target, cls: 'is-target', dash: true },
        { f: sampleChart.f, db: sampleChart.db, cls: 'is-room' },
      ]} />
      <div class="legend">
        <span class="legend__item legend__item--room">в комнате</span>
        <span class="legend__item legend__item--target">без комнаты</span>
        <span class="legend__item legend__item--unscored">не входит в оценку</span>
      </div>
      <p class="small muted">Затенение — частоты ниже полосы оценки (045): кривая продолжена вниз по модели спада, шкала центрируется по оцениваемой части.</p>
    </Panel>
    <Panel title="История RMS">
      <RmsHistoryChart live={false} rows={[-60, -58, -49, -40, -50, -58].map((rmsDbfs, i) => ({
        endSeconds: i + 1, rmsDbfs, rms1sDbfs: rmsDbfs - 1, windowComplete: i !== 3, missingBefore: i === 3 ? 1 : 0,
        peakHz: 996, clipped: false,
      }))} />
    </Panel>
    <Panel title="Реестр визуальных семейств">
      <dl class="glossary">{componentFamilies.map(([name, api]) => <div key={name}><dt>{name}</dt><dd class="small text-code">{api}</dd></div>)}</dl>
    </Panel>
    {confirm && <ConfirmSheet title="Пример подтверждения" text="Это демонстрация компонента, данные приложения не меняются."
      confirm="Подтвердить" onCancel={() => setConfirm(false)} onConfirm={() => { setConfirm(false); setMessage('Подтверждено'); }} />}
    {choice && <ConfirmSheet title="Пример с тремя действиями" text="Основной тон, своя подпись отмены, третье действие и список." tone="primary"
      confirm="Сохранить" cancel="Остаться" extra={{ label: 'Не сохранять', onClick: () => { setChoice(false); setMessage('Не сохранено'); } }}
      onCancel={() => setChoice(false)} onConfirm={() => { setChoice(false); setMessage('Сохранено'); }}>
      <ul class="plain-list small"><li>Диван</li><li>Окно, передняя стена</li></ul>
    </ConfirmSheet>}
    {dock && <ActionBar>
      <CalculationStatus stale={actionState === 'stale' ? 'Параметры изменились' : undefined} error={actionState === 'error' ? 'Не удалось рассчитать' : undefined} />
      <button type="button" class="btn btn--primary" disabled={actionState === 'busy'} onClick={() => setMessage('Действие из панели')}>
        {actionState === 'busy' ? 'Считаем…' : actionState === 'error' ? 'Повторить расчёт' : actionState === 'done' ? 'Использовать вариант' : actionState === 'stale' ? 'Пересчитать' : 'Подобрать расстановку'}
      </button>
    </ActionBar>}
  </main>;
}
render(<Catalog />, document.getElementById('catalog')!);
