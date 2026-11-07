import { describe, expect, it } from 'vitest';
import { detectRoom, DetectError } from '../../src/scan/detect';
import { makeRoomScan, type SynthOptions } from '../fixtures/synthetic';

const base: SynthOptions = { depth: 5, width: 4, height: 2.5, noise: 0.01, furniture: true, openings: true };

function expectDims(o: SynthOptions, tol = 0.05) {
  const r = detectRoom(makeRoomScan(o));
  expect(Math.abs(r.depth - Math.max(o.depth, o.width))).toBeLessThan(tol);
  expect(Math.abs(r.width - Math.min(o.depth, o.width))).toBeLessThan(tol);
  expect(Math.abs(r.height - o.height)).toBeLessThan(tol);
  return r;
}

describe('detectRoom', () => {
  it('прямоугольная комната с мебелью, шумом, дверью и окном: ±5 см', () => {
    const r = expectDims(base);
    expect(r.hasCeiling).toBe(true);
    expect(r.confidence).toBeGreaterThan(0.6);
    expect(r.outsideFraction).toBeLessThan(0.05);
  });

  it('Y-up и Z-up', () => {
    expectDims({ ...base, upAxis: 'y' });
    expectDims({ ...base, upAxis: 'z' });
  });

  it('поворот вокруг вертикали и смещение начала координат', () => {
    for (const rot of [17, 45, 73, 120]) {
      const r = expectDims({ ...base, rotationDeg: rot, offset: [3.3, -1.2, 0.8] });
      expect(r.warnings.filter((w) => w.includes('частично')).length).toBe(0);
    }
  });

  it('единицы: сантиметры и миллиметры определяются автоматически', () => {
    expect(expectDims({ ...base, units: 'cm' }).units).toBe('cm');
    expect(expectDims({ ...base, units: 'mm' }).units).toBe('mm');
  });

  it('небольшой наклон скана компенсируется', () => {
    const r = expectDims({ ...base, tiltDeg: 4 }, 0.06);
    expect(r.tiltDeg).toBeGreaterThan(3);
  });

  it('ширина больше глубины: глубиной считается длинная сторона', () => {
    expectDims({ ...base, depth: 3.2, width: 6.1, height: 2.7 });
  });

  it('без потолка — предупреждение и высота по стенам', () => {
    const r = detectRoom(makeRoomScan({ ...base, ceiling: false }));
    expect(r.hasCeiling).toBe(false);
    expect(Math.abs(r.height - 2.5)).toBeLessThan(0.1);
    expect(r.warnings.some((w) => w.includes('Потолок'))).toBe(true);
  });

  it('Г-образная комната — предупреждение о непрямоугольности', () => {
    const r = detectRoom(makeRoomScan({ ...base, lShape: true }));
    expect(r.outsideFraction).toBeGreaterThan(0.1);
    expect(r.warnings.some((w) => w.includes('не прямоугольная'))).toBe(true);
  });

  it('матрица переводит скан в координаты комнаты (углы → 0…размер)', () => {
    const tri = makeRoomScan({ ...base, rotationDeg: 30, units: 'cm', offset: [1, 2, 0] });
    const r = detectRoom(tri);
    const m = r.transform;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < tri.length; i += 3) {
      const x = m[0] * tri[i] + m[4] * tri[i + 1] + m[8] * tri[i + 2] + m[12];
      const z = m[2] * tri[i] + m[6] * tri[i + 1] + m[10] * tri[i + 2] + m[14];
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    }
    expect(Math.abs(minX)).toBeLessThan(0.05);
    expect(Math.abs(maxX - 5)).toBeLessThan(0.05);
    expect(Math.abs(minZ)).toBeLessThan(0.05);
    expect(Math.abs(maxZ - 2.5)).toBeLessThan(0.05);
  });

  it('пустой файл → понятная ошибка', () => {
    expect(() => detectRoom(new Float32Array(9))).toThrow(DetectError);
  });

  it('10 случайных комнат: ≥ 9 распознаны с точностью 5 см (SC-003)', () => {
    let ok = 0;
    for (let s = 1; s <= 10; s++) {
      const d = 3 + ((s * 37) % 40) / 10;
      const w = 2.5 + ((s * 53) % 25) / 10;
      const h = 2.4 + ((s * 11) % 8) / 10;
      const o: SynthOptions = { ...base, depth: d, width: w, height: h, rotationDeg: s * 23, seed: s, upAxis: s % 2 ? 'y' : 'z' };
      try {
        const r = detectRoom(makeRoomScan(o));
        if (Math.abs(r.depth - Math.max(d, w)) < 0.05 && Math.abs(r.width - Math.min(d, w)) < 0.05 && Math.abs(r.height - h) < 0.05) ok++;
      } catch { /* засчитывается как ошибка */ }
    }
    expect(ok).toBeGreaterThanOrEqual(9);
  });
});
