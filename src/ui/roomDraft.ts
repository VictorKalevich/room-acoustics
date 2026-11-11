// Черновик конструктора комнаты (021): изменения копятся здесь и попадают в проект только по «Сохранить».
// Хранится на устройстве отдельно от проекта (не попадает в файл проекта и синхронизацию) и переживает
// перезапуск приложения: прерванный ручной ввод продолжается с того шага, где остановились.
import type { Room } from '../core/types';
import { normalizeRoom } from '../state/storage';
import { ROOM_STEPS, type RoomStep } from './navigation';

export type DimKey = 'depth' | 'width' | 'height';
export const DIMS: DimKey[] = ['depth', 'width', 'height'];

export interface RoomDraft {
  room: Room;
  /** Дальний шаг, до которого дошли по «Далее» (ручной ввод идёт по порядку). */
  reached: RoomStep;
  /** 022: размеры, введённые при ручной настройке (до ввода поля пустые). */
  entered?: DimKey[];
  /** 022: что меняли в ручной настройке (материалы «mat.<поверхность>», «furnishing») — без пометки «по умолчанию». */
  touched?: string[];
}

const key = (id: string) => `ra-room-draft-${id}`;
const cache = new Map<string, RoomDraft | null>();

/**
 * Поля комнаты, которые меняются вне конструктора (обработка — в «Настройке», подстройка — по замеру).
 * В черновике они всегда берутся из проекта: черновик не возвращает их прежние значения при сохранении.
 * Герметичность правится в конструкторе (шаг «Стены»), поэтому берётся из черновика (022; в 021 её правка
 * в конструкторе ошибочно заменялась значением проекта).
 */
const OUTSIDE: (keyof Room)[] = ['treatments', 'treatmentsOn', 'calibration'];
export function withOutside(draft: Room, saved: Room): Room {
  const out = { ...draft } as Record<string, unknown>;
  for (const k of OUTSIDE) out[k] = saved[k];
  return out as unknown as Room;
}

export function loadRoomDraft(projectId: string): RoomDraft | null {
  if (cache.has(projectId)) return cache.get(projectId)!;
  let d: RoomDraft | null = null;
  try {
    const raw = JSON.parse(localStorage.getItem(key(projectId)) ?? 'null');
    if (raw && ROOM_STEPS.includes(raw.reached)) {
      // те же проверки, что и у проекта; объекты за стенами остаются — их покажет подтверждение «Сохранить»
      const strings = (a: unknown) => (Array.isArray(a) ? a.filter((x): x is string => typeof x === 'string') : []);
      d = {
        room: normalizeRoom(raw.room, false), reached: raw.reached,
        entered: strings(raw.entered).filter((k): k is DimKey => (DIMS as string[]).includes(k)),
        touched: strings(raw.touched),
      };
    }
  } catch { d = null; }
  cache.set(projectId, d);
  return d;
}

export function saveRoomDraft(projectId: string, d: RoomDraft) {
  cache.set(projectId, d);
  try { localStorage.setItem(key(projectId), JSON.stringify(d)); } catch { /* без хранилища — только до перезапуска */ }
}

/** После «Сохранить», «Не сохранять», «Сбросить черновик», применения скана и «Очистить». */
export function dropRoomDraft(projectId: string) {
  cache.set(projectId, null);
  try { localStorage.removeItem(key(projectId)); } catch { /* без хранилища */ }
}

/** Комната черновика отличается от сохранённой (поля вне конструктора не считаются). */
export function draftDiffers(draft: Room, saved: Room): boolean {
  return JSON.stringify(withOutside(draft, saved)) !== JSON.stringify(saved);
}
