# Contract: новые функции ядра

```ts
// система и оценка
seatPositions(room, listener: Vec3, seats): Vec3[]
evaluateSetup(room, sources, constraints, setup, opts?: { ppo?: number }): SetupEval
  // { score, perSeat[], response: { f, db, target }, receivers }

// тепловые карты (field.ts)
listenerHeatmap(room, sources, constraints, setup): Heatmap
subHeatmap(room, sources, constraints, setup, subId): Heatmap
  // Heatmap: { x0, y0, step, nx, ny, scores: Float32Array (NaN = недоступно), best: {pos, score}[], current: number }

// настройка сабвуфера (integration.ts)
optimizeSubs(room, sources, constraints, setup): IntegrationResult
  // { settings: Record<subId, SubSetting>, crossoverHz, before, after, responseBefore, responseAfter, notes[] }

// эквалайзер (eq.ts)
designEq(f: number[], db: number[], target: number[], maxFilters = 8): EqResult
peqResponse(filters, f): number[]   // дБ
biquad(filter, fs): { b0, b1, b2, a1, a2 }
exportEqualizerAPO(filters): string; exportREW(filters): string; exportMiniDSP(filters, fs): string

// обработка (treatment.ts)
reflectionPoints(room, speakers: {id, pos}[], listener): Reflection[]
bassAdvice(room, response, modes): BassAdvice[]

// замеры (measure.ts)
parseRew(text): Measurement
compareMeasurement(room, sources, constraints, setup, m): { rms, model: number[], measured: number[], f: number[] }
calibrate(room, sources, constraints, setup, m): { calibration, leakage, rmsBefore, rmsAfter }
```

Гарантии: все функции детерминированы; подбор настроек не выходит за возможности сабвуфера; EQ не содержит
фильтров с усилением > 0; лучшие точки карт удовлетворяют зонам и ограничениям.
