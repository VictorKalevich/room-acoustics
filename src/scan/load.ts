// Загрузка файлов сканов через загрузчики three.js (основной поток).
import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';

export type ScanFormat = 'obj' | 'glb' | 'gltf' | 'ply' | 'stl';

export const SUPPORTED = 'OBJ, GLB, glTF (со встроенными данными), PLY, STL';
export const MAX_TRIANGLES = 2_000_000;

export class ScanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScanError';
  }
}

export interface LoadedScan {
  triangles: Float32Array;
  preview: THREE.Object3D;
  format: ScanFormat;
  triangleCount: number;
  decimated: boolean;
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
      const g = new STLLoader().parse(buf);
      return new THREE.Mesh(g, defaultMaterial(!!g.getAttribute('color')));
    }
  }
}

/** Собирает треугольники всех сеток сцены в мировых координатах. */
export function extractTriangles(root: THREE.Object3D, maxTriangles = MAX_TRIANGLES): { triangles: Float32Array; total: number; decimated: boolean } {
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
  const v = new THREE.Vector3();
  let k = 0;
  let t = 0;
  for (const m of meshes) {
    const g = m.geometry as THREE.BufferGeometry;
    const pos = g.getAttribute('position');
    const idx = g.index;
    const nTri = idx ? idx.count / 3 : pos.count / 3;
    for (let f = 0; f < nTri; f++, t++) {
      if (t % step !== 0) continue;
      for (let c = 0; c < 3; c++) {
        const vi = idx ? idx.getX(f * 3 + c) : f * 3 + c;
        v.fromBufferAttribute(pos, vi).applyMatrix4(m.matrixWorld);
        out[k++] = v.x; out[k++] = v.y; out[k++] = v.z;
      }
    }
  }
  return { triangles: out.subarray(0, k), total, decimated: step > 1 };
}

export async function loadScan(file: File): Promise<LoadedScan> {
  if (file.size === 0) throw new ScanError('Файл пустой.');
  const buf = await file.arrayBuffer();
  const format = detectFormat(file.name, new Uint8Array(buf, 0, Math.min(buf.byteLength, 128)));
  let preview: THREE.Object3D;
  try {
    preview = await parse(buf, format);
  } catch (e) {
    if (e instanceof ScanError) throw e;
    throw new ScanError(`Не удалось прочитать файл (${format.toUpperCase()}). Поддерживаются: ${SUPPORTED}.`);
  }
  const { triangles, total, decimated } = extractTriangles(preview);
  if (total < 20) {
    throw new ScanError('В файле нет поверхностей (или это облако точек). Экспортируйте скан как сетку (mesh).');
  }
  return { triangles, preview, format, triangleCount: total, decimated };
}
