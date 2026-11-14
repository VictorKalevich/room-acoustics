// Проверка формы сохранённых данных при открытии проекта (028). Поле неверного типа не должно ронять отрисовку
// и расчёт: неверный элемент списка убирается, неверное необязательное поле — тоже (читатели подставляют
// умолчание), обязательное — к умолчанию. Проверяется только форма (тип, значение из перечня), а не смысл
// величин. Верные данные возвращаются без изменений — тем же объектом.
import type { PlacementResult, SubSetting, Vec3 } from '../core/types';

export const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object';
/** Конечное число. */
export const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
/** Число или null: NaN и ±∞ в JSON записываются как null. */
const numOrNull = (v: unknown) => v === null || typeof v === 'number';
export const isPoint = (p: unknown): p is Vec3 => isObj(p) && isNum(p.x) && isNum(p.y) && isNum(p.z);
const isList = (ok: (v: unknown) => boolean) => (v: unknown) => Array.isArray(v) && v.every(ok);
/** Необязательное поле: нет или верное. */
const opt = (v: unknown, ok: (v: any) => boolean) => v === undefined || ok(v);
/** Значение из перечня. */
export const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T => (list as readonly unknown[]).includes(v);
export const WALLS = ['front', 'back', 'left', 'right'] as const;

/** Свои фильтры канала сабвуфера: пиковые {f, gainDb, q} и фазовые {f, q} — числа. */
const isFilter = (keys: string[]) => (f: unknown) => isObj(f) && keys.every((k) => isNum(f[k]));
const isPeq = isList(isFilter(['f', 'gainDb', 'q']));
const isAllpass = isList(isFilter(['f', 'q']));

/**
 * Настройки сабвуферов расстановки: запись, где задержка, фаза или уровень — не числа, убирается (читается как
 * 0 мс / 0° / 0 дБ); неверный список своих фильтров убирается из записи. Верный объект возвращается тем же.
 */
export function cleanSubSettings(raw: unknown): Record<string, SubSetting> {
  if (!isObj(raw)) return {};
  let changed = false;
  const out: Record<string, SubSetting> = {};
  for (const [id, v] of Object.entries(raw)) {
    if (!isObj(v) || !isNum(v.delayMs) || !isNum(v.phaseDeg) || !isNum(v.gainDb)) { changed = true; continue; }
    const badPeq = !opt(v.peq, isPeq), badAllpass = !opt(v.allpass, isAllpass);
    if (!badPeq && !badAllpass) { out[id] = v as SubSetting; continue; }
    changed = true;
    const n = { ...v };
    if (badPeq) delete n.peq;
    if (badAllpass) delete n.allpass;
    out[id] = n as SubSetting;
  }
  return changed ? out : (raw as Record<string, SubSetting>);
}

/**
 * Вариант подбора: то, без чего его нельзя показать или посчитать (места, оценки, штрафы, график).
 * Необязательные поля прежних версий могут отсутствовать: seats (появилось в 002), objScore, robust, angleDeg,
 * subSettings, scheme, notes; если поле есть — оно своего типа.
 */
function okPlacement(p: unknown): boolean {
  if (!isObj(p)) return false;
  const r = p.response;
  return isPoint(p.listener)
    && opt(p.seats, isList(isPoint))
    && Array.isArray(p.sources) && p.sources.every((s) => isObj(s) && typeof s.id === 'string' && isPoint(s.pos))
    && [p.score, p.scoreCenter, p.scoreSeats].every(numOrNull)
    && [p.objScore, p.robust, p.angleDeg].every((v) => opt(v, numOrNull))
    && Array.isArray(p.penalties) && p.penalties.every(isObj)
    && isObj(r) && [r.f, r.db, r.target].every(isList(numOrNull))
    && opt(p.subSettings, (v) => isObj(v) && cleanSubSettings(v) === v)
    && opt(p.scheme, (v) => typeof v === 'string')
    && opt(p.notes, Array.isArray);
}

/** Результат подбора (FR-2801): неверной формы — null (подбор запускают заново). Верный возвращается тем же. */
export function cleanResult(raw: unknown): (PlacementResult & { stale?: boolean }) | null {
  if (!isObj(raw)) return null;
  const ok = Array.isArray(raw.best) && raw.best.every(okPlacement) && okPlacement(raw.baseline)
    && Array.isArray(raw.notes) && [raw.fLo, raw.fHi, raw.evaluated, raw.elapsedMs].every(numOrNull);
  return ok ? (raw as PlacementResult & { stale?: boolean }) : null;
}

/** Убирает перечисленные поля, если они есть и неверны; без неверных — тот же объект. */
export function dropBad<T extends Record<string, any>>(o: T, checks: { [K in keyof T]?: (v: unknown) => boolean }): T {
  const bad = (Object.keys(checks) as (keyof T)[]).filter((k) => o[k] !== undefined && !checks[k]!(o[k]));
  if (!bad.length) return o;
  const n = { ...o };
  for (const k of bad) delete n[k];
  return n;
}
