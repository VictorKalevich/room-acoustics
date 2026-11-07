# Tasks: Акустический калькулятор комнаты (MVP)

**Input**: Design documents from `/specs/001-room-acoustics-mvp/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: обязательны для ядра и распознавания (конституция, принцип V, test-first);
для UI — сквозные сценарии Playwright.

## Format: `[ID] [P?] [Story] Description`

## Phase 1: Setup

- [x] T001 Создать package.json, tsconfig.json (strict), vite.config.ts (base './', PWA, worker format 'es') и index.html в корне репозитория
- [x] T002 [P] Настроить Vitest (vitest.config через vite.config.ts) и Playwright (playwright.config.ts, профиль iPhone) с npm-скриптами test, e2e, build, dev, preview, fixtures
- [x] T003 [P] Добавить .gitignore, README.md и иконки PWA в public/icons/

## Phase 2: Foundational

- [x] T004 Описать типы ядра (Room, Material, Mode, ReverbResult, SourceSpec, Constraints, Placement, PlacementResult, Vec3, Complex) в src/core/types.ts по data-model.md
- [x] T005 [P] Тест и реализация скорости звука c = 331,3·√(1 + t/273,15) в tests/core/physics.test.ts и src/core/physics.ts
- [x] T006 [P] Справочник 16 материалов (α по октавам 63…4000 Гц, 0 < α < 1, extrapolated63, source) и меблировка в src/core/materials.ts; тест диапазонов в tests/core/materials.test.ts
- [x] T007 [P] Сетки частот logFreqs и комплексная арифметика в src/core/frequency.ts с тестом tests/core/frequency.test.ts
- [x] T008 Модель проекта, умолчания (комната 5 × 4 × 2,5, «типичная» меблировка, колонки 80–20000, сабвуфер 20–80) и валидация диапазонов (1 ≤ размер ≤ 50 м; height ≤ 20; 10 ≤ fLow < fHigh ≤ 24000) в src/state/project.ts
- [x] T009 Каркас UI: App с нижней навигацией (Комната, Моды, Расстановка, Проекты), строки в src/ui/strings.ts, стили src/styles.css (safe-area, цели ≥ 44 pt), src/main.tsx

**Checkpoint**: проект собирается, тесты запускаются.

## Phase 3: User Story 1 — Расчёт мод по размерам (P1) 🎯 MVP

**Goal**: ввод размеров → таблица и график мод с предупреждениями.

**Independent Test**: 5 × 4 × 2,5 м → 34,3 / 42,9 / 54,9 / 68,6 Гц.

- [x] T010 [P] [US1] Тесты мод (эталоны, классификация, вырождение 4 × 4 × 2, сортировка, fMax) в tests/core/modes.test.ts — должны падать
- [x] T011 [US1] Реализовать computeModes, bonelloCheck, proportionsNote в src/core/modes.ts
- [x] T012 [P] [US1] Компонент числового поля с валидацией в src/ui/components/NumberField.tsx
- [x] T013 [US1] Экран «Комната» (ручной ввод, поворот комнаты, температура) в src/ui/screens/RoomScreen.tsx
- [x] T014 [P] [US1] SVG-график распределения мод в src/ui/components/ModeChart.tsx
- [x] T015 [US1] Экран «Моды» (таблица, график, предупреждения, критерий Бонелло, допущения) в src/ui/screens/ModesScreen.tsx

## Phase 4: User Story 2 — Подбор расстановки (P1)

**Goal**: 3 лучших варианта с оценкой, планом и АЧХ за ≤ 10 с.

**Independent Test**: 5 × 4 × 2,5, пара колонок + сабвуфер → 3 варианта, лучший не хуже базового.

- [x] T016 [P] [US2] Тесты фильтров (LR4: сумма ФНЧ+ФВЧ по модулю 1 на всех частотах; Баттерворт −3 дБ на срезе) в tests/core/filters.test.ts
- [x] T017 [P] [US2] Тесты модальной передаточной функции (пик на частоте моды, нуль в узле моды, симметрия src↔rcv, затухание = Сэбин для косых мод) в tests/core/response.test.ts
- [x] T018 [P] [US2] Тесты метрики (плоская → 0; синус ±A → A/√2) в tests/core/metric.test.ts
- [x] T019 [P] [US2] Тесты расстановки (соблюдение ограничений, детерминизм, лучший ≤ базового, невыполнимые ограничения → PlacementError, диапазон сабвуфера влияет на оценку) в tests/core/placement.test.ts
- [x] T020 [US2] Реализовать sourceFilter в src/core/filters.ts
- [x] T021 [US2] Реализовать modeDamping и transfer в src/core/response.ts
- [x] T022 [US2] Реализовать flatnessScore и геометрические штрафы в src/core/metric.ts
- [x] T023 [US2] Реализовать кандидатов, baselinePlacement, evaluatePlacement, optimizePlacement в src/core/placement.ts
- [x] T024 [US2] Воркер подбора с прогрессом в src/workers/placement.worker.ts
- [x] T025 [P] [US2] SVG-план комнаты с источниками, слушателем, размерами в src/ui/components/PlanView.tsx
- [x] T026 [P] [US2] SVG-график АЧХ (комната и цель) в src/ui/components/ResponseChart.tsx
- [x] T027 [US2] Экран «Расстановка» (источники и диапазоны, ограничения, запуск, прогресс, варианты, сравнение с базовым, допущения) в src/ui/screens/PlacementScreen.tsx

## Phase 5: User Story 3 — Загрузка скана (P2)

**Goal**: файл скана → размеры комнаты с уверенностью и превью.

**Independent Test**: синтетический скан 5 × 4 × 2,5 с мебелью → ±5 см.

- [x] T028 [P] [US3] Генератор синтетических сканов (комната, мебель, шум, поворот, Y/Z-up, единицы, без потолка, Г-образная) в tests/fixtures/synthetic.ts и скрипт scripts/make-fixtures.ts (OBJ/STL)
- [x] T029 [P] [US3] Тесты распознавания по контракту scan-import в tests/scan/detect.test.ts
- [x] T030 [US3] Реализовать detectRoom в src/scan/detect.ts
- [x] T031 [US3] Воркер распознавания в src/workers/detect.worker.ts
- [x] T032 [US3] Загрузка OBJ/GLB/glTF/PLY/STL через three.js, сигнатуры, прореживание > 2 млн, ошибки ScanError в src/scan/load.ts
- [x] T033 [P] [US3] 3D-превью скана с наложенным объёмом в src/ui/components/ScanPreview.tsx (ленивая загрузка three.js)
- [x] T034 [US3] Блок импорта на экране «Комната»: выбор файла, прогресс, уверенность, предупреждения, смена единиц, подтверждение размеров в src/ui/screens/RoomScreen.tsx

## Phase 6: User Story 4 — Материалы и реверберация (P2)

**Goal**: материалы шести поверхностей → RT60 по октавам и частота Шрёдера.

**Independent Test**: RT60 совпадает с ручным расчётом ±0,01 с.

- [x] T035 [P] [US4] Тесты реверберации (Сэбин/Эйринг вручную, выбор формулы при ᾱ > 0,2, Шрёдер, ковёр уменьшает ВЧ RT60) в tests/core/reverb.test.ts
- [x] T036 [US4] Реализовать computeReverb и schroederFrequency в src/core/reverb.ts
- [x] T037 [US4] Выбор материалов и меблировки, таблица RT60 и частота Шрёдера на экране «Комната» в src/ui/screens/RoomScreen.tsx и src/ui/components/MaterialPicker.tsx
- [x] T038 [US4] Подключить RT60/Шрёдера к модам (верхняя граница) и затуханию в расстановке

## Phase 7: User Story 5 — Проекты и офлайн (P3)

- [x] T039 [P] [US5] Тесты сериализации и валидации файла проекта в tests/state/project.test.ts
- [x] T040 [US5] IndexedDB-хранилище, экспорт/импорт файла по контракту project-file в src/state/storage.ts
- [x] T041 [US5] Экран «Проекты» (список, сохранить, открыть, удалить, экспорт, импорт, предупреждение о приватном режиме) в src/ui/screens/ProjectsScreen.tsx
- [x] T042 [US5] PWA: манифест (имя, иконки, standalone, тема), service worker с precache в vite.config.ts

## Phase 8: Polish

- [x] T043 [P] Сквозные сценарии quickstart (US1–US4) в tests/e2e/app.spec.ts, эмуляция iPhone
- [x] T044 Проверка производительности подбора (≤ 10 с, 2 сабвуфера) в tests/core/perf.test.ts
- [x] T045 [P] README: запуск, публикация на GitHub Pages, рекомендации по сканированию
- [x] T046 Прогнать quickstart.md и скриншоты в эмуляции iPhone

## Dependencies & Execution Order

- Setup → Foundational → US1 → US2 (использует моды) → US4 (уточняет затухание) ; US3 и US5
  независимы от US2 и могут идти параллельно после Foundational.
- Внутри истории: тесты → ядро → воркер → UI.

## Parallel Example: User Story 2

```text
T016, T017, T018, T019 — тесты в разных файлах, параллельно
T025, T026 — независимые SVG-компоненты
```

## Implementation Strategy

MVP = US1 + US2 (ручной ввод размеров + подбор расстановки). Затем US4 (точность), US3
(удобство скана), US5 (сохранение и офлайн). Каждая история проверяется своим Independent Test.
