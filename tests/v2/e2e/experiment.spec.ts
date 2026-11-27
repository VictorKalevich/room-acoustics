// V2-026–V2-030: эксперимент — создание, независимая правка, сравнение с расчётом ядра, подтверждение со снимком,
// снимки и восстановление в эксперимент, удаление с отменой.
import { test, expect, type Page } from '@playwright/test';

async function start(page: Page) {
  await page.goto('./');
  await page.getByRole('radio', { name: /Простой/ }).check();
  await page.getByRole('button', { name: 'Продолжить' }).click();
  await page.goto('./#/rooms/new');
  await page.getByLabel('Название').fill('Гостиная');
  await page.getByRole('button', { name: 'Создать', exact: true }).click();
  await expect(page.locator('.al-plan__object').first()).toBeVisible();
}

const left = (page: Page) => page.locator('.al-plan__object[aria-label^="L (колонка)"]');
const config = (page: Page) => page.getByRole('radiogroup', { name: 'Конфигурация' });

test('059 · эксперимент: независимая правка, сравнение, подтверждение, снимок', async ({ page }) => {
  await start(page);
  await expect(page.getByText('Эксперимента нет')).toBeVisible();
  await page.getByRole('button', { name: 'Создать эксперимент' }).click();
  await expect(config(page).getByRole('radio', { name: 'Эксперимент' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('.al-topbar__context')).toHaveText('Эксперимент');
  await expect(page.getByText('Вы меняете эксперимент')).toBeVisible();

  const before = await left(page).getAttribute('aria-label');
  await left(page).focus();
  await page.keyboard.press('Shift+ArrowDown');
  await expect(left(page)).not.toHaveAttribute('aria-label', before!);
  const moved = await left(page).getAttribute('aria-label');

  await config(page).getByRole('radio', { name: 'Текущая' }).click();
  await expect(left(page)).toHaveAttribute('aria-label', before!);
  await config(page).getByRole('radio', { name: 'Эксперимент' }).click();
  await expect(left(page)).toHaveAttribute('aria-label', moved!);

  await page.getByRole('link', { name: 'Сравнить' }).click();
  await expect(page).toHaveURL(/\/model\/compare$/);
  await expect(page.getByRole('group', { name: /Эксперимент относительно/ })).toContainText('Левая колонка: перемещение на 25 см');
  const table = page.getByRole('table', { name: 'Показатели расчёта' });
  await expect(table).toBeVisible({ timeout: 30_000 });
  await expect(table.getByRole('row', { name: /Общая оценка/ })).toBeVisible();
  await expect(page.getByRole('img', { name: /АЧХ в месте слушателя: Текущая и Эксперимент/ }).or(page.getByText('АЧХ в месте слушателя: Текущая и Эксперимент'))).toHaveCount(1);

  await page.getByRole('button', { name: 'Сделать фактической' }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Сделать эксперимент фактическим?' });
  await expect(dialog.getByRole('group', { name: 'Что изменится' })).toContainText('Левая колонка: перемещение на 25 см');
  await dialog.getByRole('button', { name: 'Сделать фактической' }).click();
  await expect(page.getByText('Эксперимента нет')).toBeVisible();
  await expect(page.locator('.al-topbar__context')).toHaveText('Текущая конфигурация');

  await page.goto(page.url().replace(/model\/compare$/, 'model/history'));
  const snaps = page.getByRole('table', { name: 'Снимки конфигурации' });
  await expect(snaps.getByText('Перед подтверждением эксперимента')).toBeVisible();
  await page.getByRole('button', { name: 'Сохранить снимок' }).click();
  await expect(snaps.getByText('Вручную')).toBeVisible();

  await snaps.getByRole('row').filter({ hasText: 'Перед подтверждением эксперимента' }).getByRole('button', { name: /в эксперимент/ }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'В эксперимент' }).click();
  await expect(config(page).getByRole('radio', { name: 'Эксперимент' })).toHaveAttribute('aria-checked', 'true');
  await page.reload();
  await expect(config(page)).toBeVisible();
});

test('059 · эксперимент: удаление с отменой, отставание от текущей, сравнение снимка', async ({ page }) => {
  await start(page);
  await page.getByRole('button', { name: 'Создать эксперимент' }).click();
  await config(page).getByRole('radio', { name: 'Текущая' }).click();
  await left(page).focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByText('Текущая конфигурация изменилась после создания эксперимента')).toBeVisible();

  await page.getByRole('button', { name: 'Удалить эксперимент' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Удалить' }).click();
  await expect(page.getByText('Эксперимента нет')).toBeVisible();
  await page.locator('.al-toast').filter({ hasText: 'Эксперимент удалён' }).getByRole('button', { name: 'Отменить' }).click();
  await expect(config(page)).toBeVisible();

  await page.goto(page.url().replace(/model.*$/, 'model/history'));
  await page.getByRole('button', { name: 'Сохранить снимок' }).click();
  await page.getByRole('button', { name: /^Сравнить снимок от/ }).click();
  await expect(page).toHaveURL(/\/model\/compare$/);
  await expect(page.getByLabel('Что сравнить')).toHaveValue(/^snapshot:/);
  await expect(page.getByText('Конфигурации совпадают.')).toBeVisible();
});
