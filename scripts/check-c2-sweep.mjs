// Independent field check for two sweep measurements of one placement (054, C2). No network or writes.
// node scripts/check-c2-sweep.mjs <project.roomacoustics.json | -> [--pair=0,1] [--sign=1|-1|0] [--cal=public/field-check/c2-correction.txt]
// pair: indexes in [current measurement, ...history], newer first. sign: +1 catalog profile vs none,
// −1 legacy file vs none (legacy subtracts the file), 0 legacy vs its catalog copy.
// 058: [--zones=30-45,75-115,200-480] [--ref=75-115] — зоны сравнения и зона оценки общего сдвига уровня (поправка там известна).
// Вариант для слабого баса: --cal=public/field-check/c2-midbass-correction.txt --zones=50-82,122-160,212-480 --ref=122-160.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const option = (name, fallback) => args.find(a => a.startsWith('--' + name + '='))?.split('=')[1] ?? fallback;
const file = args.find(a => !a.startsWith('--'));
const [newer, older] = option('pair', '0,1').split(',').map(Number);
const sign = Number(option('sign', '1'));
const calPath = option('cal', fileURLToPath(new URL('../public/field-check/c2-correction.txt', import.meta.url)));
const tolerance = 1.5;
const zoneOf = text => {
  const [lo, hi] = text.split('-').map(Number);
  check(Number.isFinite(lo) && Number.isFinite(hi) && hi > lo, 'Неверная зона ' + text + ': нужно «нижняя-верхняя» в Гц.');
  return [lo, hi];
};
function check(condition, message) {
  if (!condition) throw new Error(message);
}
const median = values => { const s = [...values].sort((a, b) => a - b); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };

function readCorrection(text) {
  const rows = text.split(/\r?\n/).map(l => l.trim()).filter(l => l && !/^(#|\*|\/\/)/.test(l)).map(l => l.split(/[\s,;]+/).map(Number));
  check(rows.length >= 2 && rows.every(r => r.length >= 2 && r.every(Number.isFinite)), 'Файл поправки не прочитан.');
  return { hz: rows.map(r => r[0]), db: rows.map(r => r[1]) };
}
/** Как в приложении: дБ по логарифму частоты, вне диапазона файла поправки нет, усиление не больше +12 дБ. */
function correctionAt({ hz, db }, f) {
  if (f < hz[0] || f > hz.at(-1)) return 0;
  const i = hz.findIndex(edge => edge >= f);
  const v = f === hz[i] ? db[i] : db[i - 1] + Math.log(f / hz[i - 1]) / Math.log(hz[i] / hz[i - 1]) * (db[i] - db[i - 1]);
  return Math.min(v, 12);
}

function verify(saved, cal) {
  check(saved?.format === 'room-acoustics-project' && saved.project?.current, 'Нужен экспорт проекта Room Acoustics.');
  const setup = saved.project.current;
  const list = [setup.measurement, ...(setup.history ?? [])].filter(Boolean);
  const a = list[newer], b = list[older];
  check(a && b, `В текущей расстановке ${list.length} замер(ов); нужны индексы ${newer} и ${older}.`);
  check(a.session && b.session && a.session !== b.session, 'Нужны два отдельных сеанса свипа из приложения.');
  check(a.f.length === b.f.length && a.f.every((f, i) => Math.abs(f - b.f[i]) < 1e-9) && Math.abs(a.f[0] - 15) < 1e-9,
    'Частотные сетки замеров не совпадают или это не свип приложения.');
  const diff = a.f.map((f, i) => ({ f, d: a.db[i] - b.db[i], c: sign * correctionAt(cal, f) }));
  const zone = (lo, hi) => diff.filter(p => p.f >= lo && p.f <= hi);
  // Общий сдвиг уровня между записями (громкость, положение) — в зоне --ref за вычетом её поправки (по умолчанию там 0 дБ).
  const zones = option('zones', '30-45,75-115,200-480').split(',').map(zoneOf), ref = zoneOf(option('ref', '75-115'));
  check(zones.every(([lo, hi]) => zone(lo, hi).length) && zone(...ref).length, 'В зоне нет точек сетки свипа.');
  const offset = median(zone(...ref).map(p => p.d - p.c));
  console.log('Замеры: «%s» (%s) минус «%s» (%s) · знак %d', a.name, a.importedAt, b.name, b.importedAt, sign);
  console.log('Сдвиг уровня между записями по %s–%s Гц: %s дБ', ref[0], ref[1], offset.toFixed(2));
  console.log('Зона, Гц | медиана разности − сдвиг, дБ | ожидание, дБ | отклонение, дБ');
  let worst = 0;
  for (const [lo, hi] of zones) {
    const points = zone(lo, hi);
    const got = median(points.map(p => p.d - offset)), want = median(points.map(p => p.c));
    worst = Math.max(worst, Math.abs(got - want));
    console.log('%s–%s | %s | %s | %s', lo, hi, got.toFixed(2), want.toFixed(2), (got - want).toFixed(2));
  }
  if (Math.abs(offset) > 3) console.log('Сдвиг больше 3 дБ: проверьте, что громкость и положение не менялись между записями.');
  check(worst <= tolerance, `Отклонение ${worst.toFixed(2)} дБ больше допуска ${tolerance} дБ.`);
  console.log('Пройдена проверка разности замеров свипа C2.');
}

try {
  const text = file === '-' ? readFileSync(0, 'utf8') : readFileSync(file, 'utf8');
  verify(JSON.parse(text), readCorrection(readFileSync(calPath, 'utf8')));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
