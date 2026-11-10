# Implementation Plan: Ручная расстановка, настройка сабвуфера и обработка

Исторический план этапа 002. Последующий перенос UI и общие модули описаны в
[014](../014-ui-refactor/spec.md); этот план не является текущей картой экранов.

**Branch**: `002-manual-placement-tuning` | **Date**: 2026-11-08 | **Spec**: [spec.md](./spec.md)

## Summary

Расширение MVP: ручной режим расстановки с перетаскиванием и тепловыми картами мест слушателя и сабвуфера;
новая вкладка «Настройка» (сабвуфер: задержка/фаза/уровень/кроссовер в пределах возможностей; EQ с экспортом;
обработка; замер REW с подстройкой модели); несколько мест прослушивания; запретные зоны и герметичность
на экране «Комната»; варианты расстановки и сравнение. Решения — [research.md](./research.md).

## Technical Context

Стек без изменений (TypeScript, Preact, three.js, Vite, Vitest, Playwright). Новых зависимостей нет.
Тяжёлые расчёты — в общем воркере `compute.worker.ts` (подбор, карты, настройка, подстройка).
Производительность: карта ≤ 3 с, настройка ≤ 2 с на iPhone 17 Pro.

## Constitution Check

| Принцип | Проверка | Статус |
|---|---|---|
| I. Только клиент | Всё на устройстве; замеры REW читаются локально | ✅ |
| II. Safari на iPhone | Перетаскивание пальцем (pointer events, touch-action), 5 вкладок, воркер | ✅ |
| III. Форматы и ручная правка | Ручная расстановка, ручная правка настроек; REW txt | ✅ |
| IV. Физическая корректность | Формулы и допущения в research R11–R16 и в интерфейсе | ✅ |
| V. Тестируемое ядро | field/integration/eq/treatment/measure — чистые модули с тестами до реализации | ✅ |
| VI. Простота | Без новых зависимостей; один воркер вместо нескольких | ✅ |

## Project Structure

```text
src/core/
├── system.ts        # места, зоны, регулировки сабвуфера, evaluateSetup
├── field.ts         # тепловые карты
├── integration.ts   # подбор задержки/фазы/уровня/кроссовера
├── eq.ts            # эквалайзер и экспорт
├── treatment.ts     # точки отражений, басовые ловушки
└── measure.ts       # REW, сравнение, подстройка
src/workers/compute.worker.ts
src/ui/components/PlanEditor.tsx, Heatmap…, EqPanel…
src/ui/screens/ManualScreen.tsx, TuningScreen.tsx
tests/core/{system,field,integration,eq,treatment,measure}.test.ts
```

## Complexity Tracking

Нарушений нет.
