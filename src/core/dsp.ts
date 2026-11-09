// Обработка сигналов: БПФ, логарифмический свип и деконволюция, RT60 по Шрёдеру, FIR из PEQ, WAV.
import { biquad, type PeqFilter } from './eq';

/** БПФ на месте (radix-2), n — степень двойки. inverse — обратное с делением на n. */
export function fft(re: Float64Array, im: Float64Array, inverse = false) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr; im[b] = im[a] - xi;
        re[a] += xr; im[a] += xi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}

export const nextPow2 = (n: number) => 1 << Math.ceil(Math.log2(Math.max(2, n)));

/** Экспоненциальный свип (Farina) с плавными краями. */
export function logSweep(f1: number, f2: number, T: number, fs: number, amp = 0.5): Float32Array {
  const n = Math.round(T * fs);
  const out = new Float32Array(n);
  const L = T / Math.log(f2 / f1);
  const fade = Math.round(0.05 * fs);
  for (let i = 0; i < n; i++) {
    const t = i / fs;
    let w = 1;
    if (i < fade) w = 0.5 * (1 - Math.cos((Math.PI * i) / fade));
    else if (i > n - fade) w = 0.5 * (1 - Math.cos((Math.PI * (n - i)) / fade));
    out[i] = amp * w * Math.sin(2 * Math.PI * f1 * L * (Math.exp(t / L) - 1));
  }
  return out;
}

/** Обратный фильтр свипа: развёрнутый во времени свип с компенсацией −6 дБ/окт. */
export function inverseSweep(sweep: Float32Array, f1: number, f2: number, fs: number): Float32Array {
  const n = sweep.length;
  const T = n / fs;
  const L = T / Math.log(f2 / f1);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = sweep[n - 1 - i] * Math.exp(-(i / fs) / L);
  return out;
}

/** Линейная свёртка через БПФ. */
export function convolve(a: Float32Array, b: Float32Array): Float64Array {
  const N = nextPow2(a.length + b.length - 1);
  const ar = new Float64Array(N), ai = new Float64Array(N), br = new Float64Array(N), bi = new Float64Array(N);
  ar.set(a); br.set(b);
  fft(ar, ai); fft(br, bi);
  for (let i = 0; i < N; i++) {
    const r = ar[i] * br[i] - ai[i] * bi[i];
    ai[i] = ar[i] * bi[i] + ai[i] * br[i];
    ar[i] = r;
  }
  fft(ar, ai, true);
  return ar.subarray(0, a.length + b.length - 1);
}

/** Частоты по логарифмической сетке. */
export function logGrid(f0: number, f1: number, ppo: number): number[] {
  const n = Math.floor(Math.log2(f1 / f0) * ppo) + 1;
  return Array.from({ length: n }, (_, i) => f0 * Math.pow(2, i / ppo));
}

/** Модуль спектра отрезка сигнала на заданных частотах (через БПФ с интерполяцией), дБ. */
export function spectrumDb(x: ArrayLike<number>, fs: number, freqs: number[], nfft?: number): number[] {
  const N = nfft ?? nextPow2(x.length);
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let i = 0; i < Math.min(N, x.length); i++) re[i] = x[i];
  fft(re, im);
  return freqs.map((f) => {
    const k = (f * N) / fs;
    const k0 = Math.floor(k), t = k - k0;
    const m0 = Math.hypot(re[k0], im[k0]), m1 = Math.hypot(re[k0 + 1] ?? 0, im[k0 + 1] ?? 0);
    return 20 * Math.log10(Math.max(1e-12, m0 * (1 - t) + m1 * t));
  });
}

/** Сглаживание в долях октавы (усреднение мощности). */
export function smoothOct(freqs: number[], db: number[], frac: number): number[] {
  return freqs.map((f) => {
    const lo = f * Math.pow(2, -frac / 2), hi = f * Math.pow(2, frac / 2);
    let s = 0, c = 0;
    freqs.forEach((g, i) => { if (g >= lo && g <= hi) { s += Math.pow(10, db[i] / 10); c++; } });
    return c ? 10 * Math.log10(s / c) : db[freqs.indexOf(f)];
  });
}

export interface SweepResult { f: number[]; db: number[]; peak: number; snrDb: number; irPeakAt: number }

/**
 * Импульсная характеристика из записи свипа и АЧХ в полосе 15–500 Гц.
 * Отклик нормируется на отклик самого свипа, поэтому неровность обратного фильтра не мешает.
 */
export function analyzeSweep(rec: Float32Array, sweep: Float32Array, f1: number, f2: number, fs: number): SweepResult {
  const inv = inverseSweep(sweep, f1, f2, fs);
  const ir = convolve(rec, inv);
  const ref = convolve(sweep, inv);
  let pk = 0, pkAt = 0;
  for (let i = 0; i < ir.length; i++) if (Math.abs(ir[i]) > pk) { pk = Math.abs(ir[i]); pkAt = i; }
  let rpk = 0, rAt = 0;
  for (let i = 0; i < ref.length; i++) if (Math.abs(ref[i]) > rpk) { rpk = Math.abs(ref[i]); rAt = i; }
  // окно: 10 мс до пика, 1 с после, с полуокном Ханна на последних 30 %. Моды комнаты звучат до ~1–1,5 с:
  // короткое окно (0,5 с) срезало бы их «хвост», пики в АЧХ получились бы ниже, чем в установившемся режиме,
  // и подстройка модели по такому замеру завышала бы затухание
  const pre = Math.round(0.01 * fs), post = Math.round(1.0 * fs);
  const cut = (x: Float64Array, at: number) => {
    const out = new Float64Array(pre + post);
    for (let i = 0; i < out.length; i++) {
      const j = at - pre + i;
      const tail = i > pre + post * 0.7 ? 0.5 * (1 + Math.cos((Math.PI * (i - pre - post * 0.7)) / (post * 0.3))) : 1;
      out[i] = j >= 0 && j < x.length ? x[j] * tail : 0;
    }
    return out;
  };
  const freqs = logGrid(15, 500, 48);
  const N = nextPow2(pre + post);
  const a = spectrumDb(cut(ir, pkAt), fs, freqs, N);
  const b = spectrumDb(cut(ref, rAt), fs, freqs, N);
  // шум: энергия ИХ далеко до пика
  let noise = 0, nc = 0;
  for (let i = Math.max(0, pkAt - Math.round(0.6 * fs)); i < pkAt - Math.round(0.1 * fs); i++) { noise += ir[i] * ir[i]; nc++; }
  const snr = nc ? 10 * Math.log10((pk * pk) / (noise / nc + 1e-30)) : 60;
  let recPeak = 0;
  for (let i = 0; i < rec.length; i++) recPeak = Math.max(recPeak, Math.abs(rec[i]));
  return { f: freqs, db: smoothOct(freqs, a.map((v, i) => v - b[i]), 1 / 24), peak: recPeak, snrDb: snr, irPeakAt: pkAt / fs };
}

/** Среднее по мощности нескольких АЧХ на одной сетке. */
export function powerAverage(curves: number[][]): number[] {
  return curves[0].map((_, i) => 10 * Math.log10(curves.reduce((s, c) => s + Math.pow(10, c[i] / 10), 0) / curves.length));
}

/** Калибровочный файл микрофона (UMIK и подобные): строки «частота дБ [фаза]», прочие строки пропускаются. */
export function parseCalibration(text: string): { f: number[]; db: number[] } {
  const f: number[] = [], db: number[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.trim().replace(/,/g, '.').split(/[\s;\t]+/).map(Number);
    if (m.length >= 2 && Number.isFinite(m[0]) && Number.isFinite(m[1]) && m[0] > 0) { f.push(m[0]); db.push(m[1]); }
  }
  if (f.length < 3) throw new Error('В файле не найдено строк «частота дБ».');
  return { f, db };
}

/** Значение калибровки на частоте (лог-интерполяция, края — постоянные). */
export function calAt(cal: { f: number[]; db: number[] }, f: number): number {
  if (f <= cal.f[0]) return cal.db[0];
  if (f >= cal.f[cal.f.length - 1]) return cal.db[cal.db.length - 1];
  let i = 0;
  while (cal.f[i + 1] < f) i++;
  const t = Math.log(f / cal.f[i]) / Math.log(cal.f[i + 1] / cal.f[i]);
  return cal.db[i] + (cal.db[i + 1] - cal.db[i]) * t;
}

// ---------- RT60 ----------

/**
 * Октавная полоса с центром f0: фильтр Баттерворта 6-го порядка (прототип 3-го порядка, ширина f0/√2 — как
 * у октавных фильтров IEC 61260), применённый по модулю через БПФ — без фазовых искажений и «звона» фильтра.
 */
export function octaveBand(x: Float32Array, f0: number, fs: number): Float32Array {
  const N = nextPow2(x.length + Math.round(0.25 * fs));
  const re = new Float64Array(N), im = new Float64Array(N);
  re.set(x);
  fft(re, im);
  const B = f0 / Math.SQRT2;
  for (let k = 0; k <= N / 2; k++) {
    const f = (k * fs) / N;
    const u = f > 0 ? (f * f - f0 * f0) / (f * B) : Infinity;
    const g = Number.isFinite(u) ? 1 / Math.sqrt(1 + u ** 6) : 0;
    re[k] *= g; im[k] *= g;
    if (k > 0 && k < N / 2) { re[N - k] *= g; im[N - k] *= g; }
  }
  fft(re, im, true);
  return Float32Array.from(re.subarray(0, x.length));
}

/** Время реверберации по одной записи: T60, по какому участку кривой спада и запас над шумом. */
export interface DecayFit {
  t60: number;
  /** T20 — по участку −5…−25 дБ; T10 — −5…−15 дБ, когда запас над шумом 25–35 дБ (разброс до ±25–40 %). */
  method: 'T20' | 'T10';
  rangeDb: number;
}

/**
 * T60 по кривой Шрёдера с поправкой на шум (по методу Лундебю, ISO 3382-2): шумовой пол оценивается по концу
 * записи, огибающая аппроксимируется прямой до уровня «шум + 10 дБ», интегрирование ведётся от точки пересечения
 * прямой с шумом (шум вычитается), а энергия хвоста за ней добавляется по найденному наклону. Наклон кривой —
 * между −5 и −25 дБ (T20), при малом запасе — −5…−15 дБ (T10). null — меньше 25 дБ динамики.
 * Проверка на синтетических спадах (известное T60, шум): при запасе ≥ 38 дБ и T ≥ 0,4 с ошибка ≤ 5–10 %;
 * у коротких спадов на низах (125 Гц, 0,25 с) статистический разброс ±14 % и без шума — узкая полоса;
 * при запасе 30 дБ (T10) — ±25–40 %. Варианты (сглаженная огибающая, без вычитания шума) не лучше.
 */
export function schroederT60(x: Float32Array, fs: number): number | null {
  return schroederFit(x, fs)?.t60 ?? null;
}

export function schroederFit(x: Float32Array, fs: number): DecayFit | null {
  const blk = Math.max(1, Math.round(0.01 * fs));
  const nb = Math.floor(x.length / blk);
  if (nb < 30) return null;
  const env = new Float64Array(nb);
  for (let b = 0; b < nb; b++) {
    let s = 0;
    for (let i = b * blk; i < (b + 1) * blk; i++) s += x[i] * x[i];
    env[b] = s / blk;
  }
  const dB = (v: number) => 10 * Math.log10(Math.max(v, 1e-30));
  let pb = 0;
  for (let b = 1; b < nb; b++) if (env[b] > env[pb]) pb = b;
  const mean = (a: number, b: number) => { let s = 0; for (let i = a; i < b; i++) s += env[i]; return s / Math.max(1, b - a); };
  let noise = mean(Math.floor(nb * 0.9), nb);
  if (dB(env[pb]) - dB(noise) < 25) return null;
  let slope = 0, icpt = 0, tc = nb - 1;
  for (let it = 0; it < 4; it++) {
    const top = dB(env[pb]), floor = dB(noise) + 10;
    // участок регрессии: от −5 дБ после пика до первого падения ниже «шум + 10 дБ»
    let b0 = pb;
    while (b0 < nb - 1 && dB(env[b0]) > top - 5) b0++;
    let b1 = b0;
    while (b1 < Math.min(nb - 1, tc) && dB(env[b1 + 1]) > floor) b1++;
    if (b1 - b0 < 3) return null;
    let sx = 0, sy = 0, sxx = 0, sxy = 0;
    const c = b1 - b0 + 1;
    for (let b = b0; b <= b1; b++) { const y = dB(env[b]); sx += b; sy += y; sxx += b * b; sxy += b * y; }
    slope = (c * sxy - sx * sy) / (c * sxx - sx * sx);
    icpt = (sy - slope * sx) / c;
    if (!(slope < 0)) return null;
    // точка пересечения прямой с шумом
    tc = Math.min(nb - 1, Math.max(b1, Math.round((dB(noise) - icpt) / slope)));
    // шум — по участку на 10 дБ спада позже пересечения (не меньше 10 % записи в конце)
    const from = Math.min(Math.floor(nb * 0.9), tc + Math.round(10 / -slope));
    noise = mean(from, nb);
  }
  // интеграл Шрёдера от точки пересечения с поправкой на хвост: P(tc)·blk / k, k — затухание мощности за блок
  const k = (-slope * Math.LN10) / 10;
  const Pc = Math.pow(10, (icpt + slope * tc) / 10);
  const n = tc * blk;
  const e = new Float64Array(n);
  let acc = (Pc * blk) / (1 - Math.exp(-k));
  for (let i = n - 1; i >= 0; i--) { acc += x[i] * x[i] - noise; e[i] = Math.max(acc, 1e-30); }
  const start = pb * blk;
  const ref = e[start];
  const db = (i: number) => 10 * Math.log10(e[i] / ref);
  const fit = (hi: number, lo: number) => {
    let i0 = -1, i1 = -1;
    for (let i = start; i < n; i++) { if (i0 < 0 && db(i) <= hi) i0 = i; if (db(i) <= lo) { i1 = i; break; } }
    if (i0 < 0 || i1 <= i0 + 10) return null;
    let sx = 0, sy = 0, sxx = 0, sxy = 0, c = 0;
    const step = Math.max(1, Math.floor((i1 - i0) / 400));
    for (let i = i0; i <= i1; i += step) { const t = i / fs, y = db(i); sx += t; sy += y; sxx += t * t; sxy += t * y; c++; }
    const s = (c * sxy - sx * sy) / (c * sxx - sx * sx);
    return s < 0 ? -60 / s : null;
  };
  const range = dB(env[pb]) - dB(noise);
  const t20 = range >= 35 ? fit(-5, -25) : null;
  if (t20 != null) return { t60: t20, method: 'T20', rangeDb: range };
  const t10 = fit(-5, -15);
  return t10 != null ? { t60: t10, method: 'T10', rangeDb: range } : null;
}

export const RT_BANDS = [125, 250, 500, 1000, 2000, 4000];

export interface BandRT {
  band: number;
  t60: number | null;
  /** Мало запаса над шумом (оценка по T10): значение приблизительное. */
  approx?: boolean;
}

/** RT60 по октавам из записи хлопка (от самого громкого места до конца записи). */
export function clapRT60(rec: Float32Array, fs: number): BandRT[] {
  let pk = 0, at = 0;
  for (let i = 0; i < rec.length; i++) if (Math.abs(rec[i]) > pk) { pk = Math.abs(rec[i]); at = i; }
  const seg = rec.subarray(Math.max(0, at - Math.round(0.005 * fs)), Math.min(rec.length, at + Math.round(2.5 * fs)));
  return RT_BANDS.map((band) => {
    const r = schroederFit(octaveBand(seg, band, fs), fs);
    return r ? { band, t60: r.t60, approx: r.method === 'T10' } : { band, t60: null };
  });
}

/**
 * Среднее RT60 по нескольким хлопкам в каждой октаве: если есть оценки по T20, берутся только они
 * (у T10 разброс в несколько раз больше), иначе — по T10, и значение помечается как приблизительное.
 */
export function averageRT(takes: BandRT[][]): BandRT[] {
  return RT_BANDS.map((band, k) => {
    const all = takes.map((t) => t[k]).filter((r): r is BandRT & { t60: number } => !!r && r.t60 != null);
    const good = all.filter((r) => !r.approx);
    const use = good.length ? good : all;
    if (!use.length) return { band, t60: null };
    return { band, t60: use.reduce((a, r) => a + r.t60, 0) / use.length, approx: !good.length };
  });
}

// ---------- FIR ----------

/**
 * Сколько отсчётов нужно, чтобы импульсная характеристика каскада biquad затухла на 100 дБ: по самому медленному
 * полюсу (у узкого фильтра на 30 Гц это больше секунды). Короткий FIR обрезал бы «хвост» и срезал пик не до конца.
 */
export function iirDecayLength(filters: PeqFilter[], fs: number): number {
  let r = 0;
  for (const f of filters) {
    const { a1, a2 } = biquad(f, fs);
    const disc = a1 * a1 - 4 * a2;
    const pr = disc < 0 ? Math.sqrt(Math.max(0, a2)) : Math.max(Math.abs((-a1 + Math.sqrt(disc)) / 2), Math.abs((-a1 - Math.sqrt(disc)) / 2));
    r = Math.max(r, pr);
  }
  if (r <= 0) return 1;
  if (r >= 1) return Infinity;
  return Math.ceil(Math.log(1e-5) / Math.log(r));
}

/** Длина FIR: степень двойки с запасом под затухание фильтров, в пределах [min, max]. */
function firLength(need: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, nextPow2(Math.ceil(need * 1.15))));
}

/** Окно Тьюки: плоское в середине, косинусные края на долю taper с каждой стороны (или только в конце). */
function tukey(i: number, n: number, taper: number, endOnly = false): number {
  const m = Math.max(1, Math.floor(n * taper));
  if (!endOnly && i < m) return 0.5 * (1 - Math.cos((Math.PI * i) / m));
  if (i >= n - m) return 0.5 * (1 + Math.cos((Math.PI * (i - (n - m))) / m));
  return 1;
}

/**
 * Минимально-фазовый FIR — импульсная характеристика каскада biquad (то же, что PEQ). Длина подбирается так,
 * чтобы характеристика затухла на 100 дБ (до 2,7 с при 96 кГц), конец плавно сводится к нулю.
 */
export function firMinPhase(filters: PeqFilter[], fs: number, n?: number): Float32Array {
  const len = n ?? firLength(iirDecayLength(filters, fs), 8192, 262144);
  const x = new Float64Array(len);
  x[0] = 1;
  for (const f of filters) {
    const { b0, b1, b2, a1, a2 } = biquad(f, fs);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < len; i++) {
      const y = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = x[i]; y2 = y1; y1 = y;
      x[i] = y;
    }
  }
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) out[i] = x[i] * tukey(i, len, 0.05, true);
  return out;
}

/** Длина линейно-фазового FIR для набора фильтров (задержка фильтра — половина длины). */
export function linearPhaseLength(filters: PeqFilter[], fs: number): number {
  return firLength(2 * iirDecayLength(filters, fs), 16384, 262144);
}

/**
 * Линейно-фазовый FIR с тем же модулем, что у PEQ (задержка n/2 отсчётов). Модуль задаётся точно в каждом бине
 * БПФ, длина — с запасом под затухание фильтров в обе стороны, окно Тьюки сводит к нулю только края.
 */
export function firLinearPhase(filters: PeqFilter[], fs: number, n?: number): Float32Array {
  const len = n ?? linearPhaseLength(filters, fs);
  const re = new Float64Array(len), im = new Float64Array(len);
  const coefs = filters.map((f) => biquad(f, fs));
  for (let k = 0; k <= len / 2; k++) {
    const w = (2 * Math.PI * k) / len;
    let mag = 1;
    for (const { b0, b1, b2, a1, a2 } of coefs) {
      const nr = b0 + b1 * Math.cos(w) + b2 * Math.cos(2 * w), ni = -(b1 * Math.sin(w) + b2 * Math.sin(2 * w));
      const dr = 1 + a1 * Math.cos(w) + a2 * Math.cos(2 * w), di = -(a1 * Math.sin(w) + a2 * Math.sin(2 * w));
      mag *= Math.hypot(nr, ni) / Math.hypot(dr, di);
    }
    re[k] = mag;
    if (k > 0 && k < len / 2) re[len - k] = mag;
  }
  fft(re, im, true);
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) out[i] = re[(i + len / 2) % len] * tukey(i, len, 0.1);
  return out;
}

/**
 * WAV (32-бит float, WAVE_FORMAT_IEEE_FLOAT), каналы с одинаковой длиной. Для не-PCM формата по спецификации
 * нужен блок fmt длиной 18 байт (cbSize = 0) и блок fact с числом отсчётов — так файл читают все программы.
 */
export function wavFloat32(channels: Float32Array[], fs: number): ArrayBuffer {
  const nCh = channels.length, n = channels[0].length;
  const data = n * nCh * 4;
  const buf = new ArrayBuffer(58 + data);
  const v = new DataView(buf);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 50 + data, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 18, true); v.setUint16(20, 3, true); v.setUint16(22, nCh, true);
  v.setUint32(24, fs, true); v.setUint32(28, fs * nCh * 4, true); v.setUint16(32, nCh * 4, true); v.setUint16(34, 32, true);
  v.setUint16(36, 0, true);
  str(38, 'fact'); v.setUint32(42, 4, true); v.setUint32(46, n, true);
  str(50, 'data'); v.setUint32(54, data, true);
  let o = 58;
  for (let i = 0; i < n; i++) for (let c = 0; c < nCh; c++) { v.setFloat32(o, channels[c][i], true); o += 4; }
  return buf;
}

/** WAV (16 бит) — для проигрывания сигнала на любом устройстве. */
export function wav16(x: Float32Array, fs: number): ArrayBuffer {
  const n = x.length;
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, fs, true); v.setUint32(28, fs * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, x[i])) * 32767, true);
  return buf;
}

/** АЧХ (дБ) по кривой на сетке freqs: ниже freqs[0] — как на freqs[0], выше последней частоты — плавный (1/3 окт) переход к 0 дБ. */
function curveAt(freqs: number[], db: number[]) {
  const fTop = freqs[freqs.length - 1];
  let i = 0;
  return (f: number) => {
    if (f <= freqs[0]) return db[0];
    if (f >= fTop) {
      const t = Math.min(1, Math.log2(f / fTop) * 3);
      return db[db.length - 1] * (1 - t);
    }
    if (f < freqs[i]) i = 0;
    while (freqs[i + 1] < f) i++;
    const t = Math.log(f / freqs[i]) / Math.log(freqs[i + 1] / freqs[i]);
    return db[i] + (db[i + 1] - db[i]) * t;
  };
}

/** Линейно-фазовый FIR с заданной АЧХ (дБ на сетке freqs), окно Тьюки по краям. */
export function firFromCurve(freqs: number[], db: number[], fs: number, n = 131072): Float32Array {
  const re = new Float64Array(n), im = new Float64Array(n);
  const at = curveAt(freqs, db);
  for (let k = 0; k <= n / 2; k++) {
    const mag = Math.pow(10, at(Math.max((k * fs) / n, 1)) / 20);
    re[k] = mag;
    if (k > 0 && k < n / 2) re[n - k] = mag;
  }
  fft(re, im, true);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = re[(i + n / 2) % n] * tukey(i, n, 0.1);
  return out;
}

/**
 * Минимально-фазовый FIR с заданной АЧХ — через кепстр (гомоморфная обработка). У резонансов комнаты «звон»
 * идёт после звука, как в реальности; у линейно-фазового фильтра он был бы симметричным, с «предзвоном»,
 * которого в комнате не бывает.
 */
export function firMinPhaseFromCurve(freqs: number[], db: number[], fs: number, n = 131072): Float32Array {
  const re = new Float64Array(n), im = new Float64Array(n);
  const at = curveAt(freqs, db);
  // ln|H| в бинах БПФ
  for (let k = 0; k <= n / 2; k++) {
    const v = (at(Math.max((k * fs) / n, 1)) * Math.LN10) / 20;
    re[k] = v;
    if (k > 0 && k < n / 2) re[n - k] = v;
  }
  fft(re, im, true); // действительный кепстр
  // свёртка кепстра в причинную часть
  for (let i = 1; i < n / 2; i++) { re[i] *= 2; im[i] *= 2; }
  for (let i = n / 2 + 1; i < n; i++) { re[i] = 0; im[i] = 0; }
  fft(re, im);
  // H = exp(ln|H| + j·φ)
  for (let k = 0; k < n; k++) {
    const m = Math.exp(re[k]);
    const ph = im[k];
    re[k] = m * Math.cos(ph);
    im[k] = m * Math.sin(ph);
  }
  fft(re, im, true);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = re[i] * tukey(i, n, 0.05, true);
  return out;
}

/**
 * Участок записи со свипом: от начала звучания (−0,3 с) до конца свипа (+1,2 с на хвост комнаты).
 * Сокращает работу деконволюции для длинных ручных записей. null — сигнал не уместился в запись.
 */
export function sweepSegment(rec: Float32Array, sweepLen: number, fs: number): Float32Array | null {
  let pk = 0;
  for (let i = 0; i < rec.length; i++) pk = Math.max(pk, Math.abs(rec[i]));
  if (pk <= 0) return null;
  // огибающая по блокам 10 мс; начало — первый блок громче 10 % максимума огибающей
  const blk = Math.max(1, Math.round(0.01 * fs));
  const env: number[] = [];
  for (let i = 0; i < rec.length; i += blk) {
    let s = 0;
    for (let j = i; j < Math.min(rec.length, i + blk); j++) s += rec[j] * rec[j];
    env.push(Math.sqrt(s / blk));
  }
  const top = Math.max(...env);
  const first = env.findIndex((v) => v > 0.1 * top);
  if (first < 0) return null;
  const start = Math.max(0, first * blk - Math.round(0.3 * fs));
  const end = first * blk + sweepLen + Math.round(1.2 * fs);
  if (end > rec.length + Math.round(0.8 * fs)) return null; // свип оборван «Стопом»
  return rec.subarray(start, Math.min(rec.length, end));
}
