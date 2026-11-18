import { test, expect } from '@playwright/test';
import { openDetail, showDetail, closeDetails, fitsWidth, roomOnlyState } from './helpers';

test.describe('049: контекстное действие', () => {
  test.use({ storageState: roomOnlyState, viewport: { width: 402, height: 874 } });
  test('подбор, применение и пересчёт доступны над навигацией при прокрутке', async ({ page }) => {
    await page.goto('/#placement');
    const dock = page.getByRole('region', { name: 'Основное действие', exact: true });
    await expect(page.locator('svg.plan:visible')).toBeInViewport({ ratio: 0.5 });
    await dock.getByRole('button', { name: 'Подобрать расстановку', exact: true }).click();
    await expect(dock.getByRole('button', { name: 'Дальше: «Настройка»' })).toBeVisible({ timeout: 30000 });
    await page.getByRole('tab', { name: 'Вариант 2' }).click();
    await dock.getByRole('button', { name: 'Использовать этот вариант' }).click();
    await expect(dock.getByRole('button', { name: 'Дальше: «Настройка»' })).toBeVisible();
    await showDetail(page, 'Система и цель подбора', 'Цель и точность');
    await page.getByLabel('Что искать', { exact: true }).selectOption('lowDips');
    await expect(dock).toBeHidden();
    await closeDetails(page);
    await expect(dock).toContainText('Параметры изменились');
    const recalc = dock.getByRole('button', { name: 'Пересчитать', exact: true });
    for (const bottom of [true, false]) {
      await page.evaluate(b => scrollTo(0, b ? document.documentElement.scrollHeight : 0), bottom);
      await expect(recalc).toBeInViewport();
      const action = (await dock.boundingBox())!, tabs = (await page.locator('.tabbar').boundingBox())!;
      expect(action.y + action.height).toBeLessThanOrEqual(tabs.y + 1);
      expect((await recalc.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    await recalc.click();
    await expect(dock).not.toContainText('Параметры изменились', { timeout: 30000 });
    await expect(dock.getByRole('button')).toBeEnabled();
  });
});

test('049: вложенные настройки возвращают фокус и прокрутку, Escape закрывает только верхнюю панель', async ({ page }) => {
  await page.goto('/#manual');
  const entry = page.locator('.setting-link:visible').filter({ hasText: 'Система и цель подбора' });
  await entry.scrollIntoViewIfNeeded();
  const y = await page.evaluate(() => scrollY);
  await openDetail(page, 'Система и цель подбора');
  const equipment = await openDetail(page, 'Оборудование');
  await page.keyboard.press('Shift+Tab');
  await expect(equipment.locator(':scope > header button')).not.toBeFocused();
  expect(await equipment.evaluate(el => el.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(equipment).toBeHidden();
  await expect(page.getByRole('dialog', { name: 'Система и цель подбора', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Оборудование/ })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(entry).toBeFocused();
  await expect.poll(() => page.evaluate(() => document.body.style.position)).toBe('');
  expect(Math.abs(await page.evaluate(() => scrollY) - y)).toBeLessThan(2);
});

test('049: открытие подробностей сохраняет карту и не запускает вычислительные задачи', async ({ page }) => {
  await page.addInitScript(() => {
    const original = Worker.prototype.postMessage;
    const w = window as unknown as { jobs049: string[] };
    w.jobs049 = [];
    Worker.prototype.postMessage = function (message: unknown, options?: StructuredSerializeOptions | Transferable[]) {
      const type = (message as { type?: string })?.type;
      if (type) w.jobs049.push(type);
      return Reflect.apply(original, this, [message, options]);
    };
  });
  await page.goto('/#voice');
  await expect(page.getByTestId('voice-map-best')).toContainText(/дБ/, { timeout: 20000 });
  await expect(page.getByTestId('voice-flatness').locator('.score__value')).not.toHaveText('…');
  const heat = await page.locator('svg.plan:visible .plan__heat').innerHTML();
  const jobs = () => page.evaluate(() => (window as unknown as { jobs049: string[] }).jobs049);
  const before = await jobs();
  for (const title of ['Показатели и спектр', 'Лучшие места', 'Микрофон и голос']) {
    await showDetail(page, title);
    await closeDetails(page);
  }
  expect(await jobs()).toEqual(before);
  expect(await page.locator('svg.plan:visible .plan__heat').innerHTML()).toBe(heat);
});

test('049: панели помещаются на 320/402/1280 px, в обеих темах и при увеличенном тексте', async ({ page }) => {
  await page.goto('/#voice');
  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme });
    for (const width of [320, 402, 1280]) {
      await page.setViewportSize({ width, height: 874 });
      for (const title of ['Микрофон и голос', 'Показатели и спектр', 'Лучшие места']) {
        await showDetail(page, title);
        await expect.poll(() => fitsWidth(page)).toBe(true);
        const body = page.locator('.detail-page:visible').last().locator(':scope > .detail-page__body');
        expect(await body.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      }
    }
  }
  // Font enlargement, not a claim about a physical iPhone or its virtual keyboard.
  await page.setViewportSize({ width: 320, height: 874 });
  await page.addStyleTag({ content: ':root { --text-body: 24px; --text-small: 21px; --text-heading: 28px; --text-control: 23px; --text-input: 26px; }' });
  await showDetail(page, 'Микрофон и голос');
  await expect.poll(() => fitsWidth(page)).toBe(true);
  expect(await page.locator('.detail-page:visible').last().evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
});

test('049: мини-плеер остаётся управляемым над подэкраном и не перекрывает основное действие', async ({ page }) => {
  await page.goto('/#analysis/list');
  test.skip(!await page.evaluate(() => typeof AudioContext !== 'undefined'), 'Web Audio unavailable in this WebKit build.');
  await showDetail(page, 'Все моды');
  await page.locator('.modes-table .play-btn').first().click();
  const player = page.locator('.miniplayer');
  await expect(player.getByRole('button', { name: 'Стоп', exact: true })).toBeVisible();
  await closeDetails(page);
  await page.getByRole('navigation', { name: 'Разделы', exact: true }).getByRole('button', { name: 'Расстановка' }).click();
  const dock = page.getByRole('region', { name: 'Основное действие', exact: true });
  await expect(dock).toBeVisible();
  const a = (await dock.boundingBox())!, p = (await player.boundingBox())!;
  expect(a.y + a.height).toBeLessThanOrEqual(p.y);
  await showDetail(page, 'Система и цель подбора');
  await expect(dock).toBeHidden();
  await player.getByRole('button', { name: 'Стоп', exact: true }).click();
  await expect(player).toHaveCount(0);
});
