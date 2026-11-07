# Contract: импорт и распознавание скана

## Загрузка (`src/scan/load.ts`, основной поток)

```ts
loadScan(file: File): Promise<{
  triangles: Float32Array,     // 9 чисел на треугольник, исходные единицы и оси файла
  preview: THREE.Object3D,     // для 3D-превью
  format: 'obj' | 'glb' | 'gltf' | 'ply' | 'stl',
  triangleCount: number
}>
```

- Формат определяется по расширению, затем по сигнатуре (`glTF`, `ply`, `solid`).
- Облако точек без граней (PLY без faces) → ошибка `ScanError('Файл содержит облако точек
  без поверхностей — экспортируйте сетку (mesh)')`.
- Пустой/повреждённый файл → `ScanError` с перечнем поддерживаемых форматов.
- Более 2 млн треугольников → равномерное прореживание до 2 млн для анализа с предупреждением.

## Распознавание (`src/scan/detect.ts`, чистый модуль, в воркере)

```ts
detectRoom(triangles: Float32Array, opts?: { units?: 'm'|'cm'|'mm' }): DetectResult

interface DetectResult {
  depth: number; width: number; height: number    // м, depth ≥ width (передняя — короткая стена)
  units: 'm' | 'cm' | 'mm'
  up: [number, number, number]                     // вектор «вверх» в осях файла
  transform: number[]                              // 4×4 файл → комната (м, начало в углу)
  rotationDeg: number
  confidence: number                               // 0…1
  wallCoverage: [number, number, number, number]   // front, back, left, right
  hasCeiling: boolean
  outsideFraction: number
  warnings: string[]
}
```

Гарантии (проверяются тестами на синтетических сетках):
- Прямоугольная комната с мебелью, шумом ±1 см, поворотом вокруг вертикали, Y-up или Z-up,
  в м/см/мм → размеры ±5 см.
- Нет потолка → `hasCeiling = false`, высота по верхней точке, предупреждение.
- Г-образная комната → `outsideFraction > 0,1`, предупреждение «комната не прямоугольная».
