import { expect, test, type Locator, type Page } from '@playwright/test';
import { computeModes } from '../../src/core/modes';
import { exportRecord } from '../../src/core/noiseFile';
import { roomSnapshot } from '../../src/core/noiseModes';
import { defaultRoom } from '../../src/state/project';
import { BUILD, sessionRecord, toneMeter } from '../fixtures/noise';
import { fitsWidth, installInput, onDevice, openDetail } from './helpers';

// 057: расчётные моды на спектре шумомера, снимок комнаты в записи, смена входа в инструментах.
const json = (name: string, text: string) => ({ name, mimeType: 'application/json', buffer: Buffer.from(text) });
const studio = { ...defaultRoom(), depth: 5, width: 4, height: 2.5 };
const studioModes = computeModes(studio, 300);
const axialX = studioModes.find(m => m.n.join() === '1,0,0')!;
const base = (id: string, name: string) => sessionRecord(toneMeter({ seconds: 12, hz: axialX.f, amp: 0.1 }), { id, name });
const linked = (() => {
  const r = base('e2e-modes-linked', 'Студия, снимок');
  return exportRecord({ ...r, project: { id: 'other-project', name: 'Другая студия' }, context: { ...r.context, room: roomSnapshot(studio, studioModes, 300, 140) } }, BUILD);
})();
const bare = (() => {
  const r = base('e2e-modes-bare', 'Студия, без снимка');
  return exportRecord({ ...r, project: { id: 'other-project', name: 'Другая студия' } }, BUILD);
})();
const free = exportRecord(base('e2e-modes-free', 'Без проекта'), BUILD);

const showModes = (scope: Page | Locator) => scope.getByLabel('Моды комнаты на спектре', { exact: true });
const marks = (scope: Page | Locator) => scope.locator('svg[aria-label="Спектр входного сигнала"] .chart__mode.is-overlay');
const peaks = (scope: Page | Locator) => scope.locator('summary', { hasText: 'Пики шума и возможные соответствия' });
const library = (page: Page) => page.getByRole('dialog', { name: 'Сохранённые измерения', exact: true });
async function importFile(page: Page, file: ReturnType<typeof json>) {
  const lib = library(page);
  await expect(lib.getByRole('button', { name: 'Импорт JSON', exact: true })).toBeEnabled();
  await lib.getByLabel('Файл измерения JSON', { exact: true }).setInputFiles(file);
}
const devicechange = (page: Page) => page.evaluate(() => navigator.mediaDevices.dispatchEvent(new Event('devicechange')));

test('057 · моды на живом спектре: выкл. по умолчанию, типы, диапазон, подробности, пики, связь и снимок комнаты', async ({ page }) => {
  await page.goto('/#noise');
  if (!await installInput(page, 'tone')) test.skip(true, 'Нет виртуального входа в этом движке: моды записи проверяются импортом.');
  await expect(showModes(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Начать', exact: true }).click();
  await expect(page.getByText(/Время принятого сигнала · (9|\d\d)\.\d с/)).toBeVisible({ timeout: 20000 });
  await expect(showModes(page)).toHaveValue('none');
  await expect(marks(page)).toHaveCount(0);

  await showModes(page).selectOption('axial');
  // вертикальная линия SVG без ширины для Playwright «невидима»: проверяем число
  await expect.poll(() => marks(page).count()).toBeGreaterThan(0);
  expect(await marks(page).evaluateAll(lines => lines.every(l => l.classList.contains('chart__mode--axial')))).toBe(true);
  await expect(page.getByText(/Расчётные моды комнаты проекта «.+» на момент измерения: 5,00 × 4,00 × [\d,]+ м, 20 °C, c = 343,2 м\/с/)).toBeVisible();
  await page.getByLabel('Диапазон частот').selectOption('250');
  await expect(page.getByText(/^Мод в диапазоне графика: \d+$/)).toBeVisible();
  await showModes(page).selectOption('all');
  await expect(page.getByText(/^Показано 24 из \d+ мод: сначала осевые/)).toBeVisible();
  await expect(marks(page)).toHaveCount(24);
  const pick = page.getByLabel('Подробности моды', { exact: true });
  await pick.selectOption({ index: 1 });
  await expect(page.getByText(/^Расчётная частота [\d,]+ Гц · осевая мода \(1, 0, 0\) · по глубине/)).toBeVisible();
  await expect(marks(page).and(page.locator('.is-selected'))).toHaveCount(1);

  await peaks(page).click();
  await expect(page.getByText('Для поиска пиков нужен средний спектр не короче 8,2 с', { exact: false })).toBeVisible();
  await page.getByLabel('Спектр и полосы').selectOption('session');
  await expect(page.getByText(/^Поиск от 2\d,\d до [\d,]+ Гц по показанному спектру без сглаживания: шаг 1,465 Гц/)).toBeVisible();
  await expect(page.getByText(/Совпадение частот не доказывает, что пик вызван модой/)).toBeVisible();
  await expect(page.getByText(/Пассивный шум — не АЧХ комнаты, не передаточная функция, не SBIR и не RT60/)).toBeVisible();
  await page.setViewportSize({ width: 320, height: 640 });
  expect(await fitsWidth(page)).toBe(true);
  await page.setViewportSize({ width: 393, height: 852 });

  await page.getByRole('button', { name: 'Остановить' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-closed', '1');
  const before = await onDevice(page);
  await page.getByLabel('Название измерения').fill('Моды 057');
  await page.getByRole('checkbox', { name: /^Связать с проектом/ }).check();
  await page.getByRole('button', { name: 'Сохранить в историю' }).click();
  await expect(page.getByText('Сохранено в историю: «Моды 057»')).toBeVisible();
  // связь — только сведения в записи: проект не меняется
  expect((await onDevice(page)).draft).toEqual(before.draft);

  // Размеры комнаты изменились после измерения: показывается расчёт на момент измерения.
  await page.goto('/#room/size');
  await page.getByLabel('Глубина', { exact: true }).fill('6');
  await page.getByLabel('Глубина', { exact: true }).blur();
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.locator('.topbar__room')).toContainText('6,00 × 4,00');
  await page.goto('/#noise');
  await showModes(page).selectOption('axial');
  await expect(page.getByText(/на момент измерения: 5,00 × 4,00/)).toBeVisible();
  await expect(page.getByText(/Размеры или температура комнаты в проекте изменились после измерения/)).toBeVisible();

  const lib = await openDetail(page, 'Сохранённые измерения');
  const record = await openDetail(page, 'Моды 057');
  await expect(record.getByRole('row', { name: /^Проект/ })).toContainText(/снимок комнаты: 5,00 × 4,00 × [\d,]+ м/);
  await showModes(record).selectOption('axial');
  await expect(record.getByText(/на момент измерения: 5,00 × 4,00/)).toBeVisible();
  await expect(record.getByText(/Размеры или температура комнаты в проекте изменились/)).toBeVisible();
  await expect.poll(() => marks(record).count()).toBeGreaterThan(0);
  await expect(lib).toBeVisible();

  // Другой проект: показанное измерение остаётся с комнатой своего проекта, связать его с открытым нельзя.
  await page.goto('/#projects');
  await page.getByRole('button', { name: 'Новый проект' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Открыть новый проект' }).click();
  await page.goto('/#noise');
  await expect(page.getByText(/^Измерение начато в проекте «.+»: с открытым проектом его не связать\.$/)).toBeVisible();
  await expect(page.getByRole('checkbox', { name: /^Связать с проектом/ })).toHaveCount(0);
  await showModes(page).selectOption('axial');
  await expect(page.getByText(/Расчётные моды комнаты проекта «.+» на момент измерения: 5,00 × 4,00/)).toBeVisible();
});

test('057 · записи истории: снимок другого проекта, связь без снимка, запись без проекта', async ({ page }) => {
  await page.goto('/#noise');
  await installInput(page, 'deny');
  const lib = await openDetail(page, 'Сохранённые измерения');
  for (const [file, text, name] of [['linked.json', linked, 'Студия, снимок'], ['bare.json', bare, 'Студия, без снимка'], ['free.json', free, 'Без проекта']] as const) {
    await importFile(page, json(file, text));
    await expect(lib.getByText(`Импортировано: «${name}», schema 4`)).toBeVisible();
  }
  const record = await openDetail(page, 'Студия, снимок');
  await showModes(record).selectOption('planar');
  await expect(record.getByText(/Расчётные моды комнаты проекта «Другая студия» на момент измерения: 5,00 × 4,00 × 2,50 м/)).toBeVisible();
  await expect(record.getByText(/изменились после измерения/)).toHaveCount(0);
  await record.getByLabel('Спектр и полосы').selectOption('session');
  await peaks(record).click();
  const first = record.locator('.plain-list li', { hasText: /^Измеренный пик 3[3-5],\d Гц/ });
  await expect(first).toContainText(/Возможные соответствия в пределах ±[\d,]+ Гц: [\d,]+ Гц · осевая \(1, 0, 0\)/);
  await page.setViewportSize({ width: 320, height: 640 });
  expect(await fitsWidth(page)).toBe(true);
  await page.setViewportSize({ width: 393, height: 852 });
  await record.getByRole('button', { name: '← Назад' }).click();

  const noSnapshot = await openDetail(page, 'Студия, без снимка');
  await expect(noSnapshot.getByText(/нет снимка комнаты: расчётные моды не показываются/)).toBeVisible();
  await expect(showModes(noSnapshot)).toHaveCount(0);
  await noSnapshot.getByRole('button', { name: '← Назад' }).click();
  const unlinked = await openDetail(page, 'Без проекта');
  await expect(unlinked.getByRole('img', { name: 'Спектр входного сигнала' })).toBeVisible();
  await expect(showModes(unlinked)).toHaveCount(0);
  await expect(unlinked.getByText(/снимка комнаты/)).toHaveCount(0);
  await expect(page.locator('body')).not.toHaveAttribute('data-requests', /./);
});

test('057 · смена входа без профиля каталога: анализатор, хлопок, свип и шумомер', async ({ page }) => {
  await page.goto('/#measure/rta');
  // постоянный deviceId, как у настоящего входа: виртуальная дорожка без него получала бы новый при каждом открытии
  if (!await installInput(page, 'tone', 'test-input')) test.skip(true, 'Нет виртуального входа в этом движке.');
  // Анализатор: стоп, текущая кривая сброшена, запомненная осталась, повторный запуск не требует подтверждения.
  await page.getByRole('button', { name: 'Включить анализатор' }).click();
  await page.getByRole('button', { name: 'Запомнить кривую' }).click();
  await devicechange(page);
  await expect(page.getByText(/Список аудиоустройств изменился\. .*текущая кривая сброшена, запомненные кривые сохранены/)).toBeVisible();
  await expect(page.locator('body')).toHaveAttribute('data-closed', '1');
  await expect(page.getByRole('button', { name: 'Включить анализатор' })).toBeEnabled();
  await expect(page.getByText('Синяя — сейчас; тонкие — запомненные (1).')).toBeVisible();

  // Хлопок: серия продолжается только после подтверждения; хлопок во время смены не принимается.
  await page.goto('/#measure/clap');
  const clap = page.getByRole('button', { name: 'Записать хлопок' });
  await clap.click();
  await expect(page.getByText(/^Хлопков: 1\./)).toBeVisible({ timeout: 10000 });
  await devicechange(page);
  await clap.click();
  const sheet = page.getByRole('alertdialog');
  await expect(sheet).toContainText('Браузер не сообщает надёжно, остался ли вход прежним');
  await sheet.getByRole('button', { name: 'Отмена' }).click();
  await expect(sheet).toHaveCount(0);
  await expect(clap).toBeEnabled();
  const requests = Number(await page.locator('body').getAttribute('data-requests'));
  await clap.click();
  await sheet.getByRole('button', { name: 'Вход тот же — продолжить' }).click();
  await expect(page.getByRole('button', { name: 'Хлопайте!' })).toBeVisible();
  // вход открыт заново после смены
  expect(Number(await page.locator('body').getAttribute('data-requests'))).toBe(requests + 1);
  await devicechange(page);
  await expect(page.getByText('Во время записи изменился список аудиоустройств: эта точка не принята', { exact: false })).toBeVisible({ timeout: 10000 });
  await expect(page.getByText(/^Хлопков: 1\./)).toBeVisible();
  await clap.click();
  await sheet.getByRole('button', { name: 'Вход тот же — продолжить' }).click();
  await expect(page.getByText(/^Хлопков: 2\./)).toBeVisible({ timeout: 10000 });
  // Другой deviceId у заново открытого входа — другой вход: серия не продолжается даже после подтверждения.
  await devicechange(page);
  await page.evaluate(() => {
    const devices = navigator.mediaDevices, open = devices.getUserMedia.bind(devices);
    devices.getUserMedia = async constraints => {
      const stream = await open(constraints), track = stream.getAudioTracks()[0], settings = track.getSettings.bind(track);
      track.getSettings = () => ({ ...settings(), deviceId: 'other-input' });
      return stream;
    };
  });
  await clap.click();
  await sheet.getByRole('button', { name: 'Вход тот же — продолжить' }).click();
  await expect(page.getByText(/^Открыт другой вход, чем у записанных точек/)).toBeVisible();
  await expect(page.getByText(/^Хлопков: 2\./)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Хлопайте!' })).toHaveCount(0);

  // Свип: точка, во время которой сменились устройства, не принимается.
  await page.goto('/#measure/sweep');
  await page.getByRole('button', { name: 'Записать точку 1' }).click();
  await expect(page.getByRole('button', { name: 'Стоп' })).toBeVisible();
  await devicechange(page);
  await page.getByRole('button', { name: 'Стоп' }).click();
  await expect(page.getByText('Во время записи изменился список аудиоустройств: эта точка не принята', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Записать точку 1' })).toBeEnabled();

  // Шумомер: остановка, полученные данные сохраняются и доступны для сохранения.
  await page.goto('/#noise');
  await page.getByRole('button', { name: 'Начать', exact: true }).click();
  await expect(page.getByText(/Время принятого сигнала · [1-9]\.\d с/)).toBeVisible({ timeout: 15000 });
  await devicechange(page);
  await expect(page.getByRole('status').filter({ hasText: 'Список аудиоустройств изменился. Проверьте источник и начните снова.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Сохранить в историю' })).toBeEnabled();
  await page.locator('summary', { hasText: /^События входа за время захвата: 1$/ }).click();
  await expect(page.getByText(/изменился список аудиоустройств \(devicechange\)/)).toBeVisible();
  await expect(page.getByText(/^Запуск · вкладка браузера/)).toBeVisible();
});
