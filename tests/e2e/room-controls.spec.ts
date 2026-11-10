import { test, expect, type Page, type Locator } from '@playwright/test';

async function add(page: Page, name: string) {
  await page.getByRole('button', { name: 'Добавить проём', exact: true }).click();
  await page.getByRole('menuitem', { name, exact: true }).click();
  await expect(page.getByRole('menu')).toHaveCount(0);
}

async function aligned(a: Locator, b: Locator) {
  const first = await a.boundingBox(), second = await b.boundingBox();
  expect(Math.abs(first!.y + first!.height - second!.y - second!.height)).toBeLessThan(1);
}

test('adjacent fields stay aligned with wrapping labels and validation feedback', async ({ page }) => {
  await page.goto('/#voice');
  const height = page.getByLabel('Высота микрофона', { exact: true });
  const distance = page.getByLabel('От рта до микрофона', { exact: true });
  for (const width of [320, 393, 768]) {
    await page.setViewportSize({ width, height: 852 });
    await height.scrollIntoViewIfNeeded();
    await aligned(height, distance);
    await height.fill('1');
    await expect(height).toHaveAttribute('aria-invalid', 'true');
    await aligned(height, distance);
    await height.fill('160');
    await expect(height).toHaveAttribute('aria-invalid', 'false');
  }
  await page.evaluate(() => { location.hash = 'room'; });
  await page.setViewportSize({ width: 430, height: 932 });
  // Dimensions have hints under two controls, but none under the third.
  await aligned(page.getByLabel('Глубина', { exact: true }), page.getByLabel('Высота', { exact: true }));
});

test('wall picker creates presets, keeps edited sizes and separates cards from actions', async ({ page }) => {
  await page.goto('/#room');
  await add(page, 'Окно');
  const window = page.locator('.wall-items .zone-card').filter({ has: page.getByLabel('Окно 1: стена', { exact: true }) });
  await expect(window.getByLabel('Ширина', { exact: true })).toHaveValue('1,3');
  await expect(window.getByLabel('Низ над полом', { exact: true })).toHaveValue('0,9');
  await expect(window.getByLabel('Верх над полом', { exact: true })).toHaveValue('2,3');
  await window.getByLabel('Ширина', { exact: true }).fill('1,7');
  await add(page, 'Дверь');
  const door = page.locator('.wall-items .zone-card').filter({ has: page.getByLabel('Дверь 2: стена', { exact: true }) });
  await expect(door.getByLabel('Ширина', { exact: true })).toHaveValue('0,8');
  await expect(door.getByLabel('Высота', { exact: true })).toHaveValue('2');
  await add(page, 'Проём без двери');
  const opening = page.locator('.wall-items .zone-card').filter({ has: page.getByLabel('Проём 1: стена', { exact: true }) });
  await expect(opening.getByLabel('Ширина', { exact: true })).toHaveValue('0,9');
  await expect(opening.getByLabel('Высота', { exact: true })).toHaveValue('2,1');
  await expect(window.getByLabel('Ширина', { exact: true })).toHaveValue('1,7');
  for (const width of [320, 393, 1024]) {
    await page.setViewportSize({ width, height: 852 });
    const gaps = await page.locator('.wall-items').evaluate(el => {
      const cards = Array.from(el.children).map(card => card.getBoundingClientRect());
      const action = el.nextElementSibling!.getBoundingClientRect();
      return [...cards.slice(1).map((card, i) => card.top - cards[i].bottom), action.top - cards[cards.length - 1].bottom];
    });
    for (const gap of gaps) expect(gap).toBeGreaterThanOrEqual(11);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await door.getByLabel('Что это', { exact: true }).selectOption('arch');
  const converted = page.locator('.wall-items .zone-card').filter({ has: page.getByLabel('Проём 2: стена', { exact: true }) });
  await expect(converted.getByLabel('Ширина', { exact: true })).toHaveValue('0,8');
  await expect(converted.getByLabel('Высота', { exact: true })).toHaveValue('2');
  await converted.getByRole('button', { name: 'Удалить', exact: true }).click();
  await expect(page.locator('.wall-items .zone-card')).toHaveCount(2);
  await page.waitForTimeout(500); // project autosave debounce
  await page.reload();
  await expect(window.getByLabel('Ширина', { exact: true })).toHaveValue('1,7');
});

test('picker supports keyboard and dismissal; new items fit a small room', async ({ page }) => {
  await page.goto('/#room');
  for (const label of ['Глубина', 'Ширина', 'Высота']) await page.getByLabel(label, { exact: true }).fill('1');
  const trigger = page.getByRole('button', { name: 'Добавить проём', exact: true });
  await trigger.focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: 'Окно', exact: true })).toBeFocused();
  await page.keyboard.press('End');
  await expect(page.getByRole('menuitem', { name: 'Проём без двери', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(page.getByRole('menuitem', { name: 'Дверь', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await trigger.click();
  await page.getByRole('heading', { name: 'Окна, двери и проёмы', exact: true }).click();
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(page.locator('.wall-items .zone-card')).toHaveCount(0);
  for (const name of ['Окно', 'Дверь', 'Проём без двери']) await add(page, name);
  for (const card of await page.locator('.wall-items .zone-card').all()) {
    const read = async (label: string) => Number((await card.getByLabel(label, { exact: true }).inputValue()).replace(',', '.'));
    expect(await read('Отступ') + await read('Ширина')).toBeLessThanOrEqual(1.001);
    const window = await card.getByLabel('Верх над полом', { exact: true }).count();
    expect(await read(window ? 'Верх над полом' : 'Высота')).toBeLessThanOrEqual(1);
  }
});
