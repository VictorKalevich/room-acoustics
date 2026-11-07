// 3D-превью скана с наложенным распознанным объёмом. Модуль подгружается лениво вместе с three.js.
import { useEffect, useRef } from 'preact/hooks';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

interface Props {
  object: THREE.Object3D;
  transform: number[] | null;
  dims: { depth: number; width: number; height: number } | null;
}

export default function ScanPreview({ object, transform, dims }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = ref.current;
    if (!host) return;
    const w = host.clientWidth;
    const h = Math.round(w * 0.75);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, h);
    renderer.localClippingEnabled = true;
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 2.2));
    const sun = new THREE.DirectionalLight(0xffffff, 1.2);
    sun.position.set(3, 8, 5);
    scene.add(sun);

    // Скан в координатах комнаты (z — вверх), затем поворот в Y-up сцены three.js
    const holder = new THREE.Group();
    holder.rotation.x = -Math.PI / 2;
    scene.add(holder);
    const wrapper = new THREE.Group();
    wrapper.add(object);
    if (transform) {
      wrapper.matrixAutoUpdate = false;
      wrapper.matrix.fromArray(transform);
    }
    holder.add(wrapper);

    // Разрез по 80 % высоты, чтобы было видно комнату изнутри
    if (dims && transform) {
      const cut = new THREE.Plane(new THREE.Vector3(0, -1, 0), dims.height * 0.8);
      object.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        mats.forEach((m) => { m.clippingPlanes = [cut]; m.side = THREE.DoubleSide; });
      });
    }

    if (dims) {
      const box = new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(dims.depth, dims.width, dims.height));
      const helper = new THREE.Box3Helper(box, new THREE.Color(0x2d45c2));
      (helper.material as THREE.LineBasicMaterial).linewidth = 2;
      holder.add(helper);
    }

    holder.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(holder);
    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3()).length() || 5;

    const camera = new THREE.PerspectiveCamera(45, w / h, size / 100, size * 10);
    camera.position.copy(center).add(new THREE.Vector3(size * 0.55, size * 0.75, size * 0.7));
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.copy(center);
    controls.enableDamping = true;

    let raf = 0;
    const loop = () => {
      controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(loop);
    };
    loop();

    return () => {
      cancelAnimationFrame(raf);
      controls.dispose();
      wrapper.remove(object);
      renderer.dispose();
      host.removeChild(renderer.domElement);
    };
  }, [object, transform, dims]);

  return <div class="scan-preview" ref={ref} aria-label="3D-превью скана, можно вращать пальцем" />;
}
