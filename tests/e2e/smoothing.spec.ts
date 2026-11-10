import { test, expect } from '@playwright/test';

test('smoothing preferences are independent for voice, manual and auto and survive reload', async ({ page }) => {
  await page.goto('/#voice');
  const voice = page.locator('.smoothed-chart[data-screen="voice"]');
  await expect(voice.getByRole('slider')).toHaveValue('0', { timeout: 20000 });
  await voice.getByRole('button', { name: 'Сглаживание 1/2', exact: true }).click();
  await voice.getByRole('radio', { name: 'Психоакустическое', exact: true }).click();
  await expect(voice.getByRole('slider')).toHaveCount(0);
  await page.evaluate(() => { location.hash = 'manual'; });
  const manual = page.locator('.smoothed-chart[data-screen="placement-manual"]');
  await expect(manual.getByRole('slider')).toHaveValue('1');
  await manual.getByRole('button', { name: 'Сглаживание 1/3', exact: true }).click();
  await page.evaluate(() => { location.hash = 'placement'; });
  await page.getByRole('button', { name: 'Подобрать расстановку', exact: true }).click();
  const auto = page.locator('.smoothed-chart[data-screen="placement-auto"]');
  await expect(auto.getByRole('slider')).toHaveValue('1', { timeout: 20000 });
  await auto.getByRole('button', { name: 'Сглаживание Без', exact: true }).click();
  await page.evaluate(() => { location.hash = 'voice'; });
  await expect(voice.getByRole('radio', { name: 'Психоакустическое', exact: true })).toHaveAttribute('aria-checked', 'true');
  await voice.getByRole('radio', { name: 'Октавное', exact: true }).click();
  await expect(voice.getByRole('slider')).toHaveValue('2');
  await page.reload();
  await expect(voice.getByRole('slider')).toHaveValue('2');
  await page.evaluate(() => { location.hash = 'manual'; });
  await expect(manual.getByRole('slider')).toHaveValue('3');
  await page.evaluate(() => { location.hash = 'placement'; });
  await expect(auto.getByRole('slider')).toHaveValue('0');
});

test('smoothing changes only the curve, not the score, map or worker calculations', async ({ page }) => {
  await page.addInitScript(() => {
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (message: unknown, options?: StructuredSerializeOptions | Transferable[]) {
      document.documentElement.dataset.workerCalls = String(Number(document.documentElement.dataset.workerCalls ?? 0) + 1);
      return Reflect.apply(post, this, [message, options]);
    };
  });
  await page.goto('/#voice');
  const chart = page.locator('.smoothed-chart[data-screen="voice"]');
  await expect(chart.getByRole('slider')).toBeVisible({ timeout: 20000 });
  const score = await page.locator('.score__value:visible').first().textContent();
  const heat = await page.locator('svg.plan:visible .plan__heat').innerHTML();
  const workerCalls = await page.locator('html').getAttribute('data-worker-calls');
  const curve = chart.locator('.chart__line.is-room');
  const before = await curve.getAttribute('points');
  await chart.getByRole('slider').focus();
  await page.keyboard.press('End');
  await expect(chart.getByRole('slider')).toHaveValue('2');
  await expect(curve).not.toHaveAttribute('points', before!);
  await expect(page.locator('.score__value:visible').first()).toHaveText(score!);
  expect(await page.locator('svg.plan:visible .plan__heat').innerHTML()).toBe(heat);
  await expect(page.locator('html')).toHaveAttribute('data-worker-calls', workerCalls!);
  await chart.getByRole('slider').focus();
  await page.keyboard.press('Home');
  await expect(curve).toHaveAttribute('points', before!);
  for (const width of [320, 393]) {
    await page.setViewportSize({ width, height: 852 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  if (process.env.UI_SCREENSHOTS) await chart.screenshot({ path: 'work/previews/smoothing-voice.png' });
});

test('legacy sitting project keeps mouth height without the posture switch', async ({ page }) => {
  await page.goto('/#sync');
  const file = JSON.stringify({ format: 'room-acoustics-project', version: 5, project: {
    id: 'height-check', name: 'Высота', updatedAt: '2026-11-10T10:00:00Z', room: { depth: 4, width: 3, height: 2.7 },
    voice: { posture: 'sitting', mouthZ: 1.235, distance: 0.2, fLo: 80, fHi: 12000 },
  } });
  await page.locator('input[accept=".json,application/json"]').setInputFiles({ name: 'height.json', mimeType: 'application/json', buffer: Buffer.from(file) });
  await page.getByRole('button', { name: 'Открыть', exact: true }).click();
  await page.getByRole('button', { name: 'Открыть меню' }).click();
  await page.getByRole('button', { name: /Место для записи/ }).click();
  await expect(page.getByLabel('Высота микрофона', { exact: true })).toHaveValue('123,5');
  await expect(page.getByRole('radio', { name: /^(Сидя|Стоя)$/ })).toHaveCount(0);
  await page.getByLabel('Высота микрофона', { exact: true }).fill('145');
  await page.getByLabel('От рта до микрофона', { exact: true }).focus();
  await expect(page.locator('.score__value:visible').first()).not.toHaveText('…');
  await page.waitForTimeout(500); // autosave debounce
  await page.reload();
  await expect(page.getByLabel('Высота микрофона', { exact: true })).toHaveValue('145');
});
