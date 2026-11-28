// V2-016–V2-020: маршруты, настройки сложности, избранное и недавние, каталог 23 инструментов, «Мои данные».
import { describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { href, parseRoute, ROOM_SECTIONS, type Route } from '../../src/v2/shared/router';
import { DEFAULT_SETTINGS, RECENT_LIMIT, type AppSettings, effectiveComplexity, loadSettings, normalizeSettings, pushRecent, saveSettings, setOverride, toggleFavorite } from '../../src/v2/application/settings';
import { TOOLS, TOOL_CATEGORIES, searchTools, toolById } from '../../src/v2/features/tools/catalog';
import { openV2Db } from '../../src/v2/storage/db';
import { CATEGORY_INFO, LIBRARY_CATEGORIES, countCategories, deleteEntry, listCategory, putEntry } from '../../src/v2/storage/library';
import { nextRoomName } from '../../src/v2/shared/format';

describe('059 V2-020 · хеш-маршруты', () => {
  it('разбор и обратная сборка совпадают для всех маршрутов', () => {
    const routes: Route[] = [
      { name: 'home' }, { name: 'rooms' }, { name: 'room-new' }, { name: 'room-new', mode: 'scan' }, { name: 'room-new', mode: 'manual' }, { name: 'tools' }, { name: 'tool', toolId: 'room-modes' },
      { name: 'library' }, { name: 'library', category: 'materials' }, { name: 'settings' }, { name: 'catalog' },
      { name: 'room', id: 'legacy-abc~1f2e3d4c', tab: 'model' }, { name: 'room', id: 'r 1/2', tab: 'advice' },
      ...ROOM_SECTIONS.analysis.map((section) => ({ name: 'room' as const, id: 'r1', tab: 'analysis' as const, section })),
    ];
    for (const r of routes) expect(parseRoute(href(r)), href(r)).toEqual(r);
  });

  it('адрес комнаты без вкладки открывает модель; пустой и «#» — главная', () => {
    expect(parseRoute('#/rooms/abc')).toEqual({ name: 'room', id: 'abc', tab: 'model' });
    expect(parseRoute('')).toEqual({ name: 'home' });
    expect(parseRoute('#')).toEqual({ name: 'home' });
    expect(parseRoute('#/tools/')).toEqual({ name: 'tools' });
  });

  it('неизвестные адреса — «не найдено», а не другой экран', () => {
    for (const h of ['#/nope', '#/rooms/abc/unknown', '#/rooms/abc/analysis/foo', '#/rooms/abc/model/bass', '#/library/x', '#/settings/x', '#/rooms/new/x', '#/rooms/new/scan/x', '#/tools/a/b', '#/rooms/%E0%A4%A/model', '#/rooms/a/model/geometry/x']) {
      expect(parseRoute(h).name, h).toBe('not-found');
    }
  });
});

describe('059 V2-016 · сложность и настройки', () => {
  it('до выбора уровня — первый запуск; переопределение раздела действует только в нём', () => {
    expect(DEFAULT_SETTINGS.complexity).toBeNull();
    let s: AppSettings = { ...DEFAULT_SETTINGS, complexity: 'simple' };
    s = setOverride(s, 'tool:rta', 'expert');
    expect(effectiveComplexity(s, 'tool:rta')).toBe('expert');
    expect(effectiveComplexity(s, 'tool:sweep')).toBe('simple');
    expect(effectiveComplexity(s)).toBe('simple');
    expect(setOverride(s, 'tool:rta', 'simple').overrides).toEqual({});
    expect(setOverride(s, 'tool:rta', null).overrides).toEqual({});
  });

  it('повреждённая запись настроек не ломает запуск', () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings({ complexity: 'guru', overrides: { a: 'expert', b: 5 }, favorites: ['x', 'x', 3], recentTools: 'y' }))
      .toEqual({ complexity: null, overrides: { a: 'expert' }, favorites: ['x'], recentTools: [] });
  });

  it('избранное переключается, недавние — без повторов и не больше предела', () => {
    let s = toggleFavorite(DEFAULT_SETTINGS, 'rta');
    expect(s.favorites).toEqual(['rta']);
    expect(toggleFavorite(s, 'rta').favorites).toEqual([]);
    for (const t of ['a', 'b', 'c', 'a', 'd', 'e', 'f', 'g']) s = pushRecent(s, t);
    expect(s.recentTools).toEqual(['g', 'f', 'e', 'd', 'a', 'c']);
    expect(s.recentTools).toHaveLength(RECENT_LIMIT);
  });

  it('настройки сохраняются в IndexedDB v2', async () => {
    const db = openV2Db(new IDBFactory());
    expect(await loadSettings(db)).toEqual(DEFAULT_SETTINGS);
    await saveSettings(db, { ...DEFAULT_SETTINGS, complexity: 'expert', favorites: ['sbir'] });
    expect(await loadSettings(db)).toMatchObject({ complexity: 'expert', favorites: ['sbir'] });
    db.close();
  });
});

describe('059 V2-019 · каталог инструментов', () => {
  it('23 инструмента в пяти категориях: 4, 2, 6, 5, 6; идентификаторы уникальны', () => {
    expect(TOOLS).toHaveLength(23);
    expect(new Set(TOOLS.map((t) => t.id)).size).toBe(23);
    expect(TOOL_CATEGORIES.map((c) => TOOLS.filter((t) => t.category === c.id).length)).toEqual([4, 2, 6, 5, 6]);
    expect(TOOLS.filter((t) => t.audio === 'input').map((t) => t.id)).toEqual(['noise-meter', 'rta', 'sweep', 'decay']);
  });

  it('поиск по названию, ключевым словам, без учёта регистра и «ё»; все слова должны найтись', () => {
    expect(searchTools('моды').map((t) => t.id)).toContain('room-modes');
    expect(searchTools('RT60').map((t) => t.id)).toEqual(expect.arrayContaining(['decay', 'reverb']));
    expect(searchTools('шрeдер').length).toBe(0);
    expect(searchTools('шредер').map((t) => t.id)).toEqual(['reverb']);
    expect(searchTools('задержка фаза').map((t) => t.id)).toEqual(expect.arrayContaining(['distance-delay', 'phase-delay']));
    expect(searchTools('   ')).toHaveLength(23);
    expect(searchTools('несуществующее')).toEqual([]);
    expect(toolById('sbir')?.title).toBe('Провалы SBIR');
  });
});

describe('059 V2-020 · «Мои данные»', () => {
  it('девять категорий; пресеты и сигналы, расчёты и отчёты разделяются по виду записи', async () => {
    expect(LIBRARY_CATEGORIES).toHaveLength(9);
    const db = openV2Db(new IDBFactory());
    await putEntry(db, 'presets', { id: 'p1', name: 'EQ', kind: 'dsp', createdAt: '2026-11-27T10:00:00Z' });
    await putEntry(db, 'signals', { id: 's1', name: 'Розовый шум', kind: 'signal', createdAt: '2026-11-27T11:00:00Z' });
    await putEntry(db, 'calculations', { id: 'c1', name: 'Моды 4,5 м', kind: 'calculation', createdAt: '2026-11-27T12:00:00Z' });
    await putEntry(db, 'reports', { id: 'r1', name: 'Отчёт', kind: 'report', createdAt: '2026-11-27T12:00:00Z' });
    const counts = await countCategories(db);
    expect([counts.presets, counts.signals, counts.calculations, counts.reports, counts.materials]).toEqual([1, 1, 1, 1, 0]);
    expect((await listCategory(db, 'signals')).map((e) => e.name)).toEqual(['Розовый шум']);
    await deleteEntry(db, 'signals', 's1');
    expect((await countCategories(db)).signals).toBe(0);
    expect(CATEGORY_INFO.calculations.store).toBe('reports');
    db.close();
  });

  it('название новой комнаты по умолчанию — первое свободное «Комната N»', () => {
    expect(nextRoomName([])).toBe('Комната 1');
    expect(nextRoomName(['Комната 1', 'комната 2', 'Гостиная'])).toBe('Комната 3');
  });
});
