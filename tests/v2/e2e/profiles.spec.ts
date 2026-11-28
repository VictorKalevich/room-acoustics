// V2-047: профили материалов и оборудования — создание и версии в «Моих данных», свой материал поверхности с
// ближайшим справочным для ядра, профиль источника: сохранить экземпляр, новая версия, обновление по кнопке.
import { test, expect, type Page } from '@playwright/test';

async function start(page: Page): Promise<string> {
  await page.goto('./');
  await page.getByRole('radio', { name: /Продвинутый/ }).check();
  await page.getByRole('button', { name: 'Продолжить' }).click();
  await page.goto('./#/rooms/new');
  await page.getByLabel('Название').fill('Гостиная');
  await page.getByRole('button', { name: 'Создать', exact: true }).click();
  await expect(page.locator('.al-plan__object').first()).toBeVisible();
  return page.url();
}

const sub = (page: Page) => page.locator('.al-plan__object').filter({ has: page.locator('xpath=self::*[starts-with(@aria-label, "Сабвуфер 1 (сабвуфер)")]') });

test('059 · профили: свой материал и профиль сабвуфера с новой версией', async ({ page }) => {
  test.setTimeout(120_000);
  const roomUrl = await start(page);

  await page.goto('./#/library/materials');
  await page.getByRole('button', { name: 'Новый материал' }).click();
  const sheet = page.getByRole('dialog');
  await sheet.getByLabel('Название').fill('Войлок');
  await sheet.getByLabel('Заполнить из справочника').selectOption({ label: 'Акустические панели 50 мм' });
  await expect(sheet.getByRole('button', { name: 'Создать профиль' })).toBeDisabled();
  await sheet.getByLabel('Источник данных').fill('паспорт производителя');
  await sheet.getByRole('button', { name: 'Создать профиль' }).click();
  await expect(page.getByText('Профиль создан')).toBeVisible();
  await sheet.getByRole('button', { name: 'Закрыть' }).click();
  await expect(page.getByRole('list', { name: 'Акустические материалы' })).toContainText('Войлок');

  await page.goto(roomUrl);
  await page.getByRole('link', { name: 'Помещение' }).click();
  await page.getByLabel('Левая стена', { exact: true }).selectOption({ label: 'Мой: Войлок' });
  await expect(page.getByText(/^Свой материал, версия 1\. В расчёте ядра — «Акустические панели 50 мм» \(α расходится до 0,00\)\./)).toBeVisible();

  await page.getByRole('link', { name: 'Модель: обзор' }).click();
  await sub(page).click();
  const block = page.getByRole('group', { name: 'Профиль оборудования' });
  await expect(block).toContainText('Профиль не выбран');
  await block.getByRole('button', { name: 'Сохранить как профиль' }).click();
  await expect(block).toContainText('Профиль «Сабвуфер 1», версия 1.');

  await page.goto('./#/library/equipment');
  await page.getByRole('button', { name: 'Изменить «Сабвуфер 1»' }).click();
  const eq = page.getByRole('dialog');
  await eq.getByLabel('Нижняя граница').fill('18');
  await eq.getByLabel('Нижняя граница').press('Enter');
  await eq.getByLabel('Что изменено').fill('Новый паспорт');
  await eq.getByRole('button', { name: 'Сохранить версию' }).click();
  await expect(page.getByText('Профиль сохранён')).toBeVisible();
  await expect(eq.getByRole('list', { name: 'Версии профиля' }).getByRole('listitem')).toHaveCount(2);
  await expect(eq.getByRole('list', { name: 'Версии профиля' })).toContainText('Версия 2');
  await eq.getByRole('button', { name: 'Закрыть' }).click();

  await page.goto(roomUrl);
  await sub(page).click();
  await expect(block).toContainText('есть версия 2');
  await block.getByRole('button', { name: 'Обновить до версии 2' }).click();
  await expect(block).toContainText('Профиль «Сабвуфер 1», версия 2.');
  await expect(page.getByTestId('properties').getByLabel('Нижняя граница')).toHaveValue('18');
});
