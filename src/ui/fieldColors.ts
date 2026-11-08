// Цвета поля: красный — громче среднего по комнате, синий — тише; внутри порога — без цвета.

/** Насыщение цвета наступает на пороге + SPAN дБ. */
export const SPAN = 12;

/** [r, g, b, a] в 0…1 или null, если отклонение в пределах порога. */
export function fieldColor(db: number, threshold: number): [number, number, number, number] | null {
  if (!Number.isFinite(db) || Math.abs(db) < threshold) return null;
  const t = Math.min(1, (Math.abs(db) - threshold) / SPAN);
  const mix = (a: number, b: number) => a + (b - a) * t;
  return db > 0
    ? [mix(0.98, 0.84), mix(0.62, 0.12), mix(0.5, 0.08), mix(0.35, 0.85)]
    : [mix(0.55, 0.1), mix(0.68, 0.28), mix(0.98, 0.9), mix(0.35, 0.85)];
}

export function fieldCss(db: number, threshold: number): string | null {
  const c = fieldColor(db, threshold);
  if (!c) return null;
  return `rgba(${Math.round(c[0] * 255)}, ${Math.round(c[1] * 255)}, ${Math.round(c[2] * 255)}, ${c[3].toFixed(2)})`;
}
