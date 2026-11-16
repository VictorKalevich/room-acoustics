// Повреждённые и странные файлы сканов: понятная ошибка вместо падения, зависания или гигабайтов памяти.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { loadScan, ScanError, MAX_FILE_MB } from '../../src/scan/load';
import { cleanTriangles } from '../../src/scan/clean';
import { detectRoom, DetectError } from '../../src/scan/detect';
import { dataUri, gltfJson, makeRoomScan, toGLB, toOBJ, toPLY, toSTL } from '../fixtures/synthetic';

const room = makeRoomScan({ depth: 5, width: 4, height: 2.6, noise: 0.005, furniture: true, openings: true });
const file = (data: BlobPart, name: string) => new File([data], name);

/** Сообщение об обрезанном PLY с числами из заголовка (039). */
const plyCut = (vertices: number, faces: number) =>
  `Файл PLY обрезан или повреждён: в заголовке ${vertices.toLocaleString('ru-RU')} точек и ${faces.toLocaleString('ru-RU')} граней, а данных меньше. Скопируйте или экспортируйте файл заново.`;

/** Ошибка загрузки: только ScanError с непустым русским текстом; строка — точный текст. */
async function expectScanError(p: Promise<unknown>, re?: RegExp | string) {
  const e = await p.then(() => null, (x) => x);
  expect(e, 'файл должен быть отвергнут').toBeInstanceOf(ScanError);
  expect((e as Error).message).toMatch(/[а-я]/i);
  if (typeof re === 'string') expect((e as Error).message).toBe(re);
  else if (re) expect((e as Error).message).toMatch(re);
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
    await expectScanError(loadScan(file(b, 'scan.glb')), /^Не удалось прочитать glTF\/GLB: файл повреждён\.$/);
  });

  it('glTF: оборванный JSON', async () => {
    await expectScanError(loadScan(file('{"asset":{"version":"2.0"},"meshes":[{', 'scan.gltf')), /^Не удалось прочитать glTF\/GLB: файл повреждён\.$/);
  });

  it('PLY: облако точек без граней', async () => {
    const ply = 'ply\nformat ascii 1.0\nelement vertex 3\nproperty float x\nproperty float y\nproperty float z\nend_header\n0 0 0\n1 0 0\n0 1 0\n';
    await expectScanError(loadScan(file(ply, 'scan.ply')), /облако точек/);
  });

  it('PLY: заявлено больше вершин и граней, чем есть', async () => {
    const ply = 'ply\nformat ascii 1.0\nelement vertex 1000\nproperty float x\nproperty float y\nproperty float z\nelement face 2000\nproperty list uchar int vertex_indices\nend_header\n0 0 0\n1 0 0\n0 1 0\n3 0 1 2\n';
    await expectScanError(loadScan(file(ply, 'scan.ply')), plyCut(1000, 2000));
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
        expect(r, `${ext}/${size}: ${String(r)}`).toBeInstanceOf(ScanError);
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

describe('PLY: исправные файлы читаются, обрезанные отвергаются (039)', () => {
  const n = room.length / 9;
  const text = (b: Uint8Array) => new TextDecoder().decode(b);
  const expectRoom = async (data: BlobPart, what: string) => {
    const s = await loadScan(file(data, 'scan.ply'));
    expect(s.format, what).toBe('ply');
    expect(s.triangleCount, what).toBe(n);
    const r = detectRoom(s.triangles);
    expect([r.depth, r.width, r.height].map((v) => Math.round(v * 100) / 100), what).toEqual([5, 4, 2.6]);
  };

  it('текстовый, двоичный (оба порядка байтов), с переводами строк Windows и без перевода строки в конце', async () => {
    const ascii = text(toPLY(room));
    await expectRoom(ascii, 'ascii');
    await expectRoom(ascii.replace(/\n/g, '\r\n'), 'ascii CRLF');
    await expectRoom(ascii.trimEnd(), 'ascii без перевода строки в конце');
    await expectRoom(toPLY(room, 'binary_little_endian'), 'binary LE');
    await expectRoom(toPLY(room, 'binary_big_endian', 'int'), 'binary BE, число вершин грани — int');
  });

  it('четырёхугольные грани, нормали и цвета вершин, лишний элемент после граней', async () => {
    // пол 4 × 4 м из 16 четырёхугольников: загрузчик делит каждый на два треугольника
    const v: number[][] = [];
    const f: number[][] = [];
    for (let i = 0; i <= 4; i++) for (let j = 0; j <= 4; j++) v.push([i, j, 0]);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) f.push([i * 5 + j, (i + 1) * 5 + j, (i + 1) * 5 + j + 1, i * 5 + j + 1]);
    const header = (format: string) => `ply\nformat ${format} 1.0\nelement vertex ${v.length}\nproperty float x\nproperty float y\nproperty float z\n`
      + 'property float nx\nproperty float ny\nproperty float nz\nproperty uchar red\nproperty uchar green\nproperty uchar blue\n'
      + `element face ${f.length}\nproperty list uchar int vertex_indices\nelement material 1\nproperty uchar red\nend_header\n`;
    const ascii = header('ascii') + [...v.map((p) => `${p.join(' ')} 0 0 1 200 180 160`), ...f.map((q) => `4 ${q.join(' ')}`), '200'].join('\n') + '\n';
    const head = new TextEncoder().encode(header('binary_little_endian'));
    const bin = new Uint8Array(head.length + v.length * 27 + f.length * 17 + 1);
    bin.set(head);
    const dv = new DataView(bin.buffer);
    let o = head.length;
    for (const p of v) {
      for (const x of [...p, 0, 0, 1]) { dv.setFloat32(o, x, true); o += 4; }
      for (const c of [200, 180, 160]) dv.setUint8(o++, c);
    }
    for (const q of f) {
      dv.setUint8(o++, 4);
      for (const k of q) { dv.setInt32(o, k, true); o += 4; }
    }
    dv.setUint8(o, 200);
    for (const data of [ascii, bin]) expect((await loadScan(file(data, 'scan.ply'))).triangleCount).toBe(32);
  });

  it('двоичный с лишними байтами в конце читается', async () => {
    const b = toPLY(room, 'binary_little_endian');
    const padded = new Uint8Array(b.length + 7);
    padded.set(b);
    await expectRoom(padded, 'binary + 7 байт');
  });

  it('обрезанный — понятная ошибка с числами из заголовка, где бы ни оборвались данные', async () => {
    const cut = plyCut(n * 3, n);
    const lines = text(toPLY(room)).split('\n');
    const body = lines.indexOf('end_header') + 1;
    const keep = (rows: number) => lines.slice(0, body + rows).join('\n') + '\n';
    // текстовый: обрыв среди точек, среди граней, без последней грани, последняя грань без последнего номера
    await expectScanError(loadScan(file(keep(n), 'scan.ply')), cut);
    await expectScanError(loadScan(file(keep(n * 3 + Math.floor(n / 2)), 'scan.ply')), cut);
    await expectScanError(loadScan(file(keep(n * 4 - 1), 'scan.ply')), cut);
    await expectScanError(loadScan(file(keep(n * 4).replace(/ \d+\n$/, '\n'), 'scan.ply')), cut);
    // двоичный: обрыв среди точек, среди граней, без последнего байта
    for (const format of ['binary_little_endian', 'binary_big_endian'] as const) {
      const b = toPLY(room, format);
      const head = b.length - n * 9 * 4 - n * 13;
      for (const len of [head + n * 9 * 2, head + n * 9 * 4 + n * 6, b.length - 1]) {
        await expectScanError(loadScan(file(b.slice(0, len), 'scan.ply')), cut);
      }
    }
  });
});

describe('glTF/GLB: исправные читаются, совет про внешние файлы — только когда геометрия в них (040)', () => {
  const n = room.length / 9;
  const EXTERNAL = 'glTF ссылается на внешние файлы. Экспортируйте скан в GLB (один файл).';
  const BROKEN = 'Не удалось прочитать glTF/GLB: файл повреждён.';
  // в node нет того, что загрузчик берёт у браузера: ProgressEvent (встроенный буфер .gltf читается через fetch с
  // событиями хода) и self (загрузка картинок; без него вместо пропуска недоступной текстуры — исключение)
  beforeAll(() => {
    if (typeof ProgressEvent === 'undefined') {
      vi.stubGlobal('ProgressEvent', class extends Event { constructor(type: string, init: object = {}) { super(type); Object.assign(this, init); } });
    }
    if (typeof self === 'undefined') vi.stubGlobal('self', globalThis);
  });
  afterAll(() => vi.unstubAllGlobals());

  it('GLB с двоичным блоком и со встроенным буфером, .gltf со встроенным буфером и с внешней текстурой — вся комната', async () => {
    const textured = {
      ...gltfJson(room, dataUri(room)),
      meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }],
      materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }],
      textures: [{ source: 0 }],
      images: [{ uri: 'texture.jpg' }],
    };
    const cases: [BlobPart, string][] = [
      [toGLB(gltfJson(room), room), 'GLB'],
      [toGLB(gltfJson(room, dataUri(room))), 'GLB, буфер data:'],
      [JSON.stringify(gltfJson(room, dataUri(room))), '.gltf, буфер data:'],
      [JSON.stringify(textured), '.gltf, текстура во внешнем файле'],
    ];
    for (const [data, what] of cases) {
      const s = await loadScan(file(data, what.startsWith('GLB') ? 'scan.glb' : 'scan.gltf'));
      expect(s.triangleCount, what).toBe(n);
      const r = detectRoom(s.triangles);
      expect([r.depth, r.width, r.height].map((v) => Math.round(v * 100) / 100), what).toEqual([5, 4, 2.6]);
    }
  });

  it('геометрия во внешнем файле — совет экспортировать GLB', async () => {
    const twoBuffers = { ...gltfJson(room, dataUri(room)), buffers: [{ byteLength: room.byteLength, uri: dataUri(room) }, { byteLength: 4, uri: 'extra.bin' }] };
    await expectScanError(loadScan(file(JSON.stringify(gltfJson(room, 'scan.bin')), 'scan.gltf')), EXTERNAL);
    await expectScanError(loadScan(file(JSON.stringify(twoBuffers), 'scan.gltf')), EXTERNAL);
    await expectScanError(loadScan(file(toGLB(gltfJson(room, 'scan.bin')), 'scan.glb')), EXTERNAL);
  });

  it('повреждённый — «файл повреждён», а не совет про внешние файлы', async () => {
    const glb = toGLB(gltfJson(room), room);
    const noAsset = { ...gltfJson(room, dataUri(room)), asset: undefined };
    await expectScanError(loadScan(file(toGLB(gltfJson(room), room, 1), 'scan.glb')), BROKEN);
    await expectScanError(loadScan(file(JSON.stringify(noAsset), 'scan.gltf')), BROKEN);
    await expectScanError(loadScan(file(glb.slice(0, glb.length >> 1), 'scan.glb')), BROKEN);
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
    // битый треугольник — четвёртым, далёкий — одиннадцатым: номера после них должны сдвинуться вместе с треугольниками
    const bad = 3, far = 10;
    const n = room.length / 9 + 2;
    const t = new Float32Array(n * 9);
    for (let i = 0, k = 0; i < n; i++) {
      if (i === bad) t.fill(NaN, i * 9, i * 9 + 9);
      else if (i === far) t.set([5e5, 5e5, 5e5, 5e5 + 1, 5e5, 5e5, 5e5, 5e5 + 1, 5e5], i * 9);
      else t.set(room.subarray(9 * k, 9 * ++k), i * 9);
    }
    const ids = new Uint16Array(n).map((_, i) => i % 7);
    const c = cleanTriangles(t, ids);
    expect(c.invalid).toBe(1);
    expect(c.outliers).toBe(1);
    expect(Array.from(c.triangles)).toEqual(Array.from(room));
    expect(Array.from(c.ids!)).toEqual(Array.from(ids).filter((_, i) => i !== bad && i !== far));
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
