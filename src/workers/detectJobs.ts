// Договор панели скана и воркера распознавания (030): запросы, ответы и связь между ними.
// Поля выводятся из сигнатур detectRoom и analyzeLayout. Модуль содержит только типы.
import type { detectRoom } from '../scan/detect';
import type { analyzeLayout } from '../scan/layout';

type DetectArgs = Parameters<typeof detectRoom>;
type LayoutArgs = Parameters<typeof analyzeLayout>;

/** Распознать комнату и найти проёмы, мебель и коридор. На проводе без `type`, как раньше. */
export interface DetectRequest {
  type?: 'detect';
  labels?: LayoutArgs[3];
  units?: NonNullable<DetectArgs[1]>['units'];
}
/** Найти проёмы, мебель и коридор для выбранных границ комнаты. */
export interface LayoutRequest {
  type: 'layout';
  labels?: LayoutArgs[3];
  transform: LayoutArgs[1];
  dims: LayoutArgs[2];
}
export type ScanRequest = DetectRequest | LayoutRequest;
/** Сообщение воркеру: запрос и треугольники скана (их буфер передаётся). */
export type ScanMessage = ScanRequest & { triangles: DetectArgs[0] & LayoutArgs[0] };

export interface DetectDone { ok: true; result: ReturnType<typeof detectRoom>; layout: ReturnType<typeof analyzeLayout> }
export interface LayoutDone { ok: true; layout: ReturnType<typeof analyzeLayout> }
export interface ScanFailed { ok: false; error: string }
export type ScanReply = DetectDone | LayoutDone | ScanFailed;

/**
 * Запуск воркера скана: тип ответа выводится из вида запроса (на распознавание — комната и разбор, на `layout` —
 * только разбор); лишние и пропущенные поля — ошибка компиляции.
 */
export interface RunScanWorker {
  (msg: DetectRequest, triangles: Float32Array): Promise<DetectDone>;
  (msg: LayoutRequest, triangles: Float32Array): Promise<LayoutDone>;
}
