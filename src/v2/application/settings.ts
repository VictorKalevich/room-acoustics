// Настройки v2 (V2-016, V2-019, V2-020): уровень сложности с локальными переопределениями, избранные и недавние
// инструменты. Хранятся в IndexedDB v2 (`meta/settings`); тема — отдельно, до первой отрисовки (R12).
import type { Complexity } from '../domain/model';
import type { V2Db } from '../storage/db';
import { getMeta, setMeta } from '../storage/rooms';

export interface AppSettings {
  /** `null` — уровень ещё не выбран: показывается первый запуск. */
  complexity: Complexity | null;
  /** Локальные уровни отдельных инструментов и разделов, ключ — область (`tool:rta`, `analysis:bass`…). */
  overrides: Record<string, Complexity>;
  favorites: string[];
  recentTools: string[];
}

export const DEFAULT_SETTINGS: AppSettings = { complexity: null, overrides: {}, favorites: [], recentTools: [] };
export const RECENT_LIMIT = 6;
export const COMPLEXITIES: readonly Complexity[] = ['simple', 'advanced', 'expert'];
export const COMPLEXITY_LABEL: Record<Complexity, string> = { simple: 'Простой', advanced: 'Продвинутый', expert: 'Экспертный' };
export const COMPLEXITY_TEXT: Record<Complexity, string> = {
  simple: 'Что происходит в комнате и что сделать. Только главные параметры и понятные выводы.',
  advanced: 'Технические пояснения, расширенные параметры, альтернативные методы и свои ограничения.',
  expert: 'Физические модели, численные параметры, промежуточные результаты и настройки оптимизаторов.',
};

const isComplexity = (v: unknown): v is Complexity => typeof v === 'string' && (COMPLEXITIES as readonly string[]).includes(v);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** Нормализация записи: повреждённые поля заменяются значениями по умолчанию, а не ломают запуск. */
export function normalizeSettings(raw: unknown): AppSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const overrides = Object.fromEntries(Object.entries((r.overrides && typeof r.overrides === 'object' ? r.overrides : {}) as Record<string, unknown>).filter(([, v]) => isComplexity(v))) as Record<string, Complexity>;
  return {
    complexity: isComplexity(r.complexity) ? r.complexity : null,
    overrides,
    favorites: [...new Set(strings(r.favorites))],
    recentTools: [...new Set(strings(r.recentTools))].slice(0, RECENT_LIMIT),
  };
}

export const loadSettings = async (db: V2Db) => normalizeSettings(await getMeta(db, 'settings'));
export const saveSettings = (db: V2Db, s: AppSettings) => setMeta(db, 'settings', s);

/** Действующий уровень области: локальное переопределение или общий уровень (по умолчанию — простой). */
export const effectiveComplexity = (s: AppSettings, scope?: string): Complexity => (scope && s.overrides[scope]) || s.complexity || 'simple';

export function setOverride(s: AppSettings, scope: string, level: Complexity | null): AppSettings {
  const overrides = { ...s.overrides };
  if (level === null || level === s.complexity) delete overrides[scope]; else overrides[scope] = level;
  return { ...s, overrides };
}

export const toggleFavorite = (s: AppSettings, id: string): AppSettings =>
  ({ ...s, favorites: s.favorites.includes(id) ? s.favorites.filter((f) => f !== id) : [...s.favorites, id] });

export const pushRecent = (s: AppSettings, id: string): AppSettings =>
  ({ ...s, recentTools: [id, ...s.recentTools.filter((t) => t !== id)].slice(0, RECENT_LIMIT) });
