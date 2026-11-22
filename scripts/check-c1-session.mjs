// Independent field check for one stopped noise-meter export. No network or writes.
import { readFileSync } from 'node:fs';

const hz = [20, 40, 63, 100, 250, 500, 1000, 2000, 4000, 8000, 16000, 20000];
const db = [6, 6, 6, 6, 3, 0, 0, -3, -6, -6, 0, 0];
const tones = [80, 750, 6000];
const tolerance = 0.01;
function check(condition, message) {
  if (!condition) throw new Error(message);
}
const dB = power => 10 * Math.log10(power);
function gainDb(f) {
  if (f < hz[0] || f > hz.at(-1)) return 0;
  const i = hz.findIndex(edge => edge >= f);
  if (f === hz[i]) return db[i];
  const t = Math.log(f / hz[i-1]) / Math.log(hz[i] / hz[i-1]);
  return db[i-1] + t * (db[i] - db[i-1]);
}

function verify(report) {
  const raw = report.spectralAnalysis;
  const profile = report.calibration?.profile;
  const corrected = report.calibration?.correctedSpectrum;
  check(report.schema === 3 && raw && corrected && profile, 'Нужен экспорт сеанса с явным профилем.');
  check(profile.curve?.kind === 'correction' && JSON.stringify(profile.curve.frequencyHz) === JSON.stringify(hz) &&
    JSON.stringify(profile.curve.correctionDb) === JSON.stringify(db) && profile.version === 1 &&
    report.calibration.maxBoostDb >= 6 && JSON.stringify(profile.validRangeHz) === '[20,20000]',
    'Выберите исходную 12-точечную поправку v1 с усилением не менее +6 дБ.');
  check(raw.weight === 'Z' && corrected.weight === 'Z' && raw.period === 'session' && corrected.period === 'session' &&
    raw.validSpectralSeconds > 0 && raw.validSpectralSeconds === corrected.seconds,
    'Для обоих спектров нужны вес Z и среднее за один и тот же сеанс.');
  const step = raw.binHz;
  const length = raw.fftSize / 2 + 1;
  check(Number.isFinite(step) && step > 0 && raw.fftSize === 32768 && report.path?.sampleRate === step * raw.fftSize &&
    Array.isArray(raw.psd) && Array.isArray(corrected.psd) && raw.psd.length === length && corrected.psd.length === length,
    'Неверная или неполная частотная сетка.');

  let sumRaw = 0, sumExpected = 0, sumObserved = 0, maxError = 0;
  for (let k = 0; k < length; k++) {
    const a = raw.psd[k], b = corrected.psd[k];
    check(Number.isFinite(a) && a >= 0 && Number.isFinite(b) && b >= 0 && (a === 0) === (b === 0),
      'Некорректная PSD в бине ' + k);
    const correction = gainDb(k * step);
    if (a > 0) maxError = Math.max(maxError, Math.abs(dB(b / a) - correction));
    sumRaw += a;
    sumExpected += a * 10 ** (correction / 10);
    sumObserved += b;
  }
  const expectedLevel = dB(sumExpected * step), observedLevel = dB(sumObserved * step);
  const savedLevel = dB(corrected.meanSquare);
  console.log('Сборка %s · %s v%d · шаг %s Гц', report.build?.sha, profile.name, profile.version, step);
  console.log('Частота бина, Гц | исходная PSD | с поправкой, dBFS/Гц | разность, дБ');
  const weak = [];
  for (const tone of tones) {
    const k = Math.round(tone / step);
    const a = raw.psd[k], b = corrected.psd[k];
    check(k > 25 && k + 25 < length, 'Тон вне доступной сетки.');
    console.log([k * step, dB(a), dB(b), dB(b / a)].map(v => v.toFixed(3)).join(' | '));
    const floor = raw.psd.slice(k-25,k-9).concat(raw.psd.slice(k+10,k+26)).sort((x,y) => x-y)[15];
    if (!(a > 0 && a > floor * 10 ** 1.2)) weak.push(tone);
  }
  console.log('Интеграл PSD, dBFS · исходный %s · ожидаемый %s · полученный %s · поле meanSquare %s',
    ...[dB(sumRaw * step), expectedLevel, observedLevel, savedLevel].map(v => v.toFixed(4)));
  console.log('Максимальная ошибка поправки по бинам, дБ ·', maxError.toFixed(6));
  check(Number.isFinite(savedLevel) && Math.abs(expectedLevel - observedLevel) <= tolerance &&
    Math.abs(observedLevel - savedLevel) <= tolerance && maxError <= tolerance, 'Расхождение превышает 0,01 дБ.');
  check(report.measurement?.missing === 0 && report.measurement.clipped === 0, 'В записи есть пропуски или клиппинг. Повторите сеанс.');
  check(!weak.length, 'Недостаточно выражен тон (порог 12 дБ над соседним фоном), Гц: ' + weak.join(', '));
  console.log('Пройдена численная проверка относительной коррекции C1.');
}
try {
  const path = process.argv[2];
  check(path && process.argv.length === 3, 'Использование: node scripts/check-c1-session.mjs "путь к сеансу.json"');
  verify(JSON.parse(readFileSync(path === '-' ? 0 : path, 'utf8').replace(/^\uFEFF/, '')));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
