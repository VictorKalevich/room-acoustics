import { test, expect, type Page } from '@playwright/test';
import { EMPTY_STATE, roomOnlyState } from './helpers';

// 021/022: пока комната не создана — один экран «С чего начать», без нижней панели и разделов с расчётами.
// Ручная настройка идёт по шагам, размеры пустые до ввода, введённое хранится черновиком до «Сохранить».
const heading = (page: Page, name: string | RegExp) => page.getByRole('heading', { name });
const tabs = (page: Page) => page.getByRole('navigation', { name: 'Разделы', exact: true });

test.describe('комнаты ещё нет', () => {
  test.use({ storageState: EMPTY_STATE });

  test('только «С чего начать»: нет нижней панели и разделов с расчётами в меню; старые ссылки ведут к комнате', async ({ page }) => {
    await page.goto('/#room');
    await expect(page.locator('.start-card')).toBeVisible();
    await expect(page.locator('.start-card').getByRole('button', { name: 'Настроить комнату вручную' })).toBeVisible();
    await expect(page.locator('.tabbar')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Конструктор комнаты' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Очистить' })).toHaveCount(0);
    await expect(page.locator('.rt-table')).toHaveCount(0);
    await expect(page.locator('svg.plan:visible')).toHaveCount(0);
    await expect(page.locator('.topbar__room')).toHaveText('Моя комната');
    // меню: только то, что работает без комнаты
    await page.getByRole('button', { name: 'Открыть меню' }).click();
    const menu = page.getByRole('navigation', { name: 'Меню' });
    await expect(menu.getByRole('button', { name: /Импорт и экспорт/ })).toBeVisible();
    await expect(menu.getByRole('button', { name: /Помощник и словарь/ })).toBeVisible();
    await expect(menu.getByRole('button', { name: /Измерения/ })).toHaveCount(0);
    await expect(menu.getByRole('button', { name: /Отчёт/ })).toHaveCount(0);
    await page.keyboard.press('Escape');
    for (const route of ['analysis', 'placement', 'tuning/eq', 'measure/compare', 'voice', 'report']) {
      await page.goto(`/#${route}`);
      await expect(heading(page, 'Сначала создайте комнату')).toBeVisible();
    }
    await page.getByRole('button', { name: 'Перейти к комнате' }).click();
    await expect(page).toHaveURL(/#room$/);
    await expect(page.locator('.start-card')).toBeVisible();
  });

  test('ручная настройка: пустые размеры, шаги по порядку, «по умолчанию», черновик и сброс, «Сохранить» создаёт комнату', async ({ page }) => {
    await page.goto('/#room');
    await page.locator('.start-card').getByRole('button', { name: 'Настроить комнату вручную' }).click();
    await expect(heading(page, 'Шаг 1 из 4: Размеры')).toBeVisible();
    const depth = page.getByLabel('Глубина', { exact: true });
    await expect(depth).toBeFocused();
    await expect(depth).toHaveValue('');
    await expect(page.getByLabel('Ширина', { exact: true })).toHaveValue('');
    await expect(page.getByRole('button', { name: /Далее/ })).toBeDisabled();
    await expect(page.getByRole('navigation', { name: 'Шаги конструктора' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Назад/ })).toHaveCount(0);
    await depth.fill('6');
    await page.getByLabel('Ширина', { exact: true }).fill('4');
    await expect(page.getByRole('button', { name: /Далее/ })).toBeDisabled();
    await page.getByLabel('Высота', { exact: true }).fill('2,5');
    await page.getByRole('button', { name: /Далее/ }).click();
    await expect(heading(page, 'Шаг 2 из 4: Стены')).toBeVisible();
    // материал не трогали — пометка «по умолчанию»; выбрали — пометка исчезает
    const material = page.getByLabel('Материал стены', { exact: true });
    await expect(page.getByText('Значение по умолчанию — если у вас другое, выберите.').first()).toBeVisible();
    await material.selectOption('gypsum');
    await expect(material).not.toHaveAttribute('aria-describedby', /.+/);
    // по адресу дальше достигнутого шага не попасть
    await page.goto('/#room/furniture');
    await expect(heading(page, 'Шаг 2 из 4: Стены')).toBeVisible();
    // уход без вопроса, черновик остаётся и после перезапуска
    await page.getByRole('button', { name: /Обзор комнаты/ }).click();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    await page.reload();
    await expect(page.locator('.start-card')).toContainText('продолжится с шага «Стены»');
    await page.locator('.start-card').getByRole('button', { name: 'Настроить комнату вручную' }).click();
    await expect(heading(page, 'Шаг 2 из 4: Стены')).toBeVisible();
    await expect(material).toHaveValue('gypsum');
    await page.getByRole('button', { name: /Назад/ }).click();
    await expect(depth).toHaveValue('6');
    // «Сбросить черновик» — на каждом шаге; после него настройка начинается заново, размеры снова пустые
    await page.getByRole('button', { name: 'Сбросить черновик' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Сбросить черновик' }).click();
    await expect(heading(page, 'Шаг 1 из 4: Размеры')).toBeVisible();
    await expect(depth).toHaveValue('');
    await depth.fill('5,5');
    await page.getByLabel('Ширина', { exact: true }).fill('4');
    await page.getByLabel('Высота', { exact: true }).fill('2,5');
    for (const name of ['Стены', 'Пол и потолок', 'Мебель']) {
      await page.getByRole('button', { name: /Далее/ }).click();
      await expect(heading(page, new RegExp(`из 4: ${name}$`))).toBeVisible();
      await expect(page.getByRole('button', { name: 'Сбросить черновик' })).toBeVisible();
    }
    await expect(page.getByRole('button', { name: /Далее/ })).toHaveCount(0);
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(page).toHaveURL(/#room$/);
    await expect(page.locator('.start-card')).toHaveCount(0);
    await expect(page.locator('.topbar__room')).toContainText('5,50 × 4,00 × 2,50');
    // после создания комнаты — нижняя панель из пяти вкладок, «Что учтено» и «Что дальше»
    await expect(tabs(page).getByRole('button')).toHaveText(['Комната', 'Расстановка', 'Анализ', 'Настройка', 'Голос']);
    await expect(page.locator('.report-table:visible')).toContainText('введена вручную, 5,50 × 4,00 × 2,50 м');
    await expect(page.locator('.report-table:visible')).toContainText('ещё не выбраны');
    await expect(heading(page, 'Что дальше')).toBeVisible();
    // комната, настроенная вручную, — «3D-модель» без упоминаний скана
    await expect(page.locator('#scan-panel .panel__title')).toHaveText('3D-модель');
    await expect(page.locator('#scan-panel')).not.toContainText(/LiDAR|скан/i);
    // после перезапуска комната остаётся созданной, конструктор — в режиме правки
    await page.waitForTimeout(800);
    await page.reload();
    await page.goto('/#room/walls');
    await expect(page.getByRole('navigation', { name: 'Шаги конструктора' })).toBeVisible();
  });
});

test.describe('места колонок ещё не выбраны', () => {
  test.use({ storageState: roomOnlyState });

  test('экраны по колонкам закрыты до выбора расстановки; комнате хватает «Моды», «Голос», «Хлопок»', async ({ page }) => {
    for (const route of ['analysis', 'field', 'tuning/sub', 'tuning/eq', 'tuning/treatment', 'measure/sweep', 'measure/compare']) {
      await page.goto(`/#${route}`);
      await expect(heading(page, 'Сначала выберите расстановку')).toBeVisible();
    }
    await page.goto('/#modes');
    await expect(page.locator('.modes-table').first()).toBeVisible();
    await page.goto('/#measure/clap');
    await expect(heading(page, 'Сначала выберите расстановку')).toHaveCount(0);
    await page.goto('/#voice');
    await expect(heading(page, 'Сначала выберите расстановку')).toHaveCount(0);
    await expect(page.getByTestId('voice-map-best')).toBeVisible({ timeout: 20_000 });
    // отчёт: комната — есть, разделы о колонках — после выбора мест
    await page.goto('/#report');
    await expect(page.locator('.report__title')).toBeVisible();
    await expect(heading(page, 'Сначала выберите расстановку')).toBeVisible();
    // «Указать, как стоят» — ручная расстановка; «Колонки стоят так» открывает экраны
    await page.goto('/#tuning/eq');
    await page.getByRole('button', { name: 'Указать, как стоят' }).click();
    await expect(page).toHaveURL(/#manual$/);
    await page.getByRole('button', { name: 'Колонки стоят так — использовать эти места' }).click();
    await page.getByRole('navigation', { name: 'Разделы', exact: true }).getByRole('button', { name: 'Настройка' }).click();
    await expect(heading(page, 'Сначала выберите расстановку')).toHaveCount(0);
  });

  test('ошибка исходной расстановки исправлена: в своей комнате первый подбор становится текущей расстановкой', async ({ page }) => {
    await page.goto('/#room/size');
    await page.getByLabel('Глубина', { exact: true }).fill('6');
    await page.getByLabel('Ширина', { exact: true }).fill('3,5');
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(page.locator('.topbar__room')).toContainText('6,00 × 3,50');
    await page.goto('/#placement');
    await page.getByRole('button', { name: 'Подобрать расстановку', exact: true }).click();
    await expect(page.getByText('Это текущая расстановка')).toBeVisible({ timeout: 20_000 });
    await page.goto('/#tuning/eq');
    await expect(heading(page, 'Сначала выберите расстановку')).toHaveCount(0);
  });
});
