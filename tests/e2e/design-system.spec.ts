import { test, expect } from '@playwright/test';
import { controlSkins } from '../../src/ui/design-system/registry';

test('all screens use registered control skins and shared text in both themes', async ({ page }) => {
  for (const theme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: theme as 'light' | 'dark' });
    for (const route of ['room', 'room/size', 'room/walls', 'room/floor', 'room/furniture', 'voice', 'placement', 'manual', 'analysis', 'modes', 'field', 'tuning/sub', 'tuning/eq', 'tuning/treatment', 'measure/sweep', 'measure/clap', 'measure/rta', 'measure/compare', 'projects', 'report', 'sync', 'help', 'about']) {
      // Different query forces a document load, so the audit cannot inspect a retained previous route.
      await page.goto(`/?design-audit=${encodeURIComponent(route)}#${route}`);
      await expect(page.locator('.topbar__title')).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      // Font loading and retained-route layout can settle on the next rendering frame.
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), { message: `${theme} ${route}: overflow` }).toBe(true);
      const audit = await page.evaluate((skins) => {
        const visible = (e: Element) => e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().height > 0;
        const missing = [...document.querySelectorAll('button,input,select,textarea')].filter(visible).filter(e =>
          !e.matches((e.tagName === 'BUTTON' ? skins.button : skins.input).join(',')),
        ).map(e => `${e.tagName}.${e.className}: ${e.getAttribute('aria-label') || e.textContent?.slice(0, 50)}`);
        const small = [...document.querySelectorAll('.small')].filter(visible);
        const hints = [...document.querySelectorAll('.field__hint,.field__error')].filter(visible);
        return {
          missing,
          smallSizes: [...new Set(small.map(e => getComputedStyle(e).fontSize))],
          hintSizes: [...new Set(hints.map(e => getComputedStyle(e).fontSize))],
          ink: getComputedStyle(document.body).color,
        };
      }, controlSkins);
      expect(audit.missing, `${theme} ${route}: undocumented controls`).toEqual([]);
      expect(audit.smallSizes.every(s => s === '14px'), `${route}: text-small`).toBe(true);
      expect(audit.hintSizes.every(s => s === '12px'), `${route}: feedback`).toBe(true);
      expect(audit.ink).toBe(theme === 'dark' ? 'rgb(228, 234, 236)' : 'rgb(23, 34, 43)');
    }
  }
});

test('quick Escape returns focus to the shared action-menu trigger', async ({ page }) => {
  await page.goto('/#room/walls');
  const trigger = page.getByRole('button', { name: 'Добавить проём', exact: true });
  await trigger.click();
  await page.getByRole('menuitem', { name: 'Окно', exact: true }).press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test('canonical field spacing and text survive validation on narrow screens', async ({ page }) => {
  await page.goto('/#voice');
  const height = page.getByLabel('Высота микрофона', { exact: true });
  const distance = page.getByLabel('От рта до микрофона', { exact: true });
  for (const width of [320, 393, 1024]) {
    await page.setViewportSize({ width, height: 852 });
    await height.fill('1');
    await expect(height).toHaveAttribute('aria-invalid', 'true');
    const a = await height.boundingBox(), b = await distance.boundingBox();
    expect(Math.abs(a!.y + a!.height - b!.y - b!.height)).toBeLessThan(1);
    await expect(page.locator('.field__error:visible')).toHaveCSS('font-size', '12px');
    await expect(page.locator('.field:visible').filter({ has: height })).toHaveCSS('row-gap', '4px');
    await expect(page.locator('body')).toHaveCSS('font-size', '16px');
    expect(await height.evaluate(e => parseFloat(getComputedStyle(e).fontSize))).toBeGreaterThanOrEqual(16);
    await height.fill('160');
    await expect(height).toHaveAttribute('aria-invalid', 'false');
  }
});
