// V2-011–V2-015: токены Acoustic Lab совпадают с утверждённой таблицей, темы согласованы, контраст достаточен,
// реестр полон, вспомогательные функции компонентов работают.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import * as ds from '../../src/v2/design-system';
import { families, colorRoles } from '../../src/v2/design-system/registry';
import { formatNumber, parseNumber, rovingIndex } from '../../src/v2/design-system/fields';
import { formatHz, nearestIndex, niceTicks } from '../../src/v2/design-system/charts';
import { axesFor } from '../../src/v2/design-system/PlanView';
import { readTheme, resolvedTheme, saveTheme, THEME_KEY } from '../../src/v2/design-system/theme';

const tokens = readFileSync('src/v2/design-system/tokens.css', 'utf8');
const doc = readFileSync('docs/acoustic-lab.md', 'utf8');
const css = readdirSync('src/v2/design-system').filter((f) => f.endsWith('.css')).map((f) => readFileSync(`src/v2/design-system/${f}`, 'utf8')).join('\n');

function block(selectorStart: string): Record<string, string> {
  const i = tokens.indexOf(selectorStart);
  const body = tokens.slice(tokens.indexOf('{', i + selectorStart.length - 1) + 1, tokens.indexOf('}', i));
  return Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}
const light = block(':root {');
const darkSystem = block(":root:not([data-theme='light']) {");
const darkExplicit = block(":root[data-theme='dark'] {");

const ROLE_TOKEN: Record<string, string> = {
  Background: 'background', Surface: 'surface', 'Primary text': 'text', 'Secondary text': 'text-secondary', Border: 'border', Accent: 'accent',
  'On accent': 'on-accent', Current: 'current', Experimental: 'experimental', Measured: 'measured', Predicted: 'predicted', Warning: 'warning', Danger: 'danger',
};
const OBJECT_TOKEN: Record<string, string> = { 'Колонки и источники': 'source', Слушатели: 'listener', 'Поглощающие панели': 'absorber', 'Басовые ловушки': 'bass-trap', Диффузоры: 'diffuser', Интерьер: 'interior' };

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a: string, b: string) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

describe('059 V2-011/012 · токены и темы', () => {
  it('цвета совпадают с утверждённой таблицей docs/acoustic-lab.md в обеих темах', () => {
    const rows = [...doc.matchAll(/^\| ([A-Za-z ]+) \| (#[0-9A-F]{6}) \| (#[0-9A-F]{6}) \|$/gm)];
    expect(rows).toHaveLength(13);
    for (const [, role, l, d] of rows) {
      const t = `--al-color-${ROLE_TOKEN[role.trim()]}`;
      expect(light[t], `${role} светлая`).toBe(l);
      expect(darkExplicit[t], `${role} тёмная`).toBe(d);
    }
    const objects = [...doc.matchAll(/^\| ([А-Яа-яё ]+) \| (#[0-9A-F]{6}) \|$/gm)];
    expect(objects).toHaveLength(6);
    for (const [, name, hex] of objects) expect(light[`--al-plan-${OBJECT_TOKEN[name.trim()]}`]).toBe(hex);
  });

  it('тёмная тема одинакова для системного и явного выбора; переопределены все цвета светлой', () => {
    expect(darkSystem).toEqual(darkExplicit);
    const colorKeys = Object.keys(light).filter((k) => light[k].startsWith('#'));
    expect(colorKeys.filter((k) => !(k in darkExplicit))).toEqual([]);
  });

  it('утверждённые отступы, радиусы, высота кнопки', () => {
    for (const n of [4, 8, 12, 16, 24, 32]) expect(light[`--al-space-${n}`]).toBe(`${n}px`);
    for (const n of [8, 12, 16]) expect(light[`--al-radius-${n}`]).toBe(`${n}px`);
    expect(light['--al-control-height']).toBe('48px');
    expect(light['--al-font-body']).toMatch(/^'Inter Variable', Inter/);
  });

  it('контраст: текст ≥ 4,5 : 1, линии графиков и объекты плана ≥ 3 : 1 к поверхности', () => {
    for (const t of [light, darkExplicit]) {
      for (const bg of [t['--al-color-background'], t['--al-color-surface']]) {
        expect(contrast(t['--al-color-text'], bg)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(t['--al-color-text-secondary'], bg)).toBeGreaterThanOrEqual(4.5);
      }
      expect(contrast(t['--al-color-on-accent'], t['--al-color-accent'])).toBeGreaterThanOrEqual(4.5);
      for (const k of ['measured', 'predicted', 'current', 'experimental', 'warning', 'danger', 'accent']) {
        expect(contrast(t[`--al-color-${k}`], t['--al-color-surface']), k).toBeGreaterThanOrEqual(3);
      }
      for (const k of ['source', 'listener', 'absorber', 'diffuser', 'interior']) expect(contrast(t[`--al-plan-${k}`], t['--al-color-surface']), k).toBeGreaterThanOrEqual(3);
    }
  });

  it('выбор темы: системная не пишет в хранилище', () => {
    const store = new Map<string, string>();
    const s = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) };
    expect(readTheme(s)).toBe('system');
    saveTheme('dark', s);
    expect(store.get(THEME_KEY)).toBe('dark');
    expect(readTheme(s)).toBe('dark');
    saveTheme('system', s);
    expect(store.size).toBe(0);
    expect(resolvedTheme('system', { matches: true })).toBe('dark');
    expect(resolvedTheme('light', { matches: true })).toBe('light');
  });
});

describe('059 V2-015 · реестр и проверка', () => {
  it('каждый публичный компонент — в реестре, каждый компонент реестра — экспортирован', () => {
    const exported = Object.entries(ds).filter(([k, v]) => typeof v === 'function' && /^[A-Z]/.test(k) && k !== 'THEME_LABEL').map(([k]) => k).sort();
    const listed = families.flatMap((f) => f.components).sort();
    expect(listed).toEqual(exported);
  });

  it('классы реестра и цветовые роли определены в стилях', () => {
    for (const f of families) for (const c of f.classes) expect(css, c).toContain(`.${c}`);
    for (const [t] of colorRoles) expect(tokens).toContain(`${t}:`);
  });
});

describe('059 V2-013/014 · поведение компонентов', () => {
  it('числа: запятая и точка, пустое — NaN, формат с запятой', () => {
    expect(parseNumber('4,5')).toBe(4.5);
    expect(parseNumber(' 3.25 ')).toBe(3.25);
    expect(parseNumber('−2')).toBe(-2);
    expect(parseNumber('')).toBeNaN();
    expect(parseNumber('4,5,1')).toBeNaN();
    expect(parseNumber('abc')).toBeNaN();
    expect(formatNumber(4.5)).toBe('4,5');
    expect(formatNumber(2.345, 2)).toBe('2,35');
    expect(formatNumber(null)).toBe('');
  });

  it('стрелки по кругу, Home и End', () => {
    expect([rovingIndex('ArrowRight', 2, 3), rovingIndex('ArrowLeft', 0, 3), rovingIndex('Home', 2, 3), rovingIndex('End', 0, 3), rovingIndex('a', 0, 3)]).toEqual([0, 2, 0, 2, null]);
  });

  it('оси и подписи графиков', () => {
    expect(niceTicks(0, 0.7, 4)).toEqual([0, 0.2, 0.4, 0.6]);
    expect(niceTicks(60, 90, 5)).toEqual([60, 70, 80, 90]);
    expect(niceTicks(60, 90, 6)).toEqual([60, 65, 70, 75, 80, 85, 90]);
    expect(nearestIndex([20, 40, 80], 55)).toBe(1);
    expect(nearestIndex([20, 40, 80], 70)).toBe(2);
    expect(formatHz(38.12)).toBe('38,1 Гц');
    expect(formatHz(1000)).toBe('1 кГц');
    expect(formatHz(12500)).toBe('13 кГц');
  });

  it('оси плана: сверху передняя стена вверху, сбоку — слева, спереди — левая стена слева', () => {
    const p = { x: 1, y: 2, z: 0.5 };
    const top = axesFor('top', 4.5, 3.8, 2.7), side = axesFor('side', 4.5, 3.8, 2.7), front = axesFor('front', 4.5, 3.8, 2.7);
    expect([top.u(p), top.v(p), top.U, top.V]).toEqual([2, 1, 3.8, 4.5]);
    expect([side.u(p), side.v(p), side.U, side.V]).toEqual([1, 2.2, 4.5, 2.7]);
    expect([front.u(p), front.v(p), front.U, front.V]).toEqual([2, 2.2, 3.8, 2.7]);
  });
});
