import { describe, expect, it } from 'vitest';
import { clearedRoom, newProject } from '../../src/state/project';
import { normalizeProject, serializeProject } from '../../src/state/storage';
import { markPlaced } from '../../src/state/variant';

const raw = (p: unknown) => JSON.parse(serializeProject(p as never)).project;

describe('проект с частично неверными данными открывается, а не заменяется новым (026)', () => {
  it('неверный диапазон одного источника возвращается к значениям по умолчанию', () => {
    const p = newProject();
    const r = raw({ ...p, name: 'Студия', sources: p.sources.map((s) => (s.kind === 'sub' ? { ...s, fLow: 100, fHigh: 80 } : s)) });
    const n = normalizeProject(r);
    expect(n.name).toBe('Студия');
    const sub = n.sources.find((s) => s.kind === 'sub')!;
    expect([sub.fLow, sub.fHigh]).toEqual([20, 80]);
    // верные диапазоны не трогаются
    expect(n.sources.find((s) => s.id === 'spkL')!.fLow).toBe(80);
  });

  it('коридор мельче допустимого убирается, комната остаётся', () => {
    const p = newProject();
    const r = raw(p);
    r.room.extensions = [{ id: 'e1', name: 'Коридор', wall: 'back', a0: 1, a1: 2, depth: 0.28, width: 1, height: 2.2, arch: { a0: 1.2, a1: 1.8, height: 2 } }];
    const n = normalizeProject(r);
    expect(n.room.extensions).toEqual([]);
    expect(n.room.depth).toBe(p.room.depth);
  });

  it('мусор в списках, не-числа в ограничениях и координатах — к умолчаниям', () => {
    const p = newProject();
    const r = raw(p);
    r.sources = [null, ...r.sources];
    r.room.openings = [null];
    r.room.zones = [null];
    r.room.furnishing = 'zzz';
    r.constraints.earHeight = null;
    r.current.listener = { x: null, y: 1, z: 1 };
    r.current.positions.spkL = { x: null, y: null, z: null };
    const n = normalizeProject(r);
    expect(n.sources.length).toBe(p.sources.length);
    expect(n.room.openings).toEqual([]);
    expect(n.room.furnishing).toBe('typical');
    expect(n.constraints.earHeight).toBe(p.constraints.earHeight);
    for (const v of [n.current.listener, ...Object.values(n.current.positions)]) {
      expect([v.x, v.y, v.z].every(Number.isFinite)).toBe(true);
    }
    expect(Object.keys(n.current.positions).sort()).toEqual(p.sources.map((s) => s.id).sort());
  });

  it('точность расчёта сохраняется в файле; стандартная не пишется', () => {
    const p = newProject();
    expect(normalizeProject(raw({ ...p, precision: 'max' })).precision).toBe('max');
    expect('precision' in normalizeProject(raw(p))).toBe(false);
    expect('precision' in normalizeProject(raw({ ...p, precision: 'what' }))).toBe(false);
  });
});

describe('признак «места выбраны»', () => {
  it('сохранённые варианты — всегда выбранные места; загрузка варианта, совпадающего с текущей расстановкой, не сбрасывает признак', () => {
    const p = newProject();
    const current = { ...p.current, placed: true };
    const r = raw({ ...p, current, setups: [{ ...current, id: 'v1', name: 'Вариант 1' }] });
    delete r.setups[0].placed;
    const n = normalizeProject(r);
    expect(n.setups[0].placed).toBe(true);
    expect(markPlaced(current, { ...current, placed: false }).placed).toBe(true);
    expect(markPlaced(current, { ...current, placed: undefined }).placed).toBe(true);
    // не выбранные и не изменённые — остаются не выбранными
    expect(markPlaced(p.current, { ...p.current }).placed).toBe(false);
  });

  it('«Очистить комнату» возвращает места по умолчанию как не выбранные', () => {
    const p = newProject();
    const cleared = clearedRoom({ ...p, current: { ...p.current, placed: true } });
    expect(cleared.current!.placed).toBe(false);
  });
});
