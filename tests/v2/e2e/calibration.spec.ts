// V2-049, пакет 10г-2: подстройка модели по замеру с применением в эксперимент и сбросом, коррекция комнаты в
// конфигурации эксперимента, выбор устройств в инструменте свипа.
import { test, expect, type Page } from '@playwright/test';
import { logSweep, wavFloat32 } from '../../../src/core/dsp';

const FS = 48000;
const config = (page: Page) => page.getByRole('radiogroup', { name: 'Конфигурация' });

/** Моно WAV: низкочастотный свип 10 Гц – 1 кГц, 2 с, после 0,3 с тишины. */
function recording(): Buffer {
  const sweep = logSweep(10, 1000, 2, FS, 0.5);
  const mic = new Float32Array(sweep.length + 2 * FS);
  mic.set(sweep, Math.round(0.3 * FS));
  return Buffer.from(wavFloat32([mic], FS));
}

test('059 · подстройка модели по замеру и коррекция комнаты в эксперименте', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('./');
  await page.getByRole('radio', { name: /Продвинутый/ }).check();
  await page.getByRole('button', { name: 'Продолжить' }).click();
  await page.goto('./#/rooms/new/manual');
  await page.getByLabel('Название').fill('Гостиная');
  await page.getByRole('button', { name: 'Создать', exact: true }).click();
  await expect(page.locator('.al-plan__object').first()).toBeVisible();
  const roomUrl = page.url();
  const go = (path: string) => page.goto(roomUrl.replace(/#\/rooms\/([^/]+)\/.*$/, `#/rooms/$1/${path}`));

  await page.goto('./#/tools/sweep');
  test.skip(!await page.evaluate(() => typeof AudioContext !== 'undefined' && !!navigator.mediaDevices?.getUserMedia), 'Нет Web Audio или микрофона в этой сборке браузера (WebKit под Windows).');
  await expect(page.getByRole('button', { name: 'Обновить список' })).toBeVisible();
  await page.getByRole('radio', { name: 'Из файла WAV' }).click();
  await page.getByLabel('Файл записи WAV').setInputFiles({ name: 'bass.wav', mimeType: 'audio/wav', buffer: recording() });
  for (const [label, v] of [['Свип от', '10'], ['Свип до', '1000'], ['Длительность свипа', '2']]) {
    await page.getByLabel(label).fill(v);
    await page.getByLabel(label).press('Enter');
  }
  await page.getByRole('button', { name: 'Обработать' }).click();
  await expect(page.getByText('Запас над шумом')).toBeVisible({ timeout: 20_000 });
  await page.getByLabel('Точка микрофона').selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Сохранить в комнату' }).click();
  await expect(page.getByText(/^Замер сохранён в комнату/).last()).toBeVisible();

  await go('analysis/measurements');
  await page.getByRole('button', { name: 'Открыть замер АЧХ из файла «bass.wav»' }).click();
  const cal = page.getByRole('heading', { name: 'Подстройка модели по замеру' }).locator('xpath=..');
  await cal.getByRole('button', { name: 'Рассчитать' }).click();
  await expect(cal.getByText('Множитель затухания')).toBeVisible({ timeout: 120_000 });
  await expect(cal.getByText('Расхождение после')).toBeVisible();
  await cal.getByRole('button', { name: 'Применить в эксперимент' }).click();
  await expect(page.getByText('Подстройка применена в эксперимент: сравните его с текущей')).toBeVisible();
  await config(page).getByRole('radio', { name: 'Эксперимент' }).click();
  await expect(cal.getByText('Модель уже подстроена')).toBeVisible();
  await cal.getByRole('button', { name: 'Сбросить подстройку' }).click();
  await expect(cal.getByText('Модель уже подстроена')).toHaveCount(0);

  await go('advice/dsp');
  await page.getByRole('button', { name: 'Подобрать фильтры' }).click({ timeout: 60_000 });
  await expect(page.getByRole('list', { name: 'Фильтры коррекции' })).toBeVisible();
  await page.getByRole('button', { name: 'Сохранить в эксперименте' }).click();
  await expect(page.getByText('Коррекция сохранена в эксперименте')).toBeVisible();
  const stored = page.getByRole('list', { name: 'Сохранённые фильтры' });
  await expect(stored.getByRole('listitem').first()).toContainText('Фильтр 1:');
  await config(page).getByRole('radio', { name: 'Текущая' }).click();
  await expect(stored).toHaveCount(0);
});
