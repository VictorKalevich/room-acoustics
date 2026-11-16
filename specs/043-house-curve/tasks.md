# Tasks: 043 — Цель с подъёмом низа («домашняя кривая»)

**Input**: [spec.md](./spec.md), [plan.md](./plan.md), [research.md](./research.md), [data-model.md](./data-model.md),
[quickstart.md](./quickstart.md).

**Tests**: требуются спецификацией (приёмка 1–10). Номера задач — по правилу проекта (T43xx для 043).

## Phase 1: Setup

- [x] T4301 Ветка `043-house-curve`, каталог `specs/043-house-curve/`, спецификация с ответами владельца, чек-лист
  `checklists/requirements.md`, указатель `.specify/feature.json`

## Phase 2: Foundational

- [x] T4302 Кривая подъёма (`src/core/houseCurve.ts`): `HOUSE_RISES`, `HOUSE_F0 = 105`, `houseDb` (полка второго
  порядка, Q = 1/√2), `normalizeHouseRise`; тип `HouseRise`, `Constraints.houseCurve` (`src/core/types.ts`)
- [x] T4303 Целевая кривая с подъёмом: `filterSet(..., rise)` и `evaluateSetup` (`system.ts`), карты (`field.ts`),
  автоподбор (`placement.ts`; предотбор колонок — по номинальной кривой), «Подобрать настройки» (`integration.ts`),
  «Подобрать фильтры сабвуферов» (`subfilters.ts`); «Ровно» — без слагаемого

## Phase 3: User Story 1 — подбор, настройка и эквалайзер по кривой с подъёмом (P1)

**Goal**: пользователь выбирает подъём низа, и все расчёты баса стремятся к кривой с подъёмом.

**Independent Test**: в комнате, где «Подобрать настройки» при «Ровно» уводит уровень сабвуфера на −6 дБ, при +6 дБ
уровень выше; широкий подъём низа эквалайзер при +6 дБ не срезает.

- [x] T4304 [US1] Хранение: `normalizeProject` читает `constraints.houseCurve` через `normalizeHouseRise`
  (`src/state/storage.ts`); тесты в `tests/state/project.test.ts`
- [x] T4305 [US1] Пояснение у нижнего предела уровня сабвуфера (`settingNotes`, `integration.ts`): при «Ровно» —
  совет выбрать подъём; при подъёме — комната поднимает низ сильнее выбранного
- [x] T4306 [US1] Интерфейс: `Segmented` «Подъём низа» с пояснением и сводка (`SystemSettings.tsx`); подпись пунктира
  (`PlacementScreen.tsx` — по подъёму результата, `PlacementResult.houseCurve`; `ManualScreen.tsx`); строки на
  «Сабвуфере», «Эквалайзере» и в «Отчёте»; прослушивание EQ от номинальной кривой (`EqPanel.tsx`); сравнение замеров по
  кривой подъёма (`MeasureCompare.tsx`, `MeasurePanel.tsx`, `MeasureScreen.tsx`); строки `S.house`
- [x] T4307 [P] [US1] Тесты ядра `tests/core/houseCurve.test.ts` (приёмка 1–2, 4–6); проверка поломкой кода — каждое
  место возврата к ровной цели и подъём в предотборе колонок роняют тесты
- [x] T4308 [P] [US1] Сквозной сценарий «043: подъём низа…» в `tests/e2e/app.spec.ts` (приёмка 8); снимки блока на 320 и
  393 px
- [x] T4309 [US1] Исследование: форма, где действует цель, «Ровно» бит в бит (18 наборов), автоподбор (72 случая),
  настройка сабвуфера и эквалайзер при тех же местах, фильтры сабвуферов — `research.md`

## Phase 4: Polish & Cross-Cutting

- [x] T4310 Проверки: `npm test`, `npm run lint`, `npm run build`, `npm run e2e` (Chrome); результаты — в «Реализация и
  проверка» `spec.md`
- [x] T4311 Spec Kit: `spec.md` (статус, FR-4303 и FR-4307 по итогам проверки, реализация и проверка), 010 (T913
  закрыта, «Известные ограничения»), 009 (что оценивают «Настройка», «Обзор», «Отчёт»), `specs/README.md`,
  `specs/decisions.md` (D38), `specs/current-state.md`, `specs/deferred.md` (T913 из таблицы незавершённых), README
- [ ] T4312 Коммит фичи, вливание в `main`, push, проверка запуска CI

## Dependencies

T4301 → T4302 → T4303 → T4304–T4309 → T4310 → T4311 → T4312. T4307 и T4308 — разные файлы, параллельно.

## Implementation Strategy

Одна история — она же MVP: кривая и её передача в расчёты, хранение, интерфейс, тесты и исследование, затем проверки и
синхронизация Spec Kit.
