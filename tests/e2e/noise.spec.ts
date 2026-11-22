import { expect, test, type Page } from '@playwright/test';
import { EMPTY_STATE, fitsWidth, installInput, onDevice } from './helpers';
import { readFile } from 'node:fs/promises';

const start = (page: Page) => page.getByRole('button', { name: 'Начать', exact: true });
const menu = (page: Page) => page.getByRole('button', { name: 'Открыть меню' }).click();

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
    const weight = page.getByLabel('Частотное взвешивание');
    await expect(weight).toHaveValue('Z');
    await weight.focus();
    await expect(weight).toBeFocused();
    await weight.selectOption('C');
    expect(await page.locator('body').getAttribute('data-requests')).toBeNull();
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
  const liveWeight = page.getByLabel('Частотное взвешивание');
  await liveWeight.selectOption('C');
  await page.getByLabel('Спектр и полосы').selectOption('10');
  await expect(page.getByText(/PSD \(C\)/)).toBeVisible();
  await liveWeight.selectOption('A');
  await liveWeight.selectOption('Z');
  await expect(page.locator('body')).toHaveAttribute('data-requests', '1');
  await page.evaluate(() => document.dispatchEvent(new Event('test-level-step')));
  await expect(page.getByText(/RMS за 1 с · -15\.[0-2] dBFS/)).toBeVisible();
  await expect(page.getByRole('img', { name: 'История RMS' })).toBeVisible();
  await page.setViewportSize({ width: 320, height: 640 });
  expect(await fitsWidth(page)).toBe(true);
  await expect(page.locator('body')).toHaveAttribute('data-requests', '1');
  await page.getByRole('button', { name: 'Остановить' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-closed', '1');
  await page.getByLabel('Результат ручной проверки').selectOption('passed');
  await expect(page.getByText(/Цифровой sample peak за сеанс/)).toContainText('-6.0 dBFS');
  const period = page.getByLabel('Спектр и полосы');
  for (const option of ['10', '60', 'session']) await period.selectOption(option);
  const weights = page.getByLabel('Частотное взвешивание');
  for (const option of ['A', 'C', 'Z']) {
    await weights.selectOption(option);
    await expect(page.getByText(new RegExp('PSD \\(' + option + '\\)'))).toBeVisible();
  }
  // У остановленного сеанса меняется только представление сохранённых чисел.
  const levels = await page.getByText(/Leq за сеанс/).textContent();
  const bands = await page.locator('.meter__value').allTextContents();
  expect(parseFloat(bands[3])).toBeGreaterThan(99);
  await page.getByLabel('Сглаживание графика').selectOption('3');
  await page.getByLabel('Диапазон частот').selectOption('250');
  await page.getByLabel('Шкала PSD').selectOption('-140');
  await expect(page.getByText(/Leq за сеанс/)).toHaveText(levels!);
  expect(await page.locator('.meter__value').allTextContents()).toEqual(bands);
  expect(await fitsWidth(page)).toBe(true);
  await page.getByLabel('Диапазон частот').selectOption('20000');
  const download = page.waitForEvent('download');
  await page.getByLabel('Название измерения').fill('Ступени 1 кГц');
  await page.getByRole('button', {name: 'Сохранить JSON'}).click();
  const saved = await download;
  // WebKit в Linux заменяет пробелы на подчёркивания в предложенном имени файла. UX-001: без префикса noise-.
  expect(saved.suggestedFilename()).toMatch(/^Ступени[ _]1[ _]кГц\.json$/);
  const file = await saved.path();
  const json = await readFile(file!, 'utf8');
  const report = JSON.parse(json);
  expect(report.manual).toBe('passed');
  expect(report.fftSize).toBe(4096);
  expect(report.spectralAnalysis).toMatchObject({ fftSize: 32768, hopSamples: 16384, period: 'session', weight: 'Z' });
  expect(report.spectralAnalysis.psd).toHaveLength(16385);
  expect(report.spectralAnalysis.bands[3].percent).toBeGreaterThan(99);
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

test('C1 · импорт, фиксация версии сеанса, возврат без коррекции и сохранность legacy', async ({ page }) => {
  await page.goto('/#noise');
  const legacy = '{"name":"legacy-A","f":[30,60,120],"db":[1,2,3]}';
  await page.evaluate(v => localStorage.setItem('ra-mic-cal',v), legacy);
  const original = await onDevice(page);
  const settings = () => page.getByText('Настройки следующего измерения', {exact:true}).click();
  const manager = () => page.getByText('Управление профилями и импорт', {exact:true}).click();
  const selector = page.getByLabel('Профиль инструмента');
  const confirm = page.getByLabel(/Подтверждаю применимость/);
  await settings(); await manager();
  const file = page.getByLabel('Файл микрофонной калибровки');
  await file.setInputFiles({ name:'bad.csv', mimeType:'text/csv', buffer:Buffer.from('20,1\n10,2') });
  await expect(page.getByText(/строго возрастать/)).toBeVisible();
  await file.setInputFiles({ name:'test.csv', mimeType:'text/csv', buffer:Buffer.from('Hz,dB\n100,6\n10000,6') });
  // UX-002: название из имени файла без расширения.
  await expect(page.getByLabel('Название профиля')).toHaveValue('test');
  await page.getByLabel('Содержимое файла').selectOption('correction');
  await expect(page.getByRole('img', {name:'Исходная кривая и применяемая поправка'})).toBeVisible();
  await page.setViewportSize({width:320,height:800});
  expect(await fitsWidth(page)).toBe(true);
  await page.getByLabel(/Это калибровка микрофона/).check();
  await page.getByRole('button',{name:'Сохранить в каталог'}).click();
  await expect(selector.locator('option', {hasText:'test · v1'})).toHaveCount(1);
  await expect(selector).toHaveValue('none');
  await selector.selectOption({label:'test · v1'});
  await expect(start(page)).toBeDisabled();
  await confirm.check();
  await expect(start(page)).toBeEnabled();
  await page.reload(); await settings(); await manager();
  await expect(selector.locator('option:checked')).toHaveText('test · v1');
  await expect(start(page)).toBeDisabled();
  await confirm.check();
  const usable = await installInput(page, 'tone');
  if (usable) {
    await start(page).click();
    await expect(page.getByText(/Уровень по PSD с поправкой/)).toBeVisible();
    await page.getByRole('button',{name:'Остановить'}).click();
    // Settings collapse on stop. Freeze this run even after explicitly selecting none.
    await settings(); await selector.selectOption('none');
    const download = page.waitForEvent('download');
    await page.getByRole('button',{name:'Сохранить JSON'}).click();
    const report = JSON.parse(await readFile((await (await download).path())!, 'utf8'));
    expect(report.calibration.profile.version).toBe(1);
    const raw = report.spectralAnalysis.psd[683], corrected = report.calibration.correctedSpectrum.psd[683];
    expect(10*Math.log10(corrected/raw)).toBeCloseTo(6,7);
    expect(report.measurement.rmsDbfs).toBeCloseTo(-9.03,0);
    await expect(page.getByLabel('Представление спектра')).toBeVisible();
  }
  expect(await page.evaluate(() => localStorage.getItem('ra-mic-cal'))).toBe(legacy);
  expect(await onDevice(page)).toEqual(original);
  // C2: в «Анализаторе» каталог доступен, но по умолчанию — прежняя калибровка; выбор шумомера сюда не переходит.
  await page.goto('/#measure/rta');
  await expect(page.getByText(/Калибровка: legacy-A/)).toBeVisible();
  await expect(page.getByText(/Действует прежняя калибровка «legacy-A»/)).toBeVisible();
  await settings();
  await expect(selector).toHaveValue('legacy');
  await expect(selector.locator('option', {hasText:'test · v1'})).toHaveCount(1);
});

test('C1 · повреждение каталога требует явного выбора временного raw', async ({ page }) => {
  await page.goto('/#noise');
  await expect(start(page)).toBeEnabled();
  await page.evaluate(() => new Promise<void>((resolve,reject) => {
    const req = indexedDB.open('ra.micCalibration',1);
    req.onsuccess = () => {
      const db=req.result, tx=db.transaction('catalog','readwrite');
      tx.objectStore('catalog').put({schema:999},'v1');
      tx.oncomplete=()=>{db.close();resolve();}; tx.onabort=()=>reject(tx.error);
    };
  }));
  await page.reload();
  await expect(start(page)).toBeDisabled();
  await page.getByRole('button',{name:'Без коррекции на этот раз'}).click();
  await expect(start(page)).toBeEnabled();
});

test('C1 · копирование legacy, новая версия и архив с явным выбором замены', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('ra-mic-cal', JSON.stringify({name:'Исходная',f:[100,1000,8000],db:[-3,0,2]})));
  await page.goto('/#noise');
  await page.getByText('Настройки следующего измерения',{exact:true}).click();
  await page.getByText('Управление профилями и импорт',{exact:true}).click();
  await page.getByRole('button',{name:'Подготовить копию прежней калибровки'}).click();
  const save = page.getByRole('button',{name:'Сохранить в каталог'});
  await expect(save).toBeDisabled();
  await page.getByLabel(/Это калибровка микрофона/).check();
  await save.click();
  const selector=page.getByLabel('Профиль инструмента');
  await selector.selectOption({label:'Исходная · v1'});
  await page.getByRole('button',{name:'Изменить в новой версии'}).click();
  await page.getByLabel('Название профиля').fill('Персональная');
  await page.getByLabel('Предел усиления').selectOption('3');
  await page.getByLabel(/Это калибровка микрофона/).check(); await save.click();
  await expect(selector.locator('option:checked')).toHaveText('Исходная · v1');
  await page.getByLabel('Запись каталога').selectOption({label:'Исходная · v1'});
  await page.getByRole('button',{name:'Архивировать',exact:true}).click();
  const sheet=page.getByRole('alertdialog');
  await expect(sheet).toContainText('Шумомер');
  await sheet.getByRole('button',{name:'Архивировать'}).click();
  await expect(selector.locator('option:checked')).toHaveText('Выбранная версия архивирована');
  await expect(start(page)).toBeDisabled();
  await expect(page.getByText(/Запуск недоступен: выбранная версия профиля архивирована/)).toBeVisible();
  await selector.selectOption({label:'Персональная · v2'});
  await page.getByLabel(/Подтверждаю применимость/).check();
  await expect(start(page)).toBeEnabled();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('ra-mic-cal')!))).toEqual({name:'Исходная',f:[100,1000,8000],db:[-3,0,2]});
});
