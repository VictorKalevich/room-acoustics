import { describe, expect, it } from 'vitest';
import { calibrate, compareMeasurement, modelForMeasurement, parseRew } from '../../src/core/measure';
import { evaluateSetup } from '../../src/core/system';
import { defaultConstraints, defaultRoom, defaultSetup, defaultSources } from '../../src/state/project';

const room = defaultRoom();
const sources = defaultSources(2, 1);
const c = defaultConstraints(room);
const setup = defaultSetup(room, sources, c);

function rewText(f: number[], db: number[]) {
  return ['* Measurement data measured by REW V5.31', '* Source: Umik-1', '* Format: 1/48 octave smoothing', '* Freq(Hz) SPL(dB) Phase(degrees)',
    ...f.map((x, i) => `${x.toFixed(3)} ${db[i].toFixed(3)} 0.0`)].join('\n');
}

describe('parseRew', () => {
  it('читает экспорт REW, пропуская комментарии', () => {
    const f = Array.from({ length: 200 }, (_, i) => 10 * Math.pow(2, i / 24));
    const m = parseRew(rewText(f, f.map((x) => 80 + Math.sin(x / 10))), 'test.txt');
    expect(m.f[0]).toBeCloseTo(15, 6);
    expect(m.f.at(-1)).toBeCloseTo(500, 6);
    expect(m.db.length).toBe(m.f.length);
  });

  it('файл без данных → понятная ошибка', () => {
    expect(() => parseRew('* only comments\nhello')).toThrow(/15–500 Гц/);
  });
});

describe('подстройка модели', () => {
  it('восстанавливает множитель затухания и герметичность синтетического замера', () => {
    const truth = { ...room, leakage: 'door' as const, calibration: { dampingScale: 2 } };
    const e = evaluateSetup(truth, sources, { ...c, seats: { count: 1, spacing: 0.6 } }, setup, { ppo: 48 });
    const m = parseRew(rewText(e.response.f, e.response.db.map((v) => v + 75)));
    const before = compareMeasurement(room, sources, c, setup, m).rms;
    const r = calibrate(room, sources, c, setup, m);
    expect(Math.abs(r.dampingScale / 2 - 1)).toBeLessThan(0.07);
    expect(r.leakage).toBe('door');
    expect(r.rmsAfter).toBeLessThan(before);
    expect(r.rmsAfter).toBeLessThan(0.6);
  });

  it('замер из нескольких точек сравнивается со средним модели по тем же точкам — без смещения затухания', () => {
    const truth = { ...room, calibration: { dampingScale: 1.6 } };
    const probe = { name: 'x', importedAt: '', f: [20, 500], db: [0, 0], points: 5 };
    const avg = modelForMeasurement(truth, sources, setup, probe);
    expect(avg.averaged).toBe(true);
    const m = { ...parseRew(rewText(avg.f, avg.db.map((v) => v + 70))), points: 5 };
    const r = calibrate(room, sources, c, setup, m);
    expect(Math.abs(r.dampingScale / 1.6 - 1)).toBeLessThan(0.13);
    // если бы среднее по точкам сравнивалось с моделью в одной точке, подобралось бы заметно большее затухание
    const single = calibrate(room, sources, c, setup, { ...m, points: 1 });
    expect(single.dampingScale).toBeGreaterThan(r.dampingScale);
  });

  it('у старых замеров свипом число точек берётся из названия', () => {
    const m = { name: 'Замер свипом, точек: 4', importedAt: '', f: [20, 500], db: [0, 0] };
    expect(modelForMeasurement(room, sources, setup, m).averaged).toBe(true);
  });
});
