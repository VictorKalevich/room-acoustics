# Tasks: Ручная расстановка, настройка сабвуфера и обработка

**Input**: specs/002-manual-placement-tuning/ · **Tests**: обязательны для ядра (конституция V)

## Phase 1: Foundational

- [x] T101 Типы: Zone, Seats, SubCapabilities, SubSetting, Setup, Measurement, leakage, calibration в src/core/types.ts
- [x] T102 Умолчания, миграция v1 → v2, валидация зон и мест в src/state/project.ts и src/state/storage.ts; тесты в tests/state/project.test.ts
- [x] T103 Негерметичность и множитель затухания в prepareModes (src/core/response.ts); тест «утечка ослабляет НЧ ниже первой моды» в tests/core/response.test.ts
- [x] T104 src/core/system.ts: seatPositions, зоны (pointInZone, sourceAllowed, listenerAllowed), регулировки сабвуфера, evaluateSetup; тесты tests/core/system.test.ts
- [x] T105 Места прослушивания и зоны в автоподборе src/core/placement.ts; тесты в tests/core/placement.test.ts
- [x] T106 Общий воркер src/workers/compute.worker.ts (optimize, listenerMap, subMap, integrate, calibrate)

## Phase 2: US1 + US2 — ручная расстановка и карты (P1)

- [x] T107 [P] [US1] Тесты карт: лучшая точка ≤ текущей, зоны исключены, разнос ≥ 0,4 м в tests/core/field.test.ts
- [x] T108 [US1] listenerHeatmap и subHeatmap в src/core/field.ts
- [x] T109 [US1] PlanEditor с перетаскиванием (pointer events, шаг 5 см), тепловой картой, зонами, местами в src/ui/components/PlanEditor.tsx
- [x] T110 [US1] Экран «Вручную»: режимы «Место слушателя / Место сабвуфера», симметрия, координаты, лучшие точки, АЧХ в выбранной точке в src/ui/screens/ManualScreen.tsx
- [x] T111 [US2] Выбор сабвуфера для поиска, «Поставить сюда», учёт зоны сабвуфера

## Phase 3: US3 — настройка сабвуфера (P1)

- [x] T112 [P] [US3] Тесты: только доступные регулировки, после ≤ до, без задержки → τ = 0, 0/180 → φ ∈ {0,180} в tests/core/integration.test.ts
- [x] T113 [US3] optimizeSubs в src/core/integration.ts
- [x] T114 [US3] Возможности сабвуфера и кроссовера в панели «Система» (src/ui/screens/PlacementScreen.tsx)
- [x] T115 [US3] Вкладка «Настройка»: подбор, до/после, «Применить», ручная правка в src/ui/screens/TuningScreen.tsx

## Phase 4: US4–US7 (P2)

- [x] T116 [US4] Места прослушивания в «Ограничениях» и на всех планах
- [x] T117 [P] [US5] Тесты EQ (только срезы, пик 45 Гц, неровность уменьшается, biquad = эталон RBJ) в tests/core/eq.test.ts
- [x] T118 [US5] designEq, peqResponse, biquad, экспорт в src/core/eq.ts; блок EQ на вкладке «Настройка» с копированием
- [x] T119 [P] [US6] Тесты точек отражений (симметрия, метод мнимого источника) в tests/core/treatment.test.ts
- [x] T120 [US6] reflectionPoints, bassAdvice в src/core/treatment.ts; блок «Обработка» и отметки на плане
- [x] T121 [US7] Зоны и герметичность на экране «Комната»: список, добавление, поля, отображение, поворот с комнатой

## Phase 5: US8–US9 (P3)

- [x] T122 [P] [US8] Тесты parseRew и подстройки по синтетическому замеру в tests/core/measure.test.ts
- [x] T123 [US8] parseRew, compareMeasurement, calibrate в src/core/measure.ts; блок «Замер REW» и EQ по замеру
- [x] T124 [US9] Варианты: сохранить/загрузить/удалить/переименовать, «Открыть в ручном режиме» из автоподбора, сравнение двух

## Phase 6: Polish

- [x] T125 Сквозные сценарии ручного режима и настройки в tests/e2e/app.spec.ts
- [x] T126 Проверка производительности карт и настройки
- [x] T127 README и quickstart фичи
