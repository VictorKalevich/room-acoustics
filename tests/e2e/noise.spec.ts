import { expect, test, type Page } from '@playwright/test';
import { EMPTY_STATE, fitsWidth, onDevice } from './helpers';
import { readFile } from 'node:fs/promises';

const start = (page: Page) => page.getByRole('button', { name: 'Начать', exact: true });
const menu = (page: Page) => page.getByRole('button', { name: 'Открыть меню' }).click();

// Устанавливаем вход в основном JS-мире загруженной страницы. WebKit может заново
// создать JS-обёртку нативного MediaDevices и потерять переопределённый на ней метод.
async function installInput(page: Page, scenario: 'deny' | 'pending' | 'tone') {
  return page.evaluate(mode => {
    const devices = new EventTarget();
    Object.defineProperty(navigator, 'mediaDevices', { value: devices, configurable: true });
    if (mode === 'tone' && !window.AudioContext?.prototype.createMediaStreamDestination) return false;
    if (!window.AudioContext) Object.defineProperty(window, 'AudioContext', { value: class { state = 'running'; close() { return Promise.resolve(); } } });
    Object.defineProperty(navigator, 'canShare', { value: () => false });
    let ctx: AudioContext;
    Object.assign(devices, { async getUserMedia() {
      document.body.dataset.requests = String(1 + Number(document.body.dataset.requests || 0));
      if (mode === 'deny') throw new DOMException('', 'NotAllowedError');
      if (mode === 'pending') return new Promise(resolve => {
        document.addEventListener('grant', () => resolve({
          getTracks: () => [{ stop: () => { document.body.dataset.closed = 'yes'; } }],
        }), { once: true });
      });
      // Синус идёт через настоящий Web Audio только на виртуальную входную дорожку.
      ctx ??= new AudioContext();
      await ctx.resume();
      const dest = ctx.createMediaStreamDestination();
      const osc = ctx.createOscillator();
      osc.frequency.value = 1000;
      const gain = ctx.createGain();
      gain.gain.value = document.body.dataset.requests === '2' ? 0.25 : 0.5;
      document.addEventListener('test-level-step', () => { gain.gain.value = 0.25; }, {once: true});
      osc.connect(gain).connect(dest);
      osc.start();
      const track = dest.stream.getAudioTracks()[0];
      const stop = track.stop.bind(track);
      track.stop = () => {
        stop(); osc.stop(); gain.disconnect(); osc.disconnect();
        document.body.dataset.closed = String(1 + Number(document.body.dataset.closed || 0));
      };
      document.addEventListener('test-mute', () => track.dispatchEvent(new Event('mute')), { once: true });
      return dest.stream;
    } });
    return true;
  }, scenario);
}

test.describe('первый запуск', () => {
  test.use({ storageState: EMPTY_STATE });
  test('меню до создания комнаты, история и отказ', async ({ page }) => {
    await page.goto('/#room');
    await installInput(page, 'deny');
    await menu(page);
    await expect(page.getByRole('button', { name: 'Закрыть меню' })).toBeVisible();
    await page.getByRole('button', { name: /Шумомер/ }).click();
    await expect(page).toHaveURL(/#noise$/);
    await expect(start(page)).toBeEnabled();
    expect(await page.locator('body').getAttribute('data-requests')).toBeNull();
    await page.setViewportSize({ width: 320, height: 640 });
    expect(await fitsWidth(page)).toBe(true);
    await start(page).click();
    await expect(page.getByText(/Доступ запрещён/)).toBeVisible();
    await expect(page.getByRole('img', { name: 'Спектр входного сигнала' })).toHaveCount(0);
    await start(page).click();
    await expect(page.locator('body')).toHaveAttribute('data-requests', '2');
    await page.goBack();
    await expect(page.locator('.start-card')).toBeVisible();
    await page.goForward();
    await expect(start(page)).toBeEnabled();
  });
});

test('рабочая комната, тестовый PCM, JSON, остановка и сохранность старой калибровки', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('ra-mic-cal', '{"name":"legacy-A","f":[30,60,120],"db":[1,2,3]}');
  });
  await page.goto('/#measure/rta');
  const hasVirtualInput = await installInput(page, 'tone');
  await expect(page.locator('h1')).toHaveText('Измерения');
  const original = await onDevice(page);
  await menu(page);
  await page.getByRole('button', { name: /Шумомер/ }).click();
  await start(page).click();
  if (!hasVirtualInput) {
    await expect(page.getByRole('status').filter({hasText: /Safari|микрофон/i})).toBeVisible();
    await expect(page.getByRole('img', {name: 'Спектр входного сигнала'})).toHaveCount(0);
    return;
  }
  await expect(page.locator('body')).toHaveAttribute('data-requests', '1');
  await expect(page.locator('.rta-big strong:visible')).toHaveText(/-9\.[0-2]/);
  const chart = page.getByRole('img', {name: 'Спектр входного сигнала'});
  await expect(chart).toBeVisible();
  await expect(page.getByText(/RMS за 1 с · -9\.[0-2] dBFS/)).toBeVisible();
  await page.evaluate(() => document.dispatchEvent(new Event('test-level-step')));
  await expect(page.getByText(/RMS за 1 с · -15\.[0-2] dBFS/)).toBeVisible();
  await expect(page.getByRole('img', { name: 'История RMS' })).toBeVisible();
  await page.setViewportSize({ width: 320, height: 640 });
  expect(await fitsWidth(page)).toBe(true);
  await expect(page.locator('body')).toHaveAttribute('data-requests', '1');
  await page.getByRole('button', { name: 'Остановить' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-closed', '1');
  await page.getByLabel('Результат ручной проверки').selectOption('passed');
  const download = page.waitForEvent('download');
  await page.getByLabel('Название измерения').fill('Ступени 1 кГц');
  await page.getByRole('button', {name: 'Сохранить JSON'}).click();
  const saved = await download;
  // WebKit в Linux заменяет пробелы на подчёркивания в предложенном имени файла.
  expect(saved.suggestedFilename()).toMatch(/^noise-Ступени[ _]1[ _]кГц\.json$/);
  const file = await saved.path();
  const json = await readFile(file!, 'utf8');
  const report = JSON.parse(json);
  expect(report.manual).toBe('passed');
  expect(report.measurement.rmsDbfs).toBeCloseTo(-15.05, 0);
  expect(report.name).toBe('Ступени 1 кГц');
  expect(report.history.length).toBe(report.measurement.blocks);
  expect(report.history[0].windowComplete).toBe(false);
  expect(report.history.at(-1).rms1sDbfs).toBeCloseTo(-15.05, 0);
  let endSeconds = 0;
  for (const row of report.history) {
    expect(row.endSeconds).toBeCloseTo(endSeconds + (1 + row.missingBefore) * report.fftSize / report.path.sampleRate, 8);
    expect(Math.abs(Date.parse(row.timestamp) - (report.audioStartMs + row.endSeconds * 1000))).toBeLessThan(1);
    expect(typeof row.clipped).toBe('boolean');
    endSeconds = row.endSeconds;
  }
  expect(Math.abs(report.measurement.peakHz - 1000)).toBeLessThan(report.path.sampleRate / report.fftSize);
  expect(json).not.toMatch(/deviceId|groupId|"pcm"|"label"/i);
  await page.getByRole('button', { name: 'Сбросить' }).click();
  await expect(page.locator('.rta-big strong:visible')).toHaveText('—');
  // Моделируем открывшийся Worklet, который при повторном старте не передал ни одного блока.
  await page.evaluate(() => {
    const post = MessagePort.prototype.postMessage;
    MessagePort.prototype.postMessage = function (message: unknown, options?: StructuredSerializeOptions | Transferable[]) {
      if (message === 'stream' && document.body.dataset.requests === '2') return;
      Reflect.apply(post, this, [message, options]);
    };
  });
  await start(page).click();
  await expect(page.locator('.rta-big strong:visible')).toHaveText(/-15\.[0-2]/, {timeout: 10000});
  await expect(page.getByText(/Обработка PCM · ScriptProcessor/)).toBeVisible();
  await expect(page.locator('body')).toHaveAttribute('data-requests', '2');
  await expect(chart).toBeVisible();
  await page.evaluate(() => document.dispatchEvent(new Event('test-mute')));
  await expect(page.getByText(/Сигнал микрофона прерван/)).toBeVisible();
  await start(page).click();
  await expect(chart).toBeVisible();
  await page.goBack();
  await expect(page.locator('body')).toHaveAttribute('data-closed', '3');
  await expect(page.locator('h1')).toHaveText('Измерения');
  expect(await page.evaluate(() => localStorage.getItem('ra-mic-cal'))).toBe('{"name":"legacy-A","f":[30,60,120],"db":[1,2,3]}');
  expect((await onDevice(page)).draft).toEqual(original.draft);
});

test('позднее разрешение после ухода освобождает дорожку', async ({ page }) => {
  await page.goto('/#noise');
  await installInput(page, 'pending');
  await start(page).click();
  await expect(page.locator('body')).toHaveAttribute('data-requests', '1');
  await expect(start(page)).toBeDisabled();
  await expect(page.getByText('Ожидаем доступ к микрофону')).toBeVisible();
  await menu(page);
  await page.getByRole('button', {name: /Помощник и словарь/}).click();
  await page.evaluate(() => document.dispatchEvent(new Event('grant')));
  await expect(page.locator('body')).toHaveAttribute('data-closed', 'yes');
});
