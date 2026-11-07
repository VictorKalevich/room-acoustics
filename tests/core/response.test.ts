import { describe, expect, it } from 'vitest';
import { prepareModes, transfer, modeDamping } from '../../src/core/response';
import { computeReverb, absorptionAreaAt } from '../../src/core/reverb';
import { computeModes } from '../../src/core/modes';
import { cabs, db20 } from '../../src/core/frequency';
import { speedOfSound } from '../../src/core/physics';
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

  it('затухание косых мод совпадает с Сэбином δ = cA/(8V)', () => {
    const rev = computeReverb(room);
    const oblique = computeModes(room, 300).find((m) => m.kind === 'oblique')!;
    const delta = modeDamping(oblique, room, rev);
    const c = speedOfSound(room.temperatureC);
    // A(f) интерполируется по октавам так же, как в modeDamping
    const expected = (c * absorptionAreaAt(rev, oblique.f)) / (8 * rev.volume);
    expect(delta).toBeCloseTo(expected, 6);
  });
});
