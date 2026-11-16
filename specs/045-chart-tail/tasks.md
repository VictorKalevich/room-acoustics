# Tasks: 045 — График АЧХ ниже полосы оценки и паспорт спада колонок

**Input**: [spec.md](./spec.md), [plan.md](./plan.md), [research.md](./research.md), [data-model.md](./data-model.md),
[quickstart.md](./quickstart.md).

**Tests**: требуются спецификацией (приёмка 1–7). Номера задач — по правилу проекта (T45xx для 045).

## Phase 1: Setup

- [x] T4501 Ветка `045-chart-tail`, каталог `specs/045-chart-tail/`, спецификация с решениями владельца Р1–Р7, чек-лист
  `checklists/requirements.md`, указатель `.specify/feature.json`; снимок расчётов до правки (с паспортами и без)

## Phase 2: Foundational

- [x] T4502 Модель хвоста (`src/core/chartTail.ts`): `passportApplies`, `tailCurves` (сшивка), `tailHighPass`,
  `tailFloor`, `tailGrid`; `sourceHighPass` (`filters.ts`); `passportRolloff` и `Passport` вместо `subRolloff` и
  `SubPassport` (`deepBass.ts`, `types.ts`)
- [x] T4503 Кривая графика: `filterSet(..., tail)`, `evaluateSetup({ chart })` → `SetupEval.chart` (продолжение
  `response`, модель «Глубже низ»), `ChartCurve`; `toPlacement` → `Placement.chart`; воркер (`evaluate` с `chart`),
  `useSetupEval(..., chart)`
- [x] T4504 Хранение: паспорт у источника любого вида (`normalizeProject`), форма `chart` в `okPlacement`

## Phase 3: User Story 1 — бас ниже полосы на графике (P1)

**Goal**: пользователь видит на графике «Расстановки», что происходит с басом ниже «Диапазона от» — по паспорту колонок
без сабвуфера, по паспорту сабвуфера или по модели цели «Глубже низ», — и что эта часть не входит в оценку.

**Independent Test**: без сабвуфера с паспортом колонок 55 / 40 Гц график начинается около 25 Гц, ниже 50 Гц затенён;
числа всех расчётов — те же, что до 045.

- [x] T4505 [US1] Дизайн-система: `ResponseChart` с `scoredFrom` (затенение `.chart__unscored`, центровка по
  оцениваемой части), пункт легенды `.legend__item--unscored`, реестр, каталог, `docs/design-system.md`
- [x] T4506 [US1] Графики: `PlacementScreen` (вариант, базовая), `ManualScreen` (текущая, сравнение, проба) — линии из
  `chart`, легенда, пояснение «Глубже низ»
- [x] T4507 [US1] Паспорт в «Системе»: `PassportFields` (новый), блок «Спад по паспорту» в `SystemSettings` (колонки —
  только без сабвуфера, сабвуферы), `DeepBassOptions` без паспорта; строки `S.passport`, `S.deep.passportWhere`,
  `S.placement.legendUnscored`, `S.placement.chartDeep`
- [x] T4508 [P] [US1] Тесты ядра `tests/core/chartTail.test.ts`; файл проекта (`project.test.ts`), форма результата
  (`repair.test.ts`); проверка поломкой кода
- [x] T4509 [P] [US1] Сквозной сценарий «045: график ниже полосы оценки…», обновлённый «044: глубже низ…» в
  `tests/e2e/app.spec.ts`; снимки блока паспорта и графика на 320 и 393 px
- [x] T4510 [US1] Исследование: отклонения от предложенного решения, граница и сшивка, «Глубже низ», бит в бит (снимок
  до/после, с паспортами и без), время, интерфейс — `research.md`

## Phase 4: Polish & Cross-Cutting

- [x] T4511 Проверки: `npm test`, `npm run lint`, `npm run build`, `npm run e2e` (Chrome); результаты — в «Реализация и
  проверка» `spec.md`
- [x] T4512 Spec Kit: `spec.md` (статус, реализация и проверка), 044 (место паспорта, паспорт колонок), 009,
  `specs/README.md`, `specs/decisions.md` (D40), `specs/current-state.md`, `specs/deferred.md` (пункт о графике 044
  закрыт, предложение Р7, замеченное), README, дизайн-система
- [x] T4513 Коммит фичи, вливание в `main`, push, проверка запуска CI: запуск для `3560003` отменён следующим push,
  запуск для `c472708` (содержит фичу) — `build` и `deploy` успешно; `e2e-safari` — прежний сбой, не блокирует

## Dependencies

T4501 → T4502 → T4503 → T4504 → T4505–T4510 → T4511 → T4512 → T4513. T4508 и T4509 — разные файлы, параллельно.

## Implementation Strategy

Одна история — она же MVP: модель хвоста и кривая графика как отдельное поле, хранение, интерфейс из дизайн-системы,
тесты и исследование, затем проверки и синхронизация Spec Kit.
