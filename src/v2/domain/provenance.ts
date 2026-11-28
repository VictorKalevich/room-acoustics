// Происхождение результатов (059, data-model): вид, метод и версия, конфигурация и её ревизия, хеш входа,
// предупреждения и ограничения. Устаревший результат определяется по ревизии и хешу, а не по времени.
import type { RoomConfiguration } from './model';

export type ResultKind = 'calculated' | 'measured' | 'estimated' | 'demo' | 'imported';

export const RESULT_KIND_LABEL: Record<ResultKind, string> = {
  calculated: 'Расчёт',
  measured: 'Измерение',
  estimated: 'Оценка',
  demo: 'Демонстрация',
  imported: 'Импорт',
};

export interface Provenance {
  kind: ResultKind;
  /** Метод: «аналитические моды прямоугольной комнаты», «Sabine/Eyring» и т. п. */
  method: string;
  algorithmVersion: string;
  configId?: string;
  revision?: number;
  inputHash: string;
  createdAt: string;
  warnings: string[];
  limitations: string[];
}

export interface CalculationResult<T> {
  value: T;
  provenance: Provenance;
}

/** Канонический JSON: ключи по порядку, undefined опускается — для хеша значимых входов. */
export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return '[' + v.map((x) => (x === undefined ? 'null' : stableStringify(x))).join(',') + ']';
  if (ArrayBuffer.isView(v)) return stableStringify(Array.from(v as unknown as ArrayLike<number>));
  const o = v as Record<string, unknown>;
  return '{' + Object.keys(o).sort().filter((k) => o[k] !== undefined).map((k) => JSON.stringify(k) + ':' + stableStringify(o[k])).join(',') + '}';
}

/** 53-битный хеш cyrb53 канонического JSON: только для сравнения входов, не для защиты. */
export function hashInputs(v: unknown): string {
  const s = stableStringify(v);
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}

/** Результат устарел: другая конфигурация, другая ревизия или другой хеш значимых входов. */
export function isStale(p: Provenance, c: Pick<RoomConfiguration, 'id' | 'revision'>, inputHash?: string): boolean {
  if (p.configId !== undefined && p.configId !== c.id) return true;
  if (inputHash !== undefined) return p.inputHash !== inputHash;
  return p.revision !== undefined && p.revision !== c.revision;
}
