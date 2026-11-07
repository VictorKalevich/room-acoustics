import { describe, expect, it } from 'vitest';
import { calibrate, compareMeasurement, parseRew } from '../../src/core/measure';
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
    expect(r.dampingScale).toBe(2);
    expect(r.leakage).toBe('door');
    expect(r.rmsAfter).toBeLessThan(before);
    expect(r.rmsAfter).toBeLessThan(0.6);
  });
});
