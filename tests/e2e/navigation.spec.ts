import { test, expect } from '@playwright/test';

test('analysis entry, remembered subsection, back and forward', async ({ page }) => {
  await page.goto('/#room');
  const bar = page.getByRole('navigation', { name: 'Разделы', exact: true });
  await bar.getByRole('button', { name: 'Анализ' }).click();
  await expect(page.locator('.score-ring__num')).toBeVisible();
  await page.getByRole('navigation', { name: 'Раздел анализа' }).getByRole('button', { name: 'Моды', exact: true }).click();
  await expect(page.locator('.modes-table')).toBeVisible();
  await bar.getByRole('button', { name: 'Комната' }).click();
  await bar.getByRole('button', { name: 'Анализ' }).click();
  await expect(page.locator('.modes-table')).toBeVisible();
  await page.goBack();
  await expect(page.locator('.topbar__title')).toHaveText('Комната');
  await page.goForward();
  await expect(page.locator('.modes-table')).toBeVisible();
});

test('tuning preserves EQ result and export choice across sections, invalidates after room change', async ({ page }) => {
  await page.goto('/#tuning/eq');
  await page.getByRole('button', { name: 'Рассчитать фильтры' }).click();
  await expect(page.locator('#eq-apo')).toHaveValue(/Filter/);
  const value = await page.locator('#eq-apo').inputValue();
  await page.getByRole('navigation', { name: 'Раздел настройки' }).getByRole('button', { name: /Обработка/ }).click();
  await page.getByRole('navigation', { name: 'Раздел настройки' }).getByRole('button', { name: /Эквалайзер/ }).click();
  await expect(page.locator('#eq-apo')).toHaveValue(value);
  await page.getByRole('navigation', { name: 'Разделы', exact: true }).getByRole('button', { name: 'Комната' }).click();
  await page.getByLabel('Глубина', { exact: true }).fill('6');
  await page.getByRole('navigation', { name: 'Разделы', exact: true }).getByRole('button', { name: 'Настройка' }).click();
  await expect(page.locator('#eq-apo')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Рассчитать фильтры' })).toBeVisible();
});

test('measurement is shared with EQ and survives navigation and project reload', async ({ page }) => {
  await page.goto('/#measure/compare');
  const lines = Array.from({ length: 300 }, (_, i) => `${10 * Math.pow(2, i / 48)} ${80 + 6 * Math.sin(i / 10)}`);
  await page.setInputFiles('#rew-file', { name: 'shared.txt', mimeType: 'text/plain', buffer: Buffer.from(lines.join('\n')) });
  await expect(page.getByText('shared.txt', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Открыть эквалайзер' }).click();
  await page.getByRole('radio', { name: 'Замеру', exact: true }).click();
  await page.getByRole('button', { name: 'Рассчитать фильтры' }).click();
  await expect(page.locator('#eq-apo')).toBeVisible();
  await page.getByRole('button', { name: 'Измерения и REW' }).click();
  await expect(page.getByText('shared.txt', { exact: true })).toBeVisible();
  await page.waitForTimeout(400);
  await page.reload();
  await expect(page.getByText('shared.txt', { exact: true })).toBeVisible();
});

test('room sections keep their collapsed state and all input labels remain unique', async ({ page }) => {
  await page.goto('/#room');
  const section = page.locator('.panel--collapsible').first();
  await section.locator('summary').click();
  await expect(section).not.toHaveAttribute('open', '');
  await page.getByRole('navigation', { name: 'Разделы', exact: true }).getByRole('button', { name: 'Расстановка' }).click();
  await page.getByRole('navigation', { name: 'Разделы', exact: true }).getByRole('button', { name: 'Комната' }).click();
  await expect(section).not.toHaveAttribute('open', '');
  await page.reload();
  await expect(section).not.toHaveAttribute('open', '');
  const duplicates = await page.locator('input[id],select[id]').evaluateAll((els) => {
    const ids = els.map((el) => el.id);
    return ids.filter((id, i) => ids.indexOf(id) !== i);
  });
  expect(duplicates).toEqual([]);
});

test('workspace fits small iPhone and desktop without horizontal overflow', async ({ page }) => {
  for (const width of [320, 393, 1280]) {
    await page.setViewportSize({ width, height: 852 });
    for (const route of ['room', 'analysis', 'tuning/sub', 'tuning/eq', 'tuning/treatment', 'measure/compare']) {
      await page.goto(`/#${route}`);
      await expect(page.locator('.topbar__title')).toBeVisible();
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      if (process.env.UI_SCREENSHOTS && width === 393) {
        await page.screenshot({ path: `work/previews/${route.replace('/', '-')}.png`, fullPage: true });
      }
    }
  }
});

test('overview actions open the relevant tuning section', async ({ page }) => {
  await page.goto('/#analysis');
  await page.locator('.problems').getByRole('button', { name: 'Эквалайзер', exact: true }).first().click();
  await expect(page).toHaveURL(/#tuning\/eq$/);
  await page.goBack();
  await page.locator('.problems').getByRole('button', { name: 'Обработка', exact: true }).first().click();
  await expect(page).toHaveURL(/#tuning\/treatment$/);
});

test('leaving EQ stops its audio while preserving calculated filters', async ({ page }) => {
  await page.addInitScript(() => {
    if (typeof AudioBufferSourceNode === 'undefined') return;
    const originalStop = AudioBufferSourceNode.prototype.stop;
    AudioBufferSourceNode.prototype.stop = function (...args) {
      document.documentElement.dataset.audioStopped = 'true';
      return originalStop.apply(this, args);
    };
  });
  await page.goto('/#tuning/eq');
  test.skip(!await page.evaluate(() => typeof AudioContext !== 'undefined'), 'Web Audio unavailable in this browser build (Windows WebKit).');
  await page.getByRole('button', { name: 'Рассчитать фильтры' }).click();
  await page.getByText('Послушать в наушниках: до / после', { exact: true }).click();
  await page.getByRole('button', { name: 'Слушать', exact: true }).click();
  await expect(page.locator('.auralize').getByRole('button', { name: 'Стоп', exact: true })).toBeVisible();
  await page.getByRole('navigation', { name: 'Раздел настройки' }).getByRole('button', { name: /Сабвуфер/ }).click();
  await expect(page.locator('html')).toHaveAttribute('data-audio-stopped', 'true');
  await page.getByRole('navigation', { name: 'Раздел настройки' }).getByRole('button', { name: /Эквалайзер/ }).click();
  await expect(page.locator('#eq-apo')).toBeVisible();
  await expect(page.locator('.auralize').getByRole('button', { name: 'Слушать', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Слушать', exact: true }).click();
  await page.evaluate(() => { delete document.documentElement.dataset.audioStopped; });
  await page.getByRole('navigation', { name: 'Разделы', exact: true }).getByRole('button', { name: 'Комната' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-audio-stopped', 'true');
});
