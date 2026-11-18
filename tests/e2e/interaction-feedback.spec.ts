import { test, expect } from '@playwright/test';
import { closeDetails, showDetail, fitsWidth } from './helpers';

test('050: мода выбирается перед 3D и в срезе, выбор и поле общие', async ({ page }) => {
  await page.goto('/#field');
  const choice = page.getByRole('combobox', { name: 'Мода / частота', exact: true }).first();
  await expect(choice).toBeInViewport();
  await expect(choice.locator('option[value="1"]')).toHaveCount(1);
  await choice.selectOption('1');
  const second = (await choice.locator('option:checked').textContent())!.split(' · ')[0];
  await expect(page.locator('.field-shown')).toHaveText('Показано: ' + second, { timeout: 30000 });
  await showDetail(page, 'Срез сверху');
  const slice = page.getByRole('dialog', { name: 'Срез сверху', exact: true });
  const sliceChoice = slice.getByRole('combobox', { name: 'Мода / частота', exact: true });
  await expect(sliceChoice).toHaveValue('1');
  await expect(sliceChoice).toBeInViewport();
  const old = await slice.locator('.plan__field').innerHTML();
  await sliceChoice.selectOption('0');
  const first = (await sliceChoice.locator('option:checked').textContent())!.split(' · ')[0];
  await expect(slice.getByRole('status')).toHaveText('Показано: ' + first, { timeout: 30000 });
  await expect.poll(() => slice.locator('.plan__field').innerHTML()).not.toBe(old);
  await closeDetails(page);
  await expect(choice).toHaveValue('0');
  await expect(page.locator('.field-shown')).toHaveText('Показано: ' + first);
  // Existing arbitrary frequency and band controls remain available.
  await page.getByText('Частота и отображение', { exact: true }).click();
  await page.getByRole('radio', { name: 'Полоса', exact: true }).click();
  await expect(choice).toHaveValue('band');
  await choice.selectOption('1');
  await expect(page.getByRole('radio', { name: 'Одна частота', exact: true })).toHaveAttribute('aria-checked', 'true');
  for (const width of [320, 402]) {
    await page.setViewportSize({ width, height: 874 });
    await expect.poll(() => fitsWidth(page)).toBe(true);
  }
});

test('050: «Встать сюда» перемещает позицию и показывает временное подтверждение, повтор продлевает его', async ({ page }) => {
  await page.goto('/#voice');
  await expect(page.getByTestId('voice-map-best')).toContainText('дБ', { timeout: 20000 });
  const singer = page.locator('.plan__singer[data-id="singer"]');
  const before = await singer.getAttribute('transform');
  await showDetail(page, 'Лучшие места');
  const stand = page.getByRole('button', { name: 'Встать сюда', exact: true }).nth(1);
  await page.clock.install();
  await stand.click();
  await expect(singer).not.toHaveAttribute('transform', before!);
  const notice = page.locator('.toast__message');
  await expect(notice).toHaveText('Позиция на плане обновлена');
  await expect(notice).toBeInViewport();
  await expect(page.locator('.toast')).toHaveAttribute('role', 'status');
  await expect(page.locator('.toast')).toHaveCSS('pointer-events', 'none');
  await expect(page.getByRole('dialog', { name: 'Лучшие места', exact: true })).toBeVisible();
  await page.clock.fastForward(2000);
  await expect(notice).toBeVisible();
  await stand.click();
  await page.clock.fastForward(1000);
  await expect(notice).toBeVisible();
  await page.clock.fastForward(1700);
  await expect(notice).toHaveCount(0);
});

test('050: легенды изначально свёрнуты даже со старым сохранённым раскрытием и не связаны между экранами', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('ra-plankey-open', '1'));
  await page.goto('/#room');
  const key = page.locator('.plan-key:visible').first();
  await expect(key).not.toHaveAttribute('open');
  await key.locator('summary').click();
  await expect(key).toHaveAttribute('open');
  await showDetail(page, 'Реверберация');
  await closeDetails(page);
  await expect(key).toHaveAttribute('open');
  for (const route of ['manual', 'voice']) {
    await page.evaluate(r => { location.hash = r; }, route);
    await expect(key).not.toHaveAttribute('open');
    await key.locator('summary').click();
    await expect(key).toHaveAttribute('open');
  }
  await page.reload();
  await expect(key).not.toHaveAttribute('open');
});

test('050: кнопки дают отклик мышью и клавиатурой, reduced-motion убирает движение', async ({ page }) => {
  await page.goto('/#voice');
  const left = page.getByRole('button', { name: /Левее/ });
  await expect(left).toBeVisible({ timeout: 20000 });
  await left.scrollIntoViewIfNeeded();
  const direction = page.locator('.plan__singer[data-id="singer"] > g');
  const before = await direction.getAttribute('transform');
  const rect = (await left.boundingBox())!;
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await page.mouse.down();
  await expect(left).toHaveCSS('scale', '0.97');
  await page.mouse.up();
  await expect(direction).not.toHaveAttribute('transform', before!);
  await expect(left).toHaveCSS('scale', 'none');
  await left.focus();
  await page.keyboard.down('Space');
  await expect(left).toHaveCSS('scale', '0.97');
  await page.keyboard.up('Space');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.keyboard.down('Space');
  await expect(left).toHaveCSS('scale', 'none');
  await expect(left).toHaveCSS('filter', 'brightness(0.9)');
  await page.keyboard.up('Space');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  // Navigation buttons use the same response; disabled controls do not.
  const menu = page.getByRole('button', { name: 'Открыть меню', exact: true });
  const menuBox = (await menu.boundingBox())!;
  await page.mouse.move(menuBox.x + menuBox.width / 2, menuBox.y + menuBox.height / 2);
  await page.mouse.down();
  await expect(menu).toHaveCSS('scale', '0.97');
  await page.mouse.up();
  await expect(page.locator('.drawer')).toHaveClass(/is-open/);
});

test('050: лучшие места слушателя и сабвуфера подтверждаются тем же временным уведомлением', async ({ page }) => {
  await page.goto('/#manual');
  for (const sub of [false, true]) {
    if (sub) {
      await closeDetails(page);
      await page.locator('.panel--hero').getByRole('radio').filter({ hasText: 'Место сабвуфера' }).click();
    }
    await showDetail(page, 'Лучшие места');
    const dialog = page.getByRole('dialog', { name: 'Лучшие места', exact: true });
    const action = dialog.getByRole('button', { name: sub ? 'Поставить сюда' : 'Сесть сюда', exact: true }).first();
    await action.click({ timeout: 20000 });
    await expect(dialog.locator('.toast__message')).toHaveText(sub ? 'Позиция сабвуфера на плане обновлена' : 'Позиция слушателя на плане обновлена');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('.toast__message')).toHaveCount(0, { timeout: 5000 });
  }
});
