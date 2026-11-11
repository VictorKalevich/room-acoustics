// 021: расчёты доступны, когда комната создана. Большинство проверок начинает с готовой комнаты
// 5 × 4 × 2,5 м — её один раз создаёт ручная настройка по шагам, состояние браузера сохраняется в файл.
import { expect, test as setup } from '@playwright/test';

setup('комната создана ручной настройкой', async ({ page }, info) => {
  await page.goto('/#room');
  await page.locator('.start-card').getByRole('button', { name: 'Настроить комнату вручную' }).click();
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: /Далее/ }).click();
  await page.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByRole('button', { name: 'Конструктор комнаты' })).toBeVisible();
  // проект записывается через 300 мс после изменения
  await page.waitForTimeout(800);
  await page.context().storageState({ path: `tests/e2e/.auth/${info.project.name}.json`, indexedDB: true });
});
