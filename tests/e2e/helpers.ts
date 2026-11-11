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
