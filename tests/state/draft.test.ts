import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultRoom, newProject } from '../../src/state/project';
import { FakeIndexedDB, MemStorage } from './fakeIndexedDB';

// 029: рабочий проект («черновик») на устройстве. Состояние модуля хранения (соединение, запрет записи) — своё у
// каждого теста: модуль загружается заново.
type Storage = typeof import('../../src/state/storage');
let idb: FakeIndexedDB;
let mem: MemStorage;
let st: Storage;

beforeEach(async () => {
  idb = new FakeIndexedDB();
  mem = new MemStorage();
  vi.stubGlobal('indexedDB', idb);
  vi.stubGlobal('localStorage', mem);
  vi.resetModules();
  st = await import('../../src/state/storage');
});

const project = (name: string) => ({ ...newProject(name), updatedAt: '2026-11-14T10:00:00.000Z' });
/** Черновик, который не проходит проверку: глубина комнаты вне диапазона. */
const broken = () => ({ ...project('Повреждённый'), room: { ...defaultRoom(), depth: 500 } });

describe('исходы чтения черновика при запуске', () => {
  it('черновик есть — открывается он', async () => {
    const p = project('Студия');
    await st.saveDraft(p);
    const d = await st.loadDraft();
    expect(d?.id).toBe(p.id);
    expect(d?.name).toBe('Студия');
    expect(d).toEqual(st.normalizeProject(JSON.parse(JSON.stringify(p))));
  });

  it('черновика нет (первый запуск) — undefined', async () => {
    expect(await st.loadDraft()).toBeUndefined();
  });

  it('запись ra-draft-pending важнее черновика', async () => {
    await st.saveDraft(project('Сохранённый'));
    const pending = project('При уходе');
    st.stashPendingDraft(pending);
    expect((await st.loadDraft())?.name).toBe('При уходе');
  });

  it('повреждённая запись ra-draft-pending пропускается — открывается черновик', async () => {
    await st.saveDraft(project('Сохранённый'));
    mem.setItem('ra-draft-pending', JSON.stringify(broken()));
    expect((await st.loadDraft())?.name).toBe('Сохранённый');
    mem.setItem('ra-draft-pending', '{не json');
    expect((await st.loadDraft())?.name).toBe('Сохранённый');
  });

  it('исправная ra-draft-pending открывается, даже когда IndexedDB не читается', async () => {
    st.stashPendingDraft(project('При уходе'));
    idb.failOpens = 100;
    expect((await st.loadDraft())?.name).toBe('При уходе');
  });

  it('черновик не прошёл проверку — отклонение с причиной, копия draft-failed, черновик не тронут', async () => {
    const b = broken();
    await st.saveDraft(b as never);
    await expect(st.loadDraft()).rejects.toThrow(/Неверные данные комнаты: Глубина: от 1 до 50 м/);
    expect(idb.peek('meta', 'draft-failed')).toEqual(JSON.parse(JSON.stringify(b)));
    expect(idb.peek('meta', 'draft')).toEqual(JSON.parse(JSON.stringify(b)));
  });

  it('ra-draft-pending удаляется после сохранения', async () => {
    st.stashPendingDraft(project('При уходе'));
    st.clearPendingDraft();
    expect(mem.getItem('ra-draft-pending')).toBeNull();
  });
});

describe('операции хранилища: запросы и результаты', () => {
  it('проекты: запись, список по дате изменения, удаление', async () => {
    const a = { ...project('Первый'), updatedAt: '2026-11-01T00:00:00.000Z' };
    const b = { ...project('Второй'), updatedAt: '2026-11-02T00:00:00.000Z' };
    await st.saveProject(a);
    await st.saveProject(b);
    expect((await st.listProjects()).map((p) => p.name)).toEqual(['Второй', 'Первый']);
    await st.deleteProject(b.id);
    expect((await st.listProjects()).map((p) => p.name)).toEqual(['Первый']);
  });

  it('хранилище доступно — да; не открывается — нет', async () => {
    expect(await st.storageAvailable()).toBe(true);
    idb.dropConnections(true);
    idb.failOpens = 100;
    expect(await st.storageAvailable()).toBe(false);
  });

  it('ошибка запроса отклоняет операцию', async () => {
    await st.saveDraft(project('Студия'));
    idb.failRequests = 1;
    await expect(st.saveProject(project('Другой'))).rejects.toThrow('запрос не выполнен');
  });
});

describe('соединение с базой (029)', () => {
  const tick = () => new Promise((r) => setTimeout(r, 5));

  it('одно соединение на вкладку для всех операций', async () => {
    await st.saveDraft(project('Студия'));
    await st.saveProject(project('Первый'));
    await Promise.all([st.listProjects(), st.loadDraft(), st.storageAvailable()]);
    expect(idb.opens).toBe(1);
    expect(idb.connections.size).toBe(1);
  });

  it('versionchange закрывает соединение — удаление или смена версии не ждут; следующая операция выполняется', async () => {
    await st.saveDraft(project('Студия'));
    expect(idb.versionChange()).toBe('done');
    expect(idb.connections.size).toBe(0);
    await st.saveDraft(project('После'));
    expect((await st.loadDraft())?.name).toBe('После');
    expect(idb.opens).toBe(2);
  });

  it('браузер закрыл соединение с событием close — следующая операция открывает новое', async () => {
    await st.saveDraft(project('Студия'));
    idb.dropConnections(true);
    expect((await st.loadDraft())?.name).toBe('Студия');
    expect(idb.opens).toBe(2);
  });

  it('браузер закрыл соединение молча — операция повторяется один раз с новым', async () => {
    await st.saveDraft(project('Студия'));
    idb.dropConnections(false);
    await st.saveDraft(project('После'));
    expect((await st.loadDraft())?.name).toBe('После');
    expect(idb.opens).toBe(2);
  });

  it('после ошибки запроса следующая операция идёт по новому соединению', async () => {
    await st.saveDraft(project('Студия'));
    idb.failRequests = 1;
    await expect(st.saveDraft(project('Сбой'))).rejects.toThrow('запрос не выполнен');
    await st.saveDraft(project('После'));
    expect((await st.loadDraft())?.name).toBe('После');
    expect(idb.opens).toBe(2);
    expect(idb.connections.size).toBe(1);
  });

  it('ожидание «Хранилище занято…» отклоняет операцию; открывшееся позже соединение закрывается', async () => {
    idb.blockOpens = 1;
    await expect(st.saveDraft(project('Студия'))).rejects.toThrow(/Хранилище занято/);
    await tick();
    expect(idb.connections.size).toBe(0);
    await st.saveDraft(project('После'));
    expect((await st.loadDraft())?.name).toBe('После');
  });
});

describe('черновик не открылся — прежний не перезаписывается (029)', () => {
  const quick = [0, 0, 0];
  const stored = (p: unknown) => JSON.parse(JSON.stringify(p));
  const failure = (e: unknown) => e as InstanceType<Storage['DraftLoadError']>;

  it('кратковременный сбой (первые две попытки) незаметен — проект открывается', async () => {
    const p = project('Студия');
    idb.seed('meta', 'draft', p);
    idb.failOpens = 2;
    expect((await st.loadDraft(quick))?.id).toBe(p.id);
    expect(idb.opens).toBe(3);
    await st.saveDraft(project('Правка'));
    expect(idb.peek('meta', 'draft').name).toBe('Правка');
  });

  it('по умолчанию — четыре попытки с паузами 200, 400 и 800 мс', async () => {
    expect(st.DRAFT_READ_PAUSES).toEqual([200, 400, 800]);
    idb.seed('meta', 'draft', project('Студия'));
    idb.failOpens = 100;
    const t0 = Date.now();
    await expect(st.loadDraft()).rejects.toBeInstanceOf(st.DraftLoadError);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(1350);
    expect(idb.opens).toBe(4);
  });

  it('хранилище не читается — DraftLoadError unreadable; ни черновик, ни ra-draft-pending не пишутся до выбора', async () => {
    const p = project('Студия');
    idb.seed('meta', 'draft', p);
    idb.failOpens = 100;
    const e = failure(await st.loadDraft(quick).catch((x) => x));
    expect(e).toBeInstanceOf(st.DraftLoadError);
    expect(e.kind).toBe('unreadable');
    expect(e.message).toContain('хранилище не открылось');
    expect(idb.opens).toBe(4);
    // хранилище снова доступно, но пользователь ещё не выбрал: отложенное сохранение, уход со страницы, обновление
    idb.failOpens = 0;
    await expect(st.saveDraft(project('Пустой'))).rejects.toThrow(/не перезаписывается/);
    st.stashPendingDraft(project('Пустой'));
    expect(mem.getItem('ra-draft-pending')).toBeNull();
    expect(idb.peek('meta', 'draft')).toEqual(stored(p));
  });

  it('«Повторить», когда хранилище доступно, — тот же проект с теми же данными; запись снова разрешена', async () => {
    const p = project('Студия');
    idb.seed('meta', 'draft', p);
    idb.failOpens = 100;
    await expect(st.loadDraft(quick)).rejects.toBeInstanceOf(st.DraftLoadError);
    idb.failOpens = 0;
    const again = await st.loadDraft(quick);
    expect(again).toEqual(st.normalizeProject(stored(p)));
    await st.saveDraft(again!);
    expect(idb.peek('meta', 'draft').id).toBe(p.id);
  });

  it('«Начать новый проект» после подтверждения снимает запрет — черновик заменяется', async () => {
    idb.seed('meta', 'draft', project('Студия'));
    idb.failOpens = 100;
    await expect(st.loadDraft(quick)).rejects.toBeInstanceOf(st.DraftLoadError);
    idb.failOpens = 0;
    st.releaseDraft();
    const fresh = project('Новый');
    await st.saveDraft(fresh);
    st.stashPendingDraft(fresh);
    expect(idb.peek('meta', 'draft').id).toBe(fresh.id);
    expect(mem.getItem('ra-draft-pending')).not.toBeNull();
  });

  it('черновик не прошёл проверку — DraftLoadError invalid с причиной и данными как есть; запись запрещена', async () => {
    const b = broken();
    idb.seed('meta', 'draft', b);
    const e = failure(await st.loadDraft(quick).catch((x) => x));
    expect(e.kind).toBe('invalid');
    expect(e.message).toBe('Неверные данные комнаты: Глубина: от 1 до 50 м');
    expect(e.raw).toEqual(stored(b));
    expect(idb.peek('meta', 'draft-failed')).toEqual(stored(b));
    await expect(st.saveDraft(project('Пустой'))).rejects.toThrow(/не перезаписывается/);
    expect(idb.peek('meta', 'draft')).toEqual(stored(b));
    // без повторов: проверка не зависит от попытки
    expect(idb.opens).toBe(1);
  });

  it('исправная ra-draft-pending открывается без чтения IndexedDB', async () => {
    st.stashPendingDraft(project('При уходе'));
    idb.failOpens = 100;
    expect((await st.loadDraft(quick))?.name).toBe('При уходе');
    expect(idb.opens).toBe(0);
  });

  it('в браузере нет IndexedDB — черновика нет, запись не запрещена', async () => {
    vi.stubGlobal('indexedDB', undefined);
    expect(await st.loadDraft(quick)).toBeUndefined();
    st.stashPendingDraft(project('При уходе'));
    expect(mem.getItem('ra-draft-pending')).not.toBeNull();
  });
});
