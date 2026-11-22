/** Inventory of visual families. A CSS class is also a public design-system API.
 * Domain views compose these styles; they do not need a wrapper for every span. */
export const componentFamilies = [
  ['Рабочие экраны', 'ActionBar — основное действие; DetailPanel — подэкран с возвратом, сводкой и независимой вложенной прокруткой (в том числе строки списка «Сохранённые измерения» шумомера — 056; фокус на «Назад» только при открытии, длинный заголовок переносится — 058); workspace-plan — компактный план'],
  ['Каркас', '.screen · .content · .topbar · .tabbar (вкладки по числу пунктов) · .app--start (без нижней панели) · .drawer · .drawer__item--start (пункт «Начать»)'],
  ['Панели', 'Panel · .panel · .panel--hero · .panel--collapsible'],
  ['Поля', 'NumberField (пустое — NaN; optional — пустой ввод очищает; error — внешняя ошибка с допустимым значением) · SelectField (hint, disabled при сохранении) · .field · .field--compact · .field--error'],
  ['Переключатели', 'Segmented · .segmented · .tabs · .segmented--wrap'],
  ['Навигация разделов', 'SectionNav · .section-nav'],
  ['Кнопки', 'Общий отклик :active (scale/brightness; без движения при reduced-motion) · .btn · --primary · --tonal · --ghost · --danger · --small · --wide'],
  ['Выбор действия', 'ActionMenu · .action-menu'],
  ['Флажки и фильтры', '.check · .chip · .plan-layers · .smoothing-stops'],
  ['Ползунки', '.smoothing-slider · .freq-slider · .hrange · .miniplayer__vol'],
  ['Сообщения', 'Toast — краткое подтверждение действия · Note (длинные слова в Toast и Note переносятся — 058) · MicStartHint (причина недоступного запуска со ссылкой на настройку, 054) · CalculationStatus · RoomFirst/PlacementFirst (закрытый экран) · FailurePanel (сбой раздела или приложения) · DraftFailure (рабочий проект не открылся при запуске) · .note · .progress · .spinner'],
  ['Раскрытие', 'Details · .details (в том числе «Архив профилей» микрофона — 054)'],
  ['Шторки', 'ConfirmSheet (danger/primary, cancel, extra, список .plain-list; фокус на отмене только при открытии, текст переносит длинные слова — 058) · .sheet · .sheet-backdrop · .sheet__close'],
  ['Карточки объектов', '.zone-card · .zone-card.is-selected · .zone-card.is-error (не помещается в комнату) · .wall-items · .found-opening · .problem'],
  ['Метки состояния', '.tag · .model-tag · .sev · .robust-tag · .score__grade'],
  ['Показатели', '.stat · .score · .voice-metric · .score-ring · .meter (в том числе доли энергии полос, 052)'],
  ['Таблицы', '.table-scroll · .rt-table · .pos-table · .report-table'],
  ['Списки', '.plain-list · .best-list · .project-list · .advice-list · .steps-list'],
  ['План комнаты', 'PlanView · .plan · .plan__rug · .plan__zone-rect.is-selected · .plan-key · .heat-legend'],
  ['Развёртка стены', 'WallView · .wall-view · __window · __door · __gap · __arch · __carpet · __curtain · __furniture'],
  ['Графики', 'Charts · SmoothedResponseChart · RmsHistoryChart и ResponseChart с кривой калибровки (053), PSD (шумомер, 052) или наложением и разницей двух записей шумомера (is-measured / is-compare / is-room, 056) ·.chart · .chart__unscored (ниже полосы оценки — 045) · .legend (подписи .legend__item переносятся — 058) · .legend__item--unscored · Spectrogram (canvas под осями SVG, .spectrogram, .spectrogram__plot, .spectrogram__image, .color-scale — 055) · LevelHistoryChart (055) · .chart__frame · .chart__gap и .legend__item--gap (нет данных) · .chart__cursor · .chart__pick · ResponseChart marks — расчётные моды поверх спектра шумомера (.chart__mode.is-overlay, .is-selected — 057)'],
  ['3D и сканы', 'Field3D · RoomPreview · ScanPreview · LayoutEditor'],
  ['Аудио', 'MiniPlayer · Auralize · .play-btn · .rta-big'],
  ['Помощь и статус', 'Term · MapModeHelp · WizardStrip · .update-banner · .whatif-strip'],
  ['Экспорт и отчёт', '.export · .report · .report-pre · .compare-table'],
] as const;

/** Exhaustive skins for native controls, used by the browser audit. File inputs are hidden infrastructure,
 * except the native picker of the microphone profile editor inside a .field (053, audited on measure routes since 054). */
export const controlSkins = {
  button: [
    '.btn', '.setting-link', '.segmented button', '.tabs button', '.section-nav button', '.tabbar button',
    '.topbar__menu', '.drawer__item', '.sheet__close', '.update-banner__close',
    '.term', '.chip', '.play-btn', '.hrange__thumb', '.smoothing-stops button', '.action-menu__popup > button',
  ],
  input: [
    '.field__box input', '.field__box select', '.field__box textarea', '.check input',
    '.smoothing-slider', '.freq-slider input', '.miniplayer__vol input', '.export textarea',
    'input[type="file"].visually-hidden', '.field > input[type="file"]',
  ],
} as const;
