// V2-036–V2-040: все 23 инструмента открываются; калькулятор берёт параметры из комнаты и сохраняет расчёт в
// «Мои данные»; эквалайзер экспортирует и сохраняет пресет; генератор запускается и останавливается только
// кнопкой. Шумомер с тестовым микрофоном — tools-mic.spec.ts.
import { test, expect, type Page } from '@playwright/test';

const TOOL_IDS = [
  'noise-meter', 'rta', 'sweep', 'decay', 'signal-generator', 'test-signals', 'wavelength', 'room-modes', 'sbir', 'reverb', 'distance-delay', 'room-geometry',
  'absorber', 'bass-trap', 'diffuser', 'resonator', 'materials-compare', 'equalizer', 'crossover', 'phase-delay', 'stereo-triangle', 'spl-headroom', 'directivity',
];

async function firstRun(page: Page) {
  await page.goto('./');
  await page.getByRole('radio', { name: /Простой/ }).check();
  await page.getByRole('button', { name: 'Продолжить' }).click();
}

async function createRoom(page: Page, name: string) {
  await page.goto('./#/rooms/new');
  await page.getByLabel('Название').fill(name);
  await page.getByRole('button', { name: 'Создать', exact: true }).click();
  await expect(page.locator('.al-plan__object').first()).toBeVisible();
}

test('059 · инструменты: все экраны открываются без ошибок', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await firstRun(page);
  for (const id of TOOL_IDS) {
    await page.goto(`./#/tools/${id}`);
    await expect(page.locator('h1')).toBeVisible();
    await expect(page.locator('.al-card').first()).toBeVisible();
    await expect(page.getByText('Инструмент недоступен')).toHaveCount(0);
  }
  expect(errors).toEqual([]);
});

test('059 · калькулятор: размеры из комнаты, сохранение расчёта в «Мои данные»', async ({ page }) => {
  await firstRun(page);
  await createRoom(page, 'Кабинет');
  await page.goto('./#/tools/room-modes');
  const table = page.getByRole('table', { name: 'Моды комнаты' });
  await expect(table).toContainText('34,3 Гц');
  await page.getByRole('button', { name: 'Размеры из комнаты «Кабинет»' }).click();
  await expect(page.getByLabel('Длина (от передней стены)')).toHaveValue('5');
  await page.getByLabel('Длина (от передней стены)').fill('4');
  await page.getByLabel('Длина (от передней стены)').press('Enter');
  await expect(table).toContainText('42,9 Гц');
  await page.getByRole('button', { name: 'Сохранить расчёт' }).click();
  await expect(page.getByText('Сохранено в «Мои данные» → «Расчёты»')).toBeVisible();
  await page.goto('./#/library/calculations');
  await expect(page.getByText('Моды 4,00 × 4,00 × 2,50 м')).toBeVisible();

  await page.goto('./#/tools/wavelength');
  await page.getByLabel('Частота', { exact: true }).fill('343,2');
  await page.getByLabel('Частота', { exact: true }).press('Enter');
  await expect(page.getByRole('list', { name: 'Результат' })).toContainText('1,00');
});

test('059 · эквалайзер: фильтры, экспорт Equalizer APO, пресет в библиотеке', async ({ page }) => {
  await firstRun(page);
  await page.goto('./#/tools/equalizer');
  await page.getByRole('button', { name: 'Добавить фильтр' }).click();
  await expect(page.getByRole('list', { name: 'Цепочка фильтров' }).getByRole('listitem')).toHaveCount(2);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Equalizer APO' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('Эквалайзер_EqualizerAPO.txt');
  await page.getByLabel('Название', { exact: true }).fill('Бас');
  await page.getByRole('button', { name: 'Сохранить пресет' }).click();
  await expect(page.getByText('Сохранено в «Мои данные» → «Пресеты DSP»')).toBeVisible();
  await page.getByRole('button', { name: 'Удалить фильтр 2' }).click();
  await page.getByLabel('Пресет из библиотеки').selectOption({ label: 'Бас' });
  await page.getByRole('button', { name: 'Загрузить' }).click();
  await expect(page.getByRole('list', { name: 'Цепочка фильтров' }).getByRole('listitem')).toHaveCount(2);
});

test('059 · генератор: запуск только кнопкой, «Стоп», остановка при уходе со страницы, WAV', async ({ page }) => {
  await firstRun(page);
  test.skip(!await page.evaluate(() => typeof AudioContext !== 'undefined'), 'Нет Web Audio в этой сборке браузера (WebKit под Windows).');
  await page.goto('./#/tools/signal-generator');
  await expect(page.getByRole('button', { name: 'Стоп' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Воспроизвести' }).click();
  await expect(page.getByRole('button', { name: 'Стоп' })).toBeVisible();
  await page.getByRole('button', { name: 'Стоп' }).click();
  await expect(page.getByRole('button', { name: 'Воспроизвести' })).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Скачать WAV' }).click();
  expect((await download).suggestedFilename()).toBe('pink_-20dBFS_10s_both_48k.wav');

  // ступенчатый синус: длительность по ступеням, свой список частот, файл 96 кГц
  await page.getByLabel('Вид').selectOption({ label: 'Ступенчатый синус' });
  await expect(page.getByText('10 ступеней, всего 10 с; воспроизводится один раз.')).toBeVisible();
  await page.getByLabel('Свои частоты, Гц').fill('63, 125, 250');
  await expect(page.getByText('3 ступеней, всего 3 с; воспроизводится один раз.')).toBeVisible();
  await page.getByLabel('Частота файла WAV').selectOption('96000');
  const stepped = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Скачать WAV' }).click();
  expect((await stepped).suggestedFilename()).toBe('stepped_-20dBFS_3s_both_96k.wav');
  await page.getByLabel('Вид').selectOption({ label: 'Пакеты синусоид' });
  await page.getByLabel('Периодов в пакете').fill('1000');
  await page.getByLabel('Периодов в пакете').blur();
  await expect(page.getByText('Период повтора должен быть длиннее пакета.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Скачать WAV' })).toBeDisabled();
  await page.getByLabel('Вид').selectOption({ label: 'Розовый шум' });

  await page.getByRole('button', { name: 'Воспроизвести' }).click();
  await expect(page.getByRole('button', { name: 'Стоп' })).toBeVisible();
  await page.goto('./#/tools');
  await page.goto('./#/tools/signal-generator');
  await expect(page.getByRole('button', { name: 'Воспроизвести' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Стоп' })).toHaveCount(0);
});
