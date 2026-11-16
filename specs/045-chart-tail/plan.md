# Implementation Plan: 045 — График АЧХ ниже полосы оценки и паспорт спада колонок

**Branch**: `045-chart-tail` | **Date**: 2026-11-17 | **Spec**: [spec.md](./spec.md)

## Summary

График «Расстановки» получает отдельную кривую `chart` — продолжение `response` вниз до частоты, где спад источника по
модели −20 дБ (не ниже 20 Гц), или, при цели «Глубже низ», кривую по модели этой цели. Модуль `src/core/chartTail.ts`
строит модель спада ниже полосы (паспорт со сшивкой на нижней границе полосы или номинальный спад), находит границу и
сетку; `evaluateSetup` считает кривую только по запросу `chart: true` тем же путём (`rawResponses`, `filterSet`), что и
`response`, а `response`, оценки и все другие расчёты не трогает. Паспорт спада становится полем источника любого вида:
у колонок он действует только без сабвуфера. Интерфейс: блок «Спад по паспорту» в «Системе» (`PassportFields`,
`Details`), затенение неоцениваемой части графика и пункт легенды в дизайн-системе. Решения и числа —
[research.md](./research.md).

## Technical Context

**Language/Version**: TypeScript (стек проекта без изменений, новых зависимостей нет).

**Primary Dependencies**: нет новых; ядро — чистые функции `src/core`, интерфейс — Preact и дизайн-система.

**Storage**: `SourceSpec.passport` у колонок (прежде убирался); `Placement.chart` в сохранённом результате подбора —
необязательное ([data-model.md](./data-model.md)); версия формата файла не меняется.

**Testing**: Vitest (unit), Playwright (сквозные сценарии, Chrome; WebKit — в CI, не блокирует).

**Target Platform**: браузер, PWA на iPhone; расчёты — в воркерах (задача `evaluate` получает флаг `chart`).

**Project Type**: клиентское веб-приложение.

**Performance Goals**: время подбора — прежнее (кривая считается только у итоговых вариантов и базовой, поиск и карты её
не считают); оценка варианта для графика — на доли миллисекунды дольше в прямоугольной модели, в волновой — в пределах
разброса ([research.md](./research.md), R5).

**Constraints**: числа всех расчётов — бит в бит с паспортами и без (FR-4511); `response` и `evalBand` не меняются;
модели, формулы и сетки расчётов не меняются.

**Scale/Scope**: `src/core/chartTail.ts` (новый), `types.ts`, `filters.ts`, `system.ts`, `placement.ts`, `deepBass.ts`
(переименования); `src/state/storage.ts`, `shape.ts`; воркер (`computeJobs.ts`, `computeHandlers.ts`); `useEval.ts`;
дизайн-система (`Charts.tsx`, `components.css`, реестр, каталог, документ); `PassportFields` (новый), `DeepBassOptions`,
`SystemSettings`, `PlacementScreen`, `ManualScreen`; строки; тесты.

## Constitution Check

| Принцип | Проверка | Статус |
| --- | --- | --- |
| I. Сохранение расчётного поведения | Кривая графика — отдельное поле по запросу; `response`, оценки, подбор, карты и остальные расчёты не меняются: снимок до/после на 3 комнатах × 3 системах × 6 целях × 2 подъёмах низа, с паспортами и без — бит в бит | ✅ |
| II. Сохранение функций и связей | Паспорт — поле источника в общем проекте; паспорт сабвуфера тот же, что читает «Глубже низ» (теперь в «Системе»); паспорт колонок хранится и при сабвуфере; старые проекты и результаты подбора читаются | ✅ |
| III. Единый интерфейс | `Details`, `NumberField` (необязательное), `Segmented`, `Note`, `.range-row`, `.sub-caps`, `.legend`; новое затенение и пункт легенды — в систему, реестр, каталог, документ; 320 и 393 px — снимком | ✅ |
| IV. Честный смысл и проверка | Ниже полосы — модель, не замер, и часть не оценивается — затенение и подпись; ниже −10 дБ паспорт продолжен по модели — сказано; расхождения с предложенным решением и влияние — в research; тесты проверены поломкой кода | ✅ |
| V. Spec Kit при завершении | spec, plan, research, data-model, quickstart, tasks; 044 (место паспорта, паспорт колонок), индекс, решения (D40), current-state, отложенное, README, дизайн-система | ✅ — в задачах |

## Project Structure

### Documentation (this feature)

```text
specs/045-chart-tail/
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
src/core/chartTail.ts      # TAIL_DB, TAIL_MIN_HZ, passportApplies, tailCurves, tailHighPass, tailFloor, tailGrid
src/core/filters.ts        # sourceHighPass
src/core/system.ts         # filterSet(..., tail); evaluateSetup({ chart }) → SetupEval.chart
src/core/placement.ts      # toPlacement запрашивает кривую графика → Placement.chart
src/core/deepBass.ts       # passportRolloff (было subRolloff), Passport (было SubPassport)
src/core/types.ts          # Passport, ChartCurve, Placement.chart
src/state/storage.ts       # паспорт у источника любого вида
src/state/shape.ts         # okPlacement: форма chart
src/workers/computeJobs.ts, computeHandlers.ts   # evaluate: chart
src/ui/useEval.ts          # useSetupEval(..., chart)
src/ui/components/Charts.tsx        # ResponseChart scoredFrom, chartCurve
src/ui/design-system/      # .chart__unscored, .legend__item--unscored; реестр, каталог
src/ui/components/PassportFields.tsx (новый), DeepBassOptions.tsx
src/ui/screens/placement/SystemSettings.tsx, PlacementScreen.tsx, ManualScreen.tsx
src/ui/strings.ts          # S.passport, S.deep.passportWhere, S.placement.legendUnscored, chartDeep
tests/core/chartTail.test.ts (новый), tests/state/project.test.ts, tests/state/repair.test.ts, tests/e2e/app.spec.ts
```

**Structure Decision**: однопроектная структура; модель хвоста — модуль ядра, кривая графика — необязательный выход
`evaluateSetup`, который запрашивают только графики «Расстановки» и итоговые варианты автоподбора.

## Complexity Tracking

Нарушений нет.
