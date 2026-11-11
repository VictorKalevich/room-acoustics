import { beforeAll, describe, expect, it } from 'vitest';
import { defaultRoom } from '../../src/state/project';
import type { Room } from '../../src/core/types';

// хранилище браузера для node-окружения тестов
const store = new Map<string, string>();
beforeAll(() => {
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
  };
});
const draft = () => import('../../src/ui/roomDraft');

const sofa = { id: 'sofa', kind: 'furniture' as const, furniture: 'sofa' as const, name: 'Диван', x0: 3.5, x1: 4.4, y0: 1, y1: 3, canSit: true };

describe('черновик конструктора (021)', () => {
  it('поля вне конструктора берутся из проекта и не делают черновик изменённым', async () => {
    const { draftDiffers, withOutside } = await draft();
    const saved: Room = { ...defaultRoom(), treatmentsOn: false, treatments: [] };
    const d: Room = { ...saved, treatmentsOn: true, leakage: 'sealed' };
    expect(withOutside(d, saved)).toMatchObject({ treatmentsOn: false, leakage: saved.leakage });
    expect(draftDiffers(d, saved)).toBe(false);
    expect(draftDiffers({ ...d, depth: 6 }, saved)).toBe(true);
  });

  it('переживает перезапуск; мебель за стенами не обрезается молча — её покажет «Сохранить»', async () => {
    const { loadRoomDraft } = await draft();
    store.set('ra-room-draft-p1', JSON.stringify({ room: { ...defaultRoom(), depth: 3, zones: [sofa] }, reached: 'floor' }));
    const d = loadRoomDraft('p1')!;
    expect(d.reached).toBe('floor');
    expect(d.room.depth).toBe(3);
    expect(d.room.zones).toEqual([sofa]);
  });

  it('повреждённый черновик не открывается; «Сбросить» удаляет его', async () => {
    const { dropRoomDraft, loadRoomDraft, saveRoomDraft } = await draft();
    store.set('ra-room-draft-p2', JSON.stringify({ room: { ...defaultRoom(), depth: 80 }, reached: 'walls' }));
    expect(loadRoomDraft('p2')).toBeNull();
    saveRoomDraft('p3', { room: defaultRoom(), reached: 'walls' });
    expect(store.has('ra-room-draft-p3')).toBe(true);
    dropRoomDraft('p3');
    expect(store.has('ra-room-draft-p3')).toBe(false);
    expect(loadRoomDraft('p3')).toBeNull();
  });
});
