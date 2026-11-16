# Implementation Plan: 044 — Цель подбора «Глубже низ»

**Branch**: `044-deep-bass` | **Date**: 2026-11-16 | **Spec**: [spec.md](./spec.md)

## Summary

Новая цель подбора `deep` в ряду целей 009. Её расчёт — отдельная ветка там, где цель уже действует: своя сетка частот
(от частоты цели), фильтры сабвуферов со спадом по паспорту (`subRolloff`, Баттерворт порядка N), целевая кривая без
спада сабвуферов снизу, оценка недобора и провалов (`makeScorer` с планом цели). Модуль `src/core/deepBass.ts` строит
спад и план цели; `filterSet` получает необязательный план; автоподбор, карты и `evaluateSetup` переходят на ветку цели
только при `deep`. Неровность, график и все остальные расчёты идут прежним путём, поэтому другие цели — бит в бит
(FR-4409). Паспорт — поле сабвуфера, параметры — поля цели. Интерфейс: опции цели и паспорт в «Цели подбора»,
строка о низе в оценке, необязательное `NumberField` в дизайн-системе. Решения и числа — [research.md](./research.md).

## Technical Context

**Language/Version**: TypeScript (стек проекта без изменений, новых зависимостей нет).

**Primary Dependencies**: нет новых; ядро — чистые функции `src/core`, интерфейс — Preact и дизайн-система.

**Storage**: необязательные поля `SourceSpec.passport` и `BassObjective.deepHz`, `deepDrop`
([data-model.md](./data-model.md)); версия формата файла не меняется.

**Testing**: Vitest (unit), Playwright (сквозные сценарии, Chrome; WebKit — в CI, не блокирует).

**Target Platform**: браузер, PWA на iPhone; расчёты — в воркерах (передают источники и ограничения проекта целиком).

**Project Type**: клиентское веб-приложение.

**Performance Goals**: время других целей — прежнее. У «Глубже низ» оценка варианта считает отклик ещё раз на своей
сетке (неровность и график — на прежней): в прямоугольной модели — доли миллисекунды на вариант.

**Constraints**: другие цели и расчёты — бит в бит с паспортом и без (FR-4409); модели, формулы и сетки других целей не
меняются.

**Scale/Scope**: `src/core/deepBass.ts` (новый), `types.ts`, `filters.ts`, `system.ts`, `objective.ts`, `placement.ts`,
`field.ts`; `src/state/storage.ts`; дизайн-система (`Fields.tsx`, реестр, каталог, документ); `ObjectivePicker`,
`DeepBassOptions` (новый), `ScoreBlock`, `SystemSettings`, `PlacementScreen`, `ManualScreen`, `TreatmentPanel`; строки;
тесты.

## Constitution Check

| Принцип | Проверка | Статус |
| --- | --- | --- |
| I. Сохранение расчётного поведения | Новая цель — по согласованной задаче владельца; расчёт других целей не меняется (ветка только при `deep`); снимок до/после — бит в бит, с паспортом и без | ✅ |
| II. Сохранение функций и связей | Цель — поле общих ограничений проекта, паспорт — поле сабвуфера: действуют на все инструменты, где действует цель; смена — устаревший результат прежним механизмом; старые проекты читаются | ✅ |
| III. Единый интерфейс | Существующие `Segmented`, `Note`, `.range-row`, `SelectField`; новый вариант `NumberField` (необязательное) внесён в систему, реестр, каталог, документ; узкая ширина — снимком | ✅ |
| IV. Честный смысл и проверка | Спад по паспорту — модель, не замер; что ниже −10 дБ — продолжение модели, сказано в пояснении; влияние записано; тесты проверены поломкой кода | ✅ |
| V. Spec Kit при завершении | spec, plan, research, data-model, quickstart, tasks, 009, индекс, решения (D39), current-state, отложенное, README, дизайн-система | ✅ — в задачах |

## Project Structure

### Documentation (this feature)

```text
specs/044-deep-bass/
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
src/core/deepBass.ts       # butterworthHp, subRolloff, rolloffDb, autoDeepHz, deepPlan, normalizePassport
src/core/types.ts          # SubPassport, Enclosure, DeepDrop, ObjectiveId 'deep', BassObjective.deepHz/deepDrop, LowReach
src/core/filters.ts        # sourceFilter через части hp/lp; sourceLowPass
src/core/system.ts         # filterSet(..., plan); evaluateSetup — objScore и low по ветке цели
src/core/objective.ts      # 'deep' в OBJECTIVE_IDS, makeScorer(..., plan), lowReach, normalizeObjective
src/core/placement.ts      # сетка, фильтры и оценка поиска по плану цели; Placement.low
src/core/field.ts          # карты слушателя и сабвуфера по плану цели
src/state/storage.ts       # паспорт сабвуфера из файла и хранилища
src/ui/design-system/      # NumberField optional; реестр, каталог
src/ui/components/ObjectivePicker.tsx, DeepBassOptions.tsx (новый), ScoreBlock.tsx
src/ui/screens/placement/SystemSettings.tsx, PlacementScreen.tsx, ManualScreen.tsx, tuning/TreatmentPanel.tsx
src/ui/strings.ts          # S.objective (deep), S.deep
tests/core/deepBass.test.ts, tests/state/project.test.ts, tests/e2e/app.spec.ts
```

**Structure Decision**: однопроектная структура; цель — модуль ядра и ветка по плану цели в местах, где строятся сетка,
фильтры и оценка по цели.

## Complexity Tracking

Нарушений нет.
