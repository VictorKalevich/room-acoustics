// V2-036: шумомер с тестовым микрофоном Chrome (синтетический сигнал браузера — только для проверки интерфейса):
// замер, остановка, сохранение в комнату, запись в разделе «Измерения» с привязкой к конфигурации.
import { test, expect, type Page } from '@playwright/test';

test.use({ launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] }, permissions: ['microphone'] });

async function firstRun(page: Page) {
  await page.goto('./');
  await page.getByRole('radio', { name: /Простой/ }).check();
  await page.getByRole('button', { name: 'Продолжить' }).click();
}

async function createRoom(page: Page, name: string) {
  await page.goto('./#/rooms/new');
  await page.getByLabel('Название').fill(name);
  await page.getByRole('button', { name: 'Создать', exact: true }).click();
  await expect(page.locator('.al-plan__object').first()).toBeVisible();
}

test('059 · шумомер: замер с микрофона, сохранение в комнату, запись в разделе «Измерения»', async ({ page }) => {
  await firstRun(page);
  await createRoom(page, 'Студия');
  await page.goto('./#/tools/noise-meter');
  await page.getByRole('button', { name: 'Начать замер' }).click();
  const levels = page.getByRole('list', { name: 'Уровни' });
  await expect(levels).toBeVisible();
  await expect(levels.getByText(/Leq за замер/)).toBeVisible();
  await expect.poll(async () => (await levels.textContent()) ?? '', { timeout: 15_000 }).toMatch(/L50−?\d/);
  await page.getByRole('button', { name: 'Стоп' }).click();
  await expect(page.getByRole('button', { name: 'Новый замер' })).toBeVisible();
  await page.getByRole('button', { name: 'Сохранить в комнату' }).click();
  await expect(page.getByText('Замер сохранён в комнату «Студия»')).toBeVisible();
  await page.getByRole('button', { name: 'Открыть' }).click();
  await expect(page).toHaveURL(/\/analysis\/measurements$/);
  await expect(page.getByRole('table', { name: 'Замеры комнаты' })).toContainText('Шум A');
});
