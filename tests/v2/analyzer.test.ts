// V2-036, V2-037 (пакет 8б): окна и БПФ-анализатор, Fast/Slow, искажения синуса, АЧХ свипом в полосе;
// сигналы генератора — линейный и ступенчатый свип, двухтоновый, MLS, пакеты, фаза, независимый шум в каналах.
import { describe, expect, it } from 'vitest';
import { analyzeSweep, logSweep } from '../../src/core/dsp';
import {
  FftAnalyzer, TimeWeighted, analyzeSweepBand, decimateLog, distortion, intermod, steadySegment, windowOf, windowStats,
} from '../../src/v2/application/analyzer';
import {
  DEFAULT_SIGNAL, MLS_ORDERS, mls, signalChannels, signalFileName, signalIssues, signalSeconds, stepFrequencies, synth, type SignalSettings,
} from '../../src/v2/application/signals';

const FS = 48000;
const sine = (f: number, amp: number, seconds: number, fs = FS) => Float32Array.from({ length: Math.round(seconds * fs) }, (_, i) => amp * Math.sin((2 * Math.PI * f * i) / fs));
const sig = (p: Partial<SignalSettings>): SignalSettings => ({ ...DEFAULT_SIGNAL, seconds: 1, ...p });

describe('окна БПФ', () => {
  it('когерентное усиление и шумовая полоса совпадают со справочными', () => {
    const st = (k: Parameters<typeof windowOf>[0]) => windowStats(windowOf(k, 4096));
    expect(st('rect').enbwBins).toBeCloseTo(1, 6);
    expect(st('hann').coherentGain).toBeCloseTo(0.5, 6);
    expect(st('hann').enbwBins).toBeCloseTo(1.5, 3);
    expect(st('hamming').enbwBins).toBeCloseTo(1.363, 2);
    expect(st('blackman-harris').enbwBins).toBeCloseTo(2.004, 2);
    expect(st('flat-top').enbwBins).toBeCloseTo(3.77, 1);
  });

  it('синус полной шкалы читается как −3 дБFS; Flat Top — и между бинами', () => {
    for (const kind of ['hann', 'flat-top'] as const) {
      const a = new FftAnalyzer(FS, 8192, kind, 0.5, 'none');
      const f = 1000 * (8192 / FS) % 1 === 0 ? 1000 : Math.round(1000 / (FS / 8192)) * (FS / 8192);
      a.push(sine(f, 1, 0.5));
      const s = a.spectrum();
      expect(Math.max(...s.db)).toBeCloseTo(-3.01, 1);
    }
    const ft = new FftAnalyzer(FS, 8192, 'flat-top', 0.5, 'none');
    ft.push(sine(1000 + (FS / 8192) / 2, 1, 0.5));
    expect(Math.abs(Math.max(...ft.spectrum().db) + 3.01)).toBeLessThan(0.05);
    expect(ft.stepHz).toBeCloseTo(FS / 8192, 6);
    expect(ft.enbwHz).toBeGreaterThan(3 * ft.stepHz);
  });

  it('перекрытие задаёт шаг кадров; усреднение за весь замер — среднее', () => {
    const a = new FftAnalyzer(FS, 4096, 'hann', 0.75, 'all');
    a.push(new Float32Array(4096 + 3 * 1024));
    expect(a.frames).toBe(4);
    const d = decimateLog([20, 20.01, 20.02, 1000], [1, 5, 2, 0], 12);
    expect(d.f).toEqual([20.01, 1000]);
    expect(d.db).toEqual([5, 0]);
  });
});

describe('Fast и Slow', () => {
  const blocks = (x: Float32Array) => Array.from({ length: Math.floor(x.length / 4096) }, (_, i) => x.subarray(i * 4096, (i + 1) * 4096));

  it('синус 1 кГц: Z, A и C совпадают; уровень как у шумомера', () => {
    const tw = new TimeWeighted(FS);
    for (const b of blocks(sine(1000, 0.5, 2))) tw.push(b);
    const z = tw.level('Z', 'S')!.now!;
    expect(z).toBeCloseTo(10 * Math.log10(0.125), 1);
    expect(tw.level('A', 'S')!.now!).toBeCloseTo(z, 1);
    expect(tw.level('C', 'F')!.now!).toBeCloseTo(z, 1);
  });

  it('A ослабляет 100 Гц примерно на 19 дБ', () => {
    const tw = new TimeWeighted(FS);
    for (const b of blocks(sine(100, 0.5, 2))) tw.push(b);
    expect(tw.level('Z', 'S')!.now! - tw.level('A', 'S')!.now!).toBeGreaterThan(18);
    expect(tw.level('Z', 'S')!.now! - tw.level('A', 'S')!.now!).toBeLessThan(20.5);
  });

  it('после скачка Fast догоняет быстрее Slow, максимум запоминается', () => {
    const tw = new TimeWeighted(FS);
    const x = new Float32Array(FS * 3);
    x.set(sine(1000, 0.01, 2), 0);
    x.set(sine(1000, 0.5, 1), FS * 2);
    const all = blocks(x);
    const at = Math.ceil((FS * 2) / 4096) + Math.round((0.5 * FS) / 4096);
    all.slice(0, at).forEach((b) => tw.push(b));
    const target = 10 * Math.log10(0.125);
    expect(target - tw.level('Z', 'F')!.now!).toBeLessThan(0.5);
    expect(target - tw.level('Z', 'S')!.now!).toBeGreaterThan(1);
    expect(tw.level('Z', 'F')!.min!).toBeLessThan(-40);
    expect(tw.level('Z', 'F')!.max!).toBeCloseTo(tw.level('Z', 'F')!.now!, 3);
  });
});

describe('искажения синуса', () => {
  it('THD и гармоники известного сигнала', () => {
    const n = FS * 2;
    const x = Float32Array.from({ length: n }, (_, i) => {
      const w = (2 * Math.PI * 997 * i) / FS;
      return 0.5 * Math.sin(w) + 0.005 * Math.sin(2 * w) + 0.0025 * Math.sin(3 * w + 1);
    });
    const d = distortion(x, FS, 1000)!;
    expect(d.f0).toBeCloseTo(997, 0);
    expect(d.thd).toBeCloseTo(Math.hypot(1, 0.5), 1);
    expect(d.harmonics[0].relDb).toBeCloseTo(-40, 0);
    expect(d.harmonics[1].relDb).toBeCloseTo(-46, 0);
    expect(d.thdN).toBeCloseTo(d.thd * 1, 0);
    expect(d.fundamentalDb).toBeCloseTo(10 * Math.log10(0.125), 1);
    expect(d.harmonics.every((h) => h.f <= 20000)).toBe(true);
  });

  it('IMD по SMPTE: боковые полосы амплитудной модуляции', () => {
    // 7 кГц, промодулированный 60 Гц с глубиной 2 %: боковые f2 ± 60 Гц по 1 % — IMD = √2 %
    const x = Float32Array.from({ length: FS * 2 }, (_, i) => {
      const t = i / FS;
      return 0.4 * Math.sin(2 * Math.PI * 60 * t) + 0.1 * (1 + 0.02 * Math.sin(2 * Math.PI * 60 * t)) * Math.sin(2 * Math.PI * 7000 * t);
    });
    const r = intermod(x, FS, 60, 7000)!;
    expect(r.imd).toBeCloseTo(Math.SQRT2, 1);
    expect(r.sidebands.find((s) => s.order === 1)!.relDb).toBeCloseTo(-40, 0);
    expect(r.sidebands.find((s) => s.order === 2)!.relDb).toBeLessThan(-100);
    expect(r.f2Db).toBeCloseTo(10 * Math.log10(0.005), 1);
  });

  it('устойчивый участок записи без нарастания и тишины', () => {
    const x = new Float32Array(FS * 4);
    x.set(sine(1000, 0.3, 3), FS / 2);
    const seg = steadySegment(x, FS, 65536)!;
    expect(seg.length).toBe(65536);
    expect(seg.reduce((m, v) => Math.max(m, Math.abs(v)), 0)).toBeGreaterThan(0.29);
    expect(steadySegment(x, FS, FS * 5)).toBeNull();
  });
});

describe('АЧХ свипом в полосе', () => {
  it('в полосе 15–500 Гц совпадает с analyzeSweep ядра; во всей полосе — ровная для прямого пути', () => {
    const fs = 16000;
    const sw = logSweep(10, 1000, 2, fs, 0.5);
    const rec = new Float32Array(sw.length + fs);
    rec.set(sw, 800);
    const core = analyzeSweep(rec, sw, 10, 1000, fs);
    const v2 = analyzeSweepBand(rec, sw, 10, 1000, fs, 15, 500);
    expect(v2.f).toEqual(core.f);
    v2.db.forEach((v, i) => expect(v).toBeCloseTo(core.db[i], 9));
    expect(v2.snrDb).toBeCloseTo(core.snrDb, 9);
    const wide = logSweep(20, 7000, 2, fs, 0.5);
    const rw = new Float32Array(wide.length + fs);
    rw.set(wide, 800);
    const r = analyzeSweepBand(rw, wide, 20, 7000, fs, 30, 6000);
    expect(Math.max(...r.db.map(Math.abs))).toBeLessThan(0.5);
  });
});

describe('сигналы пакета 8б', () => {
  it('MLS максимальной длины всех порядков: период 2ⁿ − 1, сбалансирована', () => {
    for (const n of MLS_ORDERS) {
      const s = mls(n);
      expect(s.length).toBe(2 ** n - 1);
      expect(s.reduce((a, v) => a + v, 0)).toBe(1);
    }
    // автокорреляция периодической MLS: −1 при любом ненулевом сдвиге
    const s = mls(10);
    for (const lag of [1, 7, 300]) expect(s.reduce((a, v, i) => a + v * s[(i + lag) % s.length], 0)).toBe(-1);
  });

  it('ступенчатый синус: ряд по октаве или свой список, длительность — по ступеням', () => {
    expect(stepFrequencies({ f1: 100, f2: 800, stepsPerOctave: 1, list: '' })).toEqual([100, 200, 400, 800]);
    expect(stepFrequencies({ f1: 0, f2: 0, stepsPerOctave: 1, list: '63, 125; 250 1000,5' })).toEqual([63, 125, 250, 1000.5]);
    const s = sig({ kind: 'stepped', f1: 100, f2: 800, stepsPerOctave: 1, stepSeconds: 0.5 });
    expect(signalSeconds(s)).toBe(2);
    expect(synth(s, FS).length).toBe(FS * 2);
    expect(signalIssues({ ...s, stepSeconds: 20 }, FS).length).toBeGreaterThan(0);
    expect(signalIssues({ ...s, list: 'abc' }, FS).length).toBeGreaterThan(0);
  });

  it('линейный свип и пакеты: плавные края, частота, интервал', () => {
    const ls = synth(sig({ kind: 'linear-sweep', f1: 100, f2: 1000, fadeMs: 10 }), FS);
    expect(Math.abs(ls[0])).toBeLessThan(1e-6);
    expect(Math.abs(ls[ls.length - 1])).toBeLessThan(0.01);
    const b = synth(sig({ kind: 'burst', f: 1000, cycles: 10, intervalMs: 100, seconds: 1 }), FS);
    const on = Array.from(b).map((v) => Math.abs(v) > 1e-6);
    expect(on.slice(0, 480).some(Boolean)).toBe(true);
    expect(on.slice(500, 4800).some(Boolean)).toBe(false);
    expect(on.slice(4800, 5280).some(Boolean)).toBe(true);
    expect(signalIssues(sig({ kind: 'burst', f: 100, cycles: 20, intervalMs: 100 }), FS)).toContain('Период повтора должен быть длиннее пакета.');
  });

  it('двухтоновый: соотношение уровней; синус — начальная фаза', () => {
    const x = synth(sig({ kind: 'two-tone', f1: 60, f2: 7000, ratioDb: -12, seconds: 1 }), FS);
    const a = new FftAnalyzer(FS, 32768, 'flat-top', 0, 'none');
    a.push(x);
    const { f, db } = a.spectrum();
    const near = (c: number) => Math.max(...db.filter((_, i) => Math.abs(f[i] - c) < 5));
    expect(near(7000) - near(60)).toBeCloseTo(-12, 1);
    const s = synth(sig({ kind: 'sine', f: 1000, phaseDeg: 90 }), FS);
    expect(s[0]).toBeCloseTo(10 ** (DEFAULT_SIGNAL.levelDb / 20), 4);
  });

  it('независимый шум в каналах не коррелирован; файл называет частоту WAV', () => {
    const s = sig({ kind: 'white', uncorrelated: true });
    const [l, r] = signalChannels(s, FS);
    let lr = 0, ll = 0;
    for (let i = 0; i < l.length; i++) { lr += l[i] * r[i]; ll += l[i] * l[i]; }
    expect(Math.abs(lr / ll)).toBeLessThan(0.02);
    const [l2, r2] = signalChannels({ ...s, uncorrelated: false }, FS);
    expect(Array.from(r2)).toEqual(Array.from(l2));
    expect(signalFileName({ ...s, wavRate: 96000 })).toMatch(/_uncorrelated_96k\.wav$/);
  });
});
