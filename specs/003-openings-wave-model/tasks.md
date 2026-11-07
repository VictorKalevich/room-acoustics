# Tasks: Проёмы, смежные помещения и волновая модель

**Tests**: обязательны для ядра (конституция V)

## Phase 1: Foundational

- [x] T201 Типы Opening, Extension, AcousticModel; поля room.openings, room.extensions, room.model в src/core/types.ts
- [x] T202 Умолчания, миграция v2 → v3, поворот проёмов и коридоров, валидация в src/state/project.ts, src/state/storage.ts; тесты
- [x] T203 Проёмы как поглощение в прямоугольной модели (src/core/reverb.ts); тест

## Phase 2: US3 — волновая модель (P1)

- [x] T204 [P] Тесты: блоки и воксели, блокировка стены вне арки, моды прямоугольной комнаты ±2 %, коридор понижает/добавляет моды в tests/core/geometry.test.ts, tests/core/fdtd.test.ts
- [x] T205 src/core/geometry.ts — блоки, проёмы, β граней
- [x] T206 src/core/fdtd.ts — сетка, симуляция, запись слоёв, спектры, моды системы
- [x] T207 src/core/acoustics.ts — провайдер modal/wave с кэшем; подключение к system.ts, field.ts, placement.ts
- [x] T208 Постоянный воркер с очередью и асинхронная оценка в интерфейсе (src/ui/compute.ts, хук useEvaluation)

## Phase 3: US1/US2 — проёмы, коридор, разбор скана (P1)

- [x] T209 [P] Тесты разбора планировки на синтетическом скане с аркой и коридором в tests/scan/layout.test.ts
- [x] T210 src/scan/layout.ts и вызов в воркере распознавания
- [x] T211 Редактор области скана (src/ui/components/LayoutEditor.tsx) в блоке скана
- [x] T212 Панель «Проёмы и смежные помещения» и выбор модели на экране «Комната»; отображение на планах

## Phase 4: US3/US4 — моды системы и выбор модели (P1/P2)

- [x] T213 Моды системы на экране «Моды»; модель расчёта указана у результатов

## Phase 5: Polish

- [x] T214 Сквозные сценарии (коридор, волновая модель, разбор скана) в tests/e2e/app.spec.ts
- [x] T215 Производительность FDTD; README
