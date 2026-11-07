# Data Model: Акустический калькулятор комнаты (MVP)

## Система координат комнаты

Начало — передний левый нижний угол (если стоять лицом к передней стене, у которой стоят
колонки). `x` — глубина от передней стены к задней `[0, depth]`, `y` — от левой стены к правой
`[0, width]`, `z` — вверх от пола `[0, height]`. Все величины в СИ (м, Гц, с, °C).
Поворот комнаты (колонки у другой стены) меняет местами `depth` и `width` и материалы стен.

## Сущности

### Room
| Поле | Тип | Правила |
|---|---|---|
| depth, width, height | number, м | 1 ≤ v ≤ 50; height ≤ 20 |
| temperatureC | number | −10…40, по умолчанию 20 |
| materials | Record<SurfaceId, MaterialId> | SurfaceId: floor, ceiling, front, back, left, right |
| furnishing | 'empty' \| 'typical' \| 'heavy' | по умолчанию 'typical' |
| source | 'manual' \| 'scan' | |

### Material (справочник, только чтение)
| Поле | Тип | Правила |
|---|---|---|
| id, name | string | name — по-русски |
| alpha | number[7] | октавы 63…4000 Гц; 0 < α < 1 |
| extrapolated63 | boolean | 63 Гц — экстраполяция |
| source | string | библиографическая ссылка |

### Mode (вычисляемая)
`n: [nx, ny, nz]`, `f` (Гц), `kind: axial|tangential|oblique`, `degenerate` (есть мода с
|Δf| < 0,5 %), `clustered` (соседняя мода ближе 5 %).

### ReverbResult (вычисляемая)
По октавам: `sabine[]`, `eyring[]`, `used[]`, `formula[]`, `meanAlpha[]`; `tMid`, `schroeder`.

### SourceSpec
| Поле | Тип | Правила |
|---|---|---|
| id | string | `spkL`, `spkR`, `spkC` (моно), `sub1…sub4` |
| kind | 'speaker' \| 'sub' | 1–2 колонки, 0–4 сабвуфера |
| fLow, fHigh | number, Гц | 10 ≤ fLow < fHigh ≤ 24000 |
| height | number, м | акустический центр; колонки 1,0; сабвуферы 0,3 |

### Constraints
| Поле | По умолчанию | Смысл |
|---|---|---|
| speakerMinFront | 0,2 м | мин. от передней стены до колонки |
| speakerMinSide | 0,3 м | мин. от боковой стены |
| listenerMinX / listenerMaxX | 0,3·depth / depth − 0,6 | зона слушателя по глубине |
| earHeight | 1,1 м | высота ушей |
| subZone | 'walls' | 'corners' \| 'walls' \| 'anywhere' |
| subWallGap | 0,15 м | отступ сабвуфера от стены |

### Placement (вычисляемая)
`listener: Vec3`, `sources: { id, pos: Vec3 }[]`, `score` (дБ, меньше — лучше),
`scoreCenter`, `scoreSeats`, `penalties: { name, value }[]`, `angleDeg` (угол раскрытия
колонок или null), `response: { f[], db[], target[] }`.

### PlacementResult
`best: Placement[]` (≤ 3), `baseline: Placement`, `fLo`, `fHi`, `schroeder`, `evaluated`
(число вариантов), `elapsedMs`, `notes: string[]`.

### ScanInfo
`fileName`, `format`, `units: 'm'|'cm'|'mm'`, `upAxis`, `rotationDeg`, `confidence (0…1)`,
`wallCoverage: number[4]`, `hasCeiling`, `outsideFraction`, `warnings: string[]`.
Исходная сетка в проекте не хранится.

### Project
`id`, `name`, `updatedAt` (ISO), `room`, `sources`, `constraints`, `scanInfo?`,
`result?` (последний PlacementResult), `selectedIndex?`.

## Переходы состояния проекта

`пустой → комната задана (ручной ввод | скан подтверждён) → система описана →
расстановка рассчитана → вариант выбран`. Любое изменение комнаты, материалов, источников
или ограничений помечает результат расстановки как устаревший (`result.stale = true`).
