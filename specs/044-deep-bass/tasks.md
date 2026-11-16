# Tasks: 044 — Цель подбора «Глубже низ»

**Input**: [spec.md](./spec.md), [plan.md](./plan.md), [research.md](./research.md), [data-model.md](./data-model.md),
[quickstart.md](./quickstart.md).

**Tests**: требуются спецификацией (приёмка 1–8). Номера задач — по правилу проекта (T44xx для 044).

## Phase 1: Setup

- [x] T4401 Ветка `044-deep-bass`, каталог `specs/044-deep-bass/`, спецификация с уточнениями владельца, чек-лист
  `checklists/requirements.md`, указатель `.specify/feature.json`; снимок расчётов до правки (с паспортом и без)

## Phase 2: Foundational

- [x] T4402 Спад и план цели (`src/core/deepBass.ts`): `butterworthHp`, `subRolloff`, `autoDeepHz`, `deepPlan`,
  `normalizePassport`; типы `SubPassport`, `Enclosure`, `DeepDrop`, `LowReach`, `ObjectiveId 'deep'`,
  `BassObjective.deepHz/deepDrop`, `SetupEval.low`, `Placement.low`
- [x] T4403 Фильтры по плану цели: `sourceFilter` через части, `sourceLowPass` (`filters.ts`); `filterSet(..., plan)`
  (`system.ts`); без плана — прежний путь
- [x] T4404 Оценка «Глубже низ»: `makeScorer(..., plan)`, `lowReach`, `normalizeObjective` (`objective.ts`)
- [x] T4405 Ветка цели в расчётах: `evaluateSetup` (objScore и `low`), автоподбор (`placement.ts`, `Placement.low`),
  карты (`field.ts`); проверка формы результата (`shape.ts`)

## Phase 3: User Story 1 — подбор места, где комната продлевает бас (P1)

**Goal**: пользователь вводит паспорт спада сабвуфера, выбирает «Глубже низ» и получает расстановку, где бас держится
ниже, с оценкой и строкой о низе.

**Independent Test**: в комнате из скана владельца при S10.4 «Глубже низ» даёт уровень на частоте цели выше, чем лучший
по ровности вариант; другие цели — те же числа, что до 044.

- [x] T4406 [US1] Хранение: паспорт сабвуфера в `normalizeProject` (`src/state/storage.ts`); тесты в
  `tests/state/project.test.ts`
- [x] T4407 [US1] Дизайн-система: необязательное `NumberField` (пустой ввод — `NaN` без ошибки), реестр, каталог,
  `docs/design-system.md`
- [x] T4408 [US1] Интерфейс: «Глубже низ» в `ObjectivePicker`; `DeepBassOptions` (частота цели, допустимый спад,
  паспорт каждого сабвуфера, предупреждения) в `SystemSettings`; строка о низе в `ScoreBlock` (ручной режим, варианты,
  «Обработка»); строки `S.objective`, `S.deep`
- [x] T4409 [P] [US1] Тесты ядра `tests/core/deepBass.test.ts` (приёмка 1–3); проверка поломкой кода
- [x] T4410 [P] [US1] Сквозной сценарий «044: глубже низ…» в `tests/e2e/app.spec.ts` (приёмка 6); снимки блока на
  320 и 393 px
- [x] T4411 [US1] Исследование: бит в бит (снимок до/после, с паспортом и без), что выбирает цель на нескольких комнатах и
  чего это стоит по ровности, время — `research.md`

## Phase 4: Polish & Cross-Cutting

- [x] T4412 Проверки: `npm test`, `npm run lint`, `npm run build`, `npm run e2e` (Chrome); результаты — в «Реализация и
  проверка» `spec.md`
- [x] T4413 Spec Kit: `spec.md` (статус, реализация и проверка), 009 (таблица целей), `specs/README.md`,
  `specs/decisions.md` (D39), `specs/current-state.md`, `specs/deferred.md` (если что-то замечено), README
- [ ] T4414 Коммит фичи, вливание в `main`, push, проверка запуска CI

## Dependencies

T4401 → T4402 → T4403 → T4404 → T4405 → T4406–T4411 → T4412 → T4413 → T4414. T4409 и T4410 — разные файлы, параллельно.

## Implementation Strategy

Одна история — она же MVP: модуль спада и ветка цели в расчётах, хранение, интерфейс из дизайн-системы, тесты и
исследование, затем проверки и синхронизация Spec Kit.
