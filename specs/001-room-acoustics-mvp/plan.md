# Implementation Plan: Акустический калькулятор комнаты (MVP)

Исторический план этапа 001, не полная схема нынешнего UI. Актуальная навигация и
ответственность модулей — в [014](../014-ui-refactor/spec.md), обзор — в [индексе](../README.md).

**Branch**: `001-room-acoustics-mvp` | **Date**: 2026-11-07 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-room-acoustics-mvp/spec.md`

## Summary

Статическое PWA для Safari на iPhone: пользователь вводит размеры комнаты или загружает
LiDAR-скан (OBJ/GLB/PLY/STL) из стороннего приложения; приложение распознаёт прямоугольную
комнату, рассчитывает моды, RT60 и частоту Шрёдера по выбранным материалам, а затем
перебором в Web Worker подбирает положения колонок, сабвуферов и слушателя, минимизируя
неровность низкочастотной АЧХ (модальная модель с учётом полос источников и фазы).
Подробности решений — в [research.md](./research.md).

## Technical Context

**Language/Version**: TypeScript 5.x (strict), ES2022

**Primary Dependencies**: Preact 10 (UI), three.js (загрузчики форматов и 3D-превью, ленивая
загрузка), vite-plugin-pwa (офлайн); сборка — Vite

**Storage**: IndexedDB (проекты, без исходной сетки скана); экспорт/импорт JSON-файла

**Testing**: Vitest (ядро и распознавание, test-first), Playwright с эмуляцией iPhone
(сквозные сценарии)

**Target Platform**: Safari на iOS 26+ (iPhone 17 Pro); вторично — современные десктопные браузеры

**Project Type**: статическое одностраничное веб-приложение (PWA), без бэкенда

**Performance Goals**: подбор расстановки ≤ 10 с; разбор скана 50 МБ без падения; интерфейс
не блокируется (тяжёлые расчёты в Web Worker)

**Constraints**: офлайн после первой загрузки; данные не покидают устройство; интерфейс на
русском; цели касания ≥ 44 pt

**Scale/Scope**: 1 пользователь; ~4 экрана; ядро ≈ 1,5 тыс. строк

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Принцип | Проверка | Статус |
|---|---|---|
| I. Только клиент | Статическая сборка, нет сервера, нет сетевых запросов с данными; хранение в IndexedDB | ✅ |
| II. Safari на iPhone | Mobile-first UI, PWA, Web Worker для тяжёлых расчётов, проверка в эмуляции iPhone + ручная на устройстве | ✅ |
| III. Открытые форматы и ручная правка | OBJ/GLB/PLY/STL; ручной ввод и правка размеров; предупреждения при низкой уверенности | ✅ |
| IV. Физическая корректность | Формулы с источниками (research R4–R8), панель допущений рядом с результатом, СИ внутри | ✅ |
| V. Тестируемое ядро | `src/core` и `src/scan/detect.ts` — чистые модули без DOM; тесты с аналитическими эталонами и синтетическими сетками пишутся первыми | ✅ |
| VI. Простота | 3 runtime-зависимости, каждая обоснована (R9); собственные SVG-графики | ✅ |

Повторная проверка после дизайна (Phase 1): нарушений нет, таблица Complexity Tracking пуста.

## Project Structure

### Documentation (this feature)

```text
specs/001-room-acoustics-mvp/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── core-api.md          # публичный API расчётного ядра
│   ├── scan-import.md       # контракт импорта и распознавания скана
│   └── project-file.md      # формат файла экспорта проекта
└── tasks.md
```

### Source Code (repository root)

```text
index.html
vite.config.ts
package.json
public/
└── icons/                   # иконки PWA
src/
├── core/                    # чистое расчётное ядро (без DOM)
│   ├── types.ts
│   ├── physics.ts           # скорость звука
│   ├── materials.ts         # справочник материалов и меблировка
│   ├── reverb.ts            # Сэбин/Эйринг, частота Шрёдера
│   ├── modes.ts             # собственные частоты, классификация, скопления, Бонелло
│   ├── response.ts          # модальная передаточная функция, затухание мод
│   ├── filters.ts           # фильтры источников (LR4, Баттерворт 2)
│   ├── metric.ts            # оценка ровности АЧХ
│   ├── placement.ts         # кандидаты, базовый вариант, перебор
│   └── frequency.ts         # сетки частот
├── scan/
│   ├── load.ts              # загрузка файлов через three.js → массив треугольников
│   └── detect.ts            # распознавание комнаты (чистый модуль)
├── workers/
│   ├── placement.worker.ts
│   └── detect.worker.ts
├── state/
│   ├── project.ts           # модель проекта и умолчания
│   └── storage.ts           # IndexedDB + экспорт/импорт
├── ui/
│   ├── App.tsx
│   ├── screens/             # RoomScreen, ModesScreen, PlacementScreen, ProjectsScreen
│   ├── components/          # поля, PlanView, ResponseChart, ModeChart, ScanPreview…
│   └── strings.ts           # строки интерфейса (рус.)
├── main.tsx
└── styles.css
tests/
├── core/                    # *.test.ts — эталоны
├── scan/                    # синтетические сетки
├── fixtures/                # генератор синтетических сканов
└── e2e/                     # Playwright, эмуляция iPhone
```

**Structure Decision**: одно приложение. Ядро (`src/core`) и распознавание
(`src/scan/detect.ts`) изолированы от UI и тестируются без браузера; воркеры — тонкие
обёртки над ними.

## Complexity Tracking

Нарушений конституции нет.
