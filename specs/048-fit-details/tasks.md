# Tasks: 048 — Что не помещается в комнату: объект, сторона, на сколько и какое значение подходит

**Input**: [spec.md](./spec.md). Номера задач — по правилу проекта (T48xx для 048).

- [x] T4801 Ветка `048-fit-details`, спецификация; воспроизведение: мебель и окна из разметки скана за стеной на 1–5 мм
  (округление после обрезки), `fitRect` — на ошибку сложения
- [x] T4802 Причина и допуск (FR-4801, FR-4802): `inside` в `src/scan/layout.ts`, размеры границ до миллиметра в
  `ScanPanel.tsx`, `fitRect`; `FIT_TOLERANCE`, `maxShift`, сохранение вписанной комнаты в `RoomEditor.tsx`
- [x] T4803 Где и на сколько (FR-4803): `over` у `FitItem` (`src/core/fitRoom.ts`)
- [x] T4804 Интерфейс (FR-4804–FR-4807): `src/ui/screens/room/fitIssues.tsx`, список и «Показать» в `RoomEditor.tsx`,
  выделенные карточки и подсказки полей в `RoomEditor.tsx`, `OpeningsPanel.tsx`, `ZonesPanel.tsx`; `NumberField.error`,
  `.zone-card.is-error`, реестр, каталог, `docs/design-system.md`; `S.fit`
- [x] T4805 Тесты и проверки (2026-11-17, Windows): `tests/scan/insideWalls.test.ts` (приёмка 1),
  `tests/core/furniture.test.ts` «048» (приёмка 2), `tests/core/fitRoom.test.ts` «048» и `tests/ui/fitIssues.test.ts`
  (приёмка 3), `tests/e2e/room-editor.spec.ts` «048» (приёмка 4), в «021» — новые подписи. `npm test` — 576 в 65
  файлах; `npm run lint` с `design:check`; `npx tsc --noEmit`; `npm run e2e` (Chrome) — 103 из 103;
  `npm run e2e:safari` (Playwright WebKit) — 101 прошли, 2 пропущены (аудио), сбоев нет. Проверки поломкой: разбор скана
  до 048 — оба теста скана падают; `fitRect` до 048 — 129 выходов; без выбора стены и без раскрытия свёрнутого блока
  сквозной сценарий падает. Снимки WebKit на 320 px: список и карточка с подсказками, страница 320 / 320
- [x] T4806 Spec Kit: `spec.md`, `specs/deferred.md` (два пункта от 2026-11-17 закрыты), `specs/README.md`,
  `specs/decisions.md` (D43), `specs/current-state.md`
- [x] T4807 Коммит, вливание в `main`, push, проверка запуска CI: запуск `44041403651` для `03c1892` — `build` и
  `deploy` успешно; `e2e-safari` — 102 прошли (в том числе «048»), 1 упал («043: подъём низа…», известный пункт
  отложенного)

T4801 → T4802 → T4803 → T4804 → T4805 → T4806 → T4807.
