// Единицы v2 (059, data-model): внутри — СИ. Псевдоним в типе поля называет его единицу; переводы — только здесь.

export type Meters = number;
export type Centimeters = number;
export type Seconds = number;
export type Milliseconds = number;
export type Hertz = number;
export type Degrees = number;
export type Radians = number;
export type Celsius = number;
/** Линейная амплитуда (давление, напряжение, отсчёт) относительно своей опоры. */
export type Amplitude = number;
/** Энергия или мощность относительно своей опоры. */
export type Energy = number;

/** Опора децибел. dBFS без абсолютной калибровки не превращается в dB SPL. */
export type DbRef = 'dBFS' | 'dB SPL' | 'dB re 1' | 'dB re target' | 'dB re median';
export interface Level { db: number; ref: DbRef }

export const cmToM = (cm: Centimeters): Meters => cm / 100;
export const mToCm = (m: Meters): Centimeters => m * 100;
export const msToS = (ms: Milliseconds): Seconds => ms / 1000;
export const sToMs = (s: Seconds): Milliseconds => s * 1000;
export const degToRad = (d: Degrees): Radians => (d * Math.PI) / 180;
export const radToDeg = (r: Radians): Degrees => (r * 180) / Math.PI;

export const amplitudeToDb = (a: Amplitude): number => 20 * Math.log10(a);
export const energyToDb = (e: Energy): number => 10 * Math.log10(e);
export const dbToAmplitude = (db: number): Amplitude => 10 ** (db / 20);
export const dbToEnergy = (db: number): Energy => 10 ** (db / 10);

/** Значение, которого нет: неизвестно, не задано пользователем или не применимо. Не ноль и не значение по умолчанию. */
export interface Missing { readonly missing: 'unknown' | 'unset' | 'not-applicable' }
export type Maybe<T> = T | Missing;

export const UNKNOWN: Missing = Object.freeze({ missing: 'unknown' });
export const UNSET: Missing = Object.freeze({ missing: 'unset' });
export const NOT_APPLICABLE: Missing = Object.freeze({ missing: 'not-applicable' });

export function isMissing(v: unknown): v is Missing {
  return typeof v === 'object' && v !== null && 'missing' in v && Object.keys(v).length === 1;
}

export const isKnown = <T>(v: Maybe<T>): v is T => !isMissing(v);

/** Известное значение или результат `orElse` — вызывающий явно решает, что делать с пропуском. */
export const knownOr = <T, U>(v: Maybe<T>, orElse: (m: Missing) => U): T | U => (isMissing(v) ? orElse(v) : v);
