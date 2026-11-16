# Tasks: 046 — Тривиальные исправления из отложенного

**Input**: [spec.md](./spec.md). Номера задач — по правилу проекта (T46xx для 046).

- [x] T4601 Ветка `046-trivial-fixes`, спецификация; сверка восьми пунктов отложенного с кодом `863283b`
- [x] T4602 Интерфейс: `fmtSigned` (`format.ts`) в `MeasureCompare` и `ScoreBlock`; сброс ошибки в `runCal`
  (`MeasurePanel`); `progress: 'reset'` (`ModesScreen`); `useLayoutEffect` (`Drawer`); карта варианта только в режиме
  «Подобрать» (`PlacementScreen`) (FR-4601–FR-4605)
- [x] T4603 Удаление неиспользуемых `S.tuning.setup` и `treatmentSurfaces`; отчёт `github` в CI (FR-4606–FR-4608)
- [x] T4604 [P] Тесты: `tests/ui/format.test.ts`, сквозные «046: Escape…» (`navigation.spec.ts`) и «046: в режиме
  «Вручную»…» (`app.spec.ts`), комментарий `menuReady`; проверка поломкой кода (приёмка 4)
- [x] T4605 Проверки: `npm test` (566 в 63 файлах), `npm run lint`, `npm run build`, `npm run e2e` (Chrome, 102 из 102)
- [x] T4606 Spec Kit: `spec.md`, 034 (таблица мест), пункты «Замечено» в 028, 033, 034, 035, 038, 044 и в
  `specs/deferred.md`, `specs/README.md`, `specs/decisions.md` (D41)
- [x] T4607 Коммит, вливание в `main`, push, проверка запуска CI: запуск `43969792475` для `5533af1` (содержит фичу) —
  `build` и `deploy` успешно; `e2e-safari` — прежний сбой, не блокирует; с отчётом `github` видны упавшие сценарии (5
  упали, 2 нестабильны, 95 прошли — записано в отложенное)

T4601 → T4602, T4603 → T4604 → T4605 → T4606 → T4607.
