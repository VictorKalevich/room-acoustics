import type { MicProfile } from './micCalibration';

export const maxPoints = 16384;
export const maxBoostDb = 12;
const invalid = (reason: string): never => { throw new Error(reason); };

export function checkCurve(f: readonly number[], db: readonly number[]) {
  if (!Array.isArray(f) || !Array.isArray(db) || f.length !== db.length || f.length < 2 || f.length > maxPoints)
    invalid('Нужны от 2 до 16384 пар частота / уровень.');
  for (let i = 0; i < f.length; i++) {
    if (!Number.isFinite(f[i]) || f[i] <= 0 || (i && f[i] <= f[i - 1]))
      invalid('Частоты в Гц должны быть положительными и строго возрастать.');
    if (!Number.isFinite(db[i]) || Math.abs(db[i]) > 300)
      invalid('Проверьте единицы уровня. Допустимы конечные значения от −300 до 300 дБ.');
  }
}

export function parseMicFile(text: string) {
  const f: number[] = [], db: number[] = [];
  const number = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
  let header = false;
  for (const [i, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('*') || line.startsWith('//')) continue;
    if (!f.length && !header && /^(?:(?:frequency|freq|частота)[ _([]*)?(?:hz|гц)[)\]]?[;,\s]+(?:db|дб)(?:[;,\s]+(?:deg|degrees))?$/i.test(line)) {
      header = true;
      continue;
    }
    // FRD optionally contains a phase column in degrees. Preserve empty CSV cells as errors.
    const whitespace = line.split(/\s+/);
    const decimalComma = whitespace.length >= 2 && whitespace.every(x => number.test(x.replace(',', '.')));
    const columns = line.includes(';') ? line.split(';') : decimalComma ? whitespace : line.split(',');
    const cells = columns.map(x => x.trim().replace(',', '.'));
    if ((cells.length !== 2 && cells.length !== 3) || cells.some(x => !number.test(x) || !Number.isFinite(Number(x))))
      invalid('Строка ' + (i + 1) + ' — ожидаются Гц и дБ, необязательно фаза в градусах.');
    f.push(Number(cells[0]));
    db.push(Number(cells[1]));
    if (f.length > maxPoints) invalid('Слишком много точек.');
  }
  checkCurve(f, db);
  return { f, db };
}

export function values(curve: MicProfile['curve']) {
  return curve.kind === 'response' ? curve.responseDb : curve.correctionDb;
}

export function validateProfile(p: MicProfile) {
  if (!p || (p.maxBoostDb !== undefined && !(Number.isFinite(p.maxBoostDb) && p.maxBoostDb >= 0 && p.maxBoostDb <= maxBoostDb)) || typeof p.id !== 'string' || !p.id || !Number.isSafeInteger(p.version) || p.version < 1 ||
      !['user', 'builtin'].includes(p.origin) || !['unknown', 'built-in', 'external'].includes(p.inputKind) ||
      !['experimental', 'unverified', 'validated'].includes(p.validationStatus) ||
      !p.curve || !['correction', 'response'].includes(p.curve.kind) ||
      [p.name, p.deviceModel, p.method, p.captureMode].some(s => typeof s !== 'string' || !s.trim()) ||
      typeof p.notes !== 'string' || [p.sourceURL, p.sourceDate, p.orientation, p.directivitySource].some(s => s !== null && typeof s !== 'string') ||
      (p.digitizationUncertaintyDb !== null && !(Number.isFinite(p.digitizationUncertaintyDb) && p.digitizationUncertaintyDb >= 0)))
    invalid('Повреждены метаданные профиля.');
  const f = p.curve.frequencyHz;
  checkCurve(f, values(p.curve));
  if (!Array.isArray(p.validRangeHz) || p.validRangeHz.length !== 2) invalid('Некорректный диапазон.');
  if (p.sourceURL && !/^https?:\/\//i.test(p.sourceURL)) invalid('Укажите источник в виде URL http(s).');
  const [lo, hi] = p.validRangeHz;
  if (!(Number.isFinite(lo) && Number.isFinite(hi) && lo >= f[0] && hi <= f[f.length - 1] && hi > lo &&
      p.referenceHz === 1000 && (p.curve.kind !== 'response' || (lo <= 1000 && hi >= 1000))))
    invalid('Проверьте диапазон. Для АЧХ нужна опора 1000 Гц внутри диапазона.');
}

function logDistance(a: number, b: number) {
  const relative = (b - a) / a;
  return Number.isFinite(relative) ? Math.log1p(relative) : Math.log(b) - Math.log(a);
}
function interpolate(f: readonly number[], db: readonly number[], hz: number) {
  let lo = 0, hi = f.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >>> 1;
    if (f[mid] <= hz) lo = mid;
    else hi = mid;
  }
  if (hz === f[lo]) return db[lo];
  if (hz === f[hi]) return db[hi];
  return db[lo] + (db[hi] - db[lo]) * logDistance(f[lo], hz) / logDistance(f[lo], f[hi]);
}

/** null marks an uncharacterized bin. Its raw energy is retained. */
export function correctionFunction(p: MicProfile) {
  validateProfile(p);
  const f = p.curve.frequencyHz, db = values(p.curve);
  const response = p.curve.kind === 'response';
  const reference = response ? interpolate(f, db, p.referenceHz) : 0;
  return (hz: number) => {
    if (!(hz >= p.validRangeHz[0] && hz <= p.validRangeHz[1])) return null;
    const level = interpolate(f, db, hz);
    return Math.min(p.maxBoostDb ?? maxBoostDb, response ? reference - level : level);
  };
}

export function powerGains(profile: MicProfile, step: number, bins: number) {
  const correction = correctionFunction(profile);
  return Float64Array.from({ length: bins }, (_, k) => 10 ** ((correction(k * step) ?? 0) / 10));
}
