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
  // окно: 10 мс до пика, 500 мс после (для баса — с полуокном Ханна на хвосте)
  const pre = Math.round(0.01 * fs), post = Math.round(0.5 * fs);
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
  const N = nextPow2(Math.round(fs * 1.0));
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

/** Полосовой фильтр (RBJ, постоянное усиление 0 дБ в центре), октава: Q = √2. */
function bandpass(x: Float32Array, f0: number, fs: number): Float32Array {
  const w = (2 * Math.PI * f0) / fs, q = Math.SQRT2;
  const alpha = Math.sin(w) / (2 * q), cw = Math.cos(w);
  const b0 = alpha, b2 = -alpha, a0 = 1 + alpha, a1 = -2 * cw, a2 = 1 - alpha;
  const out = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const y = (b0 * x[i] + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = y;
    out[i] = y;
  }
  return out;
}

/** T60 по кривой Шрёдера (наклон между −5 и −25 дБ, при малом запасе — −5…−15). null — мало динамики. */
export function schroederT60(x: Float32Array, fs: number): number | null {
  const n = x.length;
  // шумовой пол — по последним 10 %
  let nz = 0;
  const tail = Math.max(1, Math.floor(n * 0.1));
  for (let i = n - tail; i < n; i++) nz += x[i] * x[i];
  nz /= tail;
  const e = new Float64Array(n);
  let acc = 0;
  for (let i = n - 1; i >= 0; i--) { acc += Math.max(0, x[i] * x[i] - nz); e[i] = acc; }
  if (e[0] <= 0) return null;
  const db = (i: number) => 10 * Math.log10(Math.max(e[i], 1e-30) / e[0]);
  const fit = (hi: number, lo: number) => {
    let i0 = -1, i1 = -1;
    for (let i = 0; i < n; i++) { if (i0 < 0 && db(i) <= hi) i0 = i; if (db(i) <= lo) { i1 = i; break; } }
    if (i0 < 0 || i1 <= i0 + 10) return null;
    let sx = 0, sy = 0, sxx = 0, sxy = 0, c = 0;
    const step = Math.max(1, Math.floor((i1 - i0) / 400));
    for (let i = i0; i <= i1; i += step) { const t = i / fs, y = db(i); sx += t; sy += y; sxx += t * t; sxy += t * y; c++; }
    const slope = (c * sxy - sx * sy) / (c * sxx - sx * sx);
    return slope < 0 ? -60 / slope : null;
  };
  return fit(-5, -25) ?? fit(-5, -15);
}

export const RT_BANDS = [125, 250, 500, 1000, 2000, 4000];

/** RT60 по октавам из записи хлопка (от самого громкого места до конца записи). */
export function clapRT60(rec: Float32Array, fs: number): { band: number; t60: number | null }[] {
  let pk = 0, at = 0;
  for (let i = 0; i < rec.length; i++) if (Math.abs(rec[i]) > pk) { pk = Math.abs(rec[i]); at = i; }
  const seg = rec.subarray(at, Math.min(rec.length, at + Math.round(2.5 * fs)));
  return RT_BANDS.map((band) => ({ band, t60: schroederT60(bandpass(seg, band, fs), fs) }));
}

// ---------- FIR ----------

/** Минимально-фазовый FIR — импульсная характеристика каскада biquad (то же, что PEQ), с плавным концом. */
export function firMinPhase(filters: PeqFilter[], fs: number, n = 16384): Float32Array {
  const x = new Float64Array(n);
  x[0] = 1;
  for (const f of filters) {
    const { b0, b1, b2, a1, a2 } = biquad(f, fs);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < n; i++) {
      const y = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = x[i]; y2 = y1; y1 = y;
      x[i] = y;
    }
  }
  const fade = Math.floor(n * 0.1);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = x[i] * (i > n - fade ? 0.5 * (1 + Math.cos((Math.PI * (i - (n - fade))) / fade)) : 1);
  return out;
}

/** Линейно-фазовый FIR с тем же модулем, что у PEQ (задержка n/2 отсчётов). */
export function firLinearPhase(filters: PeqFilter[], fs: number, n = 32768): Float32Array {
  const re = new Float64Array(n), im = new Float64Array(n);
  for (let k = 0; k <= n / 2; k++) {
    const w = (2 * Math.PI * k) / n;
    let mag = 1;
    for (const f of filters) {
      const { b0, b1, b2, a1, a2 } = biquad(f, fs);
      const nr = b0 + b1 * Math.cos(w) + b2 * Math.cos(2 * w), ni = -(b1 * Math.sin(w) + b2 * Math.sin(2 * w));
      const dr = 1 + a1 * Math.cos(w) + a2 * Math.cos(2 * w), di = -(a1 * Math.sin(w) + a2 * Math.sin(2 * w));
      mag *= Math.hypot(nr, ni) / Math.hypot(dr, di);
    }
    re[k] = mag;
    if (k > 0 && k < n / 2) re[n - k] = mag;
  }
  fft(re, im, true);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const j = (i + n / 2) % n;
    const win = 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)) + 0.08 * Math.cos((4 * Math.PI * i) / (n - 1)); // Блэкман
    out[i] = re[j] * win;
  }
  return out;
}

/** WAV (32-бит float), каналы с одинаковой длиной. */
export function wavFloat32(channels: Float32Array[], fs: number): ArrayBuffer {
  const nCh = channels.length, n = channels[0].length;
  const buf = new ArrayBuffer(44 + n * nCh * 4);
  const v = new DataView(buf);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n * nCh * 4, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 3, true); v.setUint16(22, nCh, true);
  v.setUint32(24, fs, true); v.setUint32(28, fs * nCh * 4, true); v.setUint16(32, nCh * 4, true); v.setUint16(34, 32, true);
  str(36, 'data'); v.setUint32(40, n * nCh * 4, true);
  let o = 44;
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

/**
 * Линейно-фазовый FIR с заданной АЧХ (дБ на сетке freqs). Ниже freqs[0] — как на freqs[0],
 * выше последней частоты — плавный (1/3 окт) переход к 0 дБ.
 */
export function firFromCurve(freqs: number[], db: number[], fs: number, n = 65536): Float32Array {
  const re = new Float64Array(n), im = new Float64Array(n);
  const fTop = freqs[freqs.length - 1];
  const at = (f: number) => {
    if (f <= freqs[0]) return db[0];
    if (f >= fTop) {
      const t = Math.min(1, Math.log2(f / fTop) * 3);
      return db[db.length - 1] * (1 - t);
    }
    let i = 0;
    while (freqs[i + 1] < f) i++;
    const t = Math.log(f / freqs[i]) / Math.log(freqs[i + 1] / freqs[i]);
    return db[i] + (db[i + 1] - db[i]) * t;
  };
  for (let k = 0; k <= n / 2; k++) {
    const f = (k * fs) / n;
    const mag = Math.pow(10, at(Math.max(f, 1)) / 20);
    re[k] = mag;
    if (k > 0 && k < n / 2) re[n - k] = mag;
  }
  fft(re, im, true);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const j = (i + n / 2) % n;
    const win = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
    out[i] = re[j] * win;
  }
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
