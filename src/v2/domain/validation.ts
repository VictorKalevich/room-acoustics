// Проверки конфигурации v2: ошибка не даёт считать, предупреждение показывается рядом с результатом.
import type { RoomConfiguration } from './model';

export interface Issue {
  severity: 'error' | 'warning';
  path: string;
  message: string;
}

/** Пределы размеров — как у проверки комнаты legacy (`validateRoom`): мигрированные комнаты остаются допустимыми. */
export const DIM_LIMITS = { depth: [1, 50], width: [1, 50], height: [1, 20] } as const;
export const DIM_LABEL = { depth: 'Длина', width: 'Ширина', height: 'Высота' } as const;

export function validateDimensions(d: { depth: number; width: number; height: number }): Issue[] {
  const out: Issue[] = [];
  for (const key of ['depth', 'width', 'height'] as const) {
    const v = d[key];
    const [lo, hi] = DIM_LIMITS[key];
    if (!Number.isFinite(v)) out.push({ severity: 'error', path: `geometry.${key}`, message: `${DIM_LABEL[key]}: введите число в метрах.` });
    else if (v < lo || v > hi) out.push({ severity: 'error', path: `geometry.${key}`, message: `${DIM_LABEL[key]}: от ${lo} до ${hi} м.` });
  }
  return out;
}

/** Размеры прямоугольной оболочки, в которой должны лежать объекты. */
export function bounds(c: RoomConfiguration): { depth: number; width: number; height: number } {
  const g = c.geometry;
  if (g.kind === 'rect') return g;
  const xs = g.outline.map((p) => p.x), ys = g.outline.map((p) => p.y);
  return { depth: Math.max(...xs) - Math.min(...xs, 0), width: Math.max(...ys) - Math.min(...ys, 0), height: g.height };
}

const inside = (p: { x: number; y: number; z: number }, b: { depth: number; width: number; height: number }) =>
  p.x >= 0 && p.x <= b.depth && p.y >= 0 && p.y <= b.width && p.z >= 0 && p.z <= b.height;

export function validateConfiguration(c: RoomConfiguration): Issue[] {
  const out: Issue[] = [];
  if (c.geometry.kind === 'rect') out.push(...validateDimensions(c.geometry));
  else if (c.geometry.outline.length < 3) out.push({ severity: 'error', path: 'geometry.outline', message: 'Контур комнаты: нужно не меньше трёх точек.' });
  const b = bounds(c);
  c.audio.sources.forEach((s, i) => {
    if (!inside(s.position, b)) out.push({ severity: 'warning', path: `audio.sources.${i}`, message: `«${s.name}» за пределами комнаты.` });
    if (!(s.fLow > 0 && s.fHigh > s.fLow)) out.push({ severity: 'error', path: `audio.sources.${i}`, message: `«${s.name}»: нижняя граница полосы должна быть меньше верхней.` });
  });
  c.listening.listeners.forEach((l, i) => {
    if (!inside(l.position, b)) out.push({ severity: 'warning', path: `listening.listeners.${i}`, message: `«${l.name}» за пределами комнаты.` });
  });
  if (!c.listening.listeners.some((l) => l.primary)) out.push({ severity: 'error', path: 'listening', message: 'Нужен основной слушатель.' });
  for (const o of c.openings) {
    if (!(o.a1 > o.a0) || !(o.top > o.bottom)) out.push({ severity: 'error', path: `openings.${o.id}`, message: 'Проём: размеры должны быть положительными.' });
  }
  return out;
}

export const hasErrors = (issues: Issue[]) => issues.some((i) => i.severity === 'error');
