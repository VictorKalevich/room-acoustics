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
