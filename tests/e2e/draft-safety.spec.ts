import { readFileSync } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';
import { errlog, fits } from './helpers';

// 029: сбой чтения не стирает рабочий проект. Сбой задаётся без тестовых веток в приложении: до загрузки страницы
// подменяется IDBFactory.prototype.open — первые N открытий базы завершаются ошибкой. Черновик читается и пишется
// в сценарии напрямую, прежним open, минуя подмену.

interface Fault029 {
  /** Сколько следующих открытий базы завершится ошибкой (можно менять из сценария). */
  idbFail029: number;
  /** Сколько раз приложение открывало базу. */
  idbOpens029: number;
  /** Черновик (JSON) в момент загрузки страницы — до того, как приложение что-либо сделало. */
  draftAtStart029: Promise<string | null>;
  readMeta029: (key: string) => Promise<string | null>;
  writeMeta029: (key: string, value: unknown) => Promise<void>;
}

/** Подмена open до загрузки страницы. После перезагрузки число сбоев берётся из sessionStorage idb-fail029, если задано. */
const faultIdb = (page: Page, fails: number) => page.addInitScript((n) => {
  const w = window as unknown as Fault029;
  const open = IDBFactory.prototype.open;
  const saved = sessionStorage.getItem('idb-fail029');
  w.idbFail029 = saved === null ? n : Number(saved);
  w.idbOpens029 = 0;
  const meta = (mode: IDBTransactionMode, key: string, value?: unknown) => new Promise<unknown>((resolve, reject) => {
    const r = open.call(indexedDB, 'room-acoustics');
    r.onerror = () => reject(r.error);
    r.onsuccess = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('meta')) { db.close(); resolve(undefined); return; }
      const store = db.transaction('meta', mode).objectStore('meta');
      const q = mode === 'readonly' ? store.get(key) : store.put(value, key);
      q.onsuccess = () => { db.close(); resolve(mode === 'readonly' ? q.result : undefined); };
      q.onerror = () => { db.close(); reject(q.error); };
    };
  });
  w.readMeta029 = (key) => meta('readonly', key).then((v) => (v === undefined ? null : JSON.stringify(v)));
  w.writeMeta029 = (key, value) => meta('readwrite', key, value).then(() => undefined);
  w.draftAtStart029 = w.readMeta029('draft');
  IDBFactory.prototype.open = function (this: IDBFactory, ...args: Parameters<IDBFactory['open']>) {
    w.idbOpens029++;
    if (w.idbFail029 <= 0) return open.apply(this, args);
    w.idbFail029--;
    const req = { error: new DOMException('проверка 029: хранилище не открылось', 'UnknownError'), onsuccess: null, onerror: null, onblocked: null, onupgradeneeded: null } as unknown as IDBOpenDBRequest;
    setTimeout(() => req.onerror?.call(req, new Event('error')));
    return req;
  };
}, fails);

const opens = (page: Page) => page.evaluate(() => (window as unknown as Fault029).idbOpens029);
const readDraft = (page: Page, key = 'draft') => page.evaluate((k) => (window as unknown as Fault029).readMeta029(k), key);
const atStart = (page: Page) => page.evaluate(() => (window as unknown as Fault029).draftAtStart029);
const setFails = (page: Page, n: number) => page.evaluate((v) => { (window as unknown as Fault029).idbFail029 = v; }, n);
/** Уход со страницы: приложение с открытым проектом сохраняет несохранённое (ra-draft-pending и IndexedDB). */
const leave = (page: Page) => page.evaluate(() => { dispatchEvent(new PageTransitionEvent('pagehide')); });
const pending = (page: Page) => page.evaluate(() => localStorage.getItem('ra-draft-pending'));
/** Отсутствие записи не дождаться по событию: отложенное сохранение сработало бы через 300 мс после открытия проекта. */
const quiet = (page: Page) => page.waitForTimeout(700);
const unreadable = (page: Page) => page.getByRole('heading', { name: 'Не удалось открыть сохранённый проект' });

test('029: кратковременный сбой чтения (первые две попытки) незаметен — проект открывается', async ({ page }) => {
  await faultIdb(page, 2);
  await page.goto('/#placement');
  await expect(page.locator('.tabbar')).toBeVisible();
  const before = JSON.parse((await atStart(page))!);
  await expect(page.locator('.topbar__room')).toContainText(`${before.name}, 5,00 × 4,00 × 2,50`);
  await expect(page.getByRole('button', { name: 'Подобрать расстановку' })).toBeVisible();
  await expect(unreadable(page)).toHaveCount(0);
  expect(await opens(page)).toBeGreaterThanOrEqual(3);
});

test('029: хранилище не читается — сообщение; черновик не перезаписывается и после снятия сбоя; «Повторить» открывает тот же проект', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await faultIdb(page, 1e6);
  await page.goto('/#placement');
  await expect(unreadable(page)).toBeVisible();
  await expect(page.getByText('Данные на устройстве не тронуты.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Повторить' })).toBeVisible();
  // остального интерфейса нет: ни шапки, ни нижней панели, ни разделов
  await expect(page.locator('.topbar')).toHaveCount(0);
  await expect(page.locator('.tabbar')).toHaveCount(0);
  await expect(page.locator('main.content .panel')).toHaveCount(1);
  expect(await opens(page)).toBe(4);
  expect((await errlog(page)).some((e) => e.ctx === 'черновик проекта не прочитан' && e.msg.includes('проверка 029'))).toBe(true);
  const before = (await atStart(page))!;
  expect(before).not.toBeNull();

  // хранилище снова доступно, но пользователь ещё не выбрал: ни отложенного сохранения, ни сохранения при уходе
  await setFails(page, 0);
  await leave(page);
  await quiet(page);
  expect(await readDraft(page)).toBe(before);
  expect(await pending(page)).toBeNull();
  await fits(page, 'хранилище не читается');

  await page.getByRole('button', { name: 'Повторить' }).click();
  await expect(page.locator('.tabbar')).toBeVisible();
  const p = JSON.parse(before);
  await expect(page.locator('.topbar__room')).toContainText(`${p.name}, 5,00 × 4,00 × 2,50`);
  await expect(page.getByRole('button', { name: 'Подобрать расстановку' })).toBeVisible();
  // открыт тот же проект с теми же данными: прежнее отложенное сохранение пишет его же
  await quiet(page);
  expect(JSON.parse((await readDraft(page))!)).toEqual(p);
  expect(errors).toEqual([]);
});

test('029: «Начать новый проект» спрашивает подтверждение и только после него заменяет черновик', async ({ page }) => {
  await faultIdb(page, 1e6);
  await page.goto('/#placement');
  await expect(unreadable(page)).toBeVisible();
  const before = (await atStart(page))!;
  const start = page.locator('[role=alert]').getByRole('button', { name: 'Начать новый проект' });
  const dialog = page.getByRole('alertdialog');
  await start.click();
  await expect(dialog).toContainText('Прежний рабочий проект на этом устройстве заменится новым. Проекты, сохранённые в «Проектах», останутся.');
  await dialog.getByRole('button', { name: 'Отмена' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(unreadable(page)).toBeVisible();
  await setFails(page, 0);
  await quiet(page);
  expect(await readDraft(page)).toBe(before);

  await start.click();
  await dialog.getByRole('button', { name: 'Начать новый проект' }).click();
  await expect(page.locator('.start-card')).toBeVisible();
  await expect(page.locator('.tabbar')).toHaveCount(0);
  await expect.poll(async () => JSON.parse((await readDraft(page)) ?? 'null')?.id).not.toBe(JSON.parse(before).id);
  // после перезагрузки (хранилище доступно) — новый проект
  await page.evaluate(() => sessionStorage.setItem('idb-fail029', '0'));
  await page.reload();
  await expect(page.locator('.start-card')).toBeVisible();
});

test('029: черновик не прошёл проверку — причина, копия в файл, черновик не тронут; «Начать новый проект» с подтверждением', async ({ page }) => {
  // приложение пока не может открыть хранилище — повреждённый черновик записывается, пока оно ничего не трогает
  await faultIdb(page, 1e6);
  await page.goto('/#room');
  await expect(unreadable(page)).toBeVisible();
  const draft = JSON.parse((await atStart(page))!);
  const broken = { ...draft, name: 'Повреждённый', room: { ...draft.room, depth: 500 } };
  await page.evaluate((b) => (window as unknown as Fault029).writeMeta029('draft', b), broken);
  await page.evaluate(() => sessionStorage.setItem('idb-fail029', '0'));
  await page.reload();

  await expect(page.getByRole('heading', { name: 'Сохранённый проект повреждён' })).toBeVisible();
  await expect(page.getByText('Причина: Неверные данные комнаты: Глубина: от 1 до 50 м. Данные на устройстве не тронуты.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Повторить' })).toHaveCount(0);
  await expect(page.locator('.tabbar')).toHaveCount(0);
  expect((await errlog(page)).some((e) => e.ctx === 'черновик проекта не открылся; копия сохранена как draft-failed')).toBe(true);

  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Сохранить копию в файл' }).click()]);
  await expect(page.getByText('Файл проекта передан')).toBeVisible();
  expect(download.suggestedFilename()).toBe('Повреждённый.roomacoustics.json');
  const file = JSON.parse(readFileSync((await download.path())!, 'utf8'));
  expect(file.format).toBe('room-acoustics-project');
  expect(file.version).toBe(5);
  expect(file.project).toEqual(broken);

  // черновик не тронут ни отложенным сохранением, ни уходом со страницы; копия — и под draft-failed
  await leave(page);
  await quiet(page);
  expect(JSON.parse((await readDraft(page))!)).toEqual(broken);
  expect(JSON.parse((await readDraft(page, 'draft-failed'))!)).toEqual(broken);
  expect(await pending(page)).toBeNull();
  await fits(page, 'черновик повреждён');

  await page.getByRole('button', { name: 'Начать новый проект' }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('Чтобы не потерять его, сначала сохраните копию в файл.');
  await dialog.getByRole('button', { name: 'Начать новый проект' }).click();
  await expect(page.locator('.start-card')).toBeVisible();
  await expect.poll(async () => JSON.parse((await readDraft(page)) ?? 'null')?.id).not.toBe(broken.id);
  expect(JSON.parse((await readDraft(page, 'draft-failed'))!)).toEqual(broken);
});

test('029: удаление базы в другой вкладке не ждёт приложения; следующая запись выполняется', async ({ page }) => {
  await faultIdb(page, 0);
  await page.goto('/#projects');
  await expect(page.locator('#pname')).toBeVisible();
  // приложение уже работало с хранилищем: открыло проект и список сохранённых
  await expect(page.getByRole('heading', { name: 'Сохранённые' })).toBeVisible();
  const deleted = await page.evaluate(() => new Promise<string>((resolve, reject) => {
    const r = indexedDB.deleteDatabase('room-acoustics');
    r.onsuccess = () => resolve('удалена');
    r.onblocked = () => resolve('ждёт закрытия соединений');
    r.onerror = () => reject(r.error);
  }));
  expect(deleted).toBe('удалена');
  await page.locator('#pname').fill('После удаления базы');
  await expect.poll(async () => JSON.parse((await readDraft(page)) ?? 'null')?.name).toBe('После удаления базы');
  await page.reload();
  await expect(page.locator('.topbar__room')).toContainText('После удаления базы');
});
