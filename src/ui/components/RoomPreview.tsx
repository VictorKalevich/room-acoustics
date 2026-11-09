// 3D-модель комнаты по введённым данным — в том же виде, что и превью скана (когда файла скана нет).
// Стены видны только изнутри: ближние к камере стены прозрачны, потолка нет. Модуль подгружается лениво вместе с three.js.
import { useEffect, useMemo, useRef } from 'preact/hooks';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Room } from '../../core/types';
import { extensionBox } from '../../core/geometry';
import { roomModel, type Quad, type QuadKind } from '../../core/roomModel';

interface Props { room: Room }

function cssColor(name: string, fallback: string): THREE.Color {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return new THREE.Color(v || fallback);
}

/** Стена снаружи (ближняя к камере): едва видна, чтобы не закрывать комнату, но окна и двери на ней остаются видны. */
function ghost(): THREE.Material {
  return new THREE.MeshBasicMaterial({ color: 0x8a8478, side: THREE.BackSide, transparent: true, opacity: 0.12, depthWrite: false });
}

/** Материалы — как у превью скана (матовый серо-бежевый, плоское затенение). */
function material(kind: QuadKind, accent: THREE.Color): THREE.Material {
  const base = { roughness: 0.9, flatShading: true, side: THREE.FrontSide } as const;
  switch (kind) {
    case 'floor': return new THREE.MeshStandardMaterial({ ...base, color: 0xa69f92 });
    case 'front': return new THREE.MeshStandardMaterial({ ...base, color: new THREE.Color(0xb9b2a5).lerp(accent, 0.22) });
    // окна и двери видны и сквозь полупрозрачную ближнюю стену
    case 'window': return new THREE.MeshStandardMaterial({ ...base, color: 0x9fcbe6, roughness: 0.3, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1 });
    case 'door': return new THREE.MeshStandardMaterial({ ...base, color: 0x8d6a4b, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1 });
    case 'slope': return new THREE.MeshBasicMaterial({ color: 0x8a8376, side: THREE.DoubleSide, transparent: true, opacity: 0.4, depthWrite: false });
    default: return new THREE.MeshStandardMaterial({ ...base, color: 0xb9b2a5 });
  }
}

function meshOf(quads: Quad[], mat: THREE.Material): THREE.Mesh {
  const pos: number[] = [];
  for (const q of quads) {
    const [a, b, c, d] = q.pts;
    pos.push(...a, ...b, ...c, ...a, ...c, ...d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return new THREE.Mesh(g, mat);
}

function disposeGroup(g: THREE.Group) {
  while (g.children.length > 0) {
    const o = g.children[g.children.length - 1];
    g.remove(o);
    const m = o as THREE.Mesh;
    m.geometry?.dispose();
    const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
    mats.forEach((x) => x.dispose());
  }
}

export default function RoomPreview({ room }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const ctx = useRef<{ camera: THREE.PerspectiveCamera; controls: OrbitControls; holder: THREE.Group; model: THREE.Group; dims: string } | null>(null);

  // сцена, свет и камера — как у превью скана; один раз
  useEffect(() => {
    const el = host.current!;
    const w = el.clientWidth || 320;
    const h = Math.round(w * 0.75);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, h);
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 2.2));
    const sun = new THREE.DirectionalLight(0xffffff, 1.2);
    sun.position.set(3, 8, 5);
    scene.add(sun);
    // координаты комнаты (z — вверх) → сцена three.js (Y — вверх)
    const holder = new THREE.Group();
    holder.rotation.x = -Math.PI / 2;
    scene.add(holder);
    const model = new THREE.Group();
    holder.add(model);
    const camera = new THREE.PerspectiveCamera(45, w / h, 0.05, 200);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    ctx.current = { camera, controls, holder, model, dims: '' };
    let raf = 0;
    const loop = () => {
      controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(loop);
    };
    loop();
    const ro = new ResizeObserver(() => {
      const ww = el.clientWidth;
      if (!ww) return;
      const hh = Math.round(ww * 0.75);
      renderer.setSize(ww, hh);
      camera.aspect = ww / hh;
      camera.updateProjectionMatrix();
    });
    ro.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      disposeGroup(model);
      renderer.dispose();
      el.removeChild(renderer.domElement);
      ctx.current = null;
    };
  }, []);

  const quads = useMemo(
    () => roomModel(room),
    // только геометрия: материалы, мебель и обработка на модель не влияют
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [room.depth, room.width, room.height, room.openings, room.features, room.extensions, room.slope],
  );

  // модель; камера возвращается на место только при смене размеров
  useEffect(() => {
    const c = ctx.current;
    if (!c) return;
    disposeGroup(c.model);
    const accent = cssColor('--accent', '#2d45c2');
    const kinds = [...new Set(quads.map((q) => q.kind))];
    for (const k of kinds) {
      const qs = quads.filter((q) => q.kind === k);
      c.model.add(meshOf(qs, material(k, accent)));
      if (k === 'wall' || k === 'front') c.model.add(meshOf(qs, ghost()));
      // у скоса — контур, чтобы наклон читался
      if (k === 'slope') {
        const pts = qs.flatMap((q) => [0, 1, 1, 2, 2, 3, 3, 0].map((i) => new THREE.Vector3(...q.pts[i])));
        c.model.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x6f695e })));
      }
    }
    const { depth: D, width: W, height: H } = room;
    // контур комнаты — как распознанный объём на превью скана
    const outline = new THREE.Box3Helper(new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(D, W, H)), accent);
    c.model.add(outline);
    for (const e of room.extensions ?? []) {
      const b = extensionBox(room, e);
      c.model.add(new THREE.Box3Helper(new THREE.Box3(new THREE.Vector3(b.x0, b.y0, 0), new THREE.Vector3(b.x1, b.y1, e.height)), new THREE.Color(0xaab5b6)));
    }
    const dims = `${D}|${W}|${H}|${(room.extensions ?? []).map((e) => `${e.wall}${e.a0}${e.a1}${e.depth}`).join()}`;
    if (dims !== c.dims) {
      c.dims = dims;
      // камера — как у превью скана: сзади-слева и сверху, на весь объём (с коридорами)
      c.holder.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(c.model);
      const center = bounds.getCenter(new THREE.Vector3());
      const size = bounds.getSize(new THREE.Vector3()).length() || 5;
      c.camera.position.copy(center).add(new THREE.Vector3(size * 0.55, size * 0.75, size * 0.7).multiplyScalar(1.15));
      c.controls.target.copy(center);
      c.controls.update();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quads]);

  return <div class="scan-preview" ref={host} aria-label="3D-модель комнаты по введённым размерам, можно вращать пальцем" />;
}
