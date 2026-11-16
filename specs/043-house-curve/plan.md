# Implementation Plan: 043 — Цель с подъёмом низа («домашняя кривая»)

**Branch**: `043-house-curve` | **Date**: 2026-11-16 | **Spec**: [spec.md](./spec.md)

## Summary

Целевая кривая (`filterSet` → `target`) получает необязательное слагаемое — полку второго порядка с серединой перехода
105 Гц и величиной 3 / 6 / 9 дБ (`src/core/houseCurve.ts`). Величина хранится в ограничениях проекта
(`constraints.houseCurve`) и передаётся туда, где кривая строится: оценка расстановки, автоподбор, карты, «Подобрать
настройки», «Подобрать фильтры сабвуферов». Остальное (эквалайзер, «Обзор», ловушки, «Отчёт») берёт кривую из оценки.
Предотбор колонок в их полосе остаётся по номинальной кривой, прослушивание EQ — от номинальной кривой. Сравнение замеров
получает кривую подъёма. Выбор — `Segmented` «Подъём низа» в «Цели подбора». При «Ровно» слагаемого нет: числа бит в
бит прежние. Решения и числа — [research.md](./research.md).

## Technical Context

**Language/Version**: TypeScript (стек проекта без изменений, новых зависимостей нет).

**Primary Dependencies**: нет новых; ядро — чистые функции `src/core`, интерфейс — Preact и дизайн-система.

**Storage**: новое необязательное поле `constraints.houseCurve` (см. [data-model.md](./data-model.md)); версия формата
файла не меняется.

**Testing**: Vitest (unit), Playwright (сквозные сценарии, Chrome; WebKit — в CI, не блокирует).

**Target Platform**: браузер, PWA на iPhone; расчёты — в воркерах (передают ограничения проекта целиком).

**Project Type**: клиентское веб-приложение.

**Performance Goals**: время расчётов прежнее — подъём добавляется один раз при построении кривой.

**Constraints**: «Ровно» — бит в бит; модели, формулы целей, сетки, пределы регулировок не меняются (FR-4310).

**Scale/Scope**: `src/core/houseCurve.ts` (новый), `system.ts`, `field.ts`, `placement.ts`, `integration.ts`,
`subfilters.ts`, `types.ts`; `src/state/storage.ts`; экраны «Расстановка» (общий блок, оба режима), «Настройка»
(сабвуфер, эквалайзер), «Отчёт», сравнение замеров; строки; тесты.

## Constitution Check

| Принцип | Проверка | Статус |
| --- | --- | --- |
| I. Сохранение расчётного поведения | Меняется только целевая кривая по согласованной задаче T913 и только при выбранном подъёме; модели, формулы целей, сетки, критерии поиска — прежние; «Ровно» бит в бит (18 наборов) | ✅ |
| II. Сохранение функций и связей | Подъём — поле общих ограничений проекта, как цель подбора: действует на все инструменты; смена — устаревший результат подбора и сброс результатов «Настройки» прежним механизмом; старые проекты — «Ровно» | ✅ |
| III. Единый интерфейс | `Segmented`, `muted small`, легенда графика — существующие элементы дизайн-системы; новых элементов, стилей, отступов нет; ширина 320 px проверена снимком | ✅ |
| IV. Честный смысл и проверка | Форма — по опубликованному исследованию, без выдачи за кривую Harman; влияние на подбор, настройку и эквалайзер записано; тесты проверены поломкой кода | ✅ |
| V. Spec Kit при завершении | spec, plan, research, data-model, quickstart, tasks, 010, 009, индекс, решения (D38), current-state, отложенное, README | ✅ — в задачах |

Повторная проверка после проектирования: нарушений нет.

## Project Structure

### Documentation (this feature)

```text
specs/043-house-curve/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── checklists/requirements.md
└── tasks.md
```

Контрактов нет: внешних интерфейсов у функции нет.

### Source Code (repository root)

```text
src/core/houseCurve.ts     # HOUSE_RISES, HOUSE_F0, houseDb, normalizeHouseRise
src/core/types.ts          # HouseRise, Constraints.houseCurve, PlacementResult.houseCurve
src/core/system.ts         # filterSet(..., rise): target + подъём; evaluateSetup
src/core/field.ts          # карты слушателя и сабвуфера
src/core/placement.ts      # автоподбор; предотбор колонок без подъёма; результат помнит подъём
src/core/integration.ts    # «Подобрать настройки»; пояснение у нижнего предела уровня
src/core/subfilters.ts     # «Подобрать фильтры сабвуферов»
src/state/storage.ts       # чтение поля из файла и хранилища
src/ui/strings.ts          # S.house
src/ui/screens/placement/SystemSettings.tsx, PlacementScreen.tsx, ManualScreen.tsx
src/ui/screens/tuning/SubPanel.tsx, EqPanel.tsx; ReportScreen.tsx
src/ui/components/MeasureCompare.tsx, screens/measure/MeasurePanel.tsx, MeasureScreen.tsx
tests/core/houseCurve.test.ts, tests/state/project.test.ts, tests/e2e/app.spec.ts
```

**Structure Decision**: однопроектная структура репозитория; подъём — одна функция в ядре и параметр там, где
строится целевая кривая.

## Complexity Tracking

Нарушений нет.
