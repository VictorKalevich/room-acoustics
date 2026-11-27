// Реестр Acoustic Lab (V2-015): семейства компонентов, текстовые стили и токены. По нему строится каталог
// (`#/catalog`) и проверяется полнота: каждый публичный компонент из index.ts есть здесь, каждый класс — в стилях.
export interface Family { id: string; title: string; components: readonly string[]; classes: readonly string[]; note: string }

export const families: readonly Family[] = [
  { id: 'buttons', title: 'Кнопки', components: ['Button', 'IconButton'], classes: ['al-btn', 'al-btn--primary', 'al-btn--secondary', 'al-btn--ghost', 'al-btn--danger', 'al-btn--danger-ghost', 'al-btn--small', 'al-btn--block', 'al-btn--icon'], note: 'Высота 48 px, малая — 36 px; кнопка-значок с подписью; занятая — с индикатором' },
  { id: 'fields', title: 'Поля', components: ['TextField', 'NumberField', 'SelectField', 'RangeField'], classes: ['al-field', 'al-field__box', 'al-field__label', 'al-field__hint', 'al-field__error', 'al-field__unit', 'al-field--compact', 'al-field--error', 'al-range'], note: 'Число принимает запятую; пустое — NaN; ошибка с допустимым диапазоном' },
  { id: 'toggles', title: 'Переключатели и вкладки', components: ['Switch', 'Checkbox', 'SegmentedControl', 'Tabs', 'TabPanel'], classes: ['al-switch', 'al-check', 'al-segmented', 'al-segmented__item', 'al-tabs', 'al-tabs__tab'], note: 'Стрелки, Home и End переводят выбор' },
  { id: 'feedback', title: 'Метки и статусы', components: ['Badge', 'CalcStatus', 'Notice'], classes: ['al-badge', 'al-status', 'al-progress', 'al-notice'], note: 'Вид результата — значком и подписью, не только цветом' },
  { id: 'overlays', title: 'Диалоги, шторки, уведомления', components: ['ConfirmDialog', 'Dialog', 'Sheet', 'ToastHost'], classes: ['al-scrim', 'al-dialog', 'al-sheet', 'al-toasts', 'al-toast'], note: 'Фокус внутри, Esc закрывает, фокус возвращается; опасное действие — не по Enter' },
  { id: 'states', title: 'Состояния раздела', components: ['EmptyState', 'LoadingState', 'ErrorState'], classes: ['al-state', 'al-skeleton'], note: 'Пусто, загрузка, ошибка с повтором' },
  { id: 'data', title: 'Метрики и таблицы', components: ['MetricCard', 'DataTable', 'KeyValue'], classes: ['al-metric', 'al-table-wrap', 'al-table', 'al-kv'], note: 'Неизвестное — прочерк с пояснением, не ноль' },
  { id: 'charts', title: 'Графики и легенды', components: ['FrequencyChart', 'BarChart', 'Legend'], classes: ['al-chart', 'al-chart__line', 'al-chart__bar', 'al-legend', 'al-chart__empty'], note: 'Измерение — сплошная, расчёт — штрих, эксперимент — пунктир; курсор стрелками' },
  { id: 'plan', title: 'План помещения', components: ['PlanView', 'PlanLegend'], classes: ['al-plan', 'al-plan__object', 'al-plan-legend'], note: 'Сверху, сбоку, спереди; выбор, перетаскивание, стрелки' },
  { id: 'layout', title: 'Каркас и навигация', components: ['Card', 'PageHead', 'Section', 'Sidebar', 'TabBar', 'TopBar'], classes: ['al-app', 'al-sidebar', 'al-tabbar', 'al-topbar', 'al-content', 'al-card', 'al-section', 'al-list', 'al-split', 'al-grid', 'al-stack', 'al-row'], note: 'Боковая панель от 1024 px, нижняя — до 1024 px; safe-area' },
  { id: 'screens', title: 'Блоки экранов', components: [], classes: ['al-choices', 'al-choice', 'al-tiles', 'al-tile', 'al-tile--feature', 'al-tile__link', 'al-list__item--wrap', 'al-list__link'], note: 'Выбор карточкой (радиокнопка внутри), плитки разделов и инструментов: вся плитка — ссылка, кнопки поверх' },
  { id: 'icons', title: 'Значки', components: ['Icon'], classes: ['al-icon'], note: 'Контурные 24 × 24, currentColor; декоративные скрыты от чтения с экрана' },
];

export const textStyles = [
  ['al-text-headline', 'Заголовок страницы, 28'],
  ['al-text-title', 'Заголовок диалога, 22'],
  ['al-text-lead', 'Заголовок блока, 18'],
  ['al-text-body', 'Основной текст, 16'],
  ['al-text-small', 'Вспомогательный текст, 14'],
  ['al-text-caption', 'Подпись, 12'],
  ['al-text-overline', 'Надзаголовок, 12 прописными'],
] as const;

export const spacing = ['--al-space-4', '--al-space-8', '--al-space-12', '--al-space-16', '--al-space-24', '--al-space-32'] as const;
export const radii = ['--al-radius-8', '--al-radius-12', '--al-radius-16'] as const;

export const colorRoles = [
  ['--al-color-background', 'Фон'], ['--al-color-surface', 'Поверхность'], ['--al-color-text', 'Основной текст'], ['--al-color-text-secondary', 'Вторичный текст'],
  ['--al-color-border', 'Граница'], ['--al-color-accent', 'Акцент'], ['--al-color-on-accent', 'Текст на акценте'], ['--al-color-current', 'Текущая конфигурация'],
  ['--al-color-experimental', 'Эксперимент'], ['--al-color-measured', 'Измерение'], ['--al-color-predicted', 'Прогноз'], ['--al-color-warning', 'Предупреждение'], ['--al-color-danger', 'Опасность'],
  ['--al-plan-source', 'План: источники'], ['--al-plan-listener', 'План: слушатели'], ['--al-plan-absorber', 'План: панели'], ['--al-plan-bass-trap', 'План: басовые ловушки'],
  ['--al-plan-diffuser', 'План: диффузоры'], ['--al-plan-interior', 'План: интерьер'],
] as const;
