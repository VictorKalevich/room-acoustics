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
