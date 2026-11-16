import { describe, expect, it } from 'vitest';
import { prepareModes, transfer, modeDamping, modalAbsorptionAt } from '../../src/core/response';
import type { Room } from '../../src/core/types';
import { computeReverb, absorptionAreaAt } from '../../src/core/reverb';
import { computeModes } from '../../src/core/modes';
import { cabs, db20 } from '../../src/core/frequency';
import { speedOfSound } from '../../src/core/physics';
import { betaFromAlpha } from '../../src/core/paris';
import { alphaAt, getMaterial } from '../../src/core/materials';
import { furnishingOctaves } from '../../src/core/furniture';
import { defaultRoom } from '../../src/state/project';

const room = defaultRoom(); // 5 × 4 × 2,5

describe('модальная передаточная функция', () => {
  const pm = prepareModes(room, 300);

  it('симметрична: источник ↔ приёмник', () => {
    const a = { x: 0.4, y: 0.7, z: 0.3 };
    const b = { x: 3.1, y: 2.0, z: 1.1 };
    const f = [30, 47, 61.3, 99, 150];
    const h1 = transfer(pm, a, b, f);
    const h2 = transfer(pm, b, a, f);
    h1.forEach((h, i) => {
      expect(h.re).toBeCloseTo(h2[i].re, 9);
      expect(h.im).toBeCloseTo(h2[i].im, 9);
    });
  });

  it('источник в узле моды (1,0,0) не возбуждает её: на 34,3 Гц уровень заметно ниже', () => {
    const rcv = { x: 4.5, y: 0.3, z: 0.3 };
    const f = [speedOfSound(20) / 10];
    const corner = cabs(transfer(pm, { x: 0.1, y: 0.3, z: 0.3 }, rcv, f)[0]);
    const node = cabs(transfer(pm, { x: 2.5, y: 0.3, z: 0.3 }, rcv, f)[0]);
    expect(db20(corner) - db20(node)).toBeGreaterThan(6);
  });

  it('резонанс: в углу пик на частоте осевой моды выше соседних частот', () => {
    const src = { x: 0.05, y: 0.05, z: 0.05 };
    const rcv = { x: 4.95, y: 3.95, z: 2.45 };
    const f0 = speedOfSound(20) / 10;
    const [hp, h0, hm] = transfer(pm, src, rcv, [f0 * 0.9, f0, f0 * 1.1]).map((h) => db20(cabs(h)));
    expect(h0).toBeGreaterThan(hp);
    expect(h0).toBeGreaterThan(hm);
  });

  it('затухание косых мод: δ = cB/(8V), B = 8·Σβ·S + обстановка; при малых α — формула Сэбина', () => {
    const c = speedOfSound(room.temperatureC);
    // жёсткая пустая комната без окон и дверей: α ≤ 0,02 — β ≈ α/8, и мода затухает по Сэбину (с точностью ~3 %)
    const bare: Room = { ...room, furnishing: 'empty', features: [], openings: [], materials: { floor: 'concrete-painted', ceiling: 'concrete-painted', front: 'concrete-painted', back: 'concrete-painted', left: 'concrete-painted', right: 'concrete-painted' } };
    const rb = computeReverb(bare);
    const ob = computeModes(bare, 300).find((m) => m.kind === 'oblique')!;
    const sabine = (c * absorptionAreaAt(rb, ob.f)) / (8 * rb.volume);
    expect(Math.abs(modeDamping(ob, bare, rb) / sabine - 1)).toBeLessThan(0.04);
    // обычная комната: косая мода затухает по c·B/(8V) — B из β поверхностей и обстановки
    const rev = computeReverb(room);
    const oblique = computeModes(room, 300).find((m) => m.kind === 'oblique')!;
    const noPatches = { ...room, features: [], openings: [] };
    const { depth: d, width: w, height: h } = noPatches;
    const S = { floor: d * w, ceiling: d * w, front: w * h, back: w * h, left: d * h, right: d * h };
    const beta = (k: keyof typeof S) => betaFromAlpha(alphaAt(getMaterial(noPatches.materials[k]).alpha, oblique.f));
    const B = 8 * (Object.keys(S) as (keyof typeof S)[]).reduce((a, k) => a + beta(k) * S[k], 0) + alphaAt(furnishingOctaves(noPatches), oblique.f) * S.floor;
    expect(Object.values(modalAbsorptionAt(noPatches, oblique.f)).reduce((a, b) => a + b, 0)).toBeCloseTo(B, 9);
    expect(modeDamping(oblique, noPatches, rev)).toBeCloseTo((c * B) / (8 * rev.volume), 6);
    // β по формуле Пари больше α/8: мода затухает быстрее, чем по Сэбину с табличным α, но не больше чем на треть
    const ratio = modeDamping(oblique, room, rev) / ((c * absorptionAreaAt(rev, oblique.f)) / (8 * rev.volume));
    expect(ratio).toBeGreaterThan(1);
    expect(ratio).toBeLessThan(1.35);
  });

  it('подстройка по замеру умножает затухание (кроме проёмов)', () => {
    const m = computeModes(room, 120)[3];
    const k = 1.7;
    const damp = (r: Room, scale = 1) => modeDamping(m, { ...r, calibration: { dampingScale: scale } });
    // окно и дверь умножаются вместе со стенами
    const closed: Room = { ...room, openings: [], features: [
      { id: 'w', kind: 'window', wall: 'left', a0: 1, a1: 2.5, bottom: 0.9, top: 2.1 },
      { id: 'd', kind: 'door', wall: 'back', a0: 0.5, a1: 1.4, bottom: 0, top: 2 },
    ] };
    expect(damp(closed)).not.toBeCloseTo(damp({ ...closed, features: [] }), 6);
    expect(damp(closed, k)).toBeCloseTo(k * damp(closed), 9);
    // проводимость проёма не умножается: δ(k) = k·δ_стен + δ_проёма
    const open: Room = { ...room, features: [], openings: [{ id: 'o', wall: 'back', a0: 0.5, a1: 1.4, height: 2 }] };
    const aperture = 2 * damp(open) - damp(open, 2);
    expect(aperture).toBeGreaterThan(0.05 * damp(open));
    expect(damp(open, k)).toBeCloseTo(k * damp(open) - (k - 1) * aperture, 9);
  });
});

describe('негерметичность', () => {
  it('утечка воздуха ослабляет «эффект герметичного объёма» ниже первой моды', () => {
    const src = { x: 0.2, y: 0.2, z: 0.3 };
    const rcv = { x: 3, y: 2, z: 1.1 };
    const f = [15];
    const sealed = cabs(transfer(prepareModes({ ...room, leakage: 'sealed' }, 200), src, rcv, f)[0]);
    const open = cabs(transfer(prepareModes({ ...room, leakage: 'open' }, 200), src, rcv, f)[0]);
    expect(db20(sealed) - db20(open)).toBeGreaterThan(3);
  });
});
