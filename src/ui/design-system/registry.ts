/** Inventory of visual families. A CSS class is also a public design-system API.
 * Domain views compose these styles; they do not need a wrapper for every span. */
export const componentFamilies = [
  ['Каркас', '.screen · .content · .topbar · .tabbar (вкладки по числу пунктов) · .app--start (без нижней панели) · .drawer'],
  ['Панели', 'Panel · .panel · .panel--hero · .panel--collapsible'],
  ['Поля', 'NumberField (пустое — NaN) · SelectField (hint) · .field · .field--compact · .field--error'],
  ['Переключатели', 'Segmented · .segmented · .tabs · .segmented--wrap'],
  ['Навигация разделов', 'SectionNav · .section-nav'],
  ['Кнопки', '.btn · --primary · --tonal · --ghost · --danger · --small · --wide'],
  ['Выбор действия', 'ActionMenu · .action-menu'],
  ['Флажки и фильтры', '.check · .chip · .plan-layers · .smoothing-stops'],
  ['Ползунки', '.smoothing-slider · .freq-slider · .hrange · .miniplayer__vol'],
  ['Сообщения', 'Note · CalculationStatus · RoomFirst/PlacementFirst (закрытый экран) · .note · .progress · .spinner'],
  ['Раскрытие', 'Details · .details · .setup-card'],
  ['Шторки', 'ConfirmSheet (danger/primary, cancel, extra, список .plain-list) · .sheet · .sheet-backdrop · .sheet__close'],
  ['Карточки объектов', '.zone-card · .zone-card.is-selected · .wall-items · .found-opening · .problem'],
  ['Метки состояния', '.tag · .model-tag · .sev · .robust-tag · .score__grade'],
  ['Показатели', '.stat · .score · .voice-metric · .score-ring · .meter'],
  ['Таблицы', '.table-scroll · .rt-table · .pos-table · .report-table'],
  ['Списки', '.plain-list · .best-list · .project-list · .advice-list · .steps-list'],
  ['План комнаты', 'PlanView · .plan · .plan__rug · .plan__zone-rect.is-selected · .plan-key · .heat-legend'],
  ['Развёртка стены', 'WallView · .wall-view · __window · __door · __gap · __arch · __carpet · __curtain · __furniture'],
  ['Графики', 'Charts · SmoothedResponseChart · .chart · .legend'],
  ['3D и сканы', 'Field3D · RoomPreview · ScanPreview · LayoutEditor'],
  ['Аудио', 'MiniPlayer · Auralize · .play-btn · .rta-big'],
  ['Помощь и статус', 'Term · MapModeHelp · WizardStrip · .update-banner · .whatif-strip'],
  ['Экспорт и отчёт', '.export · .report · .report-pre · .compare-table'],
] as const;

/** Exhaustive skins for native controls, used by the browser audit. File inputs are hidden infrastructure. */
export const controlSkins = {
  button: [
    '.btn', '.segmented button', '.tabs button', '.section-nav button', '.tabbar button',
    '.topbar__menu', '.topbar__projects', '.drawer__item', '.sheet__close', '.update-banner__close',
    '.term', '.chip', '.play-btn', '.hrange__thumb', '.smoothing-stops button', '.action-menu__popup > button',
  ],
  input: [
    '.field__box input', '.field__box select', '.field__box textarea', '.check input',
    '.smoothing-slider', '.freq-slider input', '.miniplayer__vol input', '.export textarea',
    'input[type="file"].visually-hidden',
  ],
} as const;
