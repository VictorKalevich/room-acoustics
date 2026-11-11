import { test, expect, type Page } from '@playwright/test';

const value = (page: Page, metric: string) => page.getByTestId(metric).locator('.voice-metric__value');
const ready = async (page: Page) => {
  await expect(page.getByTestId('voice-map-best')).toBeVisible({ timeout: 20000 });
  await expect(page.getByRole('status')).not.toContainText('Считаю карту');
};

test('map goal preserves the selected position, spectrum and smoothing and survives reload', async ({ page }) => {
  await page.goto('/#voice');
  await ready(page);
  const spectrum = page.getByTestId('voice-flatness');
  const metrics = await spectrum.textContent();
  const room = await value(page, 'voice-room-level').textContent();
  const rt = await value(page, 'voice-reverb').textContent();
  const singer = page.locator('svg.plan .plan__singer');
  const position = await singer.getAttribute('transform');
  const direction = await singer.innerHTML();
  const heat = await page.locator('svg.plan .plan__heat').innerHTML();
  const chart = page.locator('.smoothed-chart[data-screen="voice"]');
  await chart.getByRole('button', { name: 'Сглаживание 1/2', exact: true }).click();
  const curve = await chart.locator('.chart__line.is-room').getAttribute('points');
  await page.getByRole('radio', { name: 'Меньше комнаты', exact: true }).click();
  await ready(page);
  await expect(spectrum).toHaveText(metrics!);
  await expect(value(page, 'voice-room-level')).toHaveText(room!);
  await expect(value(page, 'voice-reverb')).toHaveText(rt!);
  await expect(singer).toHaveAttribute('transform', position!);
  expect(await singer.innerHTML()).toBe(direction);
  expect(await page.locator('svg.plan .plan__heat').innerHTML()).not.toBe(heat);
  await expect(chart.locator('.chart__line.is-room')).toHaveAttribute('points', curve!);
  await expect(chart.getByRole('slider')).toHaveValue('2');
  await expect(page.getByTestId('voice-map-best')).toContainText('вклад комнаты');
  await page.reload();
  await ready(page);
  await expect(page.getByRole('radio', { name: 'Меньше комнаты', exact: true })).toHaveAttribute('aria-checked', 'true');
  await expect(chart.getByRole('slider')).toHaveValue('2');
  await expect(singer).toHaveAttribute('transform', position!);
  await page.getByRole('radio', { name: 'Ровнее спектр', exact: true }).click();
  await ready(page);
  expect(await page.locator('svg.plan .plan__heat').innerHTML()).toBe(heat);
});

test('room recommendations and best facing use the room metric, while RT60 stays fixed', async ({ page }) => {
  await page.goto('/#voice');
  await ready(page);
  await page.getByLabel('От рта до микрофона', { exact: true }).fill('60');
  await page.getByRole('radio', { name: 'Меньше комнаты', exact: true }).click();
  await ready(page);
  const best = page.locator('.best-list li').first();
  const score = await best.locator('strong').textContent();
  const rt = await value(page, 'voice-reverb').textContent();
  await best.getByRole('button', { name: 'Встать сюда' }).click();
  await expect(value(page, 'voice-room-level')).toHaveText(score!);
  await expect(page.getByRole('button', { name: 'Лучшее направление здесь', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Правее ↻', exact: true }).click();
  await expect(value(page, 'voice-reverb')).toHaveText(rt!);
  await page.getByRole('button', { name: 'Лучшее направление здесь', exact: true }).click();
  await expect(value(page, 'voice-room-level')).toHaveText(score!);
  await expect(value(page, 'voice-reverb')).toHaveText(rt!);
  for (const width of [320, 393]) {
    await page.setViewportSize({ width, height: 852 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  if (process.env.UI_SCREENSHOTS) await page.locator('.voice-metrics').screenshot({ path: `work/previews/voice-metrics-${test.info().project.name}.png` });
});

test('room materials update RT60 and the final goal wins after rapid toggles', async ({ page }) => {
  await page.goto('/#voice');
  await ready(page);
  const rt = await value(page, 'voice-reverb').textContent();
  // 019: обстановка — на шаге «Мебель» конструктора
  await page.evaluate(() => { location.hash = 'room/furniture'; });
  await page.getByLabel('Общая оценка обстановки', { exact: true }).selectOption('empty');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await page.evaluate(() => { location.hash = 'voice'; });
  await ready(page);
  await expect(value(page, 'voice-reverb')).not.toHaveText(rt!);
  const flatness = await page.getByTestId('voice-flatness').textContent();
  await page.getByRole('radio', { name: 'Меньше комнаты', exact: true }).click();
  await page.getByRole('radio', { name: 'Ровнее спектр', exact: true }).click();
  await page.getByRole('radio', { name: 'Меньше комнаты', exact: true }).click();
  await ready(page);
  await expect(page.getByTestId('voice-map-best')).toContainText('вклад комнаты');
  await expect(page.getByTestId('voice-flatness')).toHaveText(flatness!);
  await expect(page.getByText('почти не окрашивает', { exact: true })).toHaveCount(0);
});
