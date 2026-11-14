import { readFileSync } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';

// 028: сбой отрисовки не выводит приложение из строя. Сбой вызывается без тестовых веток в приложении: до загрузки
// страницы подменяется встроенный метод, который при отрисовке вызывает только проверяемая часть.

/** Сбой «Комнаты»: IntersectionObserver создаёт только блок скана на обзоре комнаты (ScanPanel), в эффекте. */
const failRoom = (page: Page) => page.addInitScript(() => {
  const w = window as unknown as { failRoom028: boolean; IntersectionObserver: typeof IntersectionObserver };
  w.failRoom028 = true;
  const IO = w.IntersectionObserver;
  w.IntersectionObserver = class extends IO {
    constructor(cb: IntersectionObserverCallback, o?: IntersectionObserverInit) {
      if (w.failRoom028) throw new Error('проверка 028: сбой раздела «Комната»');
      super(cb, o);
    }
  };
});

/** Сбой оболочки: элемент <header> создаёт только шапка App (Preact 11 создаёт элементы через createElementNS). */
const failShell = (page: Page) => page.addInitScript(() => {
  const orig = Document.prototype.createElementNS;
  Document.prototype.createElementNS = function (this: Document, ...args: unknown[]) {
    if (args[1] === 'header' && sessionStorage.getItem('fail-shell') === '1') throw new Error('проверка 028: сбой оболочки');
    return (orig as (...a: unknown[]) => Element).apply(this, args);
  } as typeof orig;
});

const errlog = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('ra-errors') ?? '[]') as { msg: string; ctx?: string }[]);
const tab = (page: Page, name: string) => page.locator('.tabbar').getByRole('button', { name, exact: true });
const menu = async (page: Page, item: string) => {
  await page.getByRole('button', { name: 'Открыть меню' }).click();
  await page.locator('.drawer__item', { hasText: item }).click();
};

/** Сообщение помещается без горизонтальной прокрутки на 320 и 393 px в светлой и тёмной темах. */
async function fits(page: Page, what: string) {
  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme });
    for (const width of [320, 393]) {
      await page.setViewportSize({ width, height: 852 });
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), { message: `${what}: ${theme} ${width}` }).toBe(true);
      expect(await page.evaluate(() => getComputedStyle(document.body).color)).toBe(theme === 'dark' ? 'rgb(228, 234, 236)' : 'rgb(23, 34, 43)');
      await expect(page.locator('[role=alert] .panel .small').first()).toHaveCSS('font-size', '14px');
    }
  }
  await page.emulateMedia({ colorScheme: 'light' });
  await page.setViewportSize({ width: 393, height: 852 });
}

test('028: проект с результатом подбора неверной формы открывается — содержимое, нижняя панель, подбор заново', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // воспроизведение из описания шага: запись читается при запуске раньше черновика из IndexedDB
  await page.addInitScript(() => {
    if (sessionStorage.getItem('poisoned')) return;
    sessionStorage.setItem('poisoned', '1');
    localStorage.setItem('ra-draft-pending', JSON.stringify({ id: 'poison', name: 'Проверка', room: {}, roomReady: true, result: { best: 'x', baseline: 5 } }));
  });
  await page.goto('/#placement');
  await expect(page.locator('main.content')).toBeVisible();
  await expect(page.locator('.tabbar')).toBeVisible();
  await expect(page.locator('.topbar__room')).toContainText('Проверка');
  await expect(page.getByRole('button', { name: 'Подобрать расстановку' })).toBeVisible();
  // результата нет: кнопка предлагает подбор, а не «Пересчитать»
  await expect(page.getByRole('button', { name: 'Пересчитать' })).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.tabbar')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Подобрать расстановку' })).toBeVisible();
  // по адресу «Проекты» — тоже (новая загрузка документа)
  await page.goto('/?again#projects');
  await expect(page.locator('#pname')).toHaveValue('Проверка');
  await expect(page.locator('.tabbar')).toBeVisible();
  await expect(page.locator('.panel', { hasText: 'Раздел не открылся' })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('028: результат настоящего подбора после сохранения и открытия совпадает с исходным', async ({ page }) => {
  await page.goto('/#placement');
  await page.getByRole('button', { name: 'Подобрать расстановку' }).click();
  const hero = page.locator('.panel--hero');
  await expect(hero.locator('.pos-table')).toBeVisible({ timeout: 30_000 });
  const shown = async () => [
    await hero.locator('.tabs').innerText(),
    await hero.locator('.score').first().innerText(),
    await hero.locator('.pos-table').innerText(),
    await hero.getByText(/^Проверено/).innerText(),
  ];
  const before = await shown();
  await page.reload();
  await expect(hero.locator('.pos-table')).toBeVisible();
  expect(await shown()).toEqual(before);
});

test('028: сбой скрытого раздела не трогает остальные разделы и меню; на его месте — сообщение; «Попробовать снова»', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await failRoom(page);
  await page.goto('/#placement');
  // «Комната» смонтирована всегда и упала скрытой: сообщение есть, но не видно
  const hidden = page.locator('.panel', { hasText: 'Раздел не открылся' });
  await expect(hidden).toHaveCount(1);
  await expect(hidden).toBeHidden();
  await expect(page.getByRole('button', { name: 'Подобрать расстановку' })).toBeVisible();
  await expect(page.locator('.tabbar')).toBeVisible();
  await menu(page, 'Помощник и словарь');
  await expect(page.locator('.topbar__title')).toHaveText('Помощник и словарь');
  await tab(page, 'Анализ').click();
  await expect(page.locator('.modes-switch')).toBeVisible();

  await tab(page, 'Комната').click();
  const failure = page.getByRole('heading', { name: 'Раздел не открылся' });
  await expect(failure).toBeVisible();
  await expect(page.getByText('Ошибка записана в журнал. Проект не удалён.')).toBeVisible();
  await expect(page.locator('.tabbar')).toBeVisible();
  await expect(page.locator('.topbar__title')).toHaveText('Комната');
  expect((await errlog(page)).some((e) => e.ctx === 'экран «Комната»' && e.msg.includes('проверка 028'))).toBe(true);
  await fits(page, 'сообщение раздела');

  // «Сообщить о проблеме» — существующий блок в «О приложении», ошибка уже в журнале
  await page.getByRole('button', { name: 'Сообщить о проблеме' }).click();
  await expect(page.locator('.topbar__title')).toHaveText('О приложении');
  await expect(page.getByTestId('errlog-count')).toContainText('Записано ошибок');
  await tab(page, 'Комната').click();
  await expect(failure).toBeVisible();
  // причина не устранена — снова сообщение; устранена — раздел возвращается
  await page.getByRole('button', { name: 'Попробовать снова' }).click();
  await expect(failure).toBeVisible();
  await page.evaluate(() => { (window as unknown as { failRoom028: boolean }).failRoom028 = false; });
  await page.getByRole('button', { name: 'Попробовать снова' }).click();
  await expect(page.getByRole('button', { name: 'Конструктор комнаты' })).toBeVisible();
  await expect(page.locator('.panel', { hasText: 'Раздел не открылся' })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('028: «Экспортировать проект» из сообщения выдаёт файл, который открывается импортом', async ({ page }) => {
  await failRoom(page);
  await page.goto('/#room');
  await expect(page.getByRole('heading', { name: 'Раздел не открылся' })).toBeVisible();
  const name = (await page.locator('.topbar__room').innerText()).split(',')[0];
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Экспортировать проект' }).click()]);
  await expect(page.getByText('Файл проекта передан')).toBeVisible();
  const file = (await download.path())!;
  const data = JSON.parse(readFileSync(file, 'utf8'));
  expect(data.format).toBe('room-acoustics-project');
  expect(data.project.name).toBe(name);
  // тот же экспорт, что в «Проектах»: время последнего экспорта запомнено
  await menu(page, 'Проекты');
  await expect(page.getByText(/Последний экспорт в файл:/)).toBeVisible();
  await page.locator('#pname').fill('Другое имя');
  await page.locator('input[type=file][accept^=".json"]').setInputFiles(file);
  await page.getByRole('alertdialog').getByRole('button', { name: 'Открыть проект' }).click();
  await expect(page.locator('.topbar__room')).toContainText(`${name}, 5,00 × 4,00 × 2,50`);
});

test('028: сбой оболочки — сообщение вместо пустой страницы; «Перезагрузить», экспорт и «Начать новый проект»', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await failShell(page);
  await page.goto('/#placement');
  await expect(page.locator('.tabbar')).toBeVisible();
  const name = (await page.locator('.topbar__room').innerText()).split(',')[0];
  await page.evaluate(() => sessionStorage.setItem('fail-shell', '1'));
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Приложение не открылось' })).toBeVisible();
  await expect(page.getByText('Ошибка записана в журнал. Проект не удалён.')).toBeVisible();
  await expect(page.locator('.topbar')).toHaveCount(0);
  await expect(page.locator('.tabbar')).toHaveCount(0);
  expect((await errlog(page)).some((e) => e.ctx === 'оболочка приложения' && e.msg.includes('проверка 028'))).toBe(true);
  await fits(page, 'сообщение оболочки');

  // рабочий проект с устройства
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Экспортировать проект' }).click()]);
  expect(JSON.parse(readFileSync((await download.path())!, 'utf8')).project.name).toBe(name);
  await expect(page.getByText('Файл проекта передан')).toBeVisible();

  // причина устранена — «Перезагрузить» открывает приложение с тем же проектом
  await page.evaluate(() => sessionStorage.removeItem('fail-shell'));
  await page.getByRole('button', { name: 'Перезагрузить' }).click();
  await expect(page.locator('.tabbar')).toBeVisible();
  await expect(page.locator('.topbar__room')).toContainText(name);

  // «Начать новый проект» — только после подтверждения
  await page.evaluate(() => sessionStorage.setItem('fail-shell', '1'));
  await page.reload();
  const start = page.locator('[role=alert]').getByRole('button', { name: 'Начать новый проект' });
  await start.click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('Проекты, сохранённые в «Проектах», останутся');
  await dialog.getByRole('button', { name: 'Отмена' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Приложение не открылось' })).toBeVisible();
  await page.evaluate(() => sessionStorage.removeItem('fail-shell'));
  await start.click();
  await dialog.getByRole('button', { name: 'Начать новый проект' }).click();
  await expect(page.locator('.start-card')).toBeVisible();
  await expect(page.locator('.tabbar')).toHaveCount(0);
  expect(errors).toEqual([]);
});
