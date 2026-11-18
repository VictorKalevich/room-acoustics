import { test, expect, type Locator } from '@playwright/test';
import { openDetail, closeDetails } from './helpers';

// Synthetic touch events check cancellation by every ancestor, unlike scrollTop alone.
async function checkScroll(body: Locator) {
  await expect.poll(() => body.evaluate(el => {
    const marker = document.createElement('div');
    marker.style.height = '1200px';
    marker.style.flexShrink = '0';
    el.append(marker);
    const gesture = (from: number, to: number) => {
      const start = new Event('touchstart', { bubbles: true, cancelable: true });
      Object.defineProperty(start, 'touches', { value: [{ clientY: from }] });
      marker.dispatchEvent(start);
      const move = new Event('touchmove', { bubbles: true, cancelable: true });
      Object.defineProperty(move, 'touches', { value: [{ clientY: to }] });
      marker.dispatchEvent(move);
      return move.defaultPrevented;
    };
    el.scrollTop = 0;
    const downBlocked = gesture(200, 100);
    const topBlocked = gesture(100, 200);
    el.scrollTop = el.scrollHeight;
    const reachedBottom = el.scrollTop > 0 && Math.abs(el.scrollTop + el.clientHeight - el.scrollHeight) < 2;
    const upBlocked = gesture(100, 200);
    const endBlocked = gesture(200, 100);
    const overflow = getComputedStyle(el).overflowY;
    marker.remove();
    el.scrollTop = 0;
    return { downBlocked, topBlocked, upBlocked, endBlocked, reachedBottom, overflow };
  })).toEqual({ downBlocked: false, topBlocked: true, upBlocked: false, endBlocked: true, reachedBottom: true, overflow: 'auto' });
}

test('051: вложенные настройки пропускают жест прокрутки, включая короткие экраны с ростом данных', async ({ page }) => {
  await page.goto('/#manual');
  for (const size of [{ width: 320, height: 480 }, { width: 874, height: 402 }]) {
    await page.setViewportSize(size);
    await openDetail(page, 'Система и цель подбора');
    for (const title of ['Оборудование', 'Места и сабвуфер', 'Цель и точность']) {
      const panel = await openDetail(page, title);
      await checkScroll(panel.locator(':scope > .detail-page__body'));
      await expect(panel.locator(':scope > header button')).toBeInViewport();
      await panel.locator(':scope > header button').click();
    }
    await closeDetails(page);
    await expect.poll(() => page.evaluate(() => document.body.style.position)).toBe('');
  }
});

test('051: все доступные подэкраны и меню допускают прокрутку при росте данных', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 320, height: 480 });
  for (const route of ['room', 'room/size', 'room/walls', 'room/floor', 'room/furniture', 'placement', 'manual', 'voice', 'tuning/sub', 'tuning/eq', 'tuning/treatment', 'field', 'analysis', 'modes', 'measure/sweep', 'measure/clap', 'measure/rta', 'measure/compare', 'projects', 'report', 'help', 'about']) {
    await page.goto('/?scroll-audit=' + encodeURIComponent(route) + '#' + route);
    await expect(page.getByRole('button', { name: 'Открыть меню', exact: true })).toBeVisible();
    // Direct children only: recursively open the retained nested panels.
    async function visit(scope: Locator) {
      const entries = scope.locator('.setting-link:visible');
      const count = await entries.count();
      for (let i = 0; i < count; i++) {
        const entry = entries.nth(i);
        const id = await entry.getAttribute('aria-controls');
        await entry.click();
        const panel = page.locator('[id=' + JSON.stringify(id) + ']');
        const body = panel.locator(':scope > .detail-page__body');
        await checkScroll(body);
        await visit(body);
        await panel.locator(':scope > header button').click();
      }
    }
    await visit(page.locator('.content'));
  }
  await page.getByRole('button', { name: 'Открыть меню', exact: true }).click();
  await checkScroll(page.locator('.drawer__panel'));
});

test('051: жест браузера и длинная шторка сохраняют прокрутку', async ({ page, browserName }) => {
  await page.setViewportSize({ width: 320, height: 480 });
  await page.goto('/#manual');
  await openDetail(page, 'Система и цель подбора');
  const nested = await openDetail(page, 'Оборудование');
  const body = nested.locator(':scope > .detail-page__body');
  await checkScroll(body);
  if (browserName === 'chromium') {
    // Native browser gesture, in addition to cancellation checks shared with WebKit.
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 300, y: 380 }] });
    for (const y of [340, 300, 260, 220, 180, 140]) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 300, y }] });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(() => body.evaluate(el => el.scrollTop)).toBeGreaterThan(50);
    await cdp.detach();
  }
  await closeDetails(page);
  await page.goto('/?scroll-sheet#modes');
  await page.locator('.term:visible').first().click();
  await checkScroll(page.locator('.sheet'));
  await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await expect.poll(() => page.evaluate(() => document.body.style.position)).toBe('');
});
