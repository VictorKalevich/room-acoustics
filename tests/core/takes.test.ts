import { describe, expect, it } from 'vitest';
import type { Measurement } from '../../src/core/types';
import { compareTakes } from '../../src/core/measure';
import { logFreqs } from '../../src/core/frequency';
import { newProject } from '../../src/state/project';
import { HISTORY_MAX, withMeasurement } from '../../src/state/variant';
import { parseProjectFile, serializeProject } from '../../src/state/storage';

const f = logFreqs(15, 500, 48);
/** Замер: базовый уровень + резонансные пики/провалы (f0, высота дБ, ширина в октавах). */
function take(level: number, bumps: [number, number, number][], extra: Partial<Measurement> = {}): Measurement {
  const db = f.map((x) => level + bumps.reduce((s, [f0, a, w]) => s + a * Math.exp(-0.5 * (Math.log2(x / f0) / w) ** 2), 0));
  return { name: 'замер', importedAt: '2026-11-08T10:00:00Z', f, db, ...extra };
}

describe('сравнение замеров «до и после»', () => {
  it('пик на 42 Гц убрали ловушкой: неровность и пик меньше, частоты найдены верно', () => {
    const before = take(80, [[42, 10, 0.08], [87, -12, 0.06]]);
    const after = take(80, [[42, 3, 0.08], [87, -12, 0.06]]);
    const c = compareTakes(before, after);
    // сетка 1/48 октавы: шаг около 1,5 %
    expect(Math.abs(c.statsBefore.peak.f / 42 - 1)).toBeLessThan(0.015);
    expect(Math.abs(c.statsBefore.dip.f / 87 - 1)).toBeLessThan(0.015);
    expect(c.statsAfter.rms).toBeLessThan(c.statsBefore.rms - 0.5);
    expect(c.statsAfter.peak.db).toBeLessThan(c.statsBefore.peak.db - 4);
    // провал не трогали — глубина почти та же
    expect(Math.abs(c.statsAfter.dip.db - c.statsBefore.dip.db)).toBeLessThan(2);
  });

  it('разная громкость замеров не влияет на результат', () => {
    const a = take(70, [[50, 8, 0.1]]);
    const b = take(84, [[50, 8, 0.1]]);
    const c = compareTakes(a, b);
    expect(c.statsAfter.rms).toBeCloseTo(c.statsBefore.rms, 6);
    expect(c.before.every((v, i) => Math.abs(v - c.after[i]) < 1e-9)).toBe(true);
  });

  it('полоса — пересечение замеров, по умолчанию 20–200 Гц', () => {
    const narrow = { ...take(80, []), f: f.filter((x) => x >= 30 && x <= 150) };
    narrow.db = narrow.f.map(() => 80);
    const c = compareTakes(take(80, []), narrow);
    expect(c.fLo).toBeCloseTo(narrow.f[0], 6);
    expect(c.fHi).toBeCloseTo(narrow.f[narrow.f.length - 1], 6);
    const d = compareTakes(take(80, []), take(80, []));
    expect(d.fLo).toBe(20);
    expect(d.fHi).toBe(200);
  });

  it('цель: замер, совпадающий с «домашней» кривой, — ровный', () => {
    const house = (x: number) => 6 * Math.log2(100 / Math.max(20, Math.min(100, x))) / Math.log2(5);
    const m = { ...take(80, []), db: f.map((x) => 80 + house(x)) };
    const c = compareTakes(m, m, { target: house });
    expect(c.statsBefore.rms).toBeLessThan(0.3);
    expect(compareTakes(m, m).statsBefore.rms).toBeGreaterThan(1);
  });

  it('без общих частот — понятная ошибка', () => {
    const lo = { ...take(80, []), f: [15, 16, 17, 18], db: [80, 80, 80, 80] };
    const hi = { ...take(80, []), f: [300, 350, 400, 450], db: [80, 80, 80, 80] };
    expect(() => compareTakes(lo, hi)).toThrow(/общих частот/);
  });
});

describe('история замеров расстановки', () => {
  const p = newProject();
  it('новый замер отправляет прежний в историю, свежие первыми, не больше пяти', () => {
    let s = p.current;
    for (let i = 0; i < HISTORY_MAX + 3; i++) s = withMeasurement(s, take(80, [], { name: `m${i}` }));
    expect(s.measurement!.name).toBe(`m${HISTORY_MAX + 2}`);
    expect(s.history!.map((m) => m.name)).toEqual(Array.from({ length: HISTORY_MAX }, (_, i) => `m${HISTORY_MAX + 1 - i}`));
  });

  it('повторное сохранение того же сеанса уточняет замер, а не плодит историю', () => {
    let s = withMeasurement(p.current, take(80, [], { name: 'старый' }));
    s = withMeasurement(s, take(80, [], { name: '3 точки', session: 'A' }));
    s = withMeasurement(s, take(80, [], { name: '5 точек', session: 'A' }));
    expect(s.measurement!.name).toBe('5 точек');
    expect(s.history!.map((m) => m.name)).toEqual(['старый']);
    s = withMeasurement(s, take(80, [], { name: 'новый сеанс', session: 'B' }));
    expect(s.history!.map((m) => m.name)).toEqual(['5 точек', 'старый']);
  });

  it('история сохраняется в файле проекта, битые записи отбрасываются', () => {
    const q = newProject();
    q.current = withMeasurement(withMeasurement(q.current, take(80, [], { name: 'до' })), take(80, [], { name: 'после' }));
    const back = parseProjectFile(serializeProject(q));
    expect(back.current.measurement!.name).toBe('после');
    expect(back.current.history!.map((m) => m.name)).toEqual(['до']);
    const raw = JSON.parse(serializeProject(q));
    raw.project.current.history.push({ name: 'битый', f: [1, 2], db: [1] }, null, { name: 'nan', f: [1, 2], db: [1, null] });
    raw.project.current.measurement = { name: 'x', f: 'oops' };
    const back2 = parseProjectFile(JSON.stringify(raw));
    expect(back2.current.history!.map((m) => m.name)).toEqual(['до']);
    expect(back2.current.measurement).toBeNull();
  });
});
