// Повреждённые и странные файлы сканов: понятная ошибка вместо падения, зависания или гигабайтов памяти.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { loadScan, ScanError, MAX_FILE_MB } from '../../src/scan/load';
import { cleanTriangles } from '../../src/scan/clean';
import { detectRoom, DetectError } from '../../src/scan/detect';
import { makeRoomScan, toOBJ, toSTL } from '../fixtures/synthetic';

const room = makeRoomScan({ depth: 5, width: 4, height: 2.6, noise: 0.005, furniture: true, openings: true });
const file = (data: BlobPart, name: string) => new File([data], name);

/** Ошибка загрузки: только ScanError с непустым русским текстом. */
async function expectScanError(p: Promise<unknown>, re?: RegExp) {
  const e = await p.then(() => null, (x) => x);
  expect(e, 'файл должен быть отвергнут').toBeInstanceOf(ScanError);
  expect((e as Error).message).toMatch(/[а-я]/i);
  if (re) expect((e as Error).message).toMatch(re);
}

// загрузчик three.js пишет предупреждения на каждую непонятную строку — в тестах они не нужны
beforeAll(() => { vi.spyOn(console, 'warn').mockImplementation(() => undefined); vi.spyOn(console, 'error').mockImplementation(() => undefined); });
afterAll(() => vi.restoreAllMocks());

describe('загрузка: битые файлы', () => {
  it('пустой файл', async () => {
    await expectScanError(loadScan(file('', 'scan.obj')), /пуст/);
  });

  it('слишком большой файл отвергается до чтения', async () => {
    const huge = { name: 'scan.obj', size: (MAX_FILE_MB + 1) * 1024 * 1024, arrayBuffer: () => { throw new Error('не должен читаться'); } } as unknown as File;
    await expectScanError(loadScan(huge), /слишком большой/);
  });

  it('неизвестный формат', async () => {
    await expectScanError(loadScan(file('hello', 'scan.txt')), /Неизвестный формат/);
  });

  it('двоичный STL с мусорным заголовком (4 млрд треугольников) — без попытки выделить память', async () => {
    const b = new Uint8Array(400);
    new DataView(b.buffer).setUint32(80, 0xffffffff, true);
    const t0 = performance.now();
    await expectScanError(loadScan(file(b, 'scan.stl')), /обрезан|повреждён/);
    expect(performance.now() - t0).toBeLessThan(1000);
  });

  it('обрезанный двоичный STL', async () => {
    const stl = toSTL(room);
    await expectScanError(loadScan(file(stl.slice(0, Math.floor(stl.byteLength / 2)), 'scan.stl')), /обрезан/);
    await expectScanError(loadScan(file(stl.slice(0, 50), 'scan.stl')), /обрезан|повреждён/);
  });

  it('двоичный STL с лишними байтами в конце читается', async () => {
    const stl = new Uint8Array(toSTL(room));
    const padded = new Uint8Array(stl.length + 7);
    padded.set(stl);
    const s = await loadScan(file(padded, 'scan.stl'));
    expect(s.triangleCount).toBe(room.length / 9);
  });

  it('GLB: верная сигнатура, внутри мусор', async () => {
    const b = new Uint8Array(256);
    b.set(new TextEncoder().encode('glTF'), 0);
    new DataView(b.buffer).setUint32(4, 2, true);
    new DataView(b.buffer).setUint32(8, 256, true);
    await expectScanError(loadScan(file(b, 'scan.glb')), /glTF|GLB/);
  });

  it('glTF: оборванный JSON', async () => {
    await expectScanError(loadScan(file('{"asset":{"version":"2.0"},"meshes":[{', 'scan.gltf')));
  });

  it('PLY: облако точек без граней', async () => {
    const ply = 'ply\nformat ascii 1.0\nelement vertex 3\nproperty float x\nproperty float y\nproperty float z\nend_header\n0 0 0\n1 0 0\n0 1 0\n';
    await expectScanError(loadScan(file(ply, 'scan.ply')), /облако точек/);
  });

  it('PLY: заявлено больше вершин и граней, чем есть', async () => {
    const ply = 'ply\nformat ascii 1.0\nelement vertex 1000\nproperty float x\nproperty float y\nproperty float z\nelement face 2000\nproperty list uchar int vertex_indices\nend_header\n0 0 0\n1 0 0\n0 1 0\n3 0 1 2\n';
    await expectScanError(loadScan(file(ply, 'scan.ply')));
  });

  it('OBJ: только вершины, без граней', async () => {
    const obj = Array.from({ length: 100 }, (_, i) => `v ${i} ${i * 2} ${i * 3}`).join('\n');
    await expectScanError(loadScan(file(obj, 'scan.obj')), /нет поверхностей/);
  });

  it('OBJ: текст без единой вершины', async () => {
    await expectScanError(loadScan(file('# пусто\nfoo bar\n'.repeat(50), 'scan.obj')), /нет поверхностей/);
  });

  it('OBJ: почти все координаты — NaN', async () => {
    const obj = Array.from({ length: 300 }, (_, i) => `v nan nan ${i}`).join('\n') + '\n' + Array.from({ length: 100 }, (_, i) => `f ${3 * i + 1} ${3 * i + 2} ${3 * i + 3}`).join('\n');
    await expectScanError(loadScan(file(obj, 'scan.obj')), /нечисловые/);
  });

  it('случайные байты под любым расширением: только ScanError и быстро', async () => {
    let seed = 7;
    const rnd = () => { seed = (seed * 1103515245 + 12345) >>> 0; return seed / 4294967296; };
    for (const ext of ['obj', 'stl', 'ply', 'glb', 'gltf', 'bin']) {
      for (const size of [1, 83, 84, 85, 1000, 50_000]) {
        const b = new Uint8Array(size);
        for (let i = 0; i < size; i++) b[i] = Math.floor(rnd() * 256);
        const t0 = performance.now();
        const r = await loadScan(file(b, `scan.${ext}`)).then(() => 'ok', (e) => e);
        expect(performance.now() - t0, `${ext}/${size}`).toBeLessThan(3000);
        // либо понятная ошибка, либо (редко) из мусора всё-таки собралось что-то читаемое
        if (r !== 'ok') expect(r, `${ext}/${size}: ${String(r)}`).toBeInstanceOf(ScanError);
      }
    }
  });
});

describe('загрузка: годные файлы с мусором внутри', () => {
  it('OBJ с NaN-вершинами и улетевшей точкой: мусор отброшен, размеры комнаты верные', async () => {
    const obj = toOBJ(room).split('\n');
    const nv = obj.filter((l) => l.startsWith('v ')).length;
    // NaN-треугольник и треугольник за 1000 км
    obj.push('v nan 0 0', 'v 0 nan 0', 'v 0 0 nan', `f ${nv + 1} ${nv + 2} ${nv + 3}`);
    obj.push('v 1e6 1e6 1e6', 'v 1e6 1e6 1.001e6', 'v 1e6 1.001e6 1e6', `f ${nv + 4} ${nv + 5} ${nv + 6}`);
    const s = await loadScan(file(obj.join('\n'), 'scan.obj'));
    expect(s.dropped).toBe(2);
    const r = detectRoom(s.triangles);
    expect(r.depth).toBeCloseTo(5, 1);
    expect(r.width).toBeCloseTo(4, 1);
    expect(r.height).toBeCloseTo(2.6, 1);
  });
});

describe('очистка треугольников', () => {
  it('чистый скан не меняется (тот же массив)', () => {
    const c = cleanTriangles(room);
    expect(c.triangles).toBe(room);
    expect(c.invalid + c.outliers).toBe(0);
  });

  it('коридор за аркой и ниша не считаются выбросами', () => {
    for (const o of [{ corridor: true }, { lShape: true }]) {
      const t = makeRoomScan({ depth: 4.5, width: 3.6, height: 2.7, ...o });
      expect(cleanTriangles(t).outliers).toBe(0);
    }
  });

  it('«шип» с одной улетевшей вершиной отброшен, даже если его центр ещё внутри', () => {
    const t = new Float32Array(room.length + 9);
    t.set(room);
    // две вершины у стены, третья — в 25 м: центр ≈ 9,7 м, в пределах запаса, но вершина — нет
    t.set([2, 2, 1, 2.1, 2, 1, 25, 2, 1.2], room.length);
    const c = cleanTriangles(t);
    expect(c.outliers).toBe(1);
    expect(c.triangles.length).toBe(room.length);
  });

  it('номера размеченных объектов остаются при своих треугольниках', () => {
    const t = new Float32Array(room.length + 18);
    t.set(room);
    t.fill(NaN, room.length, room.length + 9); // битый
    t.set([5e5, 5e5, 5e5, 5e5 + 1, 5e5, 5e5, 5e5, 5e5 + 1, 5e5], room.length + 9); // далёкий
    const n = t.length / 9;
    const ids = new Uint16Array(n).map((_, i) => i % 7);
    const c = cleanTriangles(t, ids);
    expect(c.invalid).toBe(1);
    expect(c.outliers).toBe(1);
    expect(c.ids!.length).toBe(n - 2);
    expect(Array.from(c.ids!.subarray(0, 50))).toEqual(Array.from(ids.subarray(0, 50)));
  });
});

describe('распознавание: вырожденные данные', () => {
  const expectDetectError = (t: Float32Array) => {
    let err: unknown = null;
    try { detectRoom(t); } catch (e) { err = e; }
    expect(err, 'должна быть понятная ошибка').toBeInstanceOf(DetectError);
  };

  it('все вершины в одной точке', () => {
    expectDetectError(new Float32Array(9 * 100).fill(1.5));
  });

  it('только пол (одна плоскость)', () => {
    const t: number[] = [];
    for (let i = 0; i < 20; i++) for (let j = 0; j < 20; j++) t.push(i, j, 0, i + 1, j, 0, i, j + 1, 0);
    expectDetectError(new Float32Array(t));
  });

  it('пара точек за тысячи километров — ошибка, а не гигабайтная гистограмма', () => {
    const t = new Float32Array(room.length + 18);
    t.set(room);
    t.set([1e9, 1e9, 1e9, 1e9 + 1, 1e9, 1e9, 1e9, 1e9 + 1, 1e9], room.length);
    t.set([-1e9, -1e9, 1e9, -1e9 + 1, -1e9, 1e9, -1e9, -1e9 + 1, 1e9], room.length + 9);
    expectDetectError(t);
  });

  it('NaN и бесконечности в сыром массиве не превращают размеры в NaN', () => {
    const t = new Float32Array(room.length + 27);
    t.set(room);
    t.fill(NaN, room.length, room.length + 9);
    t.fill(Infinity, room.length + 9, room.length + 18);
    t.fill(-Infinity, room.length + 18);
    const r = detectRoom(t);
    for (const v of [r.depth, r.width, r.height]) expect(Number.isFinite(v)).toBe(true);
    expect(r.depth).toBeCloseTo(5, 1);
  });
});
