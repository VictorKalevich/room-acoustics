// V2-054: экспертный уровень подбора — неопределённость варианта (Монте-Карло против нынешней расстановки) и
// совместный подбор мест, сабвуферов и эквалайзера с переносом сочетания в эксперимент; на продвинутом уровне блоков нет.
import { test, expect, type Page } from '@playwright/test';

const block = (page: Page) => page.locator('.al-card').filter({ has: page.getByRole('heading', { name: 'Поиск с учётом закреплений' }) });
const go = (page: Page, s: string) => page.goto(page.url().replace(/#\/rooms\/([^/]+)\/.*$/, `#/rooms/$1/${s}`));

async function front(page: Page, level: RegExp) {
  await page.goto('./');
  await page.getByRole('radio', { name: level }).check();
  await page.getByRole('button', { name: 'Продолжить' }).click();
  await page.goto('./#/rooms/new');
  await page.getByLabel('Название').fill('Гостиная');
  await page.getByRole('button', { name: 'Создать', exact: true }).click();
  await page.waitForURL(/#\/rooms\/[^/]+\/model/);
  await go(page, 'advice/optimize');
  await block(page).getByRole('button', { name: 'Рассчитать' }).first().click();
  const t = page.getByRole('table', { name: 'Фронт Парето: оценка и перестановка' });
  await expect(t).toBeVisible({ timeout: 120_000 });
  return t;
}

test('059 · неопределённость и совместный подбор', async ({ page }) => {
  test.setTimeout(240_000);
  const t = await front(page, /Экспертный/);
  await t.getByRole('button', { name: /^Вариант \d+$/ }).last().click();

  const mc = page.locator('[aria-label="Неопределённость"]');
  await mc.getByLabel('Выборок').fill('20');
  await mc.getByLabel('Выборок').press('Enter');
  await mc.getByRole('button', { name: 'Рассчитать' }).click();
  await expect(mc.getByText('Разница: медиана (10–90 %)')).toBeVisible({ timeout: 120_000 });
  await expect(mc.getByText(/Вывод устойчив|Вывод неустойчив|Разница в пределах разброса/)).toBeVisible();
  await expect(mc.getByRole('img', { name: /^Разброс АЧХ: вариант \d+\./ })).toBeVisible();

  const joint = page.locator('[aria-label="Совместный подбор"]');
  await joint.getByRole('button', { name: 'Рассчитать' }).click();
  const rows = page.getByRole('table', { name: 'Совместный подбор: неровность по шагам' });
  await expect(rows).toBeVisible({ timeout: 180_000 });
  await expect(rows.getByRole('columnheader', { name: '+ сабвуферы' })).toBeVisible();
  expect(await rows.getByRole('row').count()).toBeGreaterThan(2);
  await joint.getByRole('button', { name: 'Перенести сочетание в эксперимент' }).click();
  await expect(page.getByRole('alertdialog')).toContainText(/коррекция комнаты — фильтров \d+|настройки сабвуферов/);
  await page.getByRole('alertdialog').getByRole('button', { name: 'В эксперимент' }).click();
  await expect(page.getByText('Перенесено в эксперимент; текущая конфигурация не изменилась')).toBeVisible();
});

test('059 · на продвинутом уровне неопределённости и совместного подбора нет', async ({ page }) => {
  test.setTimeout(180_000);
  await front(page, /Продвинутый/);
  await expect(page.locator('[aria-label="Неопределённость"]')).toHaveCount(0);
  await expect(page.locator('[aria-label="Совместный подбор"]')).toHaveCount(0);
});
