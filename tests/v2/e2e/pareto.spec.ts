// V2-050: поиск с учётом закреплений — закреплённый сабвуфер не двигается, фронт Парето, чувствительность варианта,
// перенос в эксперимент; запрет перемещать оборудование оставляет подвижным только слушателя.
import { test, expect, type Page } from '@playwright/test';

const obj = (page: Page, name: string) => page.locator('.al-plan__object').filter({ has: page.locator(`xpath=self::*[starts-with(@aria-label, "${name}")]`) });
const block = (page: Page) => page.locator('.al-card').filter({ has: page.getByRole('heading', { name: 'Поиск с учётом закреплений' }) });

test('059 · поиск с учётом закреплений и фронт Парето', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('./');
  await page.getByRole('radio', { name: /Продвинутый/ }).check();
  await page.getByRole('button', { name: 'Продолжить' }).click();
  await page.goto('./#/rooms/new/manual');
  await page.getByLabel('Название').fill('Гостиная');
  await page.getByRole('button', { name: 'Создать', exact: true }).click();
  const sub = obj(page, 'Сабвуфер 1 (сабвуфер)');
  await sub.focus();
  await page.keyboard.press('Enter');
  await page.getByTestId('properties').getByRole('switch', { name: 'Закрепить' }).click();
  await expect(sub).toHaveAttribute('aria-label', /закреп/i);
  const subAt = await sub.getAttribute('aria-label');
  const go = (s: string) => page.goto(page.url().replace(/#\/rooms\/([^/]+)\/.*$/, `#/rooms/$1/${s}`));

  await go('advice/optimize');
  const b = block(page);
  await expect(b.getByText('Закреплены: Сабвуфер 1.')).toBeVisible();
  await b.getByRole('button', { name: 'Рассчитать' }).click();
  const front = page.getByRole('table', { name: 'Фронт Парето: оценка и перестановка' });
  await expect(front).toBeVisible({ timeout: 120_000 });
  await expect(front.getByRole('button', { name: 'Как сейчас' })).toBeVisible();
  await expect(front).not.toContainText('сабвуфер 1');
  const rows = await front.getByRole('row').count();
  expect(rows).toBeGreaterThan(2);
  await front.getByRole('button', { name: /^Вариант \d+$/ }).last().click();
  await b.getByRole('button', { name: 'Рассчитать' }).click();
  await expect(page.getByRole('table', { name: /^Чувствительность: вариант \d+$/ })).toBeVisible({ timeout: 60_000 });
  await b.getByRole('button', { name: 'Перенести в эксперимент' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'В эксперимент' }).click();
  await expect(page.getByText('Перенесено в эксперимент; текущая конфигурация не изменилась')).toBeVisible();

  await go('model');
  await expect(page.locator('.al-topbar__context')).toHaveText('Эксперимент');
  await expect(sub).toHaveAttribute('aria-label', subAt!);

  await go('advice/goals');
  await page.getByRole('switch', { name: 'Оборудование можно двигать' }).click();
  await go('advice/optimize');
  await expect(block(page).getByText('Оборудование перемещать нельзя (ограничение комнаты): колонки и сабвуферы не меняются.')).toBeVisible();
});
