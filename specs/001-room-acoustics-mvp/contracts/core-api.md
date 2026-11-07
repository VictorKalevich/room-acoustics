# Contract: расчётное ядро `src/core`

Чистые функции, без DOM и глобального состояния. Единицы — СИ.

```ts
speedOfSound(tempC: number): number                       // 331.3·√(1 + t/273.15)

MATERIALS: Material[]; FURNISHING: Record<Furnishing, number[7]>
OCTAVES = [63, 125, 250, 500, 1000, 2000, 4000]
alphaAt(alpha: number[7], f: number): number              // log-интерполяция, края — константа

computeReverb(room: Room): ReverbResult
schroederFrequency(tMid: number, volume: number): number  // 2000·√(T/V)

computeModes(room: Room, fMax: number, fMin = 15): Mode[] // отсортированы по f
bonelloCheck(modes: Mode[]): { ok: boolean, bands: { center, count }[] }
proportionsNote(room): string[]                           // кратные размеры и т.п.

modeDamping(mode, room, fHz): number                      // δ, 1/с
transfer(room, src: Vec3, rcv: Vec3, freqs: number[], modes: ModeWithDamping[]): Complex[]

sourceFilter(spec: SourceSpec, system: SourceSpec[], f: number): Complex
logFreqs(fLo, fHi, pointsPerOctave = 24): number[]

flatnessScore(roomDb: number[], targetDb: number[]): number   // СКО отклонения, дБ

optimizePlacement(input: {
  room: Room, sources: SourceSpec[], constraints: Constraints
}, onProgress?: (p: number) => void): PlacementResult
evaluatePlacement(room, sources, listener: Vec3, positions: Record<id, Vec3>): Placement
baselinePlacement(room, sources, constraints): Placement
```

Гарантии:
- `computeModes` для 5 × 4 × 2,5 м при 20 °C даёт первые моды 34,3; 42,9; 54,9 (1,1,0);
  68,6 Гц (±0,1 Гц).
- `computeReverb` совпадает с формулами Сэбина/Эйринга при ручном расчёте (±0,01 с).
- `optimizePlacement` детерминирована: одинаковый вход → одинаковый результат.
- Все предложенные положения удовлетворяют `constraints` и лежат внутри комнаты.
- Невыполнимые ограничения → исключение `PlacementError` с понятным сообщением.
