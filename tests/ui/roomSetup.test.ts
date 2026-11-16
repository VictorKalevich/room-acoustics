import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultConstraints, defaultRoom, emptyRoom, newProject, rotateRoom, rotateSetup, type Project } from '../../src/state/project';
import { changeRoom, replaceProject } from '../../src/state/transitions';
import { defaultChoice, type ScanChoice } from '../../src/scan/apply';
import type { LayoutResult } from '../../src/scan/layout';
import type { DetectResult } from '../../src/scan/detect';
import type { StoredScan } from '../../src/state/storage';
import type { RoomDraft } from '../../src/ui/roomDraft';
import type { PlacementResult, Room, Zone } from '../../src/core/types';
import { onScanFixRequest } from '../../src/ui/scanFix';
import {
  applyScan, applyScanFix, clearRoom, discardRoomDraft, openScanFix, removeSaved, saveRoom, switchProject, turnInSteps, turnRoom,
  type RoomChange, type ScanApply, type SetupStores,
} from '../../src/ui/roomSetup';

// 037: по тесту на строку таблицы действий (specs/037-room-setup-operations/spec.md) — каким станет проект, что сделано
// с черновиком конструктора и сканом на устройстве и в каком порядке. Хранилища — заглушки.

const NOW = '2026-11-16T12:00:00.000Z';
const result: PlacementResult = { best: [], baseline: {} as never, fLo: 20, fHi: 120, schroeder: 180, evaluated: 10, elapsedMs: 5, notes: [] };

/** Что и в каком порядке сделала операция: обработчики экрана, переход, хранилища. */
let log: string[];
let saved: StoredScan[];
let drafts: [string, RoomDraft][];
let errors: unknown[][];
let fail: { saveScan?: unknown; deleteScan?: unknown; deleteProject?: unknown };
const stores: SetupStores = {
  dropRoomDraft: (id) => { log.push(`dropRoomDraft ${id}`); },
  saveRoomDraft: (id, d) => { log.push(`saveRoomDraft ${id}`); drafts.push([id, d]); },
  saveScan: (s) => { log.push(`saveScan ${s.projectId}`); saved.push(s); return fail.saveScan ? Promise.reject(fail.saveScan) : Promise.resolve(); },
  deleteScan: (id) => { log.push(`deleteScan ${id}`); return fail.deleteScan ? Promise.reject(fail.deleteScan) : Promise.resolve(); },
  deleteProject: (id, keep) => { log.push(`deleteProject ${id} ${keep}`); return fail.deleteProject ? Promise.reject(fail.deleteProject) : Promise.resolve(); },
  logError: (...a) => { log.push('logError'); errors.push(a); },
};
let changes: RoomChange[];
const onRoom = (room: Room, extra: Partial<Project> = {}) => { log.push('onRoom'); changes.push({ room, extra }); };
const onGo = (to: string) => { log.push(`onGo ${to}`); };
let unlisten: () => void;
beforeEach(() => {
  log = []; saved = []; drafts = []; errors = []; fail = {}; changes = [];
  unlisten = onScanFixRequest(() => { log.push('requestScanFix'); });
});
afterEach(() => unlisten());

/** Проект после изменения так, как его применит хук (`onRoom` → `changeRoom` с ограничениями этой отрисовки). */
const after = (p: Project, c: RoomChange) => changeRoom(c.room, c.extra, p.constraints)(p, NOW);
const flush = () => new Promise((r) => setTimeout(r, 0));

const layout = (o: Partial<LayoutResult> = {}): LayoutResult => ({
  outline: new Float32Array(), bounds: { x0: 0, x1: 6, y0: 0, y1: 5 },
  openings: [], windows: [], furniture: [], coverage: { front: 1, back: 1, left: 1, right: 1 }, labeled: true, extension: null, ...o,
});
const found = layout({
  openings: [{ wall: 'back', a0: 0.5, a1: 1.3, height: 2, kind: 'door' }],
  furniture: [{ name: 'sofa', x0: 5, x1: 5.9, y0: 1.5, y1: 3.5, top: 0.85 }],
});
const det = (o: Partial<DetectResult> = {}): DetectResult => ({
  depth: 6, width: 5, height: 2.6, units: 'm', unitsGuessed: false, up: [0, 0, 1], transform: Array.from({ length: 16 }, (_, i) => (i % 5 ? 0 : 1)),
  rotationDeg: 0, tiltDeg: 0, confidence: 0.9, wallCoverage: [1, 1, 1, 1], hasCeiling: true, outsideFraction: 0, warnings: [], triangleCount: 4, ...o,
});
const WHOLE = { x0: 0, x1: 6, y0: 0, y1: 5 };
function scan(o: { rect?: typeof WHOLE; layout?: LayoutResult; det?: Partial<DetectResult>; thinned?: boolean } = {}): ScanApply {
  const choice: ScanChoice = defaultChoice(o.layout ?? found, 2.6, o.rect ?? WHOLE);
  return {
    file: { fileName: 'room.obj', format: 'obj', count: 4, decimated: false, dropped: 0, thinned: o.thinned, triangles: new Float32Array(9 * 4) },
    det: det(o.det), initial: { layout: found, rect: WHOLE }, choice, units: 'auto',
  };
}
const fresh = (o: Partial<Project> = {}): Project => ({ ...newProject(), id: 'p1', updatedAt: '2026-01-01T00:00:00.000Z', ...o });
const bed: Zone = { id: 'manual', kind: 'furniture', furniture: 'bed', x0: 1, x1: 3, y0: 2.5, y1: 4.1, canSit: true };
/** Проект со сканом 6 × 5 м (вся найденная комната), ручной кроватью, результатом подбора и выбранными местами. */
function scanned(o: Partial<Project> = {}): Project {
  const p = fresh();
  const first = after(p, applyScan(p, scan(), { onRoom }, stores));
  log = []; saved = []; changes = [];
  const room = { ...first.room, zones: [...first.room.zones, bed] };
  return { ...first, room, roomReady: true, result, selectedIndex: 2, current: { ...first.current, placed: true }, ...o };
}

describe('скан (020, 022): строки 1–3', () => {
  it('1. первое применение: комната из скана, сводка без матрицы, черновик удалён, к шагам, затем запись скана', () => {
    const p = fresh({ result, constraints: { ...defaultConstraints(defaultRoom()), listenerMinX: 0.3 } });
    const s = scan();
    const c = applyScan(p, s, { onRoom, onGo }, stores);
    expect(log).toEqual(['onRoom', 'dropRoomDraft p1', 'onGo room/size', 'saveScan p1']);
    expect(changes).toEqual([c]);
    const next = after(p, c);
    expect([next.room.depth, next.room.width, next.room.height, next.room.source]).toEqual([6, 5, 2.6, 'scan']);
    expect(next.room.zones.map((z) => [z.furniture, z.fromScan])).toEqual([['sofa', true]]);
    expect(next.roomReady).toBe(false);
    expect(next.scanInfo).toMatchObject({ fileName: 'room.obj', format: 'obj', confidence: 0.9, rotation: 0, applied: { rect: WHOLE, units: 'm' } });
    expect(next.scanInfo).not.toHaveProperty('transform');
    const zone = defaultConstraints(next.room);
    expect(next.constraints).toMatchObject({ listenerMinX: zone.listenerMinX, listenerMaxX: zone.listenerMaxX });
    expect(next.result).toEqual({ ...result, stale: true });
    expect(saved[0]).toMatchObject({ projectId: 'p1', fileName: 'room.obj', format: 'obj', count: 4, decimated: false, dropped: 0, thinned: false, units: 'auto', det: s.det, initial: s.initial, applied: s.choice });
    expect(saved[0].triangles).toHaveLength(36);
  });

  it('1. запись скана не ждётся; её ошибка — в журнал, операция уже закончилась', async () => {
    fail.saveScan = new Error('нет места');
    const c = applyScan(fresh(), scan({ thinned: true }), { onRoom }, stores);
    expect(c.extra.roomReady).toBe(false);
    expect(saved[0].thinned).toBe(true);
    expect(errors).toEqual([]);
    await flush();
    expect(errors).toEqual([['scan', fail.saveScan, 'сохранение скана на устройстве']]);
    expect(log).toEqual(['onRoom', 'dropRoomDraft p1', 'saveScan p1', 'logError']);
  });

  it('2. новый скан поверх применённого: сначала как «Очистить», ручное и результат подбора пропадают', () => {
    const base = scanned();
    const p = {
      ...base,
      room: { ...base.room, materials: { ...base.room.materials, front: 'brick' } },
      current: { ...base.current, measurement: { name: 'замер' } as never },
    };
    const c = applyScan(p, scan({ rect: { x0: 0, x1: 5, y0: 0, y1: 4 }, det: { depth: 5, width: 4 } }), { onRoom, onGo }, stores);
    expect(log).toEqual(['onRoom', 'dropRoomDraft p1', 'onGo room/size', 'saveScan p1']);
    const next = after(p, c);
    expect([next.room.depth, next.room.width]).toEqual([5, 4]);
    expect(next.room.zones.find((z) => z.id === 'manual')).toBeUndefined();
    expect(next).toMatchObject({ roomReady: false, result: null, selectedIndex: 0, scanInfo: { rotation: 0, applied: { rect: { x0: 0, x1: 5, y0: 0, y1: 4 } } } });
    expect(next.current).toMatchObject({ placed: false, measurement: null });
    // основа — комната очищенного проекта, а не прежняя
    expect(next.room.materials.front).toBe(emptyRoom().materials.front);
    expect(emptyRoom().materials.front).not.toBe('brick');
  });

  it('3. поправка созданной комнаты: сдвиг ручного от границ проекта, поворот прежний; без перехода', () => {
    const p = scanned();
    const c = applyScanFix(p, scan({ rect: { x0: 0, x1: 6, y0: 1, y1: 5 }, layout: layout() }), null, { onRoom, onGo }, stores);
    expect(log).toEqual(['onRoom', 'dropRoomDraft p1', 'saveScan p1']);
    const next = after(p, c);
    expect([next.room.depth, next.room.width]).toEqual([6, 4]);
    expect(next.room.zones.find((z) => z.id === 'manual')).toMatchObject({ y0: 1.5, y1: 3.1 });
    expect(next).toMatchObject({ roomReady: true, scanInfo: { rotation: 0, applied: { rect: { x0: 0, x1: 6, y0: 1, y1: 5 }, units: 'm' } } });
    expect(next.result).toEqual({ ...result, stale: true });
    expect(saved[0].applied.rect).toEqual({ x0: 0, x1: 6, y0: 1, y1: 5 });
  });

  it('3. поправка при проверке по шагам — назад к шагам после записи скана', () => {
    const p = scanned({ roomReady: false });
    applyScanFix(p, scan(), null, { onRoom, onGo }, stores);
    expect(log).toEqual(['onRoom', 'dropRoomDraft p1', 'saveScan p1', 'onGo room/size']);
  });

  it('3. от каких границ сдвиг: из проекта (026), у проектов до 026 — применённый выбор; другие единицы — без сдвига', () => {
    const narrow = scan({ rect: { x0: 0, x1: 6, y0: 1, y1: 5 }, layout: layout() });
    const manualY = (p: Project, applied: Parameters<typeof applyScanFix>[2]) =>
      after(p, applyScanFix(p, narrow, applied, { onRoom }, stores)).room.zones.find((z) => z.id === 'manual')!.y0;
    const base = scanned();
    const old = { ...base, scanInfo: { ...base.scanInfo!, applied: undefined } };
    expect(manualY(old, null)).toBe(2.5);
    expect(manualY(old, { choice: scan().choice, units: 'm' })).toBe(1.5);
    expect(manualY(old, { choice: scan().choice, units: 'cm' })).toBe(2.5);
    expect(manualY({ ...base, scanInfo: { ...base.scanInfo!, applied: { rect: WHOLE, units: 'cm' } } }, null)).toBe(2.5);
    // границы проекта важнее выбора этого сеанса
    expect(manualY(base, { choice: narrow.choice, units: 'm' })).toBe(1.5);
  });

  it('3. поворот после скана учитывается и сохраняется', () => {
    const base = scanned();
    const p = { ...base, room: rotateRoom(base.room), current: rotateSetup(base.room, base.current), scanInfo: { ...base.scanInfo!, rotation: 1 } };
    const next = after(p, applyScanFix(p, scan({ rect: { x0: 0, x1: 6, y0: 1, y1: 5 }, layout: layout() }), null, { onRoom }, stores));
    expect([next.room.depth, next.room.width]).toEqual([4, 6]);
    expect(next.scanInfo!.rotation).toBe(1);
  });
});

describe('конструктор (021, 022): строки 4–8', () => {
  it('4. «Сохранить»: комната конструктора в проекте, комната создана, черновик удалён', () => {
    const p = fresh({ result });
    const room = { ...defaultRoom(), depth: 5.5 };
    const c = saveRoom(p, room, onRoom, stores);
    expect(log).toEqual(['onRoom', 'dropRoomDraft p1']);
    expect(c).toEqual({ room, extra: { roomReady: true } });
    expect(after(p, c)).toMatchObject({ room, roomReady: true, result: { stale: true } });
  });

  it('5, 6. «Не сохранять» и «Сбросить черновик»: только черновик', () => {
    discardRoomDraft(fresh(), stores);
    expect(log).toEqual(['dropRoomDraft p1']);
    expect(changes).toEqual([]);
  });

  it('7. поворот при проверке скана: комната конструктора повёрнута в проекте и в черновике, счётчик поворота + 1', () => {
    const p = scanned({ roomReady: false, scanInfo: { ...scanned().scanInfo!, rotation: 3 } });
    const room = { ...p.room, materials: { ...p.room.materials, front: 'gypsum' } };
    const c = turnInSteps(p, room, { reached: 'walls', entered: [], touched: ['mat.front'] }, onRoom, stores);
    expect(log).toEqual(['onRoom', 'saveRoomDraft p1']);
    expect(c.room).toEqual(rotateRoom(room));
    expect(c.extra).toEqual({ scanInfo: { ...p.scanInfo!, rotation: 0 } });
    // черновик — тот же, что писал конструктор: комната, шаг, размеры, изменённые поля (и в том же порядке ключей)
    expect(JSON.stringify(drafts[0])).toBe(JSON.stringify(['p1', { room: c.room, reached: 'walls', entered: [], touched: ['mat.front'] }]));
    expect(after(p, c).roomReady).toBe(false);
    // без скана поворот только комнаты
    expect(turnInSteps(fresh(), defaultRoom(), { reached: 'size' }, onRoom, stores).extra).toEqual({});
  });

  it('8. переход к поправке с шага «Размеры»: введённое — в проект, черновик удалён, просьба открыть поправку, обзор', () => {
    const p = scanned({ roomReady: false });
    const room = { ...p.room, materials: { ...p.room.materials, front: 'gypsum' } };
    const c = openScanFix(p, room, { onRoom, onBack: () => log.push('onBack') }, stores);
    expect(log).toEqual(['onRoom', 'dropRoomDraft p1', 'requestScanFix', 'onBack']);
    expect(c).toEqual({ room, extra: {} });
    expect(after(p, c)).toMatchObject({ room, roomReady: false, scanInfo: p.scanInfo });
  });
});

describe('обзор комнаты: строки 9, 15', () => {
  it('9. «Очистить»: скан и черновик удалены до изменения проекта; комната как в новом проекте', async () => {
    const p = scanned();
    fail.deleteScan = new Error('занято');
    const c = clearRoom(p, onRoom, stores);
    expect(log).toEqual(['deleteScan p1', 'dropRoomDraft p1', 'onRoom']);
    const next = after(p, c);
    expect(next.room).toEqual(emptyRoom());
    expect(next).toMatchObject({ roomReady: false, scanInfo: null, result: null, selectedIndex: 0 });
    expect(next.current).toMatchObject({ placed: false, measurement: null });
    // ошибка удаления скана не сообщается
    await flush();
    expect(errors).toEqual([]);
  });

  it('15. поворот на обзоре: места и варианты вместе с комнатой, счётчик поворота скана + 1; хранилища не трогаются', () => {
    const p = scanned({ setups: [{ ...scanned().current, id: 'v1', name: 'Вариант' }] });
    const c = turnRoom(p, onRoom);
    expect(log).toEqual(['onRoom']);
    expect(c.room).toEqual(rotateRoom(p.room));
    expect(c.extra).toEqual({ current: rotateSetup(p.room, p.current), setups: [rotateSetup(p.room, p.setups[0])], scanInfo: { ...p.scanInfo!, rotation: 1 } });
    expect(turnRoom(fresh(), onRoom).extra).not.toHaveProperty('scanInfo');
  });
});

describe('«Проекты» (023, 024): строки 10–14', () => {
  const replace = (p: Project) => (next: Project) => { log.push(`onReplace ${next.id === p.id ? 'тот же' : 'другой'}`); return replaceProject(next)(p, NOW); };

  it('10. «Новый проект» из несохранённого: черновик и скан текущего удалены, затем замена', () => {
    const p = fresh();
    const next = switchProject(p, { kind: 'new' }, false, replace(p), stores);
    expect(log).toEqual(['dropRoomDraft p1', 'deleteScan p1', 'onReplace другой']);
    expect(next.id).not.toBe('p1');
    expect(next).toMatchObject({ roomReady: false, scanInfo: null });
  });

  it('10. «Новый проект» из сохранённого: скан остаётся его сохранённой копии', () => {
    const p = fresh();
    switchProject(p, { kind: 'new' }, true, replace(p), stores);
    expect(log).toEqual(['dropRoomDraft p1', 'onReplace другой']);
  });

  it('11. «Открыть»: другой проект — как «Новый проект»; копия того же — скан остаётся, черновик удаляется', () => {
    const p = fresh();
    const other = fresh({ id: 'p2' });
    expect(switchProject(p, { kind: 'open', p: other }, false, replace(p), stores)).toBe(other);
    expect(log).toEqual(['dropRoomDraft p1', 'deleteScan p1', 'onReplace другой']);
    log = [];
    switchProject(p, { kind: 'open', p: fresh({ name: 'Сохранённая' }) }, false, replace(p), stores);
    expect(log).toEqual(['dropRoomDraft p1', 'onReplace тот же']);
  });

  it('12. «Импорт»: по тем же правилам; ошибка удаления скана не сообщается', async () => {
    const p = fresh();
    fail.deleteScan = new Error('занято');
    switchProject(p, { kind: 'import', p: fresh({ id: 'from-file' }) }, false, replace(p), stores);
    expect(log).toEqual(['dropRoomDraft p1', 'deleteScan p1', 'onReplace другой']);
    log = [];
    switchProject(p, { kind: 'import', p: fresh({ id: 'from-file' }) }, true, replace(p), stores);
    expect(log).toEqual(['dropRoomDraft p1', 'onReplace другой']);
    await flush();
    expect(errors).toEqual([]);
  });

  it('13. «Удалить» другой сохранённый: запись и скан, после них — черновик; и при ошибке хранилища', async () => {
    await removeSaved(fresh(), 'p2', stores);
    expect(log).toEqual(['deleteProject p2 false', 'dropRoomDraft p2']);
    log = [];
    fail.deleteProject = new Error('занято');
    await removeSaved(fresh(), 'p2', stores);
    expect(log).toEqual(['deleteProject p2 false', 'dropRoomDraft p2']);
  });

  it('14. «Удалить» копию открытого: скан и черновик остаются рабочему проекту', async () => {
    await removeSaved(fresh(), 'p1', stores);
    expect(log).toEqual(['deleteProject p1 true']);
  });
});
