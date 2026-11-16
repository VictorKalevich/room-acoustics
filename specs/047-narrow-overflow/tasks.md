# Tasks: 047 — Переключатели не выходят за край экрана на 320 px

**Input**: [spec.md](./spec.md). Номера задач — по правилу проекта (T47xx для 047).

- [x] T4701 Ветка `047-narrow-overflow`, спецификация; воспроизведение пяти сбоев WebKit локально, поиск выходящих за
  край элементов в WebKit и Chrome на 320 и 393 px, причина расхождения движков (`innerWidth` мобильной эмуляции Chrome)
- [x] T4702 Дизайн-система: перенос вариантов `.segmented` (FR-4701), `docs/design-system.md`
- [x] T4703 Тесты: `fitsWidth` (`tests/e2e/helpers.ts`) во всех проверках ширины (FR-4702); проверка поломкой кода в
  Chrome (приёмка 3)
- [x] T4704 Проверки: `npm test` (566), `npm run lint`, `npm run e2e` (Chrome, 102 из 102), `npm run e2e:safari`
  (WebKit: 99 прошли, 2 пропущены, 1 упал — 043, не переполнение), снимки переключателей на 320 и 393 px
- [x] T4705 Spec Kit: `spec.md`, `specs/deferred.md` (пункт о 320 px закрыт, пункт о WebKit уточнён),
  `specs/README.md`, `specs/decisions.md` (D42), `specs/current-state.md`
- [ ] T4706 Коммит, вливание в `main`, push, проверка запуска CI

T4701 → T4702 → T4703 → T4704 → T4705 → T4706.
