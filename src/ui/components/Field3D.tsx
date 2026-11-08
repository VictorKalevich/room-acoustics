// 3D-вид поля: облако точек (красное — громче среднего по комнате, синее — тише), каркас комнаты,
// колонки, сабвуферы, слушатель и плоскости среза. Модуль подгружается лениво вместе с three.js.
import { useEffect, useRef } from 'preact/hooks';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { FieldResult } from '../../core/field3d';
import { toDb } from '../../core/field3d';
import { extensionBox } from '../../core/geometry';
import type { Room, Vec3 } from '../../core/types';
import { fieldColor } from '../fieldColors';

export interface Field3DItem { id: string; kind: 'spk' | 'sub' | 'listener'; pos: Vec3 }

interface Props {
  room: Room;
  field: FieldResult | null;
  energy: Float32Array | null;
  threshold: number;
  items: Field3DItem[];
  slice: [number, number];
}

function cssColor(name: string, fallback: string): THREE.Color {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  try { return new THREE.Color(v || fallback); } catch { return new THREE.Color(fallback); }
}

function dotTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.6, 'rgba(255,255,255,0.8)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function disposeGroup(g: THREE.Group) {
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    m.geometry?.dispose();
    const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
    mats.forEach((x) => x.dispose());
  });
  g.clear();
}

function boxEdges(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, color: THREE.Color, opacity = 1) {
  const geo = new THREE.EdgesGeometry(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0));
  const line = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity }));
  line.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return line;
}

export default function Field3D({ room, field, energy, threshold, items, slice }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const ctx = useRef<{
    renderer: THREE.WebGLRenderer;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    holder: THREE.Group;
    roomG: THREE.Group;
    itemsG: THREE.Group;
    sliceG: THREE.Group;
    points: THREE.Points;
    tex: THREE.Texture;
  } | null>(null);

  // сцена, камера, рендерер — один раз
  useEffect(() => {
    const el = host.current!;
    const w = el.clientWidth || 320;
    const h = Math.round(w * 0.8);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, h);
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 2.4));
    const sun = new THREE.DirectionalLight(0xffffff, 1.0);
    sun.position.set(3, 8, 5);
    scene.add(sun);
    // координаты комнаты (x — глубина, y — ширина, z — вверх) → сцена three.js (Y — вверх)
    const holder = new THREE.Group();
    holder.rotation.x = -Math.PI / 2;
    scene.add(holder);
    const roomG = new THREE.Group(), itemsG = new THREE.Group(), sliceG = new THREE.Group();
    const tex = dotTexture();
    const points = new THREE.Points(
      new THREE.BufferGeometry(),
      new THREE.PointsMaterial({ size: 0.2, vertexColors: true, transparent: true, depthWrite: false, map: tex, alphaTest: 0.02, sizeAttenuation: true }),
    );
    holder.add(roomG, sliceG, points, itemsG);
    const camera = new THREE.PerspectiveCamera(45, w / h, 0.05, 200);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.enablePan = true;
    ctx.current = { renderer, camera, controls, holder, roomG, itemsG, sliceG, points, tex };
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
      const hh = Math.round(ww * 0.8);
      renderer.setSize(ww, hh);
      camera.aspect = ww / hh;
      camera.updateProjectionMatrix();
    });
    ro.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      [roomG, itemsG, sliceG].forEach(disposeGroup);
      points.geometry.dispose();
      (points.material as THREE.Material).dispose();
      tex.dispose();
      renderer.dispose();
      el.removeChild(renderer.domElement);
      ctx.current = null;
    };
  }, []);

  // комната, коридор, стена с колонками, пол; камера смотрит со стороны задней стены
  useEffect(() => {
    const c = ctx.current;
    if (!c) return;
    disposeGroup(c.roomG);
    const ink = cssColor('--ink', '#17222b');
    const accent = cssColor('--accent', '#2d45c2');
    const line = cssColor('--line-strong', '#aab5b6');
    const { depth: D, width: W, height: H } = room;
    c.roomG.add(boxEdges(0, 0, 0, D, W, H, ink, 0.9));
    for (const e of room.extensions ?? []) {
      const b = extensionBox(room, e);
      c.roomG.add(boxEdges(b.x0, b.y0, 0, b.x1, b.y1, e.height, line, 0.9));
    }
    const front = new THREE.Mesh(
      new THREE.PlaneGeometry(H, W),
      new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }),
    );
    front.rotation.y = Math.PI / 2;
    front.position.set(0.001, W / 2, H / 2);
    c.roomG.add(front);
    const grid = new THREE.GridHelper(Math.max(D, W), Math.round(Math.max(D, W) / 0.5), line, line);
    grid.rotation.x = Math.PI / 2;
    grid.position.set(D / 2, W / 2, 0);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.35;
    c.roomG.add(grid);
    // камера
    const size = Math.hypot(D, W, H);
    const target = new THREE.Vector3(D / 2, W / 2, H * 0.4).applyEuler(c.holder.rotation);
    const eye = new THREE.Vector3(D + size * 0.75, W / 2 + size * 0.45, H + size * 0.55).applyEuler(c.holder.rotation);
    c.camera.position.copy(eye);
    c.controls.target.copy(target);
    c.controls.update();
  }, [room.depth, room.width, room.height, room.extensions]);

  // колонки, сабвуферы, слушатель
  useEffect(() => {
    const c = ctx.current;
    if (!c) return;
    disposeGroup(c.itemsG);
    const accent = cssColor('--accent', '#2d45c2');
    const ink = cssColor('--ink', '#17222b');
    const surface = cssColor('--surface', '#ffffff');
    const listener = items.find((i) => i.kind === 'listener');
    for (const it of items) {
      let mesh: THREE.Mesh;
      if (it.kind === 'spk') {
        mesh = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.3, 0.36), new THREE.MeshStandardMaterial({ color: accent }));
        if (listener) mesh.rotation.z = Math.atan2(listener.pos.y - it.pos.y, listener.pos.x - it.pos.x);
      } else if (it.kind === 'sub') {
        mesh = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.36, 0.36), new THREE.MeshStandardMaterial({ color: ink }));
      } else {
        mesh = new THREE.Mesh(new THREE.SphereGeometry(0.11, 20, 14), new THREE.MeshStandardMaterial({ color: surface, emissive: surface, emissiveIntensity: 0.2 }));
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.015, 8, 32), new THREE.MeshBasicMaterial({ color: ink }));
        ring.position.set(it.pos.x, it.pos.y, it.pos.z);
        c.itemsG.add(ring);
      }
      mesh.position.set(it.pos.x, it.pos.y, it.kind === 'listener' ? it.pos.z : Math.max(it.pos.z, 0.18));
      c.itemsG.add(mesh);
    }
  }, [items]);

  // плоскости среза
  useEffect(() => {
    const c = ctx.current;
    if (!c) return;
    disposeGroup(c.sliceG);
    const accent = cssColor('--accent', '#2d45c2');
    const zs = Math.abs(slice[1] - slice[0]) < 0.01 ? [slice[0]] : slice;
    for (const z of zs) {
      const pl = new THREE.Mesh(
        new THREE.PlaneGeometry(room.depth, room.width),
        new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false }),
      );
      pl.position.set(room.depth / 2, room.width / 2, z);
      c.sliceG.add(pl);
      c.sliceG.add(boxEdges(0, 0, z, room.depth, room.width, z, accent, 0.6));
    }
  }, [slice[0], slice[1], room.depth, room.width]);

  // облако точек
  useEffect(() => {
    const c = ctx.current;
    if (!c) return;
    const geo = new THREE.BufferGeometry();
    if (field && energy) {
      const pos: number[] = [];
      const col: number[] = [];
      const { nx, ny, nz } = field;
      for (let i = 0; i < nx; i++)
        for (let j = 0; j < ny; j++)
          for (let k = 0; k < nz; k++) {
            const p = (i * ny + j) * nz + k;
            if (!field.mask[p]) continue;
            const rgba = fieldColor(toDb(energy[p]), threshold);
            if (!rgba) continue;
            pos.push(field.x0 + i * field.sx, field.y0 + j * field.sy, field.z0 + k * field.sz);
            col.push(...rgba);
          }
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
      (c.points.material as THREE.PointsMaterial).size = Math.max(field.sx, field.sy, field.sz) * 1.9;
    }
    c.points.geometry.dispose();
    c.points.geometry = geo;
  }, [field, energy, threshold]);

  return <div class="field3d" ref={host} aria-label="3D-модель поля: вращайте одним пальцем, приближайте двумя" />;
}
