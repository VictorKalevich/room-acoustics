// Общие шаги сценариев 021/022.
import { expect, type Page, type TestInfo } from '@playwright/test';

/** Новый проект: комнаты ещё нет. */
export const EMPTY_STATE = { cookies: [], origins: [] };

/** Комната создана, места колонок ещё не выбраны (файл из room.setup.ts; имя — по проекту Playwright). */
export const roomOnlyState = async ({ browserName }: { browserName: string }, provide: (v: string) => Promise<void>, info: TestInfo) => {
  void browserName;
  await provide(`tests/e2e/.auth/${info.project.name}-room.json`);
};

/** Проверка комнаты по шагам: «Далее» до последнего шага и «Сохранить» — комната создана, открыт обзор. */
export async function finishRoomSteps(page: Page) {
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: /Далее/ }).click();
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Конструктор комнаты' })).toBeVisible();
}

/** Выбрать файл скана на карточке «С чего начать» и дождаться шага «Размеры» проверки комнаты. */
export async function scanToSteps(page: Page, file: string) {
  await page.setInputFiles('#scan-file', file);
  await expect(page.getByRole('heading', { name: 'Шаг 1 из 4: Размеры' })).toBeVisible({ timeout: 30_000 });
}

/** Журнал ошибок на устройстве (028). */
export const errlog = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('ra-errors') ?? '[]') as { msg: string; ctx?: string }[]);

/** Сообщение о сбое (028, 029) помещается без горизонтальной прокрутки на 320 и 393 px в светлой и тёмной темах. */
export async function fits(page: Page, what: string) {
  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme });
    for (const width of [320, 393]) {
      await page.setViewportSize({ width, height: 852 });
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), { message: `${what}: ${theme} ${width}` }).toBe(true);
      expect(await page.evaluate(() => getComputedStyle(document.body).color)).toBe(theme === 'dark' ? 'rgb(228, 234, 236)' : 'rgb(23, 34, 43)');
      await expect(page.locator('[role=alert] .panel .small').first()).toHaveCSS('font-size', '14px');
    }
  }
  await page.emulateMedia({ colorScheme: 'light' });
  await page.setViewportSize({ width: 393, height: 852 });
}
