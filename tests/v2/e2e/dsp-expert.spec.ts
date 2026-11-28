// V2-053: экспертный уровень настройки — звенья сверх RBJ и порядок, FIR из цепочки, семейства кроссовера и фазовая
// коррекция, замер с фазой из файла; на простом уровне этого нет.
import { test, expect, type Page } from '@playwright/test';

const start = async (page: Page, level: RegExp) => {
  await page.goto('./');
  await page.getByRole('radio', { name: level }).check();
  await page.getByRole('button', { name: 'Продолжить' }).click();
};

test('059 · эквалайзер: звенья, порядок, групповая задержка и FIR', async ({ page }) => {
  await start(page, /Экспертный/);
  await page.goto('./#/tools/equalizer');
  await page.getByLabel('Другое звено').selectOption('delay');
  await page.getByRole('button', { name: 'Добавить звено' }).click();
  const chain = page.getByRole('list', { name: 'Цепочка фильтров' });
  await chain.getByRole('button', { name: 'Звено 2 выше' }).click();
  await expect(chain.getByRole('switch', { name: 'Звено 1: Задержка' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Групповая задержка цепочки' })).toBeVisible();
  await page.getByLabel('Другое звено').selectOption('biquad');
  await page.getByRole('button', { name: 'Добавить звено' }).click();
  await chain.getByLabel('a2').fill('1,5');
  await chain.getByLabel('a2').press('Enter');
  await expect(chain.getByText(/Фильтр неустойчив/)).toBeVisible();

  await expect(page.getByRole('heading', { name: 'FIR из цепочки' })).toBeVisible();
  await page.getByRole('radio', { name: 'Минимальная' }).click();
  await expect(page.getByText('Предзвон', { exact: true })).toBeVisible();
  await expect(page.getByText('нет', { exact: true })).toBeVisible();
  const wav = page.waitForEvent('download');
  await page.getByRole('button', { name: 'FIR, WAV 32 бит' }).click();
  expect((await wav).suggestedFilename()).toMatch(/minimum_48000\.wav$/);
  const apo = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Equalizer APO' }).click();
  expect((await apo).suggestedFilename()).toMatch(/EqualizerAPO\.txt$/);
});

test('059 · кроссовер: эллиптический, ограничения параметров, фазовая коррекция', async ({ page }) => {
  await start(page, /Экспертный/);
  await page.goto('./#/tools/crossover');
  await page.getByLabel('Семейство').selectOption('elliptic');
  await expect(page.getByLabel('Пульсации в полосе')).toBeVisible();
  await page.getByLabel('Подавление').fill('25');
  await page.getByLabel('Подавление').press('Enter');
  await expect(page.getByRole('heading', { name: 'Групповая задержка суммы' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Фазовая коррекция FIR' })).toBeVisible();
  await expect(page.getByText('Остаток фазы в полосе')).toBeVisible();
  await page.getByRole('switch', { name: 'Исправлять и уровень (регуляризованное обращение)' }).click();
  await expect(page.getByRole('img', { name: /^Уровень до и после коррекции\./ })).toBeVisible();
});

test('059 · замер с фазой из файла → коррекция', async ({ page }) => {
  await start(page, /Экспертный/);
  await page.goto('./#/tools/phase-delay');
  const lines = ['* Freq(Hz) SPL(dB) Phase(degrees)'];
  for (let f = 5; f <= 20000; f += 5) lines.push(`${f} 80 ${((((-360 * f * 0.002) % 360) + 540) % 360) - 180}`);
  await page.getByLabel('Файл замера с фазой').setInputFiles({ name: 'zamer.txt', mimeType: 'text/plain', buffer: Buffer.from(lines.join('\n')) });
  await expect(page.getByText('Задержка прихода по наклону фазы')).toBeVisible();
  await expect(page.getByText(/^2,00 мс$/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Фазовая коррекция FIR' })).toBeVisible();
  await page.getByLabel('Файл замера с фазой').setInputFiles({ name: 'bad.txt', mimeType: 'text/plain', buffer: Buffer.from('1 2\n3 4') });
  await expect(page.getByText(/нет трёх столбцов/)).toBeVisible();
});

test('059 · на простом уровне звеньев, FIR и фазовой коррекции нет', async ({ page }) => {
  await start(page, /Простой/);
  await page.goto('./#/tools/equalizer');
  await expect(page.getByRole('button', { name: 'Добавить фильтр' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Добавить звено' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'FIR из цепочки' })).toHaveCount(0);
  await page.goto('./#/tools/crossover');
  await expect(page.getByRole('radio', { name: 'Linkwitz–Riley' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Фазовая коррекция FIR' })).toHaveCount(0);
  await page.goto('./#/tools/phase-delay');
  await expect(page.getByLabel('Файл замера с фазой')).toHaveCount(0);
});
