import { readFileSync } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';
import type { Project } from '../../src/state/project';
import { EMPTY_STATE, finishRoomSteps, scanToSteps, startManualRoom } from './helpers';

// 037: действия с комнатой (таблица действий в specs/037-room-setup-operations) — что после каждого лежит на
// устройстве: рабочий проект, черновик конструктора, скан. Сценарий проходит и на коде до шага 9 плана рефакторинга.

type Rect = { x0: number; x1: number; y0: number; y1: number };
interface StoredScan { fileName: string; units: string; applied: Rect; initial: Rect }
interface Stored {
  /** Рабочий проект (IndexedDB, `meta/draft`). */
  draft: Project | null;
  /** Сохранённые проекты («Проекты»). */
  saved: string[];
  /** Сканы на устройстве по проекту (хранилище `scans`). */
  scans: Record<string, StoredScan>;
  /** Черновики конструктора по проекту (`localStorage`, `ra-room-draft-<проект>`). */
  roomDrafts: Record<string, { room: { depth: number; width: number; materials: Record<string, string> }; reached: string; entered: string[]; touched: string[] }>;
}

const read = (page: Page) => page.evaluate(() => new Promise<Stored>((resolve, reject) => {
  const roomDrafts: Stored['roomDrafts'] = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)!;
    if (k.startsWith('ra-room-draft-')) roomDrafts[k.slice('ra-room-draft-'.length)] = JSON.parse(localStorage.getItem(k)!);
  }
  const req = indexedDB.open('room-acoustics');
  req.onupgradeneeded = () => req.transaction?.abort();
  req.onerror = () => resolve({ draft: null, saved: [], scans: {}, roomDrafts });
  req.onsuccess = () => {
    const db = req.result;
    const t = db.transaction(['meta', 'projects', 'scans'], 'readonly');
    const draft = t.objectStore('meta').get('draft');
    const saved = t.objectStore('projects').getAllKeys();
    const scans = t.objectStore('scans').getAll();
    t.oncomplete = () => {
      db.close();
      resolve({
        draft: draft.result ?? null,
        saved: saved.result.map(String),
        scans: Object.fromEntries((scans.result as (StoredScan & { projectId: string; applied: { rect: Rect }; initial: { rect: Rect } })[])
          .map((s) => [s.projectId, { fileName: s.fileName, units: s.units, applied: s.applied.rect, initial: s.initial.rect }])),
        roomDrafts,
      });
    };
    t.onerror = () => { db.close(); reject(t.error); };
  };
}));

/** Дождаться, пока на устройстве окажется ожидаемое (проект пишется через 300 мс после изменения, скан — асинхронно). */
async function stored(page: Page, what: string, ready: (s: Stored & { draft: Project }) => boolean): Promise<Stored & { draft: Project }> {
  let last: Stored | null = null;
  await expect.poll(async () => {
    last = await read(page);
    return !!last.draft && ready(last as Stored & { draft: Project });
  }, { message: `на устройстве не то: ${what}` }).toBe(true);
  return last! as Stored & { draft: Project };
}

const id = async (page: Page) => (await stored(page, 'рабочий проект', () => true)).draft.id;
const projects = async (page: Page) => {
  await page.getByRole('button', { name: 'Открыть меню' }).click();
  await page.locator('.drawer__item', { hasText: 'Проекты' }).click();
};
const dialog = (page: Page) => page.getByRole('alertdialog');
/** Глубина и ширина до дециметра: распознанные размеры не круглые (ширина образца — 3,995 м). */
const size = (r: { depth: number; width: number }) => [Math.round(r.depth * 10) / 10, Math.round(r.width * 10) / 10];

/** Черновик конструктора, совпадающий с комнатой проекта: правка высоты и возврат; уход — без вопроса. */
async function sameDraft(page: Page) {
  await page.goto('/#room/size');
  const height = page.getByLabel('Высота', { exact: true });
  const was = await height.inputValue();
  await height.fill('2,9');
  await height.blur();
  await height.fill(was);
  await height.blur();
  await page.getByRole('button', { name: /Обзор комнаты/ }).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(page).toHaveURL(/#room$/);
}

test.describe('комнаты ещё нет', () => {
  test.use({ storageState: EMPTY_STATE });

  test('скан: первое применение, поворот, переход к поправке, поправка по шагам, «Сохранить», поворот на обзоре, поправка, новый скан поверх, «Начать заново»', async ({ page }) => {
    await page.goto('/#room');
    // начатая ручная настройка — черновик есть
    await startManualRoom(page);
    await page.getByLabel('Глубина', { exact: true }).fill('6');
    const pid = await id(page);
    expect((await read(page)).roomDrafts[pid]).toMatchObject({ entered: ['depth'], reached: 'size' });
    await page.getByRole('button', { name: /Обзор комнаты/ }).click();

    // 1. первое применение скана
    await scanToSteps(page, 'tests/fixtures/out/sample-room.obj');
    await expect(page).toHaveURL(/#room\/size$/);
    let s = await stored(page, 'скан применён', (x) => x.draft.scanInfo?.fileName === 'sample-room.obj' && !!x.scans[pid]);
    expect(s.draft).toMatchObject({ id: pid, roomReady: false, room: { height: 2.5, source: 'scan' } });
    expect(size(s.draft.room)).toEqual([5, 4]);
    expect(s.draft.scanInfo).toMatchObject({ rotation: 0, applied: { units: 'm' } });
    // границы — вся найденная комната: у проекта, у скана — исходные и применённые
    const whole = s.draft.scanInfo!.applied!.rect;
    expect(size({ depth: whole.x1 - whole.x0, width: whole.y1 - whole.y0 })).toEqual([5, 4]);
    expect(s.roomDrafts[pid]).toBeUndefined();
    expect(s.scans[pid]).toEqual({ fileName: 'sample-room.obj', units: 'auto', applied: whole, initial: whole });

    // 7. поворот при проверке скана: комната проекта и черновик повёрнуты
    await page.getByRole('button', { name: 'Колонки у другой стены' }).click();
    s = await stored(page, 'комната повёрнута', (x) => x.draft.scanInfo?.rotation === 1);
    expect(size(s.draft.room)).toEqual([4, 5]);
    expect(s.roomDrafts[pid]).toMatchObject({ room: s.draft.room, reached: 'size', entered: [], touched: [] });
    expect(Object.keys(s.scans)).toEqual([pid]);

    // 8. «Поправить границы комнаты» с шага «Размеры»: введённое на шагах — в проект, черновик удалён
    await page.getByRole('button', { name: /Далее/ }).click();
    await page.getByLabel('Материал стены', { exact: true }).selectOption('gypsum');
    expect((await read(page)).roomDrafts[pid]).toMatchObject({ reached: 'walls', touched: ['mat.front'] });
    await page.getByRole('button', { name: /Назад/ }).click();
    await page.getByRole('button', { name: 'Поправить границы комнаты' }).click();
    await expect(page).toHaveURL(/#room$/);
    await expect(page.locator('.layout-editor')).toBeVisible({ timeout: 15_000 });
    s = await stored(page, 'введённое на шагах в проекте', (x) => x.draft.room.materials.front === 'gypsum');
    expect(s.draft).toMatchObject({ roomReady: false, scanInfo: { rotation: 1 } });
    expect(size(s.draft.room)).toEqual([4, 5]);
    expect(s.roomDrafts[pid]).toBeUndefined();

    // 3. поправка границ во время проверки по шагам — снова шаги
    await page.getByRole('button', { name: 'Применить размеры' }).click();
    await expect(page).toHaveURL(/#room\/size$/);
    s = await stored(page, 'поправка по шагам', (x) => x.draft.scanInfo?.rotation === 1 && x.draft.room.materials.front === 'gypsum');
    expect(s.draft).toMatchObject({ roomReady: false, scanInfo: { applied: { rect: whole } } });
    expect(size(s.draft.room)).toEqual([4, 5]);
    expect(s.roomDrafts[pid]).toBeUndefined();
    expect(s.scans[pid]).toMatchObject({ fileName: 'sample-room.obj', applied: whole });

    // 4. «Сохранить» на последнем шаге проверки — комната создана, черновика нет
    await finishRoomSteps(page);
    await expect(page).toHaveURL(/#room$/);
    s = await stored(page, 'комната создана', (x) => x.draft.roomReady);
    expect(s.roomDrafts[pid]).toBeUndefined();

    // 15. поворот на обзоре: комната и места повёрнуты, черновик и скан не трогаются
    const before = s.draft.current.listener;
    await page.getByRole('button', { name: 'Колонки у другой стены' }).click();
    s = await stored(page, 'поворот на обзоре', (x) => x.draft.scanInfo?.rotation === 2);
    expect(size(s.draft.room)).toEqual([5, 4]);
    expect(s.draft.current.listener).not.toEqual(before);
    expect(s.roomDrafts[pid]).toBeUndefined();
    expect(s.scans[pid].applied).toEqual(whole);

    // 3. поправка границ созданной комнаты: границы — в проекте и у скана, черновик удалён, остаётся обзор
    await sameDraft(page);
    expect((await read(page)).roomDrafts[pid]?.room).toEqual((await read(page)).draft!.room);
    await page.getByRole('button', { name: 'Поправить границы комнаты' }).click();
    const dims = page.locator('.layout-editor__dims');
    await expect(dims).toHaveText('5,00 × 4,00 м', { timeout: 15_000 });
    const handle = page.locator('.layout-editor__handle').nth(2);
    await handle.scrollIntoViewIfNeeded();
    const box = (await handle.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 50, box.y + box.height / 2, { steps: 5 });
    await page.mouse.up();
    await expect(dims).not.toHaveText('5,00 × 4,00 м');
    await expect(page.getByRole('button', { name: 'Применить размеры' })).toBeEnabled();
    await page.getByRole('button', { name: 'Применить размеры' }).click();
    await expect(page.getByText('Размеры из скана применены')).toBeVisible();
    await expect(page).toHaveURL(/#room$/);
    s = await stored(page, 'новые границы', (x) => !!x.draft.scanInfo?.applied && JSON.stringify(x.draft.scanInfo.applied.rect) !== JSON.stringify(whole)
      && JSON.stringify(x.scans[pid]?.applied) === JSON.stringify(x.draft.scanInfo.applied.rect));
    expect(s.draft).toMatchObject({ roomReady: true, scanInfo: { rotation: 2, applied: { units: 'm' } } });
    expect(s.draft.room.depth + s.draft.room.width).toBeLessThan(9);
    expect(s.roomDrafts[pid]).toBeUndefined();

    // 2. новый скан поверх применённого: комната сброшена, как «Очистить», и снова проверка по шагам
    await page.setInputFiles('#scan-file', 'tests/fixtures/out/sample-room-cm.stl');
    await expect(page.getByRole('heading', { name: 'Шаг 1 из 4: Размеры' })).toBeVisible({ timeout: 30_000 });
    s = await stored(page, 'новый скан', (x) => x.draft.scanInfo?.fileName === 'sample-room-cm.stl' && x.scans[pid]?.fileName === 'sample-room-cm.stl');
    expect(s.draft).toMatchObject({ roomReady: false, result: null, selectedIndex: 0, room: { source: 'scan' } });
    expect(size(s.draft.room)).toEqual([6.2, 3.8]);
    expect(s.draft.scanInfo).toMatchObject({ rotation: 0, applied: { units: 'cm' } });
    expect(s.draft.current.placed).toBe(false);
    expect(s.roomDrafts[pid]).toBeUndefined();
    expect(s.scans[pid]).toMatchObject({ units: 'auto' });

    // 9. «Начать заново» на карточке «Скан распознан» — то же, что «Очистить»: скан и черновик удалены
    await page.getByRole('button', { name: /Далее/ }).click();
    expect((await read(page)).roomDrafts[pid]).toMatchObject({ reached: 'walls' });
    await page.getByRole('button', { name: /Обзор комнаты/ }).click();
    await page.getByRole('button', { name: 'Начать заново: другой скан или вручную' }).click();
    await dialog(page).getByRole('button', { name: 'Очистить' }).click();
    await expect(page.getByRole('button', { name: 'Выбрать файл скана' })).toBeVisible();
    s = await stored(page, 'комната очищена', (x) => x.draft.scanInfo === null && !x.scans[pid]);
    expect(s.draft).toMatchObject({ id: pid, roomReady: false, result: null, selectedIndex: 0, current: { placed: false, measurement: null } });
    expect(s.draft.room.source).not.toBe('scan');
    expect(s.roomDrafts[pid]).toBeUndefined();
  });

  test('ручная настройка: «Сбросить черновик» удаляет черновик, проект прежний; «Сохранить» создаёт комнату', async ({ page }) => {
    await page.goto('/#room');
    await startManualRoom(page);
    await page.getByLabel('Глубина', { exact: true }).fill('6');
    await page.getByLabel('Ширина', { exact: true }).fill('4');
    await page.getByLabel('Высота', { exact: true }).fill('2,5');
    await page.getByRole('button', { name: /Далее/ }).click();
    const pid = await id(page);
    expect((await read(page)).roomDrafts[pid]).toMatchObject({ room: { depth: 6, width: 4 }, reached: 'walls', entered: ['depth', 'width', 'height'] });
    // 6. «Сбросить черновик» в ручной настройке — снова шаг «Размеры»
    await page.getByRole('button', { name: 'Сбросить черновик' }).click();
    await dialog(page).getByRole('button', { name: 'Сбросить черновик' }).click();
    await expect(page).toHaveURL(/#room\/size$/);
    let s = await stored(page, 'черновик сброшен', (x) => !x.roomDrafts[pid]);
    expect(s.draft).toMatchObject({ roomReady: false, scanInfo: null, room: { depth: 5, width: 4 } });
    // 4. «Сохранить» на последнем шаге ручной настройки
    await page.getByLabel('Глубина', { exact: true }).fill('5,5');
    await page.getByLabel('Ширина', { exact: true }).fill('3,5');
    await page.getByLabel('Высота', { exact: true }).fill('2,6');
    for (let i = 0; i < 3; i++) await page.getByRole('button', { name: /Далее/ }).click();
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(page).toHaveURL(/#room$/);
    s = await stored(page, 'комната создана', (x) => x.draft.roomReady);
    expect(s.draft).toMatchObject({ scanInfo: null, room: { depth: 5.5, width: 3.5, height: 2.6 } });
    expect(s.roomDrafts[pid]).toBeUndefined();
    expect(s.scans).toEqual({});
  });

  test('«Новый проект», «Открыть», «Импорт»: черновик текущего удаляется, его скан — если он не сохранён', async ({ page }) => {
    await page.goto('/#room');
    // 10. несохранённый проект со сканом и черновиком → «Новый проект»: скан и черновик удалены
    await scanToSteps(page, 'tests/fixtures/out/sample-room.obj');
    await page.getByRole('button', { name: /Далее/ }).click();
    const first = await id(page);
    await stored(page, 'скан первого проекта', (x) => !!x.scans[first] && !!x.roomDrafts[first]);
    await projects(page);
    await page.getByRole('button', { name: 'Новый проект' }).click();
    await dialog(page).getByRole('button', { name: 'Открыть новый проект' }).click();
    await expect(page).toHaveURL(/#room$/);
    let s = await stored(page, 'новый проект', (x) => x.draft.id !== first && !x.scans[first]);
    expect(s.draft).toMatchObject({ roomReady: false, scanInfo: null });
    expect(s.roomDrafts[first]).toBeUndefined();

    // 10. сохранённый проект → «Новый проект» без вопроса: черновик удалён, скан остаётся сохранённой копии
    const saved = s.draft.id;
    await scanToSteps(page, 'tests/fixtures/out/sample-room.obj');
    await finishRoomSteps(page);
    await sameDraft(page);
    await projects(page);
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(page.getByText('Сохранено')).toBeVisible();
    await stored(page, 'сохранён, черновик есть', (x) => x.saved.includes(saved) && !!x.scans[saved] && !!x.roomDrafts[saved]);
    // список сохранённых прочитан: проект сохранён, вопроса нет
    await expect(page.locator('.project-list li')).toHaveCount(1);
    await page.getByRole('button', { name: 'Новый проект' }).click();
    await expect(dialog(page)).toHaveCount(0);
    s = await stored(page, 'второй новый проект', (x) => x.draft.id !== saved);
    expect(s.roomDrafts[saved]).toBeUndefined();
    expect(Object.keys(s.scans)).toEqual([saved]);

    // 11. «Открыть» сохранённый из несохранённого проекта со сканом: скан и черновик текущего удалены
    const third = s.draft.id;
    await scanToSteps(page, 'tests/fixtures/out/sample-room-cm.stl');
    await page.getByRole('button', { name: /Далее/ }).click();
    await stored(page, 'скан третьего проекта', (x) => !!x.scans[third] && !!x.roomDrafts[third]);
    await projects(page);
    await page.locator('.project-list li').first().getByRole('button', { name: 'Открыть' }).click();
    await dialog(page).getByRole('button', { name: 'Открыть проект' }).click();
    await expect(page).toHaveURL(/#room$/);
    s = await stored(page, 'открыт сохранённый', (x) => x.draft.id === saved && !x.scans[third]);
    expect(s.draft).toMatchObject({ roomReady: true, scanInfo: { fileName: 'sample-room.obj' } });
    expect(s.roomDrafts[third]).toBeUndefined();
    expect(Object.keys(s.scans)).toEqual([saved]);

    // 11. «Открыть» копию того же проекта, изменённого после сохранения: черновик удалён, скан остаётся
    await sameDraft(page);
    await projects(page);
    await page.locator('#pname').fill('Изменённое название');
    await stored(page, 'изменён после сохранения', (x) => x.draft.name === 'Изменённое название' && !!x.roomDrafts[saved]);
    await page.locator('.project-list li').first().getByRole('button', { name: 'Открыть' }).click();
    await dialog(page).getByRole('button', { name: 'Вернуться', exact: true }).click();
    s = await stored(page, 'вернулись к сохранённой', (x) => x.draft.name !== 'Изменённое название');
    expect(s.draft.id).toBe(saved);
    expect(s.roomDrafts[saved]).toBeUndefined();
    expect(Object.keys(s.scans)).toEqual([saved]);

    // 12. «Импорт» другого проекта, текущий сохранён: черновик текущего удалён, скан остаётся
    await sameDraft(page);
    await projects(page);
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Экспорт', exact: true }).click()]);
    const data = JSON.parse(readFileSync((await download.path())!, 'utf8'));
    data.project = { ...data.project, id: 'from-file', name: 'Комната из файла' };
    await stored(page, 'черновик перед импортом', (x) => !!x.roomDrafts[saved]);
    await expect(page.locator('.project-list li')).toHaveCount(1);
    await page.locator('input[type=file][accept^=".json"]').setInputFiles({ name: 'room.roomacoustics.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
    await expect(page).toHaveURL(/#room$/);
    s = await stored(page, 'проект из файла', (x) => x.draft.id === 'from-file');
    expect(s.roomDrafts[saved]).toBeUndefined();
    expect(Object.keys(s.scans)).toEqual([saved]);
  });

  test('«Удалить» сохранённый проект: у другого — скан и черновик удаляются, у открытого — остаются', async ({ page }) => {
    await page.goto('/#room');
    await scanToSteps(page, 'tests/fixtures/out/sample-room.obj');
    await finishRoomSteps(page);
    const first = await id(page);
    await projects(page);
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(page.getByText('Сохранено')).toBeVisible();
    await page.getByRole('button', { name: 'Новый проект' }).click();
    await expect(page).toHaveURL(/#room$/);
    await scanToSteps(page, 'tests/fixtures/out/sample-room-cm.stl');
    await finishRoomSteps(page);
    const open = (await stored(page, 'второй проект', (x) => x.draft.id !== first && x.draft.roomReady)).draft.id;
    await sameDraft(page);
    // черновик конструктора сохранённого проекта, который сейчас не открыт (остался с прошлой работы с ним)
    await page.evaluate(([pid, d]) => localStorage.setItem(`ra-room-draft-${pid}`, d), [first, JSON.stringify((await read(page)).roomDrafts[open])]);
    await projects(page);
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(page.locator('.project-list li')).toHaveCount(2);
    let s = await stored(page, 'два сохранённых со сканами', (x) => x.saved.length === 2 && !!x.scans[first] && !!x.scans[open]);
    expect(Object.keys(s.roomDrafts).sort()).toEqual([first, open].sort());

    // 13. другой проект: запись, скан и черновик удалены
    await page.getByRole('button', { name: /^Удалить .*/ }).nth(1).click();
    await expect(page.locator('.project-list li')).toHaveCount(1);
    s = await stored(page, 'другой удалён', (x) => !x.saved.includes(first) && !x.scans[first]);
    expect(s.roomDrafts[first]).toBeUndefined();
    expect(Object.keys(s.scans)).toEqual([open]);
    expect(s.roomDrafts[open]).toBeDefined();

    // 14. копия открытого: запись удалена, скан и черновик остаются рабочему проекту
    await page.getByRole('button', { name: /^Удалить .*/ }).click();
    await expect(page.locator('.project-list li')).toHaveCount(0);
    s = await stored(page, 'копия открытого удалена', (x) => x.saved.length === 0);
    expect(s.draft.id).toBe(open);
    expect(Object.keys(s.scans)).toEqual([open]);
    expect(s.roomDrafts[open]).toBeDefined();
  });
});

test('конструктор созданной комнаты: «Сохранить», «Не сохранять», «Сбросить черновик»', async ({ page }) => {
  await page.goto('/#room/size');
  const width = page.getByLabel('Ширина', { exact: true });
  await width.fill('3,5');
  await width.blur();
  const pid = await id(page);
  expect((await read(page)).roomDrafts[pid]).toMatchObject({ room: { width: 3.5 } });
  // 4. «Сохранить» при правке: в проекте, черновика нет, остаётся на шаге
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByText('Изменения комнаты сохранены.')).toBeVisible();
  await expect(page).toHaveURL(/#room\/size$/);
  let s = await stored(page, 'правка сохранена', (x) => x.draft.room.width === 3.5);
  expect(s.roomDrafts[pid]).toBeUndefined();
  // 5. «Не сохранять» при уходе: проект прежний, черновика нет
  await width.fill('3');
  await width.blur();
  expect((await read(page)).roomDrafts[pid]).toMatchObject({ room: { width: 3 } });
  await page.getByRole('button', { name: /Обзор комнаты/ }).click();
  await dialog(page).getByRole('button', { name: 'Не сохранять' }).click();
  await expect(page).toHaveURL(/#room$/);
  s = await stored(page, 'не сохранено', (x) => !x.roomDrafts[pid]);
  expect(s.draft.room.width).toBe(3.5);
  // 6. «Сбросить черновик» при правке: проект прежний, черновика нет, остаётся на шаге
  await page.getByRole('button', { name: 'Конструктор комнаты' }).click();
  await width.fill('3');
  await width.blur();
  await page.getByRole('button', { name: 'Сбросить черновик' }).click();
  await dialog(page).getByRole('button', { name: 'Сбросить черновик' }).click();
  await expect(page).toHaveURL(/#room\/size$/);
  await expect(width).toHaveValue('3,5');
  s = await stored(page, 'черновик сброшен', (x) => !x.roomDrafts[pid]);
  expect(s.draft.room.width).toBe(3.5);
  expect(s.scans).toEqual({});
});
