// Генератор синтетических «LiDAR-сканов» комнаты для тестов распознавания.

export interface SynthOptions {
  depth: number;
  width: number;
  height: number;
  units?: 'm' | 'cm' | 'mm';
  upAxis?: 'y' | 'z';
  rotationDeg?: number;
  tiltDeg?: number;
  offset?: [number, number, number];
  noise?: number; // м, амплитуда шума вершин
  furniture?: boolean;
  ceiling?: boolean;
  openings?: boolean; // дверь и окно (дыры в стенах)
  lShape?: boolean; // ниша 1,5 × 1,5 м за правой стеной
  cell?: number; // размер ячейки сетки, м
  seed?: number;
}

type P = [number, number, number];

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

/** Прямоугольник: начало o, векторы a и b, разбит на ячейки; hole — функция исключения ячеек. */
function quad(out: number[], o: P, a: P, b: P, cell: number, hole?: (s: number, t: number) => boolean) {
  const la = Math.hypot(...a), lb = Math.hypot(...b);
  const na = Math.max(1, Math.round(la / cell)), nb = Math.max(1, Math.round(lb / cell));
  const at = (s: number, t: number): P => [
    o[0] + a[0] * s + b[0] * t, o[1] + a[1] * s + b[1] * t, o[2] + a[2] * s + b[2] * t,
  ];
  for (let i = 0; i < na; i++)
    for (let j = 0; j < nb; j++) {
      const s0 = i / na, s1 = (i + 1) / na, t0 = j / nb, t1 = (j + 1) / nb;
      if (hole && hole(((s0 + s1) / 2) * la, ((t0 + t1) / 2) * lb)) continue;
      out.push(...at(s0, t0), ...at(s1, t0), ...at(s1, t1), ...at(s0, t0), ...at(s1, t1), ...at(s0, t1));
    }
}

function box(out: number[], x0: number, y0: number, z0: number, dx: number, dy: number, dz: number, cell: number) {
  quad(out, [x0, y0, z0 + dz], [dx, 0, 0], [0, dy, 0], cell); // верх
  quad(out, [x0, y0, z0], [dx, 0, 0], [0, 0, dz], cell);
  quad(out, [x0, y0 + dy, z0], [dx, 0, 0], [0, 0, dz], cell);
  quad(out, [x0, y0, z0], [0, dy, 0], [0, 0, dz], cell);
  quad(out, [x0 + dx, y0, z0], [0, dy, 0], [0, 0, dz], cell);
}

/** Комната в координатах (x — глубина, y — ширина, z — вверх), затем поворот, шум, оси и единицы. */
export function makeRoomScan(o: SynthOptions): Float32Array {
  const { depth: X, width: Y, height: Z } = o;
  const cell = o.cell ?? 0.2;
  const t: number[] = [];
  // пол (под мебелью не сканируется — дыра под диваном)
  quad(t, [0, 0, 0], [X, 0, 0], [0, Y, 0], cell, o.furniture ? (s, u) => s > X - 1.2 && u > 1 && u < 3 : undefined);
  if (o.ceiling !== false) quad(t, [0, 0, Z], [X, 0, 0], [0, Y, 0], cell);
  const door = (s: number, u: number) => !!o.openings && s > 0.5 && s < 1.4 && u < 2.0;
  const win = (s: number, u: number) => !!o.openings && s > 1.0 && s < 2.5 && u > 0.9 && u < 2.1;
  quad(t, [0, 0, 0], [0, Y, 0], [0, 0, Z], cell); // передняя x=0
  quad(t, [X, 0, 0], [0, Y, 0], [0, 0, Z], cell, door); // задняя
  quad(t, [0, 0, 0], [X, 0, 0], [0, 0, Z], cell, win); // левая y=0
  if (o.lShape) {
    // правая стена с проёмом в нишу 1,5 × 1,5 м
    quad(t, [0, Y, 0], [X, 0, 0], [0, 0, Z], cell, (s) => s > 1 && s < 2.5);
    quad(t, [1, Y + 1.5, 0], [1.5, 0, 0], [0, 0, Z], cell);
    quad(t, [1, Y, 0], [0, 1.5, 0], [0, 0, Z], cell);
    quad(t, [2.5, Y, 0], [0, 1.5, 0], [0, 0, Z], cell);
    quad(t, [1, Y, 0], [1.5, 0, 0], [0, 1.5, 0], cell);
    if (o.ceiling !== false) quad(t, [1, Y, Z], [1.5, 0, 0], [0, 1.5, 0], cell);
  } else {
    quad(t, [0, Y, 0], [X, 0, 0], [0, 0, Z], cell);
  }
  if (o.furniture) {
    box(t, X - 1.1, 1, 0, 0.9, 2, 0.8, cell / 2); // диван у задней стены
    box(t, 1.5, 0.05, 0, 1.2, 0.6, 2.0, cell / 2); // шкаф у левой стены (высокий)
    box(t, 2, 1.5, 0.7, 1.0, 0.8, 0.04, cell / 2); // столешница
    box(t, 0.1, Y / 2 - 0.8, 0, 0.45, 1.6, 0.5, cell / 2); // ТВ-тумба
  }

  const rand = rng(o.seed ?? 7);
  const noise = o.noise ?? 0;
  const rot = ((o.rotationDeg ?? 0) * Math.PI) / 180;
  const tilt = ((o.tiltDeg ?? 0) * Math.PI) / 180;
  const off = o.offset ?? [0, 0, 0];
  const scale = o.units === 'cm' ? 100 : o.units === 'mm' ? 1000 : 1;
  const out = new Float32Array(t.length);
  for (let i = 0; i < t.length; i += 3) {
    let x = t[i] + (rand() * 2 - 1) * noise;
    let y = t[i + 1] + (rand() * 2 - 1) * noise;
    let z = t[i + 2] + (rand() * 2 - 1) * noise;
    // поворот вокруг вертикали
    [x, y] = [x * Math.cos(rot) - y * Math.sin(rot), x * Math.sin(rot) + y * Math.cos(rot)];
    // наклон вокруг оси x
    [y, z] = [y * Math.cos(tilt) - z * Math.sin(tilt), y * Math.sin(tilt) + z * Math.cos(tilt)];
    x += off[0]; y += off[1]; z += off[2];
    let p: P = [x, y, z];
    if (o.upAxis !== 'z') p = [x, z, -y]; // Y-up (правая система)
    out[i] = p[0] * scale; out[i + 1] = p[1] * scale; out[i + 2] = p[2] * scale;
  }
  return out;
}

/** Сохраняет треугольники как OBJ (текст). */
export function toOBJ(tri: Float32Array): string {
  const lines: string[] = ['# synthetic room scan'];
  for (let i = 0; i < tri.length; i += 3) lines.push(`v ${tri[i].toFixed(5)} ${tri[i + 1].toFixed(5)} ${tri[i + 2].toFixed(5)}`);
  for (let f = 0; f < tri.length / 9; f++) lines.push(`f ${f * 3 + 1} ${f * 3 + 2} ${f * 3 + 3}`);
  return lines.join('\n') + '\n';
}

/** Двоичный STL. */
export function toSTL(tri: Float32Array): ArrayBuffer {
  const n = tri.length / 9;
  const buf = new ArrayBuffer(84 + n * 50);
  const dv = new DataView(buf);
  dv.setUint32(80, n, true);
  for (let f = 0; f < n; f++) {
    const o = 84 + f * 50;
    for (let k = 0; k < 9; k++) dv.setFloat32(o + 12 + k * 4, tri[f * 9 + k], true);
  }
  return buf;
}
