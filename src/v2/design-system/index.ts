// Публичные модули Acoustic Lab (v2). Компонент с таким именем вне src/v2/design-system — ошибка design:check.
export { Icon, ICON_NAMES, type IconName } from './Icon';
export { Button, IconButton, buttonClass, type ButtonVariant } from './Button';
export {
  TextField, NumberField, SelectField, Switch, Checkbox, SegmentedControl, Tabs, TabPanel, RangeField, parseNumber, formatNumber, rovingIndex, type Option, type TabItem,
} from './fields';
export {
  Badge, CalcStatus, Notice, ConfirmDialog, Dialog, Sheet, ToastHost, useToast, EmptyState, LoadingState, ErrorState, type BadgeTone, type CalcState, type NoticeTone,
} from './feedback';
export { FrequencyChart, BarChart, Legend, Spectrogram, spectrogramLevel, SPECTROGRAM_LEVELS, useWidth, formatHz, niceTicks, nearestIndex, SERIES_LABEL, type Series, type SeriesKind, type SeriesVariant, type BarSeries } from './charts';
export { MetricCard, DataTable, KeyValue, Card, PageHead, Section, type Column, type MetricTone } from './data';
export { PlanView, PlanLegend, axesFor, type PlanAnnex, type PlanItem, type PlanItemType, type PlanMap, type PlanOpening, type PlanPoint, type PlanViewKind } from './PlanView';
export { PlanHeat, HeatLegend, PlanPath, EventChart, heatLevel, HEAT_LEVELS, type HeatGrid, type PlanPathPoint, type TimeEvent } from './overlays';
export { Sidebar, TabBar, TopBar, type NavItem } from './nav';
export { applyTheme, readTheme, saveTheme, resolvedTheme, THEME_LABEL, type ThemeChoice } from './theme';
