// Загрузка файлов сканов через загрузчики three.js (основной поток).
import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { ScanLabels, ScanObjectKind } from './layout';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { cleanTriangles } from './clean';

export type ScanFormat = 'obj' | 'glb' | 'gltf' | 'ply' | 'stl';

export const SUPPORTED = 'OBJ, GLB, glTF (со встроенными данными), PLY, STL';
export const MAX_TRIANGLES = 2_000_000;
/** Больше — iPhone может не хватить памяти на разбор (текстовый OBJ раздувается в несколько раз). */
export const MAX_FILE_MB = 500;

export class ScanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScanError';
  }
}

export interface LoadedScan {
  triangles: Float32Array;
  /** Разметка RoomPlan/Polycam (двери, окна, проёмы), если она есть в файле. */
  labels?: ScanLabels;
  preview: THREE.Object3D;
  format: ScanFormat;
  triangleCount: number;
  decimated: boolean;
  /** Сколько треугольников отброшено как мусор (нечисловые координаты, далёкие выбросы). */
  dropped: number;
}

function detectFormat(name: string, head: Uint8Array): ScanFormat {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  const text = new TextDecoder().decode(head.slice(0, 80));
  if (text.startsWith('glTF')) return 'glb';
  if (text.startsWith('ply')) return 'ply';
  if (ext === 'obj' || ext === 'glb' || ext === 'gltf' || ext === 'ply' || ext === 'stl') return ext;
  if (/^\s*(#|v |o |mtllib|g )/m.test(text)) return 'obj';
  if (text.trimStart().startsWith('{')) return 'gltf';
  if (text.startsWith('solid') || head.length > 84) return 'stl';
  throw new ScanError(`Неизвестный формат файла. Поддерживаются: ${SUPPORTED}.`);
}

function defaultMaterial(hasColors: boolean) {
  return new THREE.MeshStandardMaterial({
    color: hasColors ? 0xffffff : 0xb9b2a5,
    vertexColors: hasColors,
    side: THREE.DoubleSide,
    roughness: 0.9,
    flatShading: !hasColors,
  });
}

async function parse(buf: ArrayBuffer, format: ScanFormat): Promise<THREE.Object3D> {
  switch (format) {
    case 'obj': {
      const obj = new OBJLoader().parse(new TextDecoder().decode(buf));
      obj.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) {
          const m = o as THREE.Mesh;
          const g = m.geometry as THREE.BufferGeometry;
          if (!g.getAttribute('normal')) g.computeVertexNormals();
          m.material = defaultMaterial(!!g.getAttribute('color'));
        }
      });
      return obj;
    }
    case 'glb':
    case 'gltf': {
      try {
        const gltf = await new GLTFLoader().parseAsync(buf, '');
        return gltf.scene;
      } catch (e) {
        const msg = String((e as Error)?.message ?? e);
        if (/load|fetch|uri/i.test(msg)) {
          throw new ScanError('glTF ссылается на внешние файлы. Экспортируйте скан в GLB (один файл).');
        }
        throw new ScanError('Не удалось прочитать glTF/GLB: файл повреждён.');
      }
    }
    case 'ply': {
      const header = new TextDecoder().decode(new Uint8Array(buf, 0, Math.min(buf.byteLength, 4096)));
      const faces = /element\s+face\s+(\d+)/.exec(header);
      if (!faces || Number(faces[1]) === 0) {
        throw new ScanError('Файл PLY содержит облако точек без поверхностей — экспортируйте сетку (mesh).');
      }
      checkPly(buf);
      const g = new PLYLoader().parse(buf);
      if (!g.getAttribute('normal')) g.computeVertexNormals();
      return new THREE.Mesh(g, defaultMaterial(!!g.getAttribute('color')));
    }
    case 'stl': {
      checkStl(buf);
      const g = new STLLoader().parse(buf);
      return new THREE.Mesh(g, defaultMaterial(!!g.getAttribute('color')));
    }
  }
}

/**
 * Двоичный STL: загрузчик сразу выделяет память под заявленное в заголовке число треугольников.
 * В повреждённом файле там бывает что угодно (до 4 млрд) — проверяем, что данные действительно есть.
 */
function checkStl(buf: ArrayBuffer) {
  const head = new TextDecoder().decode(new Uint8Array(buf, 0, Math.min(buf.byteLength, 256)));
  if (buf.byteLength < 84) {
    if (/^\s*solid/.test(head)) return; // крошечный текстовый STL — разберёт текстовый парсер
    throw new ScanError('Файл STL обрезан или повреждён.');
  }
  const faces = new DataView(buf).getUint32(80, true);
  const expected = 84 + faces * 50;
  if (expected === buf.byteLength) return;
  // текстовый STL («solid …», внутри — facet/vertex)
  if (/^\s*solid/.test(head) && /facet|vertex/.test(head + new TextDecoder().decode(new Uint8Array(buf, 0, Math.min(buf.byteLength, 4096))))) return;
  if (expected > buf.byteLength) {
    throw new ScanError(`Файл STL обрезан или повреждён: в заголовке ${faces.toLocaleString('ru-RU')} треугольников, а данных меньше.`);
  }
  // лишние байты в конце (некоторые программы дописывают) — не страшно
}

interface PlyProp { type: string; countType?: string }
interface PlyElement { name: string; count: number; props: PlyProp[] }

const PLY_SIZE: Record<string, number> = {
  char: 1, uchar: 1, int8: 1, uint8: 1, short: 2, ushort: 2, int16: 2, uint16: 2,
  int: 4, uint: 4, int32: 4, uint32: 4, float: 4, float32: 4, double: 8, float64: 8,
};

/** Заголовок PLY: формат, элементы и смещение данных; null — заголовок не разобрать (тогда решает загрузчик). */
function plyHeader(buf: ArrayBuffer): { format: string; elements: PlyElement[]; body: number } | null {
  const bytes = new Uint8Array(buf, 0, Math.min(buf.byteLength, 65536));
  const text = new TextDecoder('latin1').decode(bytes);
  const end = /end_header[ \t]*\r?\n/.exec(text);
  if (!end) return null;
  let format = '';
  const elements: PlyElement[] = [];
  for (const line of text.slice(0, end.index).split(/\r?\n/)) {
    const w = line.trim().split(/\s+/);
    if (w[0] === 'format') format = w[1];
    else if (w[0] === 'element') elements.push({ name: w[1], count: Number(w[2]), props: [] });
    else if (w[0] === 'property' && elements.length) {
      elements[elements.length - 1].props.push(w[1] === 'list' ? { type: w[3], countType: w[2] } : { type: w[1] });
    }
  }
  if (!elements.every((e) => Number.isInteger(e.count) && e.count >= 0)) return null;
  return { format, elements, body: end.index + end[0].length };
}

/**
 * Обрезанный PLY (файл не докопирован): загрузчик three.js текстовый файл читает частично — комната распознаётся по
 * части скана или не распознаётся с советом пересканировать, — а на двоичном падает. Проверяем, что данных столько,
 * сколько заявлено в заголовке.
 */
function checkPly(buf: ArrayBuffer) {
  const h = plyHeader(buf);
  if (!h) return;
  const truncated = () => {
    const n = (name: string) => (h.elements.find((e) => e.name === name)?.count ?? 0).toLocaleString('ru-RU');
    return new ScanError(`Файл PLY обрезан или повреждён: в заголовке ${n('vertex')} точек и ${n('face')} граней, а данных меньше. Скопируйте или экспортируйте файл заново.`);
  };
  const data = new Uint8Array(buf, h.body);
  if (h.format === 'ascii') {
    // в текстовом PLY строка данных — одна строка файла
    let rows = 0, inRow = false, lastStart = 0, lastEnd = data.length;
    for (let i = 0; i < data.length; i++) {
      const c = data[i];
      if (c === 10 || c === 13) {
        if (inRow) { rows++; inRow = false; lastEnd = i; }
      } else if (c !== 32 && c !== 9 && !inRow) {
        inRow = true;
        lastStart = i;
        lastEnd = data.length;
      }
    }
    if (inRow) rows++;
    const total = h.elements.reduce((s, e) => s + e.count, 0);
    if (rows < total) throw truncated();
    // последняя строка оборвана: значений меньше, чем требуют свойства её элемента
    const last = h.elements.filter((e) => e.count > 0).at(-1);
    if (!last || rows > total) return;
    const words = new TextDecoder().decode(data.subarray(lastStart, lastEnd)).trim().split(/\s+/);
    let k = 0;
    for (const p of last.props) k += p.countType ? 1 + Number(words[k]) : 1;
    if (!(k <= words.length)) throw truncated();
    return;
  }
  if (h.format !== 'binary_little_endian' && h.format !== 'binary_big_endian') return;
  const little = h.format === 'binary_little_endian';
  const dv = new DataView(buf);
  const read = (type: string, at: number) => {
    switch (PLY_SIZE[type]) {
      case 1: return dv.getUint8(at);
      case 2: return dv.getUint16(at, little);
      default: return dv.getUint32(at, little);
    }
  };
  let at = h.body;
  for (const e of h.elements) {
    if (e.props.some((p) => !PLY_SIZE[p.type] || (p.countType && !PLY_SIZE[p.countType]))) return;
    if (!e.props.some((p) => p.countType)) {
      at += e.count * e.props.reduce((s, p) => s + PLY_SIZE[p.type], 0);
      if (at > buf.byteLength) throw truncated();
      continue;
    }
    for (let r = 0; r < e.count; r++) {
      for (const p of e.props) {
        if (!p.countType) { at += PLY_SIZE[p.type]; continue; }
        if (at + PLY_SIZE[p.countType] > buf.byteLength) throw truncated();
        at += PLY_SIZE[p.countType] + read(p.countType, at) * PLY_SIZE[p.type];
      }
      if (at > buf.byteLength) throw truncated();
    }
  }
}

const LABEL_RE = /^(door|window|opening)[\s_-]*\d*$/i;
/** Категории мебели RoomPlan / Polycam (имя узла начинается с категории: sofa_0, table_dining_rect_0). */
const FURN_RE = /^(storage|shelf|cabinet|wardrobe|refrigerator|fridge|stove|oven|bed|sink|washer|dryer|washerdryer|toilet|bathtub|dishwasher|table|desk|sofa|couch|chair|armchair|fireplace|television|tv|stairs|piano)(?=$|[\s_\-\d])/i;

/** Тип размеченного объекта по имени узла или его ближайшего предка (Door_0, Window_1, Opening_2). */
function labelOf(o: THREE.Object3D): { kind: ScanObjectKind; node: THREE.Object3D; name: string } | null {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) {
    const nm = p.name.trim();
    const m = LABEL_RE.exec(nm);
    if (m) return { kind: m[1].toLowerCase() as ScanObjectKind, node: p, name: m[1].toLowerCase() };
    const f = FURN_RE.exec(nm);
    if (f) return { kind: 'furniture', node: p, name: f[1].toLowerCase() };
  }
  return null;
}

/** Собирает треугольники всех сеток сцены в мировых координатах. */
export function extractTriangles(root: THREE.Object3D, maxTriangles = MAX_TRIANGLES): { triangles: Float32Array; total: number; decimated: boolean; labels?: ScanLabels } {
  root.updateMatrixWorld(true);
  const meshes: THREE.Mesh[] = [];
  let total = 0;
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const g = m.geometry as THREE.BufferGeometry;
    const pos = g.getAttribute('position');
    if (!pos) return;
    total += g.index ? g.index.count / 3 : pos.count / 3;
    meshes.push(m);
  });
  const step = Math.max(1, Math.ceil(total / maxTriangles));
  const out = new Float32Array(Math.ceil(total / step) * 9);
  const ids = new Uint16Array(Math.ceil(total / step));
  const objects: ScanObjectKind[] = [];
  const names: string[] = [];
  const objIndex = new Map<THREE.Object3D, number>();
  const v = new THREE.Vector3();
  let k = 0;
  let t = 0;
  for (const m of meshes) {
    const g = m.geometry as THREE.BufferGeometry;
    const pos = g.getAttribute('position');
    const idx = g.index;
    const nTri = idx ? idx.count / 3 : pos.count / 3;
    const lb = labelOf(m);
    let id = 0;
    if (lb && objects.length < 65000) {
      id = objIndex.get(lb.node) ?? 0;
      if (!id) { objects.push(lb.kind); names.push(lb.name); id = objects.length; objIndex.set(lb.node, id); }
    }
    for (let f = 0; f < nTri; f++, t++) {
      if (t % step !== 0) continue;
      ids[k / 9] = id;
      for (let c = 0; c < 3; c++) {
        const vi = idx ? idx.getX(f * 3 + c) : f * 3 + c;
        v.fromBufferAttribute(pos, vi).applyMatrix4(m.matrixWorld);
        out[k++] = v.x; out[k++] = v.y; out[k++] = v.z;
      }
    }
  }
  const labels = objects.length ? { ids: ids.slice(0, k / 9), objects, names } : undefined;
  return { triangles: out.subarray(0, k), total, decimated: step > 1, labels };
}

export async function loadScan(file: File): Promise<LoadedScan> {
  if (file.size === 0) throw new ScanError('Файл пустой.');
  if (file.size > MAX_FILE_MB * 1024 * 1024) {
    throw new ScanError(`Файл слишком большой (${Math.round(file.size / 1024 / 1024)} МБ, можно до ${MAX_FILE_MB} МБ). Экспортируйте скан с меньшей детализацией.`);
  }
  const buf = await file.arrayBuffer();
  const format = detectFormat(file.name, new Uint8Array(buf, 0, Math.min(buf.byteLength, 128)));
  let preview: THREE.Object3D;
  try {
    preview = await parse(buf, format);
  } catch (e) {
    if (e instanceof ScanError) throw e;
    throw new ScanError(`Не удалось прочитать файл (${format.toUpperCase()}). Поддерживаются: ${SUPPORTED}.`);
  }
  const ex = extractTriangles(preview);
  if (ex.total < 20) {
    throw new ScanError('В файле нет поверхностей (или это облако точек). Экспортируйте скан как сетку (mesh).');
  }
  const c = cleanTriangles(ex.triangles, ex.labels?.ids);
  if (c.triangles.length / 9 < 20) {
    throw new ScanError('Координаты в файле повреждены: почти все точки нечисловые. Экспортируйте скан заново.');
  }
  const labels = ex.labels && c.ids ? { ...ex.labels, ids: c.ids } : ex.labels;
  return { triangles: c.triangles, labels, preview, format, triangleCount: ex.total, decimated: ex.decimated, dropped: c.invalid + c.outliers };
}
