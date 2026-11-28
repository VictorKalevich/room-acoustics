// V2-059: обход всех адресов v2 на экспертном уровне (виден весь интерфейс) — ни один экран не шире окна на 320, 390
// (эмуляция iPhone) и 1440 px, без ошибок в консоли и на странице. Комната создаётся одна, адреса берутся из маршрутов.
import { test, expect, type Page } from '@playwright/test';
import { ROOM_SECTIONS, ROOM_TABS } from '../../../src/v2/shared/router';
import { TOOLS } from '../../../src/v2/features/tools/catalog';
import { LIBRARY_CATEGORIES } from '../../../src/v2/storage/library';

async function overflow(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const w = document.documentElement.clientWidth;
    if (document.documentElement.scrollWidth - w <= 1) return null;
    const wide = [...document.querySelectorAll<HTMLElement>('body *')]
      .filter((e) => e.getBoundingClientRect().right > w + 1 && getComputedStyle(e).position !== 'fixed' && !e.closest('.al-table-wrap, .al-scroll-x, [data-scroll-x]'))
      .slice(0, 3).map((e) => `${e.tagName.toLowerCase()}.${[...e.classList].join('.')} → ${Math.round(e.getBoundingClientRect().right)}`);
    return `ширина документа ${document.documentElement.scrollWidth} > ${w}: ${wide.join('; ')}`;
  });
}

test('059 · все экраны помещаются по ширине и открываются без ошибок', async ({ page }, info) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('./');
  await page.getByRole('radio', { name: /Экспертный/ }).check();
  await page.getByRole('button', { name: 'Продолжить' }).click();
  await page.goto('./#/rooms/new/manual');
  await page.getByLabel('Название').fill('Гостиная');
  await page.getByRole('button', { name: 'Создать', exact: true }).click();
  await page.waitForURL(/#\/rooms\/[^/]+\/model/);
  const id = /#\/rooms\/([^/]+)\//.exec(page.url())![1];

  const paths = ['', 'rooms', 'rooms/new', 'rooms/new/scan', 'rooms/new/manual', 'tools', 'library', 'settings'];
  for (const tab of ROOM_TABS) {
    paths.push(`rooms/${id}/${tab}`);
    for (const s of ROOM_SECTIONS[tab]) paths.push(`rooms/${id}/${tab}/${s}`);
  }
  for (const t of TOOLS) paths.push(`tools/${t.id}`);
  for (const c of LIBRARY_CATEGORIES) paths.push(`library/${c}`);

  const widths = info.project.use.isMobile ? [320, 390] : [1440];
  const bad: string[] = [];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 800 });
    for (const p of paths) {
      await page.goto(`./#/${p}`);
      await expect(page.getByRole('main')).toBeVisible();
      await page.waitForLoadState('networkidle');
      await expect(page.getByRole('progressbar')).toHaveCount(0, { timeout: 60_000 });
      const o = await overflow(page);
      if (o) bad.push(`${width} px #/${p}: ${o}`);
    }
  }
  expect(bad, bad.join('\n')).toEqual([]);
  expect(errors, errors.join('\n')).toEqual([]);
});
