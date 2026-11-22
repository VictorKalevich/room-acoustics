export const CAL_KEY = 'ra-mic-cal';

export function loadCal(): { name: string; f: number[]; db: number[] } | null {
  try { return JSON.parse(localStorage.getItem(CAL_KEY) ?? 'null'); } catch { return null; }
}
