import { test, expect } from '@playwright/test';

// 026: точность расчёта — общая настройка проекта; узкое сглаживание доступно только при подробных данных
test('точность расчёта открывает сглаживание 1/24 и 1/48, предупреждает о времени и общая для расстановки и голоса', async ({ page }) => {
  await page.goto('/#manual');
  const manual = page.locator('.smoothed-chart[data-screen="placement-manual"]');
  await expect(manual.getByRole('slider')).toHaveValue('1', { timeout: 20000 });
  await expect(manual.getByRole('button', { name: 'Сглаживание 1/24', exact: true })).toHaveCount(0);
  const score = page.locator('.score__value:visible').first();
  await expect(score).not.toHaveText('…');

  await page.getByRole('radio', { name: 'Максимальная', exact: true }).click();
  await expect(page.getByText('Расчёты идут в 3–4 раза дольше', { exact: false })).toBeVisible();
  await expect(manual.getByRole('button', { name: 'Сглаживание 1/48', exact: true })).toBeVisible();
  await expect(manual.getByRole('button', { name: 'Сглаживание 1/24', exact: true })).toBeVisible();
  // прежний выбор (1/12) сохранился: теперь это четвёртая точка из семи
  await expect(manual.getByRole('slider')).toHaveValue('3');
  await manual.getByRole('button', { name: 'Сглаживание 1/48', exact: true }).click();
  await expect(manual.getByRole('slider')).toHaveValue('1');
  await expect(score).toHaveText(/\d/);

  // голос: та же настройка, исходная кривая — 1/48 октавы, выбранная раньше 1/6 остаётся сглаживанием
  await page.evaluate(() => { location.hash = 'voice'; });
  await expect(page.getByRole('radio', { name: 'Максимальная', exact: true })).toHaveAttribute('aria-checked', 'true');
  const voice = page.locator('.smoothed-chart[data-screen="voice"]');
  await expect(voice.getByRole('button', { name: 'Исходная кривая 1/48 октавы', exact: true })).toBeVisible({ timeout: 20000 });
  await expect(voice.getByRole('slider')).toHaveValue('3');
  await expect(page.getByText('Карта мест считается в 2–5 раз дольше.')).toBeVisible();

  // стандартная точность: узких точек нет, действует прежняя базовая точка; настройка переживает перезагрузку
  await page.getByRole('radio', { name: 'Стандартная', exact: true }).click();
  await expect(voice.getByRole('button', { name: 'Исходная кривая 1/6 октавы', exact: true })).toBeVisible({ timeout: 20000 });
  await expect(voice.getByRole('slider')).toHaveValue('0');
  await page.getByRole('radio', { name: 'Высокая', exact: true }).click();
  await expect(voice.getByRole('button', { name: 'Исходная кривая 1/24 октавы', exact: true })).toBeVisible({ timeout: 20000 });
  await page.waitForTimeout(800); // автосохранение
  await page.reload();
  await expect(page.getByRole('radio', { name: 'Высокая', exact: true })).toHaveAttribute('aria-checked', 'true', { timeout: 20000 });
  await page.evaluate(() => { location.hash = 'manual'; });
  await expect(manual.getByRole('button', { name: 'Сглаживание 1/24', exact: true })).toBeVisible({ timeout: 20000 });
  await expect(manual.getByRole('button', { name: 'Сглаживание 1/48', exact: true })).toHaveCount(0);
  for (const width of [320, 393]) {
    await page.setViewportSize({ width, height: 852 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});
