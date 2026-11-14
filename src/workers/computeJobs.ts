// Договор интерфейса и воркера расчётов (030): вид задачи → входные данные → результат.
// Входные данные и результат выводятся из сигнатур функций ядра; вручную записаны только имена полей на проводе.
// Модуль содержит только типы: интерфейс подключает его через `import type`, функции ядра в его сборку отсюда
// не попадают. Обработчики по этой таблице — в computeHandlers.ts, отправка — в ui/compute.ts.
import type { optimizePlacement } from '../core/placement';
import type { listenerHeatmap, subHeatmap } from '../core/field';
import type { optimizeSubs } from '../core/integration';
import type { calibrate, compareMeasurement } from '../core/measure';
import type { evaluateSetup } from '../core/system';
import type { waveSystemModes } from '../core/acoustics';
import type { computeField } from '../core/field3d';
import type { optimizeSubFilters } from '../core/subfilters';
import type { voiceMap } from '../core/voice';

/** Что не переживает JSON-копию перед отправкой (ui/compute.ts): типизированные массивы, буферы, функции и т. п. */
type NotJson = ArrayBufferView | ArrayBufferLike | Date | RegExp | Map<unknown, unknown> | Set<unknown> | ((...args: never[]) => unknown) | bigint | symbol;

/**
 * Тип, из которого убрано то, что JSON-копия теряет или искажает: на месте таких значений — never, и входные данные
 * с ними не проходят проверку в конце модуля. `undefined` в элементах массива тоже запрещён: копия превращает его
 * в null. NaN и бесконечность копия тоже превращает в null; тип number этого не различает — так было и раньше.
 */
export type JsonSafe<T> = T extends NotJson
  ? never
  : T extends readonly (infer E)[]
    ? undefined extends E ? never : { [P in keyof T]: JsonSafe<T[P]> }
    : T extends object ? { [P in keyof T]: JsonSafe<T[P]> } : T;
type IsJsonSafe<T> = [T] extends [JsonSafe<T>] ? true : false;

/** Задача: входные данные (только то, что доходит до воркера, — проверка в конце модуля) и результат. */
interface Job<P, R> {
  payload: P;
  result: R;
}

/** Первые четыре аргумента большинства функций ядра: комната, источники, ограничения, расстановка. */
interface SetupArgs<A extends readonly unknown[]> {
  room: A[0];
  sources: A[1];
  constraints: A[2];
  setup: A[3];
}
/** Поля необязательного объекта настроек функции ядра (например, `{ ppo }`). */
type Opts<T, K extends keyof NonNullable<T>> = Pick<NonNullable<T>, K>;

type ListenerArgs = Parameters<typeof listenerHeatmap>;
type SubArgs = Parameters<typeof subHeatmap>;
type IntegrateArgs = Parameters<typeof optimizeSubs>;
type CalibrateArgs = Parameters<typeof calibrate>;
type CompareArgs = Parameters<typeof compareMeasurement>;
type EvaluateArgs = Parameters<typeof evaluateSetup>;
type ModesArgs = Parameters<typeof waveSystemModes>;
type SubFiltersArgs = Parameters<typeof optimizeSubFilters>;
type VoiceArgs = Parameters<typeof voiceMap>;

/**
 * Виды задач. `optimize` и `field` передают входные данные в функцию ядра целиком, остальные раскладывают поля
 * по аргументам. Формат на проводе прежний: те же строки `type` и те же имена полей.
 */
export interface ComputeJobs {
  optimize: Job<Parameters<typeof optimizePlacement>[0], ReturnType<typeof optimizePlacement>>;
  listenerMap: Job<SetupArgs<ListenerArgs> & Opts<ListenerArgs[4], 'ppo'>, ReturnType<typeof listenerHeatmap>>;
  subMap: Job<SetupArgs<SubArgs> & { subId: SubArgs[4] } & Opts<SubArgs[5], 'ppo'>, ReturnType<typeof subHeatmap>>;
  integrate: Job<SetupArgs<IntegrateArgs> & Opts<IntegrateArgs[4], 'ppo'>, ReturnType<typeof optimizeSubs>>;
  calibrate: Job<SetupArgs<CalibrateArgs> & { measurement: CalibrateArgs[4] }, ReturnType<typeof calibrate>>;
  compare: Job<SetupArgs<CompareArgs> & { measurement: CompareArgs[4] }, ReturnType<typeof compareMeasurement>>;
  evaluate: Job<SetupArgs<EvaluateArgs> & Opts<EvaluateArgs[4], 'ppo'>, ReturnType<typeof evaluateSetup>>;
  modes: Job<{ room: ModesArgs[0]; fMax?: ModesArgs[1] }, ReturnType<typeof waveSystemModes>>;
  field: Job<Parameters<typeof computeField>[0], ReturnType<typeof computeField>>;
  subFilters: Job<SetupArgs<SubFiltersArgs> & Opts<SubFiltersArgs[4], 'ppo'>, ReturnType<typeof optimizeSubFilters>>;
  voiceMap: Job<{ room: VoiceArgs[0]; settings: VoiceArgs[1]; goal?: VoiceArgs[3]; precision?: VoiceArgs[4] }, ReturnType<typeof voiceMap>>;
}

export type ComputeType = keyof ComputeJobs;
export type ComputePayload<K extends ComputeType> = ComputeJobs[K]['payload'];
export type ComputeResult<K extends ComputeType> = ComputeJobs[K]['result'];

type ExpectAll<T extends Record<ComputeType, true>> = T;
/**
 * Проверка договора: входные данные каждой задачи переживают JSON-копию. Если в них попадёт типизированный массив,
 * функция, дата и т. п., здесь будет ошибка компиляции с названием вида задачи.
 */
export type PayloadsSurviveJson = ExpectAll<{ [K in ComputeType]: IsJsonSafe<ComputePayload<K>> }>;

/** Задача для воркера: `payload` — JSON-копия входных данных. */
export interface ComputeRequest<K extends ComputeType = ComputeType> {
  id: number;
  type: K;
  payload: ComputePayload<K>;
}
/** Отмена задачи, которая ещё ждёт в очереди. */
export interface ComputeCancel {
  cancel: number;
}
/** Сообщения интерфейса воркеру. */
export type ComputeMessage = ComputeRequest | ComputeCancel;

/** Сообщения воркера интерфейсу: ход расчёта (0…1), результат или ошибка. */
export type ComputeReply =
  | { id: number; kind: 'progress'; value: number }
  | { id: number; kind: 'done'; result: ComputeResult<ComputeType> }
  | { id: number; kind: 'error'; error: string; stack?: string };
