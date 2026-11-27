// V2-041–V2-045: вкладка «Советы» — рекомендации по группам с подробностями, применение только в эксперименте,
// цели и ограничения, план работ и проверка, отчёт; подбор мест и согласование сабвуферов в воркере, DSP с экспортом.
import { test, expect, type Page } from '@playwright/test';

async function start(page: Page) {
  await page.goto('./');
  await page.getByRole('radio', { name: /Простой/ }).check();
  await page.getByRole('button', { name: 'Продолжить' }).click();
  await page.goto('./#/rooms/new');
  await page.getByLabel('Название').fill('Гостиная');
  await page.getByRole('button', { name: 'Создать', exact: true }).click();
  await expect(page.locator('.al-plan__object').first()).toBeVisible();
}

const section = (page: Page, s: string) => page.goto(page.url().replace(/#\/rooms\/([^/]+)\/.*$/, `#/rooms/$1/advice${s ? `/${s}` : ''}`));

test('059 · советы: группы, подробности, эксперимент, цели и ограничения, план, отчёт', async ({ page }) => {
  test.setTimeout(120_000);
  await start(page);
  await page.getByRole('tab', { name: 'Советы' }).click();
  const data = page.getByRole('list', { name: 'Проверка исходных данных' });
  await expect(data).toBeVisible({ timeout: 30_000 });
  await expect(data).toContainText('Измерьте АЧХ в месте слушателя');
  const treat = page.getByRole('list', { name: 'Акустическая обработка' });
  await expect(treat).toBeVisible();
  const refl = treat.getByRole('listitem').filter({ hasText: 'Закройте первые отражения' });
  await refl.getByRole('button', { name: 'Подробнее' }).click();
  await expect(refl.getByText('Побочные последствия')).toBeVisible();
  await expect(refl.getByRole('list', { name: 'Действия' })).toContainText('Панель');

  await refl.getByRole('button', { name: 'В план' }).click();
  await expect(refl.getByRole('button', { name: 'В плане' })).toBeDisabled();
  await refl.getByRole('button', { name: 'Применить в эксперименте' }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('Будет создан эксперимент');
  await dialog.getByRole('button', { name: 'Применить' }).click();
  await expect(page.getByText('Применено в эксперименте; текущая конфигурация не изменилась')).toBeVisible();
  await expect(page.getByText(/^Эксперимент конфигурация\./)).toBeVisible({ timeout: 30_000 });

  await section(page, 'goals');
  await page.getByLabel('Главная цель').selectOption({ label: 'Разборчивость речи' });
  await page.getByRole('switch', { name: 'Оборудование можно двигать' }).click();
  await expect(page.getByRole('switch', { name: 'Оборудование можно двигать' })).toHaveAttribute('aria-checked', 'false');
  await section(page, '');
  await expect(page.getByText(/Цель — разборчивость речи/)).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: /^Противоречит ограничениям \(\d+\)$/ }).click();
  await expect(page.getByRole('list', { name: 'Противоречит ограничениям' })).toContainText('Оборудование перемещать нельзя');

  await section(page, 'plan');
  const item = page.getByRole('list', { name: 'Этапы плана' }).getByRole('listitem').first();
  await expect(item).toContainText('Проверено в эксперименте');
  await item.getByRole('button', { name: 'Выполнено' }).click();
  await expect(item).toContainText('Выполнено, ждёт проверки');
  await expect(item).toContainText('это ещё не подтверждённое улучшение');
  await item.getByLabel('Стоимость этапа').fill('15000');
  await item.getByLabel('Стоимость этапа').press('Enter');
  await expect(page.getByText(/^Стоимость указанных этапов: 15\s000 ₽, бюджет не задан\.$/)).toBeVisible();
  await item.getByRole('button', { name: 'История' }).click();
  await expect(item.getByRole('list', { name: 'История пункта' }).getByRole('listitem')).toHaveCount(3);

  await section(page, 'reports');
  await expect(page.getByRole('table', { name: 'Проверка до и после' })).toContainText('Нет замера после выполнения');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Скачать отчёт' }).click();
  expect((await download).suggestedFilename()).toMatch(/^Гостиная_отчёт_\d{4}-\d{2}-\d{2}\.md$/);
  await page.getByRole('button', { name: 'Сохранить в «Мои данные»' }).click();
  await expect(page.getByRole('table', { name: 'Сохранённые отчёты' }).getByRole('row')).toHaveCount(2);

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Проверка и отчёты' })).toBeVisible();
  await section(page, 'plan');
  await expect(page.getByRole('list', { name: 'Этапы плана' })).toContainText('Выполнено, ждёт проверки');
});

test('059 · советы: подбор мест и сабвуферов в эксперимент, сохранение прогона, DSP и экспорт', async ({ page }) => {
  test.setTimeout(240_000);
  await start(page);
  await page.getByRole('tab', { name: 'Советы' }).click();
  await section(page, 'optimize');
  const search = page.locator('.al-card').filter({ has: page.getByRole('heading', { name: 'Поиск мест' }) });
  await search.getByRole('button', { name: 'Рассчитать' }).click();
  const variants = page.getByRole('table', { name: 'Найденные варианты' });
  await expect(variants).toBeVisible({ timeout: 180_000 });
  await expect(page.getByRole('img', { name: /АЧХ: сейчас и вариант 1/ })).toBeVisible();
  await page.getByRole('button', { name: 'Сохранить отчёт прогона' }).click();
  await expect(page.getByRole('table', { name: 'Сохранённые прогоны' }).getByRole('row')).toHaveCount(2);
  await search.getByRole('button', { name: 'Перенести в эксперимент' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'В эксперимент' }).click();
  await expect(page.getByText('Перенесено в эксперимент; текущая конфигурация не изменилась')).toBeVisible();

  const subs = page.locator('.al-card').filter({ has: page.getByRole('heading', { name: 'Согласование сабвуферов с колонками' }) });
  await subs.getByRole('button', { name: 'Рассчитать' }).click();
  await expect(page.getByRole('table', { name: 'Согласование сабвуферов с колонками: настройки' })).toBeVisible({ timeout: 120_000 });

  await section(page, 'dsp');
  await expect(page.getByRole('button', { name: 'Подобрать фильтры' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('radio', { name: 'Несколько мест' })).toBeDisabled();
  await page.getByRole('radio', { name: 'Осторожная коррекция' }).click();
  await expect(page.getByLabel('Подъём не больше')).toBeVisible();
  await page.getByRole('button', { name: 'Подобрать фильтры' }).click();
  await expect(page.getByRole('img', { name: /Коррекция: до и после/ })).toBeVisible();
  const list = page.getByRole('list', { name: 'Фильтры коррекции' });
  await expect(list.getByRole('switch').first()).toHaveAttribute('aria-checked', 'true');
  await list.getByRole('switch').first().click();
  await expect(list.getByRole('switch').first()).toHaveAttribute('aria-checked', 'false');
  const apo = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Equalizer APO' }).click();
  expect((await apo).suggestedFilename()).toBe('Гостиная EQ_EqualizerAPO.txt');
  const fir = page.waitForEvent('download');
  await page.getByRole('button', { name: 'FIR WAV, минимальная фаза' }).click();
  expect((await fir).suggestedFilename()).toBe('Гостиная EQ_FIR_min_48k.wav');
  const cam = page.waitForEvent('download');
  await page.getByRole('button', { name: 'CamillaDSP' }).click();
  expect((await cam).suggestedFilename()).toBe('Гостиная EQ_CamillaDSP.yml');
});
