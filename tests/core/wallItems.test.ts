import { describe, expect, it } from 'vitest';
import { toRoomItem } from '../../src/core/wallItems';

describe('смена вида элемента стены', () => {
  const it0 = { wall: 'front' as const, a0: 1, a1: 2.1, bottom: 0, top: 2.4 };
  it('арка — проём в расчёте', () => {
    const r = toRoomItem(it0, 'arch', 'a');
    expect(r.opening).toEqual({ id: 'a', wall: 'front', a0: 1, a1: 2.1, height: 2.4 });
    expect(r.feature).toBeUndefined();
  });
  it('дверь — ориентир от пола', () => {
    expect(toRoomItem({ ...it0, bottom: 0.9 }, 'door', 'd').feature).toMatchObject({ kind: 'door', bottom: 0, top: 2.4 });
  });
  it('окно из проёма до пола получает подоконник, найденное окно сохраняет свой низ', () => {
    expect(toRoomItem(it0, 'window', 'w').feature).toMatchObject({ kind: 'window', bottom: 0.9, top: 2.4 });
    expect(toRoomItem({ ...it0, bottom: 0.66 }, 'window', 'w').feature?.bottom).toBe(0.66);
  });
});
