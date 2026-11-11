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
import { ActionMenu, CalculationStatus, ConfirmSheet, Details, Note, NumberField, Panel, SectionNav, Segmented, SelectField } from './index';
import { componentFamilies } from './registry';

function Catalog() {
  const [number, setNumber] = useState(160);
  const [distance, setDistance] = useState(20);
  const [mode, setMode] = useState('first');
  const [section, setSection] = useState('one');
  const [theme, setTheme] = useState('light');
  const [checked, setChecked] = useState(true);
  const [confirm, setConfirm] = useState(false);
  const [message, setMessage] = useState('Выберите действие');
  const options = [{ value: 'first', label: 'Первый' }, { value: 'second', label: 'Второй' }];
  return <main class="content screen">
    <h1 class="text-title">Дизайн-система</h1>
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
    <Panel title="Кнопки и состояния">
      <div class="btn-row"><button type="button" class="btn btn--primary">Основная</button><button type="button" class="btn">Обычная</button></div>
      <div class="btn-row"><button type="button" class="btn btn--ghost">Без фона</button><button type="button" class="btn" disabled>Недоступна</button></div>
      <div class="btn-row"><button type="button" class="btn btn--small">Компактная</button><button type="button" class="btn btn--danger" onClick={() => setConfirm(true)}>Подтверждение</button></div>
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
    <Panel title="Отступы и вложенные карточки">
      <p class="small">Между секциями — 14 px, внутри панели — 12 px, поля панели — 16 px, между подписью и вводом — 4 px.</p>
      <div class="wall-items"><div class="zone-card"><strong>Первая карточка</strong><p class="small">Единый фон, радиус и отступы</p></div><div class="zone-card"><strong>Вторая карточка</strong><p class="small">Интервал 12 px сохраняется</p></div></div>
    </Panel>
    <Panel title="Реестр визуальных семейств">
      <dl class="glossary">{componentFamilies.map(([name, api]) => <div key={name}><dt>{name}</dt><dd class="small text-code">{api}</dd></div>)}</dl>
    </Panel>
    {confirm && <ConfirmSheet title="Пример подтверждения" text="Это демонстрация компонента, данные приложения не меняются."
      confirm="Подтвердить" onCancel={() => setConfirm(false)} onConfirm={() => { setConfirm(false); setMessage('Подтверждено'); }} />}
  </main>;
}
render(<Catalog />, document.getElementById('catalog')!);
