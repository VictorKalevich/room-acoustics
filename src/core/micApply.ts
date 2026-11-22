import { calAt } from './dsp';
import type { MicProfile } from './micCalibration';
import { correctionFunction } from './micCurve';

/** Прежняя кривая `ra-mic-cal`: измеренное отклонение микрофона, вычитается как есть, края постоянные. */
export interface LegacyCal { name: string; f: number[]; db: number[] }

/** Микрофонная поправка одного измерения инструмента (054). Действует ровно одна: прежняя, никакой или из каталога. */
export type AppliedMic = { mode: 'legacy'; legacy: LegacyCal | null } | { mode: 'none' } | { mode: 'catalog'; profile: MicProfile };

/** Поправка профиля на частотах сетки, дБ. Вне диапазона профиля — 0: значение остаётся без поправки. */
export function correctionAt(profile: MicProfile, f: readonly number[]) {
  const at = correctionFunction(profile);
  return f.map(hz => at(hz) ?? 0);
}

/** Поправка каталога прибавляется к уровням сетки до частотного сглаживания: сглаживается исправленный спектр. */
export function beforeSmoothing(mic: AppliedMic, f: readonly number[], db: number[]) {
  if (mic.mode !== 'catalog') return db;
  const c = correctionAt(mic.profile, f);
  return db.map((v, i) => v + c[i]);
}

/** Прежнее правило RTA и свипа: legacy-кривая вычитается из уже сглаженных уровней. */
export function afterSmoothing(mic: AppliedMic, f: readonly number[], db: number[]) {
  const legacy = mic.mode === 'legacy' ? mic.legacy : null;
  return legacy ? db.map((v, i) => v - calAt(legacy, f[i])) : db;
}

/** Одинаковый ключ — одинаковая поправка: точки одного накопленного замера не смешивают разные. */
export function micKey(mic: AppliedMic) {
  if (mic.mode === 'catalog') return 'catalog:' + mic.profile.id + ':' + mic.profile.version;
  return mic.mode === 'legacy' ? 'legacy:' + JSON.stringify(mic.legacy) : 'none';
}
