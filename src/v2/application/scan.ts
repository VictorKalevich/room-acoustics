// Скан помещения в v2 (V2-046): распознавание ядра скана (`src/scan`: размеры, двери и окна, мебель, коридор) —
// в выбранную конфигурацию, как первое «Применить размеры» legacy: найденное заменяет прежнее найденное в скане,
// введённое вручную остаётся. Материалы по геометрии скана не определяются. Исходный файл не сохраняется (R46).
import { foundWallItems, scanProblem, scanRoom, type ScanChoice } from '../../scan/apply';
import type { DetectResult } from '../../scan/detect';
import type { LayoutResult } from '../../scan/layout';
import type { WallItemKind } from '../../core/wallItems';
import { coreInputs, fromCore } from '../adapters/core';
import type { RoomConfiguration } from '../domain/model';
import { setDimensions } from './editing';

export const SCAN_FURNITURE: Record<string, string> = {
  storage: 'Шкаф', shelf: 'Стеллаж', cabinet: 'Шкаф', wardrobe: 'Шкаф', refrigerator: 'Холодильник', fridge: 'Холодильник',
  stove: 'Плита', oven: 'Духовка', bed: 'Кровать', sink: 'Раковина', washer: 'Стиральная машина', dryer: 'Сушилка',
  washerdryer: 'Стиральная машина', toilet: 'Унитаз', bathtub: 'Ванна', dishwasher: 'Посудомойка', table: 'Стол', desk: 'Стол',
  sofa: 'Диван', couch: 'Диван', chair: 'Стул', armchair: 'Кресло', fireplace: 'Камин', television: 'ТВ', tv: 'ТВ',
  stairs: 'Лестница', piano: 'Пианино',
};

export const WALL_ITEM_LABEL: Record<WallItemKind, string> = { door: 'Дверь', window: 'Окно', arch: 'Проём' };

/** Краткие сведения о применённом скане — в `config.scan`. */
export interface ScanInfo {
  fileName: string;
  format: string;
  units: DetectResult['units'];
  unitsGuessed: boolean;
  confidence: number;
  depth: number;
  width: number;
  height: number;
  appliedAt: string;
  warnings: string[];
}

export const scanInfo = (c: RoomConfiguration): ScanInfo | null => {
  const s = c.scan as Partial<ScanInfo> | null | undefined;
  return s && typeof s.fileName === 'string' && typeof s.depth === 'number' ? (s as ScanInfo) : null;
};

/** Явно неверное распознавание (обычно единицы): применять нельзя. */
export const scanDimsProblem = (det: Pick<DetectResult, 'depth' | 'width' | 'height'>): string | null =>
  scanProblem(det) ? 'Размеры по скану вне допустимых (1–50 м по плану, 1–20 м по высоте): вероятно, неверно угаданы единицы. Выберите единицы файла вручную.' : null;

/** Что применить: вся найденная комната, виды элементов стен и мебель — по выбору пользователя. */
export function scanChoice(det: DetectResult, layout: LayoutResult, kinds: WallItemKind[], furniture: { on: boolean; sit: boolean }[], takeCorridor: boolean): ScanChoice {
  return { height: det.height, rect: { x0: 0, x1: det.depth, y0: 0, y1: det.width }, layout, kinds, furniture, takeCorridor };
}

export const wallItems = (layout: LayoutResult) => foundWallItems(layout);

/**
 * Применить скан: размеры (объекты вписываются, как при смене размеров), затем проёмы, коридор и мебель ядра скана.
 * Прежнее найденное в скане заменяется, ручное остаётся.
 */
export function applyScan(c: RoomConfiguration, choice: ScanChoice, info: Omit<ScanInfo, 'appliedAt'>, newId: () => string, now: string): { config: RoomConfiguration; notes: string[] } {
  const problem = scanDimsProblem({ depth: choice.rect.x1 - choice.rect.x0, width: choice.rect.y1 - choice.rect.y0, height: choice.height });
  if (problem) throw new Error(problem);
  const r3 = (v: number) => Math.round(v * 1000) / 1000;
  const sized = setDimensions(c, { depth: r3(choice.rect.x1 - choice.rect.x0), width: r3(choice.rect.y1 - choice.rect.y0), height: r3(choice.height) });
  const base = sized.config;
  const manual = { ...base, openings: base.openings.filter((o) => !o.fromScan), zones: base.zones.filter((z) => !z.fromScan), interior: { ...base.interior, obstacles: base.interior.obstacles.filter((z) => !z.fromScan) } };
  const inputs = coreInputs(manual);
  const room = scanRoom(inputs.room, choice, 'fix', { furniture: (n) => SCAN_FURNITURE[n] ?? 'Мебель', corridor: 'Коридор', id: newId });
  const back = fromCore({ ...inputs, room }, { id: c.id, role: c.role, revision: c.revision });
  // ручное берётся из конфигурации v2 (у проёмов там больше сведений, чем у ядра), найденное — из ядра скана
  const own = new Set(c.shape?.zoneIds ?? []);
  const config: RoomConfiguration = {
    ...base, geometrySource: 'scan',
    openings: [...manual.openings, ...back.openings.filter((o) => o.fromScan)],
    zones: [...manual.zones.filter((z) => !own.has(z.id)), ...back.zones.filter((z) => z.fromScan)],
    interior: { ...base.interior, obstacles: [...manual.interior.obstacles, ...back.interior.obstacles.filter((z) => z.fromScan)] },
    scan: { ...info, appliedAt: now } satisfies ScanInfo,
  };
  delete config.shape;
  const notes = [...sized.notes];
  if (c.shape) notes.push('Форма комнаты заменена прямоугольником по скану.');
  return { config, notes };
}
