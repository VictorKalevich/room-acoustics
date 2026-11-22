// Общие шаги сценариев 021/022 и ожидания событий вместо пауз (033).
import { expect, type Page, type TestInfo } from '@playwright/test';
import type { Room } from '../../src/core/types';
import type { Project } from '../../src/state/project';

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

/**
 * «Настроить комнату вручную» на карточке «С чего начать» (настройка начинается с шага «Размеры») — и дождаться фокуса
 * в «Глубине». Приложение ставит его через два кадра после перехода; `fill` ставит фокус в поле и отдельной командой
 * вводит текст, и пришедший между ними кадр увёл бы текст в «Глубину» (033).
 */
export async function startManualRoom(page: Page) {
  await page.locator('.start-card').getByRole('button', { name: 'Настроить комнату вручную' }).click();
  await expect(page.getByLabel('Глубина', { exact: true })).toBeFocused();
}

/**
 * Боковое меню открыто: фокус на первом пункте. Обработчик Escape подключается вместе с фокусом, с 046 — до отрисовки
 * кадра (`src/ui/components/Drawer.tsx`), поэтому Escape закрывает меню и без этого ожидания (033).
 */
export const menuReady = (page: Page) => expect(page.locator('.drawer__item').first()).toBeFocused();

/** Что лежит на устройстве (IndexedDB «room-acoustics»): черновик рабочего проекта и id проектов с сохранённым сканом. */
interface OnDevice {
  /** Черновик (`meta/draft`) — его откроет следующий запуск; null — записи нет. */
  draft: Project | null;
  /** Проекты, скан которых хранится на устройстве (020, хранилище `scans`). */
  scans: string[];
}

/** Прочитать хранилище приложения напрямую. Базу, которой ещё нет, не создаёт; своё соединение закрывает. */
export const onDevice = (page: Page) => page.evaluate(() => new Promise<OnDevice>((resolve, reject) => {
  const none: OnDevice = { draft: null, scans: [] };
  const req = indexedDB.open('room-acoustics');
  // базы ещё нет: отмена создания, иначе приложение не открыло бы её своей версией
  req.onupgradeneeded = () => req.transaction?.abort();
  req.onerror = () => resolve(none);
  req.onsuccess = () => {
    const db = req.result;
    if (!db.objectStoreNames.contains('meta') || !db.objectStoreNames.contains('scans')) { db.close(); resolve(none); return; }
    const t = db.transaction(['meta', 'scans'], 'readonly');
    const draft = t.objectStore('meta').get('draft');
    const scans = t.objectStore('scans').getAllKeys();
    t.oncomplete = () => { db.close(); resolve({ draft: draft.result ?? null, scans: scans.result.map(String) }); };
    t.onerror = () => { db.close(); reject(t.error); };
  };
}));

/**
 * Дождаться, пока рабочий проект записан на устройство таким, каким его должен открыть следующий запуск: проект
 * пишется через 300 мс после последнего изменения (`src/ui/useProject.ts`), ожидание — по содержимому черновика (033).
 */
export async function draftSaved(page: Page, what: string, ready: (draft: Project, scans: string[]) => boolean) {
  await expect.poll(async () => {
    const { draft, scans } = await onDevice(page);
    return !!draft && ready(draft, scans);
  }, { message: `на устройстве не записано: ${what}` }).toBe(true);
}

/**
 * Черновик конструктора комнаты рабочего проекта (021): правки до «Сохранить» в проект не попадают, а сразу пишутся в
 * localStorage `ra-room-draft-<проект>` (`src/ui/roomDraft.ts`). null — черновика нет.
 */
export async function roomDraft(page: Page): Promise<{ room: Room } | null> {
  const { draft } = await onDevice(page);
  if (!draft) return null;
  return page.evaluate((id) => JSON.parse(localStorage.getItem(`ra-room-draft-${id}`) ?? 'null'), draft.id);
}

/** Выбрать файл скана на карточке «С чего начать» и дождаться шага «Размеры» проверки комнаты. */
export async function scanToSteps(page: Page, file: string) {
  await page.setInputFiles('#scan-file', file);
  await expect(page.getByRole('heading', { name: 'Шаг 1 из 4: Размеры' })).toBeVisible({ timeout: 30_000 });
}

/**
 * Страница не шире окна. Сравнение — с `clientWidth`: в мобильной эмуляции Chrome `innerWidth` растёт до ширины
 * содержимого, и сравнение с ним переполнения не замечает (047).
 */
export const fitsWidth = (page: Page, slack = 0) =>
  page.evaluate((s) => document.documentElement.scrollWidth <= document.documentElement.clientWidth + s, slack);

/** Журнал ошибок на устройстве (028). */
export const errlog = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('ra-errors') ?? '[]') as { msg: string; ctx?: string }[]);

/** Сообщение о сбое (028, 029) помещается без горизонтальной прокрутки на 320 и 393 px в светлой и тёмной темах. */
export async function fits(page: Page, what: string) {
  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme });
    for (const width of [320, 393]) {
      await page.setViewportSize({ width, height: 852 });
      await expect.poll(() => fitsWidth(page, 1), { message: `${what}: ${theme} ${width}` }).toBe(true);
      expect(await page.evaluate(() => getComputedStyle(document.body).color)).toBe(theme === 'dark' ? 'rgb(228, 234, 236)' : 'rgb(23, 34, 43)');
      await expect(page.locator('[role=alert] .panel .small').first()).toHaveCSS('font-size', '14px');
    }
  }
  await page.emulateMedia({ colorScheme: 'light' });
  await page.setViewportSize({ width: 393, height: 852 });
}

/** 049: follow the same detail-page buttons and Back actions as a user. */
export async function openDetail(page: Page, title: string) {
  await page.locator('.setting-link:visible').filter({ has: page.getByText(title, { exact: true }) }).click();
  const dialog = page.getByRole('dialog', { name: title, exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(':scope > header button')).toBeFocused();
  return dialog;
}
export async function closeDetails(page: Page) {
  while (await page.locator('.detail-page:visible').count()) {
    const id = await page.locator('.detail-page:visible').last().getAttribute('id');
    const dialog = page.locator('[id=' + JSON.stringify(id) + ']');
    await dialog.locator(':scope > header button').click();
    await expect(dialog).toBeHidden();
  }
}
export async function showDetail(page: Page, ...path: string[]) {
  await closeDetails(page);
  for (const title of path) await openDetail(page, title);
}

// Устанавливаем вход в основном JS-мире загруженной страницы. WebKit может заново
// создать JS-обёртку нативного MediaDevices и потерять переопределённый на ней метод.
export async function installInput(page: Page, scenario: 'deny' | 'pending' | 'tone', deviceId?: string) {
  return page.evaluate(([mode, device]) => {
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
      // 054: идентификатор входа, как у настоящего микрофона, — для проверки сохранения подтверждения.
      if (device) { const settings = track.getSettings.bind(track); track.getSettings = () => ({ ...settings(), deviceId: device, groupId: 'test-group' }); }
      const stop = track.stop.bind(track);
      track.stop = () => {
        stop(); osc.stop(); gain.disconnect(); osc.disconnect();
        document.body.dataset.closed = String(1 + Number(document.body.dataset.closed || 0));
      };
      document.addEventListener('test-mute', () => track.dispatchEvent(new Event('mute')), { once: true });
      return dest.stream;
    } });
    return true;
  }, [scenario, deviceId] as const);
}
