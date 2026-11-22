// Independent check of a noise-meter extended export (058). No network or writes.
// node scripts/check-noise-final.mjs <export-session.json | -> [table.csv ...] [--signal[=noise-final-signal.json]]
//   [--profile=public/field-check/c2-correction.txt] [--same=other-export-session.json]
// Свои реализации: base64, веса A/C по IEC 61672-1 (точные полюсы), поправка профиля, ячейки полос, окна Leq.
// Код приложения не используется. Без --signal — проверки данных и математики для любого сеанса schema 4;
// с --signal — ещё структура сигнала итоговой проверки (относительные уровни, полосы, тоны, время).
import { readFileSync } from 'node:fs';
import { endianness } from 'node:os';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const option = name => { const a = args.find(x => x === '--' + name || x.startsWith('--' + name + '=')); return a === undefined ? undefined : a.slice(name.length + 3); };
const inputs = args.filter(a => !a.startsWith('--'));
const BLOCK = 4096, N = 32768, HOP = 16384, BINS = N / 2 + 1;
const ENERGY_EDGES = [20, 60, 250, 500, 2000, 5000, 20000];

const lines = [];
let failures = 0;
const mark = { ok: 'пройдено', fail: 'НЕ ПРОЙДЕНО', skip: 'не проверено', info: 'сведения' };
function result(status, group, text) {
  lines.push(`[${mark[status]}] ${group} · ${text}`);
  if (status === 'fail') failures++;
}
const pass = (g, t) => result('ok', g, t), fail = (g, t) => result('fail', g, t), skip = (g, t) => result('skip', g, t), info = (g, t) => result('info', g, t);
const verdict = (ok, g, t) => result(ok ? 'ok' : 'fail', g, t);
function need(condition, message) { if (!condition) throw new Error(message); }
const dB = p => p > 0 ? 10 * Math.log10(p) : p === 0 ? -Infinity : NaN;
const f2 = v => Number.isFinite(v) ? v.toFixed(2) : String(v);
const f3 = v => Number.isFinite(v) ? v.toFixed(3) : String(v);
const median = values => { const s = [...values].sort((a, b) => a - b); return s.length ? s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2 : NaN; };

// Типизированные массивы {"$typed", "length", "base64"}: байты little-endian.
const TYPES = { Float64Array, Float32Array, Uint32Array, Uint16Array, Uint8Array };
function decode(v) {
  if (Array.isArray(v)) return v.map(decode);
  if (!v || typeof v !== 'object') return v;
  if ('$typed' in v) {
    const T = TYPES[v.$typed];
    need(T && Number.isSafeInteger(v.length) && v.length >= 0 && typeof v.base64 === 'string', 'Файл повреждён: неверный массив.');
    const bytes = Buffer.from(v.base64, 'base64');
    need(bytes.length === v.length * T.BYTES_PER_ELEMENT, 'Файл повреждён: длина массива не совпадает с base64.');
    const copy = new ArrayBuffer(bytes.length);
    new Uint8Array(copy).set(bytes);
    return new T(copy);
  }
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, decode(x)]));
}
function load(path) {
  const text = readFileSync(path === '-' ? 0 : path, 'utf8').replace(/^﻿/, '');
  const d = JSON.parse(text);
  need(d?.kind === 'room-acoustics/noise-export', 'Это не расширенный JSON шумомера (kind room-acoustics/noise-export). Прежний JSON schema 2/3 проверяет scripts/check-c1-session.mjs.');
  need(d.schema === 4, `Схема ${d.schema}: скрипт проверяет schema 4.`);
  const r = d.record;
  need(r && typeof r === 'object', 'Файл повреждён: нет записи.');
  const record = { ...r, content: decode(r.content), context: decode(r.context) };
  need(record.content?.type === 'session', `Запись — импорт прежнего экспорта schema ${record.imported?.schema ?? '?'}: истории по секундам и спектрограммы в ней нет. Нужен расширенный JSON сеанса шумомера.`);
  return { file: d, record, s: record.content.session, chars: text.length };
}

// IEC 61672-1, приложение E: точные полюсы и нормировка на 1 кГц.
const P1 = 20.598997, P2 = 107.65265, P3 = 737.86223, P4 = 12194.217;
function weight(f, w) {
  if (w === 'Z') return 1;
  const s = f * f;
  if (f === 0) return 0;
  if (w === 'C') return 10 ** ((20 * Math.log10(P4 ** 2 * s / ((s + P1 ** 2) * (s + P4 ** 2))) + 0.062) / 10);
  return 10 ** ((20 * Math.log10(P4 ** 2 * s * s / ((s + P1 ** 2) * Math.sqrt(s + P2 ** 2) * Math.sqrt(s + P3 ** 2) * (s + P4 ** 2))) + 2.0) / 10);
}
/** Поправка профиля, дБ мощности: линейно по lg f; АЧХ — R(1 кГц) − R(f); положительная — не выше предела; вне диапазона — 0. */
function correction(calibration) {
  if (!calibration) return () => 0;
  const { profile, maxBoostDb } = calibration, c = profile.curve;
  const f = c.frequencyHz, db = c.kind === 'response' ? c.responseDb : c.correctionDb;
  need(Array.isArray(f) && Array.isArray(db) && f.length === db.length && f.length >= 2 && f.every((x, i) => Number.isFinite(x) && x > 0 && (!i || x > f[i - 1])) &&
    db.every(Number.isFinite) && ['correction', 'response'].includes(c.kind), 'Снимок профиля повреждён.');
  const at = hz => {
    let lo = 0, hi = f.length - 1;
    if (hz <= f[0]) return db[0];
    if (hz >= f[hi]) return db[hi];
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (f[mid] <= hz) lo = mid; else hi = mid; }
    return hz === f[lo] ? db[lo] : db[lo] + (db[hi] - db[lo]) * Math.log(hz / f[lo]) / Math.log(f[hi] / f[lo]);
  };
  const reference = c.kind === 'response' ? at(profile.referenceHz) : 0;
  const [lo, hi] = profile.validRangeHz;
  return hz => !(hz >= lo && hz <= hi) ? 0 : Math.min(maxBoostDb, c.kind === 'response' ? reference - at(hz) : at(hz));
}
/** Мощность бина делится между полосами по пересечению его физической ячейки (DC и Найквист — половинные ячейки). */
function cells(step, edges) {
  const nyquist = (BINS - 1) * step;
  return edges.slice(1).map((upper, i) => {
    const lo = edges[i], hi = Math.min(upper, nyquist), list = [];
    for (let k = Math.max(0, Math.ceil(lo / step - 0.5)); k <= Math.min(BINS - 1, Math.floor(hi / step + 0.5)); k++) {
      const left = Math.max(0, (k - 0.5) * step), right = Math.min(nyquist, (k + 0.5) * step);
      const width = Math.max(0, Math.min(hi, right) - Math.max(lo, left));
      if (width > 0) list.push([k, step * width / (right - left)]);
    }
    return { lo, hi, list };
  }).filter(b => b.hi > b.lo);
}
function spectrogramEdges(fs) {
  const edges = [];
  for (let n = -68; n <= 51; n++) {
    const hi = 1000 * 2 ** ((2 * n + 1) / 24);
    if (hi > fs / 2) break;
    if (!edges.length) edges.push(1000 * 2 ** ((2 * n - 1) / 24));
    edges.push(hi);
  }
  return edges;
}
/** Файл поправки как в приложении: «#», «*», «//» — комментарии; разделители ; , пробел; десятичная запятая. */
function readCorrectionFile(text) {
  const f = [], db = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || /^(#|\*|\/\/)/.test(line) || (!f.length && /^[^\d+-.]/.test(line))) continue;
    const parts = line.includes(';') ? line.split(';') : /^\S+\s+\S+/.test(line) ? line.split(/\s+/) : line.split(',');
    const [a, b] = parts.map(x => Number(x.trim().replace(',', '.')));
    need(Number.isFinite(a) && Number.isFinite(b), 'Файл поправки не прочитан: ' + line);
    f.push(a); db.push(b);
  }
  return { f, db };
}

function analyse(session) {
  const s = session, st = s.settings, tl = s.timeline, fs = st?.sampleRate;
  const G = 'данные', M = 'математика';
  need(s?.kind === 'room-acoustics/noise-session' && s.version === 1, 'Неизвестный снимок сеанса.');
  need(st.blockSamples === BLOCK && st.fftSize === N && st.hopSamples === HOP && st.window === 'periodic Hann' && st.levelColumnSeconds === 1 &&
    st.coarseColumnSeconds === 10 && st.fineSeconds === 600 && st.maxSessionSeconds === 43200 && Number.isFinite(fs) && fs > 0 && tl.sampleRate === fs && tl.hop === HOP,
  'Настройки сеанса не совпадают с описанием формата (блок 4096, FFT 32768, hop 16384, окно Ханна, столбцы 1 и 10 с, кольцо 600 с).');
  const V = tl.variants, W3 = ['Z', 'A', 'C'];
  need((V === 3 || V === 6) && (V === 6) === !!s.calibration && st.variants.length === V &&
    st.variants.every((v, i) => v.weight === W3[i % 3] && v.corrected === i >= 3), 'Варианты Z/A/C и поправки не совпадают с профилем сеанса.');
  const binHz = fs / N, energyEdges = [20, ...ENERGY_EDGES.slice(1).map(e => Math.min(e, fs / 2))].filter((e, i, a) => !i || e > a[i - 1]);
  const close = (a, b, rel) => a.length === b.length && a.every((x, i) => Math.abs(x - b[i]) <= rel * Math.abs(b[i]));
  verdict(close(tl.energyEdgesHz, energyEdges, 1e-12) && close(tl.spectrogramEdgesHz, spectrogramEdges(fs), 1e-12), G,
    `границы шести полос и полос 1/12 октавы соответствуют формулам; fs ${fs} Гц, шаг FFT ${binHz.toFixed(6)} Гц`);
  const L = tl.levels.pcm.length, E = energyEdges.length - 1, B = tl.spectrogramEdgesHz.length - 1, M10 = tl.coarse.spec.length, F = tl.fine.ends.length;
  const lv = tl.levels;
  const sizes = [[lv.z, L], [lv.peak, L], [lv.spec, L], [lv.a, L], [lv.c, L], [lv.energy, L * E * V], [tl.coarse.energy, M10 * B * V], [tl.fine.power, F * B * V]];
  need(L === Math.ceil(tl.end / fs) && sizes.every(([a, n]) => a.length === n), 'Длины массивов истории не согласованы.');
  const arrays = [lv.pcm, lv.z, lv.peak, lv.spec, lv.a, lv.c, lv.energy, tl.coarse.spec, tl.coarse.energy, tl.fine.ends, tl.fine.power, ...Object.values(s.spectra).map(x => x.psd)];
  verdict(arrays.every(a => a.every(x => Number.isFinite(x) && x >= 0)), G, 'все суммы, мощности и PSD конечны и неотрицательны');

  // Итоги и столбцы.
  const sum = a => a.reduce((x, y) => x + y, 0);
  const b = s.blocks, T = s.totals, n = b.next.length;
  const accepted = sum(lv.pcm), spectral = sum(lv.spec);
  const missing = sum(b.missingBefore), clipped = b.flags.reduce((x, f) => x + (f & 2 ? 1 : 0), 0);
  verdict(T.blocks === n && accepted === n * BLOCK && T.endSamples === tl.end && (!n || tl.end === b.next[n - 1] * BLOCK) &&
    T.missingBlocks === missing && T.clippedBlocks === clipped, G, `блоки: принято ${n} (${(accepted / fs).toFixed(3)} с), шкала ${(tl.end / fs).toFixed(3)} с, пропущено ${missing}, с клиппингом ${clipped}`);
  verdict(Math.abs(sum(lv.z) - T.sumSquares) <= 1e-9 * T.sumSquares && Math.abs(Math.max(0, ...lv.peak) - T.samplePeak) <= 1e-6 * Math.max(T.samplePeak, 1e-30) &&
    spectral === T.spectralFrames * HOP && sum(tl.coarse.spec) === spectral, G, 'сумма квадратов, пик и спектральные отсчёты совпадают с итогами сеанса и столбцами 10 с');
  let columns = true;
  for (let i = 0; i < L; i++) {
    if (lv.pcm[i] > fs || lv.spec[i] > fs || (!lv.pcm[i] && (lv.z[i] || lv.peak[i])) ||
        (lv.pcm[i] && lv.peak[i] ** 2 < lv.z[i] / lv.pcm[i] * (1 - 1e-6))) columns = false;
  }
  verdict(columns, G, 'в каждом столбце 1 с: отсчётов не больше fs, цифровой пик не ниже RMS, пустые столбцы без энергии');
  let blockPower = 0;
  for (let i = 0; i < n; i++) if (!Number.isNaN(b.rms[i])) blockPower += 10 ** (b.rms[i] / 10);
  const leqZ = sum(lv.z) / accepted;
  verdict(n > 0 && Math.abs(dB(blockPower / n) - dB(leqZ)) <= 1e-6, G, `Leq Z сеанса по RMS блоков 4096 и по столбцам 1 с: ${f3(dB(blockPower / n))} и ${f3(dB(leqZ))} dBFS`);
  for (const w of ['A', 'C']) {
    const stored = T.weightedPower[w], cols = sum(w === 'A' ? lv.a : lv.c) / spectral;
    verdict(spectral > 0 && Math.abs(cols - stored) <= 1e-9 * stored, G, `Leq ${w} сеанса по столбцам и в итогах: ${f3(dB(cols))} dBFS`);
  }

  // Кольцо кадров и столбцы 10 с.
  const capacity = Math.ceil(600 * fs / HOP), ends = tl.fine.ends, dropped = tl.fine.dropped;
  let order = F <= capacity && (!dropped || F === capacity);
  for (let i = 0; i < F; i++) if (ends[i] - HOP < 0 || ends[i] > tl.end || (i && ends[i] <= ends[i - 1])) order = false;
  verdict(order, G, `кольцо кадров: ${F} из ${capacity}, вытеснено ${dropped}${dropped ? `, хранятся последние ${((ends[F - 1] - ends[0] + HOP) / fs).toFixed(1)} с` : ''}`);
  const fineFrom = dropped ? ends[0] - HOP : 0, span = 10 * fs, acc = new Float64Array(M10 * B);
  for (let i = 0; i < F; i++) {
    const t0 = ends[i] - HOP, t1 = ends[i];
    for (let m = Math.floor(t0 / span); m * span < t1; m++) {
      const overlap = Math.min(t1, (m + 1) * span) - Math.max(t0, m * span);
      for (let k = 0; k < B; k++) acc[m * B + k] += tl.fine.power[i * B * V + k] * overlap;
    }
  }
  let worstTier = 0, compared = 0;
  for (let m = Math.ceil(fineFrom / span); m < M10; m++) {
    for (let k = 0; k < B; k++) {
      const c = tl.coarse.energy[m * B * V + k];
      if (c > 0) { worstTier = Math.max(worstTier, Math.abs(acc[m * B + k] / c - 1)); compared++; }
    }
  }
  verdict(worstTier <= 1e-4, G, `кадры кольца и столбцы 10 с согласованы (${compared} ячеек, наибольшее относительное расхождение ${worstTier.toExponential(1)})`);

  // Математика по LTAS сеанса.
  const ltas = s.spectra.session, cal = correction(s.calibration);
  need(ltas.psd.length === BINS && Math.abs(ltas.seconds - spectral / fs) <= 1e-9 * Math.max(1, ltas.seconds), 'LTAS сеанса не согласован со спектральными отсчётами.');
  const gainA = Float64Array.from({ length: BINS }, (_, k) => weight(k * binHz, 'A')), gainC = Float64Array.from({ length: BINS }, (_, k) => weight(k * binHz, 'C'));
  const gainP = Float64Array.from({ length: BINS }, (_, k) => 10 ** (cal(k * binHz) / 10));
  const variantGain = v => { const w = W3[v % 3]; return k => (w === 'A' ? gainA[k] : w === 'C' ? gainC[k] : 1) * (v >= 3 ? gainP[k] : 1); };
  let msq = 0;
  for (let k = 0; k < BINS; k++) msq += ltas.psd[k] * binHz;
  const covered = []; for (let i = 0; i < L; i++) if (lv.spec[i] === fs && lv.pcm[i] === fs) covered.push(i);
  const leqCovered = sum(covered.map(i => lv.z[i])) / (covered.length * fs);
  verdict(covered.length > 0 && Math.abs(dB(msq) - dB(leqCovered)) <= 0.3, M,
    `Парсеваль: ∫PSD сеанса ${f3(dB(msq))} dBFS и Leq Z тех же секунд ${f3(dB(leqCovered))} dBFS (допуск ±0,3 дБ: края окон Ханна, удаление среднего)`);
  for (const [w, g] of [['A', gainA], ['C', gainC]]) {
    let p = 0; for (let k = 0; k < BINS; k++) p += ltas.psd[k] * g[k] * binHz;
    const d = dB(p) - dB(T.weightedPower[w]);
    verdict(Math.abs(d) <= 0.01, M, `вес ${w} по формуле IEC 61672 к LTAS: ${f3(dB(p))} dBFS, Leq ${w} приложения ${f3(dB(T.weightedPower[w]))} dBFS, разница ${f3(d)} дБ (допуск ±0,01: округление полюсов)`);
  }
  const integrate = (edges, v) => cells(binHz, edges).map(c => { const g = variantGain(v); let p = 0; for (const [k, coef] of c.list) p += ltas.psd[k] * g(k) * coef; return p; });
  for (let v = 0; v < V; v++) {
    const want = integrate(energyEdges, v), name = W3[v % 3] + (v >= 3 ? ' с поправкой' : ''), tol = v % 3 ? 0.01 : 0.001;
    let worst = 0;
    for (let j = 0; j < E; j++) {
      let e = 0; for (let i = 0; i < L; i++) e += lv.energy[(i * V + v) * E + j];
      if (want[j] > 0) worst = Math.max(worst, Math.abs(dB(e / spectral) - dB(want[j])));
    }
    verdict(worst <= tol, M, `шесть полос (${name}): энергия по секундам и интеграл LTAS по ячейкам бинов расходятся не больше ${f3(worst)} дБ (допуск ±${tol})`);
    const wantB = integrate(tl.spectrogramEdgesHz, v);
    let worstB = 0, totalCoarse = 0;
    for (let m = 0; m < M10; m++) totalCoarse += tl.coarse.spec[m];
    for (let k = 0; k < B; k++) {
      let e = 0; for (let m = 0; m < M10; m++) e += tl.coarse.energy[(m * V + v) * B + k];
      if (wantB[k] > 0) worstB = Math.max(worstB, Math.abs(dB(e / totalCoarse) - dB(wantB[k])));
    }
    verdict(worstB <= tol, M, `спектрограмма 1/12 окт (${name}): столбцы 10 с и интеграл LTAS расходятся не больше ${f3(worstB)} дБ (допуск ±${tol})`);
  }
  if (s.calibration) {
    const p = s.calibration.profile, at = [40, 65, 90, 140, 220, 235, 1000, 4000].map(f => `${f} Гц ${f2(cal(f))}`).join(', ');
    info(M, `профиль «${p.name}» v${p.version} (${p.curve.kind === 'response' ? 'АЧХ' : 'поправка'}), диапазон ${p.validRangeHz.join('–')} Гц, предел усиления +${s.calibration.maxBoostDb} дБ, вне диапазона — ${s.calibration.outsideRange === 'uncorrected' ? 'без поправки' : '?'}; поправка: ${at}`);
    verdict(s.calibration.outsideRange === 'uncorrected', M, 'вне диапазона профиля энергия исходная (uncorrected)');
  } else info(M, 'сеанс без профиля: вариантов с поправкой нет');
  return { fs, binHz, L, E, B, V, M10, energyEdges, gainA, gainC, gainP, cal, fineFrom, spectral, accepted, missing, startup: n ? b.missingBefore[0] : 0, clipped };
}

function checkProfile(session, path) {
  const G = 'профиль';
  const want = readCorrectionFile(readFileSync(path, 'utf8')), c = session.calibration;
  if (!c) { fail(G, `в сеансе нет профиля, ожидался ${path}`); return; }
  const p = c.profile, got = p.curve;
  verdict(got.kind === 'correction' && JSON.stringify(got.frequencyHz) === JSON.stringify(want.f) && JSON.stringify(got.correctionDb) === JSON.stringify(want.db) &&
    p.validRangeHz[0] === want.f[0] && p.validRangeHz[1] === want.f.at(-1), G,
  `снимок профиля «${p.name}» v${p.version} совпадает с файлом ${path.split(/[\\/]/).pop()}: ${want.f.length} точек, диапазон ${want.f[0]}–${want.f.at(-1)} Гц`);
}

// CSV того же измерения.
function readCsv(path) {
  const raw = readFileSync(path, 'utf8');
  const bom = raw.startsWith('﻿'), body = raw.replace(/^﻿/, '');
  const crlf = !/[^\r]\n/.test(body) && body.endsWith('\r\n');
  const all = body.split('\r\n');
  if (all.at(-1) === '') all.pop();
  const head = [];
  let i = 0;
  for (; i < all.length && all[i].startsWith('# '); i++) head.push(all[i].slice(2));
  const columns = (all[i] ?? '').split(','), rows = all.slice(i + 1).map(l => l.split(','));
  return { path, bom, crlf, head, columns, rows };
}
const cell = x => x === '' ? null : x === '-inf' ? -Infinity : Number(x);
function checkCsv(csv, ctx, record) {
  const name = csv.path.split(/[\\/]/).pop(), G = 'CSV ' + name, s = record.content.session, tl = s.timeline, lv = tl.levels;
  const title = csv.head[0] ?? '';
  const kind = { 'спектр': 'spectrum', 'LTAS': 'ltas', 'временная история': 'levels', 'история RMS по блокам': 'rms', 'энергия полос': 'bands', 'спектрограмма': 'spectrogram' }[title.replace('Room Acoustics · шумомер · ', '')];
  const idLine = csv.head.find(l => l.startsWith('Измерение: ')) ?? '';
  const shape = csv.bom && csv.crlf && !!kind && csv.head.some(l => l.startsWith('Формат: noise-csv 1')) && idLine.endsWith(' · id ' + record.id) &&
    csv.head.includes('Уровни: цифровая шкала dBFS (0 dBFS — полная шкала), не дБ SPL') && csv.rows.every(r => r.length === csv.columns.length);
  verdict(shape, G, `${kind ?? 'неизвестная таблица'}: UTF-8 с BOM, CRLF, строки «#» с единицами (dBFS, не дБ SPL), id записи ${record.id}, ${csv.rows.length} строк по ${csv.columns.length} столбцов`);
  if (!shape) return;
  const { fs, binHz, E, V, B, gainA, gainC, gainP, cal } = ctx, W3 = ['Z', 'A', 'C'];
  const line = prefix => csv.head.find(l => l.startsWith(prefix)) ?? '';
  const col = c => csv.columns.indexOf(c);
  let worst = 0, flags = true, count = 0;
  const near = (got, want, tol) => {
    count++;
    if (got === null || want === null || !Number.isFinite(want) || !Number.isFinite(got)) { if (!(got === want || (got === null && want === null))) flags = false; return; }
    worst = Math.max(worst, Math.abs(got - want) / tol);
  };
  const lvl = p => p == null || Number.isNaN(p) ? null : dB(p);
  if (kind === 'levels') {
    const m = /^Интервал: (\d+)–(\d+) с · вес ([ZAC])( · полосы с поправкой профиля)?/.exec(line('Интервал: '));
    need(m, name + ': не прочитан интервал.');
    const [n0, n1, w, corrected] = [Number(m[1]), Number(m[2]), m[3], !!m[4]], v = W3.indexOf(w) + (corrected ? 3 : 0);
    const energyOf = i => w === 'Z' ? lv.z[i] : w === 'A' ? lv.a[i] : lv.c[i], valid = i => w === 'Z' ? lv.pcm[i] : lv.spec[i];
    const window = (i, sec) => {
      let e = 0, ok = 0;
      for (let j = Math.max(0, i - sec + 1); j <= i; j++) { e += energyOf(j); ok += valid(j); }
      return { p: ok ? e / ok : null, ok, complete: i - sec + 1 >= 0 && ok === sec * fs ? 1 : 0 };
    };
    let total = 0, totalOk = 0;
    for (let i = 0; i < n0; i++) { total += energyOf(i); totalOk += valid(i); }
    verdict(csv.rows.length === n1 - n0, G, `строки секунд ${n0}–${n1}`);
    csv.rows.forEach((r, k) => {
      const i = n0 + k;
      near(cell(r[0]), i, 1e-9);
      near(cell(r[2]), lv.pcm[i] / fs, 1e-9);
      near(cell(r[3]), lv.spec[i] / fs, 1e-9);
      [1, 10, 60].forEach((sec, j) => {
        const x = window(i, sec);
        near(cell(r[4 + 2 * j]), lvl(x.p), 2e-4);
        if ((x.ok ? String(x.complete) : '') !== r[5 + 2 * j]) flags = false;
      });
      total += energyOf(i); totalOk += valid(i);
      near(cell(r[10]), lvl(totalOk ? total / totalOk : null), 2e-4);
      near(cell(r[11]), lv.pcm[i] ? dB(lv.peak[i] ** 2) : null, 2e-4);
      for (let j = 0; j < E; j++) near(cell(r[12 + j]), lv.spec[i] ? dB(lv.energy[(i * V + v) * E + j] / lv.spec[i]) : null, 2e-4);
    });
    verdict(worst <= 1 && flags, G, `Leq 1/10/60 с, Leq с начала, пик и шесть полос (${w}${corrected ? ', с поправкой' : ''}) — энергетические средние по столбцам JSON; признаки полноты окна совпадают (${count} значений)`);
  } else if (kind === 'bands') {
    const m = /^Интервал: (\d+)–(\d+) с/.exec(line('Интервал: ')), wm = /^Вес ([ZAC]);/.exec(line('Вес '));
    need(m && wm, name + ': не прочитаны интервал и вес.');
    const [n0, n1, w] = [Number(m[1]), Number(m[2]), wm[1]], profile = !!s.calibration;
    const band = v => {
      const e = new Float64Array(E);
      let spec = 0;
      for (let i = n0; i < n1; i++) { spec += lv.spec[i]; for (let j = 0; j < E; j++) e[j] += lv.energy[(i * V + v) * E + j]; }
      const p = Array.from(e, x => spec ? x / spec : 0), total = p.reduce((a, x) => a + x, 0);
      return p.map(x => ({ p: x, share: total ? 100 * x / total : null }));
    };
    const raw = band(W3.indexOf(w)), corr = profile ? band(W3.indexOf(w) + 3) : null;
    verdict(csv.rows.length === E, G, `шесть полос, вес ${w}`);
    csv.rows.forEach((r, j) => {
      near(cell(r[2]), raw[j].p, 1e-9 * Math.max(raw[j].p, 1e-30));
      near(cell(r[3]), dB(raw[j].p), 2e-4);
      near(cell(r[4]), raw[j].share, 2e-4);
      if (corr) { near(cell(r[5]), corr[j].p, 1e-9 * Math.max(corr[j].p, 1e-30)); near(cell(r[6]), dB(corr[j].p), 2e-4); near(cell(r[7]), corr[j].share, 2e-4); }
    });
    verdict(worst <= 1 && flags, G, `мощность, уровень и доля шести полос${corr ? ' (исходные и с поправкой)' : ''} совпадают с JSON (${count} значений)`);
  } else if (kind === 'spectrum' || kind === 'ltas') {
    const labels = { 'последний кадр': 'now', 'среднее за 10 с': '10', 'среднее за 60 с': '60', 'среднее за сеанс (LTAS)': 'session' };
    const wm = /вес ([ZAC])\b/.exec(kind === 'spectrum' ? line('Период: ') : csv.columns.join(' ').replace(/psd_\w+?_([zac])_/, (_, x) => 'вес ' + x.toUpperCase() + ' '));
    need(wm, name + ': не прочитан вес.');
    const w = wm[1], g = k => w === 'A' ? gainA[k] : w === 'C' ? gainC[k] : 1, tol = w === 'Z' ? 2e-4 : 6e-3;
    verdict(csv.rows.length === BINS, G, `${BINS} бинов по ${binHz.toFixed(6)} Гц, вес ${w}`);
    let worstCorrection = 0;
    if (kind === 'spectrum') {
      const period = labels[/^Период: (.+?) · /.exec(line('Период: '))?.[1]];
      need(period, name + ': не прочитан период.');
      const psd = s.spectra[period].psd, hasCorr = col(`psd_${w.toLowerCase()}_corrected_dbfs_hz`) >= 0;
      csv.rows.forEach((r, k) => {
        near(cell(r[0]), k * binHz, 1e-9);
        const want = psd[k] * g(k);
        near(cell(r[2]), dB(want), tol);
        if (hasCorr) {
          near(cell(r[4]), dB(want * gainP[k]), tol);
          if (r[5] !== '') worstCorrection = Math.max(worstCorrection, Math.abs(Number(r[5]) - cal(k * binHz)));
        }
      });
      verdict(worst <= 1 && flags, G, `PSD «${period}» (вес ${w}) совпадает с JSON и весом IEC (${count} значений)`);
      if (hasCorr) verdict(worstCorrection <= 2e-4, G, `столбец correction_db по всем бинам равен поправке профиля, вычисленной независимо (наибольшее отклонение ${worstCorrection.toFixed(5)} дБ; допуск ±0,0002 — округление CSV)`);
    } else {
      for (const [p, key] of [['now', 'now'], ['10', '10'], ['60', '60'], ['session', 'session']]) {
        const c = col(`psd_${p}_${w.toLowerCase()}_dbfs_hz`), cc = col(`psd_${p}_${w.toLowerCase()}_corrected_dbfs_hz`), x = s.spectra[key];
        csv.rows.forEach((r, k) => {
          near(cell(r[c]), x.seconds ? dB(x.psd[k] * g(k)) : null, tol);
          if (cc >= 0) near(cell(r[cc]), x.seconds ? dB(x.psd[k] * g(k) * gainP[k]) : null, tol);
        });
      }
      verdict(worst <= 1 && flags, G, `четыре средних спектра (вес ${w}${s.calibration ? ', исходные и с поправкой' : ''}) совпадают с JSON (${count} значений)`);
    }
  } else if (kind === 'rms') {
    const b = s.blocks;
    verdict(csv.rows.length === b.next.length, G, `строки блоков 4096: ${csv.rows.length}`);
    csv.rows.forEach((r, i) => {
      near(cell(r[1]), b.next[i] * BLOCK / fs, 1e-9);
      near(cell(r[3]), Number.isNaN(b.rms[i]) ? -Infinity : b.rms[i], 2e-4);
      const complete = (b.flags[i] & 1) === 1;
      if (complete) near(cell(r[4]), Number.isNaN(b.rms1s[i]) ? -Infinity : b.rms1s[i], 2e-4);
      if (r[5] !== (complete ? '1' : '0') || r[7] !== (b.flags[i] & 2 ? '1' : '0') || Number(r[8]) !== b.missingBefore[i]) flags = false;
      near(cell(r[6]), b.peakBin[i] === 0xffff ? null : b.peakBin[i] * fs / BLOCK, 1e-9);
    });
    verdict(worst <= 1 && flags, G, `RMS блоков, окно 1 с, частота пика, клиппинг и пропуски совпадают с JSON (${count} значений)`);
  } else {
    const m = /вес ([ZAC]) · (исходная|с поправкой профиля)/.exec(line('Интервал: ')), fine = line('Ярус: ').startsWith('Ярус: кадры');
    need(m, name + ': не прочитаны вес и вариант.');
    const v = W3.indexOf(m[1]) + (m[2] === 'исходная' ? 0 : 3), edges = tl.spectrogramEdgesHz;
    const printed = line('Границы полос, Гц: ').replace('Границы полос, Гц: ', '').split(' ').map(Number);
    verdict(printed.length === edges.length && printed.every((e, i) => Math.abs(e - edges[i]) <= 6e-4), G, `границы ${B} полос 1/12 октавы совпадают с JSON`);
    const rows = new Map();
    if (fine) tl.fine.ends.forEach((e, i) => rows.set(String((e - HOP) / fs), { end: e / fs, cover: 1, power: k => tl.fine.power[(i * V + v) * B + k] }));
    else for (let mm = 0; mm < tl.coarse.spec.length; mm++) {
      const a = mm * 10 * fs, e = Math.min((mm + 1) * 10 * fs, Math.max(tl.end, a)), sp = tl.coarse.spec[mm];
      rows.set(String(a / fs), { end: e / fs, cover: sp / (e - a), power: k => sp ? tl.coarse.energy[(mm * V + v) * B + k] / sp : NaN });
    }
    let known = true;
    csv.rows.forEach(r => {
      const x = rows.get(r[0]);
      if (!x) { known = false; return; }
      near(cell(r[1]), x.end, 1e-9);
      near(cell(r[2]), x.cover, 2e-4);
      for (let k = 0; k < B; k++) { const p = x.power(k); near(cell(r[3 + k]), Number.isNaN(p) ? null : dB(p / (edges[k + 1] - edges[k])), 2e-3); }
    });
    verdict(known && worst <= 1 && flags, G, `${fine ? 'кадры кольца' : 'столбцы 10 с'}: средняя PSD полос (dBFS/Гц), время и доля данных совпадают с JSON (${count} значений)`);
  }
}

function same(a, b) {
  const G = 'та же запись';
  const eq = (x, y) => {
    if (ArrayBuffer.isView(x) || ArrayBuffer.isView(y)) return ArrayBuffer.isView(x) && ArrayBuffer.isView(y) && x.constructor === y.constructor && x.length === y.length && x.every((v, i) => Object.is(v, y[i]));
    if (Array.isArray(x)) return Array.isArray(y) && x.length === y.length && x.every((v, i) => eq(v, y[i]));
    if (x && typeof x === 'object') return !!y && typeof y === 'object' && Object.keys(x).length === Object.keys(y).length && Object.keys(x).every(k => eq(x[k], y[k]));
    return Object.is(x, y);
  };
  const ra = a.record, rb = b.record;
  (ra.id === rb.id ? pass : info)(G, ra.id === rb.id ? `идентификатор записи ${ra.id}` : `идентификаторы ${ra.id} и ${rb.id}: копия при повторном импорте получает новый, данные сравниваются ниже`);
  verdict(eq(ra.content, rb.content), G, 'данные измерения (суммы, счётчики, спектры, кольцо кадров, снимок калибровки) совпадают побитно');
  verdict(eq(ra.context.room ?? null, rb.context.room ?? null) && eq(ra.context.input, rb.context.input) && eq(ra.context.absolute, rb.context.absolute), G, 'снимок комнаты, вход и абсолютная привязка совпадают');
  info(G, `названия: «${ra.name}» и «${rb.name}»; сохранено ${ra.savedAt} и ${rb.savedAt}; экспорт ${a.file.exportedAt} и ${b.file.exportedAt}`);
}

// Сигнал итоговой проверки: структура из noise-final-signal.json, сдвиг начала ищется по уровням.
function fieldSignal(session, ctx, def) {
  const G = 'сигнал', tl = session.timeline, lv = tl.levels, { fs, L, E, V, B } = ctx;
  const segs = Object.fromEntries(def.segments.map(x => [x.id, x]));
  const full = i => i >= 0 && i < L && lv.pcm[i] === fs && lv.spec[i] === fs;
  const levelA = i => lv.a[i] / lv.spec[i];
  // 1. Целый сдвиг: розовые плато P1–P5 по уровню A (выше фона, чем Z).
  const pink = def.segments.filter(x => x.kind === 'pink');
  let best = null;
  for (let d = -60; d <= L - 590; d++) {
    const r = [];
    for (const p of pink) for (let i = Math.ceil(d + p.from + 2); i < d + p.to - 2; i++) if (full(i)) r.push(dB(levelA(i)) - p.levelDb);
    if (r.length < 200) continue;
    const c = r.reduce((x, y) => x + y, 0) / r.length, e = r.reduce((x, y) => x + (y - c) ** 2, 0) / r.length;
    if (!best || e < best.e) best = { d, e };
  }
  need(best, 'Сигнал итоговой проверки не найден: в записи меньше 5 мин розового шума. Проверьте, что файл играл с начала.');
  // 2. Дробный сдвиг по двум ступеням (Z по отсчётам PCM, смена отрезков равномощная): τ из энергии пары секунд.
  const meanZ = (a, b) => { let e = 0, k = 0; for (let i = Math.ceil(a); i < b; i++) if (full(i)) { e += lv.z[i]; k += lv.pcm[i]; } return k ? e / k : NaN; };
  const step = (before, after, at) => {
    const pb = meanZ(best.d + before.from + 2, best.d + before.to - 2), pa = meanZ(best.d + after.from + 2, best.d + after.to - 2);
    const k = Math.floor(best.d + at - 0.5);
    if (!full(k) || !full(k + 1)) return NaN;
    return k + ((lv.z[k] + lv.z[k + 1]) / fs - 2 * pa) / (pb - pa);
  };
  const t12 = step(segs.P1, segs.P2, segs.P2.from), t34 = step(segs.P3, segs.P4, segs.P4.from);
  const d = (t12 - segs.P2.from + t34 - segs.P4.from) / 2, interval = t34 - t12;
  verdict(Number.isFinite(d) && Math.abs(interval - (segs.P4.from - segs.P2.from)) <= 0.25, G,
    `начало файла на шкале сеанса ${f2(d)} с; ступени P1→P2 и P3→P4 через ${f3(interval)} с (ожидается ${segs.P4.from - segs.P2.from} ± 0,25 с: шкала времени и частота дискретизации)`);
  if (!Number.isFinite(d)) return;
  const at = t => t + d;
  const inside = x => at(x.from) >= 0 && at(x.to) <= L;
  const cols = x => { const out = []; for (let i = Math.ceil(at(x.from) + 2); i < at(x.to) - 2; i++) if (full(i)) out.push(i); return out; };
  const missingSegs = def.segments.filter(x => x.kind !== 'silence' && !inside(x)).map(x => x.id);
  verdict(!missingSegs.length, G, missingSegs.length ? `не записаны отрезки ${missingSegs.join(', ')}: измерение начато позже или остановлено раньше конца файла` : 'все отрезки сигнала записаны');
  const band4 = ctx.energyEdges.findIndex((e, j) => e === 500 && ctx.energyEdges[j + 1] === 2000);
  const metrics = {
    Z: i => lv.z[i] / lv.pcm[i], A: levelA,
    '500–2000 Гц': i => lv.energy[(i * V) * E + band4] / lv.spec[i],
  };
  const mean = (list, f) => list.length ? list.reduce((x, i) => x + f(i), 0) / list.length : NaN;
  // 3. Фон: медиана секунд тишины до, в паузе и после сигнала.
  const quiet = ['S0', 'G1', 'S1'].map(id => segs[id]).filter(Boolean);
  const quietCols = x => cols(x).filter(i => i >= 0);
  const background = Object.fromEntries(Object.entries(metrics).map(([k, f]) => [k, median(quiet.flatMap(x => quietCols(x).map(f)))]));
  info(G, `фон в тишине сигнала: Z ${f2(dB(background.Z))}, A ${f2(dB(background.A))}, 500–2000 Гц ${f2(dB(background['500–2000 Гц']))} dBFS`);
  const s0 = quietCols(segs.S0), g1 = quietCols(segs.G1);
  if (s0.length >= 3 && g1.length >= 3) {
    const diff = dB(median(g1.map(metrics.A))) - dB(median(s0.map(metrics.A)));
    verdict(Math.abs(diff) <= 3, G, `фон в паузе G1 и до сигнала S0 (A): разница ${f2(diff)} дБ (допуск ±3: посторонние звуки или скрытое автоусиление)`);
  } else skip(G, 'фон в паузе и до сигнала: мало секунд тишины');
  // 4. Ступени уровня розового шума относительно P1.
  const plateau = {};
  for (const p of pink) if (inside(p)) plateau[p.id] = Object.fromEntries(Object.entries(metrics).map(([k, f]) => [k, mean(cols(p), f)]));
  const reliable = [];
  for (const p of pink.filter(x => x.id !== 'P1')) {
    if (!plateau[p.id] || !plateau.P1) { skip(G, `${p.id}: отрезок не записан`); continue; }
    const tol = Math.abs(p.levelDb) >= 20 ? 1.0 : 0.5, parts = [];
    let evaluated = 0, worst = 0;
    for (const k of Object.keys(metrics)) {
      const snr = Math.min(dB(plateau[p.id][k] / background[k]), dB(plateau.P1[k] / background[k]));
      if (!(snr >= 15)) { parts.push(`${k}: мало над фоном (${f2(snr)} дБ)`); continue; }
      const got = dB(plateau[p.id][k] - background[k]) - dB(plateau.P1[k] - background[k]);
      evaluated++; worst = Math.max(worst, Math.abs(got - p.levelDb));
      parts.push(`${k} ${f2(got)} дБ`);
    }
    if (!evaluated) { skip(G, `${p.id} (${p.levelDb} дБ к P1): уровень слишком близок к фону — увеличьте громкость. ${parts.join('; ')}`); continue; }
    reliable.push(p.id);
    verdict(worst <= tol, G, `${p.id} относительно P1: ожидается ${p.levelDb} дБ ± ${tol}; ${parts.join('; ')} (фон вычтен)`);
  }
  // 5. Окно 60 с через ступень P1→P2: энергетическое, а не среднее децибел.
  const n60 = Math.floor(at(segs.P2.from) + 30);
  if (plateau.P1 && plateau.P2 && full(n60 - 59) && full(n60)) {
    let e = 0, k = 0, arith = 0;
    for (let i = n60 - 59; i <= n60; i++) { e += lv.z[i]; k += lv.pcm[i]; arith += dB(lv.z[i] / lv.pcm[i]) / 60; }
    const tau = at(segs.P2.from), model = (plateau.P1.Z * (tau - (n60 - 59)) + plateau.P2.Z * (n60 + 1 - tau)) / 60;
    verdict(Math.abs(dB(e / k) - dB(model)) <= 0.3 && Math.abs(dB(e / k) - arith) >= 1, G,
      `Leq 60 с в секунде ${n60} (30 с после ступени −10 дБ): ${f2(dB(e / k))} dBFS; по плато ${f2(dB(model))} dBFS (допуск ±0,3); среднее децибел было бы ${f2(arith)} dBFS`);
  } else skip(G, 'окно 60 с через ступень: секунды не записаны полностью');
  // 6. Полосы B1–B6: доля энергии шести полос и спектрограмма 1/12 октавы.
  const sumOver = (list, f) => list.reduce((x, i) => x + f(i), 0);
  for (const x of def.segments.filter(y => y.kind === 'band')) {
    if (!inside(x)) { skip(G, `${x.id}: отрезок не записан`); continue; }
    const list = cols(x), [lo, hi] = x.bandHz, j = ctx.energyEdges.findIndex((e, k) => lo >= e && hi <= ctx.energyEdges[k + 1]);
    const bands = Array.from({ length: E }, (_, k) => sumOver(list, i => lv.energy[(i * V) * E + k]));
    const share = 100 * bands[j] / bands.reduce((a, y) => a + y, 0);
    const z = sumOver(list, i => lv.z[i]) / sumOver(list, i => lv.pcm[i]), a = sumOver(list, i => lv.a[i]) / sumOver(list, i => lv.spec[i]), c = sumOver(list, i => lv.c[i]) / sumOver(list, i => lv.spec[i]);
    const edges = tl.spectrogramEdgesHz, span = 10 * fs;
    let inBand = 0, total = 0;
    for (let m = Math.ceil(at(x.from) * fs / span); (m + 1) * span <= at(x.to) * fs; m++) {
      for (let k = 0; k < B; k++) {
        const p = tl.coarse.energy[(m * V) * B + k], f = Math.sqrt(edges[k] * edges[k + 1]);
        total += p; if (f >= lo / 2 ** (1 / 6) && f <= hi * 2 ** (1 / 6)) inBand += p;
      }
    }
    const spectro = total ? 100 * inBand / total : NaN;
    const range = `${ctx.energyEdges[j]}–${ctx.energyEdges[j + 1]} Гц`;
    const text = `${x.id} (шум ${lo}–${hi} Гц): доля полосы ${range} ${f2(share)} %, в спектрограмме ${f2(spectro)} % энергии в полосе ±1/6 окт; A − Z ${f2(dB(a) - dB(z))} дБ, C − Z ${f2(dB(c) - dB(z))} дБ`;
    if (x.id === 'B1') { info(G, text + ' — необязательно: слабый бас динамиков'); continue; }
    const ok = share >= 60 && (Number.isNaN(spectro) || spectro >= 70);
    const weights = { B2: [[-24, -6], [-2, 0.5]], B4: [[-2.5, 1.5], [-1, 0.5]], B6: [[-2, 1.5], [-4, -1]] }[x.id];
    const wOk = !weights || (dB(a) - dB(z) >= weights[0][0] && dB(a) - dB(z) <= weights[0][1] && dB(c) - dB(z) >= weights[1][0] && dB(c) - dB(z) <= weights[1][1]);
    verdict(ok && wOk, G, text + (weights ? ` (ожидается A − Z ${weights[0].join('…')}, C − Z ${weights[1].join('…')} дБ)` : '') + '; доля ≥ 60 %, спектрограмма ≥ 70 %');
  }
  // 7. Тоны: полоса 1/12 октавы с тоном выделяется в столбцах 10 с; частота пика блоков 4096.
  const b = session.blocks, binBlock = fs / BLOCK;
  for (const id of ['T1', 'M1']) {
    const x = segs[id];
    if (!x || !inside(x)) { skip(G, `${id}: отрезок не записан`); continue; }
    const edges = tl.spectrogramEdgesHz, span = 10 * fs, power = new Float64Array(B);
    for (let m = Math.ceil(at(x.from) * fs / span); (m + 1) * span <= at(x.to) * fs; m++) for (let k = 0; k < B; k++) power[k] += tl.coarse.energy[(m * V) * B + k] / (edges[k + 1] - edges[k]);
    const peaks = [], wrong = [];
    for (const f of x.tonesHz) {
      const k = edges.findIndex((e, i) => f >= e && f < edges[i + 1]);
      let topK = k, top = -Infinity;
      for (let q = Math.max(1, k - 12); q <= Math.min(B - 2, k + 12); q++) {
        const around = []; for (let r = q - 6; r <= q + 6; r++) if (Math.abs(r - q) > 1 && r >= 0 && r < B) around.push(power[r]);
        const prom = dB(power[q] / median(around));
        if (prom > top) { top = prom; topK = q; }
      }
      if (top < 10) { peaks.push(`${f} Гц не выделяется (${f2(top)} дБ)`); continue; }
      if (Math.abs(topK - k) > 0) wrong.push(f);
      peaks.push(`${f} Гц: наибольшая полоса ${Math.round(Math.sqrt(edges[topK] * edges[topK + 1]))} Гц, +${f2(top)} дБ над соседними`);
    }
    let blocks = 0, hit = 0;
    for (let i = 0; i < b.next.length; i++) {
      const t = b.next[i] * BLOCK / fs;
      if (t < at(x.from) + 2 || t > at(x.to) - 2 || b.peakBin[i] === 0xffff) continue;
      blocks++;
      if (x.tonesHz.some(f => Math.abs(b.peakBin[i] * binBlock - f) <= binBlock)) hit++;
    }
    const share = blocks ? 100 * hit / blocks : NaN, detected = peaks.every(p => !p.includes('не выделяется'));
    const text = `${id} (тоны ${x.tonesHz.join(', ')} Гц): ${peaks.join('; ')}; пик блока 4096 на тоне в ${f2(share)} % блоков`;
    if (wrong.length) fail(G, text + ' — тон в соседней полосе: проверьте частоту дискретизации');
    else if (!detected || !(share >= 70)) skip(G, text + ' — тон не выделился: положение телефона, громкость или провал комнаты');
    else pass(G, text);
  }
  // 8. Для сверки с экраном: «Момент на шкале времени» в «Спектрограмме и истории уровней».
  const moments = [['P1', Math.floor(at(segs.P1.from + 60))], ['P1→P2 + 30 с', n60], ['P3', Math.floor(at(segs.P3.from + 60))]];
  for (const [label, i] of moments) {
    if (!full(i) || i < 59) continue;
    const win = (sec, w) => { let e = 0, k = 0; for (let j = i - sec + 1; j <= i; j++) { e += w === 'Z' ? lv.z[j] : lv.a[j]; k += w === 'Z' ? lv.pcm[j] : lv.spec[j]; } return f2(dB(e / k)); };
    const mm = Math.floor(i / 60), ss = String(i % 60).padStart(2, '0');
    info('для экрана', `${label}: момент ${mm}:${ss} — Leq 1/10/60 с (Z) ${win(1, 'Z')} / ${win(10, 'Z')} / ${win(60, 'Z')}; (A) ${win(1, 'A')} / ${win(10, 'A')} / ${win(60, 'A')} dBFS; пик за 1 с ${f2(dB(lv.peak[i] ** 2))} dBFS`);
  }
  return reliable;
}

try {
  need(inputs.length >= 1, 'Использование: node scripts/check-noise-final.mjs <расширенный JSON сеанса> [CSV ...] [--signal] [--profile=файл поправки] [--same=второй JSON]');
  need(endianness() === 'LE', 'Нужен процессор little-endian.');
  const main = load(inputs[0]), s = main.s;
  console.log('Запись «%s» · id %s · сборка %s · экспорт %s · %s МБ JSON', main.record.name, main.record.id, s.meta.build?.sha, main.file.exportedAt, (main.chars / 2 ** 20).toFixed(2));
  const ctx = analyse(s);
  // Длительность, пропуски и клиппинг обязательны для итогового сигнала; для другой записи — только сведения.
  const C = 'захват', signal = option('signal'), required = (ok, text) => signal !== undefined ? verdict(ok, C, text) : info(C, text);
  required(ctx.accepted / ctx.fs >= 600, `принято сигнала ${(ctx.accepted / ctx.fs).toFixed(1)} с (для итоговой проверки нужно не меньше 600 с)`);
  if (ctx.startup) info(C, `в начале не принято блоков: ${ctx.startup} (${(ctx.startup * BLOCK / ctx.fs).toFixed(3)} с) — пока проверяется выбор профиля; известное ограничение, отложено`);
  required(ctx.missing - ctx.startup === 0, `пропусков после начала записи: ${ctx.missing - ctx.startup}`);
  required(ctx.clipped === 0, `блоков с клиппингом: ${ctx.clipped}`);
  const profile = option('profile');
  if (profile) checkProfile(s, profile);
  for (const path of inputs.slice(1)) checkCsv(readCsv(path), ctx, main.record);
  const other = option('same');
  if (other) same(main, load(other));
  if (signal !== undefined) {
    const path = signal || fileURLToPath(new URL('../public/field-check/noise-final-signal.json', import.meta.url));
    fieldSignal(s, ctx, JSON.parse(readFileSync(path, 'utf8')));
  }
  for (const line of lines) console.log(line);
  if (failures) throw new Error(`Не пройдено проверок: ${failures}. Порядок действий — в docs/noise-final-iphone-field-check.md, раздел «Если проверка не прошла».`);
  console.log('Пройдены все обязательные проверки, выполненные скриптом. Строки «не проверено» перечислены выше.');
} catch (error) {
  for (const line of lines) if (!line.startsWith('[')) console.log(line);
  console.error(error.message);
  process.exitCode = 1;
}
