import { fmtClock } from '../format';

/** Общая геометрия графиков по времени сеанса (055): одинаковые поля, чтобы шкалы времени совпадали по вертикали. */
export const plotLeft = 44, plotRight = 328, plotWidth = plotRight - plotLeft;

export const timeX = (seconds: number, start: number, end: number) => plotLeft + (seconds - start) / (end - start) * plotWidth;
export const xTime = (x: number, start: number, end: number) => start + (x - plotLeft) / plotWidth * (end - start);

const steps = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 10800, 21600];
/** Не больше пяти делений на кратных круглого шага. До 2 мин подписи в секундах, дальше — «м:сс». */
export function timeTicks(start: number, end: number) {
  const step = steps.find(s => (end - start) / s <= 4) ?? steps[steps.length - 1];
  const ticks: { seconds: number; label: string }[] = [];
  for (let t = Math.ceil(start / step) * step; t <= end + 1e-9; t += step) {
    ticks.push({ seconds: t, label: end <= 120 ? `${Math.round(t)} с` : fmtClock(t) });
  }
  return ticks;
}

/** Координата указателя в системе viewBox элемента. */
export function viewPoint(event: MouseEvent, width: number, height: number) {
  const rect = (event.currentTarget as Element).getBoundingClientRect();
  return { x: (event.clientX - rect.left) / rect.width * width, y: (event.clientY - rect.top) / rect.height * height };
}
