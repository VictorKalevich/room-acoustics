// V2-049: запись свипа из файла WAV с петлёй — время пролёта и расстояние, сохранение в комнату с точкой и источником,
// время прихода и задержка в разделе «Измерения», среднее по точкам, поздняя привязка.
import { test, expect, type Page } from '@playwright/test';
import { logSweep, wavFloat32 } from '../../../src/core/dsp';

const FS = 48000;

/** Стерео WAV: канал 1 — микрофон (пролёт tof отсчётов, ослабление), канал 2 — петля. */
function recording(tof: number): Buffer {
  const sweep = logSweep(20, 20000, 2, FS, 1);
  const n = sweep.length + Math.round(1.5 * FS), at = Math.round(0.3 * FS);
  const mic = new Float32Array(n), loop = new Float32Array(n);
  sweep.forEach((v, i) => { loop[at + i] = v; if (at + tof + i < n) mic[at + tof + i] = 0.25 * v; });
  return Buffer.from(wavFloat32([mic, loop], FS));
}

async function processFile(page: Page, name: string, tof: number, source: string) {
  await page.getByLabel('Файл записи WAV').setInputFiles({ name, mimeType: 'audio/wav', buffer: recording(tof) });
  await expect(page.getByLabel('Канал петли (loopback)')).toHaveValue('1');
  await page.getByLabel('Длительность свипа').fill('2');
  await page.getByLabel('Длительность свипа').press('Enter');
  await page.getByRole('button', { name: 'Обработать' }).click();
  await expect(page.getByText('Время пролёта по петле')).toBeVisible({ timeout: 20_000 });
  await page.getByLabel('Точка микрофона').selectOption({ index: 1 });
  await page.getByLabel('Что звучало').selectOption({ label: source });
  await page.getByRole('button', { name: 'Сохранить в комнату' }).click();
  await expect(page.getByText(/^Замер сохранён в комнату/).last()).toBeVisible();
}

test('059 · запись из файла: петля, время прихода, среднее по точкам, привязка', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('./');
  await page.getByRole('radio', { name: /Простой/ }).check();
  await page.getByRole('button', { name: 'Продолжить' }).click();
  await page.goto('./#/rooms/new');
  await page.getByLabel('Название').fill('Гостиная');
  await page.getByRole('button', { name: 'Создать', exact: true }).click();
  await expect(page.locator('.al-plan__object').first()).toBeVisible();
  const roomUrl = page.url();

  await page.goto('./#/tools/sweep');
  await page.getByRole('radio', { name: 'Из файла WAV' }).click();
  await processFile(page, 'left.wav', 480, 'Левая колонка');
  await expect(page.getByText('10,00 мс', { exact: true })).toBeVisible();
  await expect(page.getByText('3,43 м', { exact: true })).toBeVisible();
  await processFile(page, 'right.wav', 600, 'Правая колонка');

  await page.goto(roomUrl.replace(/#\/rooms\/([^/]+)\/.*$/, '#/rooms/$1/analysis/measurements'));
  const table = page.getByRole('table', { name: 'Замеры комнаты' });
  await expect(table.getByRole('row')).toHaveCount(3);
  await expect(table).toContainText('Левая колонка');
  const timing = page.getByRole('table', { name: /^Время прихода: / });
  await expect(timing.getByRole('row').filter({ hasText: 'Левая колонка' })).toContainText('2,50 мс');
  await expect(timing.getByRole('row').filter({ hasText: 'Правая колонка' })).toContainText('не нужно');

  const pick = page.getByRole('group', { name: 'Замеры для среднего' });
  await pick.getByRole('checkbox').nth(0).check();
  await pick.getByRole('checkbox').nth(1).check();
  await page.getByRole('button', { name: 'Усреднить (2)' }).click();
  await expect(page.getByText('Наибольший разброс')).toBeVisible();
  await page.getByRole('button', { name: 'Сохранить среднее' }).click();
  await expect(table.getByRole('row')).toHaveCount(4);
  await expect(table).toContainText('Среднее по 2 точкам');

  await page.getByRole('button', { name: 'Привязать замер АЧХ из файла «left.wav»' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Что звучало').selectOption({ label: 'Все источники' });
  await dialog.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByText('Привязка замера сохранена')).toBeVisible();
  await expect(table.getByRole('row').filter({ hasText: 'left.wav' })).toContainText('Левая колонка, Правая колонка');
  await expect(table.getByRole('row').filter({ hasText: 'left.wav' })).toContainText('нет, привязан позже');
});
