import type { LegacyCal } from '../core/micApply';

export const CAL_KEY = 'ra-mic-cal';

export function loadCal(): LegacyCal | null {
  try { return JSON.parse(localStorage.getItem(CAL_KEY) ?? 'null'); } catch { return null; }
}
