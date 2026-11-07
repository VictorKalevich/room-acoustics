# Data Model: фича 002

Дополняет [MVP data-model](../001-room-acoustics-mvp/data-model.md).

### Room (новые поля)
| Поле | Тип | Правила |
|---|---|---|
| zones | Zone[] | 0–20 зон |
| leakage | 'sealed' \| 'typical' \| 'door' \| 'open' | по умолчанию 'typical' |
| calibration | { dampingScale: number } \| null | 0,25 ≤ dampingScale ≤ 8 |

### Zone
`id`, `kind: 'door'|'window'|'furniture'|'other'`, `x0 < x1`, `y0 < y1` (м, внутри комнаты), `canSit: boolean`.

### SourceSpec (сабвуфер, новые поля)
| Поле | Тип | По умолчанию |
|---|---|---|
| delayMode | 'none' \| 'adjustable' | 'none' |
| maxDelayMs | number, 1–50 | 20 |
| phaseMode | 'none' \| 'polarity' \| 'continuous' \| 'full' | 'polarity' |
| levelAdjustable | boolean | true |

### Constraints (новые поля)
`seats: { count: 1..5, spacing: 0.4..1.2 }`, `crossover: { adjustable: boolean, min: number, max: number }`.

### SubSetting
`delayMs ≥ 0`, `phaseDeg 0…359`, `gainDb −6…+6`.

### Setup (вариант расстановки)
`id`, `name`, `listener: Vec3`, `positions: Record<sourceId, Vec3>`, `subSettings: Record<subId, SubSetting>`,
`crossoverHz: number | null`, `measurement: Measurement | null`.

### Measurement
`name`, `importedAt`, `f: number[]`, `db: number[]` (сетка 48/окт, 15–500 Гц).

### Project (версия 2)
Добавлены `current: Setup`, `setups: Setup[]`. Версия 1 мигрирует: `current` — из базовой расстановки.
