// V2-036: шумомер и анализатор спектра с тестовым микрофоном Chrome (синтетический сигнал браузера — только для
// проверки интерфейса): замер, Fast/Slow, остановка, сохранение в комнату; БПФ с окном и спектрограмма.
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
  await expect(levels.getByText('Сейчас (Fast), A')).toBeVisible();
  await expect.poll(async () => (await levels.textContent()) ?? '').toMatch(/Max \(Fast\)−?\d/);
  await page.getByRole('radio', { name: 'Slow' }).check();
  await expect(levels.getByText('Max (Slow)')).toBeVisible();
  await page.getByRole('button', { name: 'Стоп' }).click();
  await expect(page.getByRole('button', { name: 'Новый замер' })).toBeVisible();
  await page.getByRole('button', { name: 'Сохранить в комнату' }).click();
  await expect(page.getByText('Замер сохранён в комнату «Студия»')).toBeVisible();
  await page.getByRole('button', { name: 'Открыть' }).click();
  await expect(page).toHaveURL(/\/analysis\/measurements$/);
  await expect(page.getByRole('table', { name: 'Замеры комнаты' })).toContainText('Шум A');
});

test('059 · анализатор спектра: полосы, БПФ с окном и перекрытием, спектрограмма', async ({ page }) => {
  await firstRun(page);
  await page.goto('./#/tools/rta');
  await page.getByRole('button', { name: 'Начать' }).click();
  await expect(page.getByRole('img', { name: /^Спектрограмма, Z/ })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('list', { name: 'Шкала уровня, дБFS' })).toBeVisible();
  await page.getByRole('radio', { name: 'БПФ' }).check();
  await page.getByLabel('Окно').selectOption('flat-top');
  await page.getByLabel('Размер БПФ').selectOption('4096');
  await expect(page.getByText('Шаг БПФ')).toBeVisible();
  await expect(page.locator('.al-kv dd').first()).toHaveText(/^\d+,\d{2} Гц$/);
  await expect.poll(async () => Number((await page.locator('.al-kv').getByText(/^\d+$/).last().textContent()) ?? 0), { timeout: 10_000 }).toBeGreaterThan(2);
  await page.getByRole('button', { name: 'Стоп' }).click();
  await expect(page.getByRole('button', { name: 'Измерить искажения' })).toBeVisible();
});
