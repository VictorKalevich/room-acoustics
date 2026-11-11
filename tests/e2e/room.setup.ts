// Большинство проверок начинает с готовой комнаты 5 × 4 × 2,5 м: 021 — расчёты открываются, когда комната
// создана; 022 — экраны по колонкам открываются, когда места выбраны. Комнату один раз создаёт ручная настройка
// по шагам; места — кнопка «Колонки стоят так» (места по умолчанию, как раньше). Сохраняются два состояния:
// <проект>-room.json — комната создана, места не выбраны; <проект>.json — и места выбраны.
import { expect, test as setup } from '@playwright/test';

setup('комната создана ручной настройкой, места выбраны', async ({ page }, info) => {
  const target = info.project.name === 'setup' ? 'iphone' : 'iphone-safari';
  await page.goto('/#room');
  await page.locator('.start-card').getByRole('button', { name: 'Настроить комнату вручную' }).click();
  await page.getByLabel('Глубина', { exact: true }).fill('5');
  await page.getByLabel('Ширина', { exact: true }).fill('4');
  await page.getByLabel('Высота', { exact: true }).fill('2,5');
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: /Далее/ }).click();
  await page.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByRole('button', { name: 'Конструктор комнаты' })).toBeVisible();
  // проект записывается через 300 мс после изменения
  await page.waitForTimeout(800);
  await page.context().storageState({ path: `tests/e2e/.auth/${target}-room.json`, indexedDB: true });
  await page.goto('/#manual');
  await page.getByRole('button', { name: 'Колонки стоят так — использовать эти места' }).click();
  await expect(page.getByRole('button', { name: 'Колонки стоят так — использовать эти места' })).toHaveCount(0);
  await page.waitForTimeout(800);
  await page.context().storageState({ path: `tests/e2e/.auth/${target}.json`, indexedDB: true });
});
