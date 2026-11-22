import { describe, expect, it } from 'vitest';
import { FFT_SIZE as BLOCK, NoiseMeter } from '../../src/core/noise';
import { bandPowers, SPECTRUM_HOP as HOP, SPECTRUM_SIZE as N, weightPower, type Weight } from '../../src/core/noiseSpectrum';
import { COARSE_SECONDS, FINE_SECONDS, MAX_SESSION_SECONDS, NoiseTimeline, spectrogramEdges, variantOf, WEIGHTS } from '../../src/core/noiseTimeline';
import { checkNoiseSession, createNoiseSession, noiseSessionBytes, restoreNoiseSession } from '../../src/core/noiseSession';
import type { MicProfile } from '../../src/core/micCalibration';

const db = (p: number) => 10 * Math.log10(p);
const close = (a: number, b: number, relative: number) => expect(Math.abs(a - b)).toBeLessThanOrEqual(relative * Math.max(Math.abs(a), Math.abs(b)));
/** Непрерывный синус по номеру отсчёта; пропущенные блоки просто не передаются. */
function tone(fs: number, schedule: (t: number) => { hz: number; amp: number }) {
  return (sequence: number) => Float32Array.from({ length: BLOCK }, (_, i) => {
    const n = sequence * BLOCK + i, { hz, amp } = schedule(n / fs);
    return amp * Math.sin(2 * Math.PI * hz * n / fs);
  });
}
function run(meter: NoiseMeter, blocks: number, make: (seq: number) => Float32Array, skip: (seq: number) => boolean = () => false) {
  for (let seq = 0; seq < blocks; seq++) if (!skip(seq)) meter.push(make(seq), seq);
}
const bandOf = (edges: readonly number[], hz: number) => edges.findIndex((e, i) => i && hz < e) - 1;
const profile: MicProfile = { id: 'p', name: 'Поправка', version: 1, origin: 'user', deviceModel: 'test', inputKind: 'unknown', captureMode: 'test',
  orientation: null, sourceURL: null, sourceDate: null, method: 'test', referenceHz: 1000, validRangeHz: [20, 20000],
  digitizationUncertaintyDb: null, validationStatus: 'unverified', notes: '', directivitySource: null,
  curve: { kind: 'correction', frequencyHz: [20, 20000], correctionDb: [6, 6] } };

describe('спектрограмма: полосы, время и частота', () => {
  it('полосы 1/12 октавы с центрами 1000·2^(n/12), 19,6 Гц – 19,6 кГц, не выше Найквиста', () => {
    const edges = spectrogramEdges(48000);
    expect(edges).toHaveLength(121);
    expect(edges[0]).toBeCloseTo(1000 * 2 ** (-137 / 24), 9);
    expect(edges.at(-1)).toBeCloseTo(1000 * 2 ** (103 / 24), 9);
    for (let b = 0; b < 120; b++) expect(Math.sqrt(edges[b] * edges[b + 1])).toBeCloseTo(1000 * 2 ** ((b - 68) / 12), 6);
    expect(spectrogramEdges(16000).at(-1)).toBeLessThanOrEqual(8000);
  });
  for (const fs of [44100, 48000]) {
    it('тон попадает в свою полосу и свой момент времени, тишина до включения — без энергии, ' + fs, () => {
      const meter = new NoiseMeter(fs);
      const onAt = 4, schedule = (t: number) => ({ hz: t < onAt ? 0 : 1000, amp: t < onAt ? 0 : 0.5 });
      const blocks = Math.ceil(12 * fs / BLOCK);
      run(meter, blocks, tone(fs, schedule));
      const tl = meter.timeline, B = tl.bandCount, b1k = bandOf(tl.spectrogramEdges, 1000);
      expect(tl.spectrogramEdges[b1k]).toBeLessThan(1000);
      expect(tl.spectrogramEdges[b1k + 1]).toBeGreaterThan(1000);
      const width = 120, image = tl.spectrogramImage(0, tl.end, width, variantOf('Z', false));
      expect(image.tier).toBe('fine');
      const step = tl.end / width / fs, lastFrame = (N + Math.floor((tl.end - N) / HOP) * HOP) / fs;
      for (let x = 0; x < width; x++) {
        const t0 = x * step, t1 = (x + 1) * step, column = image.power.subarray(x * B, (x + 1) * B);
        // До первого полного окна и после последнего кадра данных нет.
        if (t1 <= N / 2 / fs || t0 >= lastFrame) { expect(image.coverage[x]).toBe(0); expect(Number.isNaN(column[0])).toBe(true); continue; }
        // Каждый кадр — последний hop окна; окно, захватившее включение, тоже содержит тон.
        if (t0 >= onAt + 0.01) expect(column.indexOf(Math.max(...column))).toBe(b1k);
        // Кадры, чей hop задевает пиксель, кончаются раньше t1 + hop: при t1 + hop ≤ включения их окна тихие.
        if (t1 + HOP / fs <= onAt) expect(Math.max(...column)).toBe(0);
      }
      // Средняя PSD полосы в dBFS/Гц: мощность тона 0,125 FS² делится на ширину полосы.
      const at = tl.spectrumAt(10 * fs, variantOf('Z', false))!;
      const bw = tl.spectrogramEdges[b1k + 1] - tl.spectrogramEdges[b1k];
      const neighbours = at.power[b1k - 1] + at.power[b1k] + at.power[b1k + 1];
      expect(db(neighbours)).toBeCloseTo(db(0.125), 1);
      expect(at.power[b1k] / bw).toBeGreaterThan(1000 * at.power[b1k - 3] / bw);
    });
  }
});

describe('энергетическая агрегация, A/C/Z и поправка', () => {
  const fs = 48000;
  const meter = new NoiseMeter(fs, profile);
  // 64 с (750 блоков) — конец на границе секунды; три тона по очереди и пропуск 20 блоков.
  const schedule = (t: number) => t < 20 ? { hz: 63, amp: 0.3 } : t < 40 ? { hz: 1000, amp: 0.05 } : { hz: 8000, amp: 0.2 };
  const skip = (seq: number) => seq >= 300 && seq < 320;
  run(meter, 750, tone(fs, schedule), skip);
  const tl = meter.timeline;
  it('шесть полос и спектрограмма за сеанс равны полосам LTAS сеанса для всех весов, исходных и с поправкой', () => {
    for (const weight of WEIGHTS) for (const corrected of [false, true]) {
      const v = tl.variant(weight, corrected);
      const ltas = meter.spectral.average('session', weight, corrected).density;
      const expected = bandPowers(ltas, meter.spectral.binHz);
      const got = tl.interval(0, tl.levelCount, weight, v).bands;
      expected.forEach((b, j) => close(got[j].power, b.power, 2e-6));
      const sum = got.reduce((s, b) => s + (b.percent ?? 0), 0);
      expect(sum).toBeCloseTo(100, 9);
      const bands = bandPowers(ltas, meter.spectral.binHz, tl.spectrogramEdges);
      const image = tl.spectrogramImage(0, COARSE_SECONDS * fs * tl.coarseCount, 1, v);
      // Один пиксель на сеанс: средняя мощность полос по времени с данными.
      bands.forEach((b, i) => close(image.power[i], b.power, 2e-5));
      expect(image.tier).toBe('fine');
    }
  });
  it('Leq сеанса из истории равен Leq шумомера: Z по отсчётам, A/C по кадрам; пропуск не входит во время', () => {
    const last = tl.levelCount - 1;
    close(tl.series('leqAll', 'Z', last, last + 1).power[0], meter.sessionPower!, 1e-12);
    for (const w of ['A', 'C'] as const) close(tl.series('leqAll', w, last, last + 1).power[0], meter.spectral.leqPower(w)!, 1e-12);
    expect(tl.series('leqAll', 'Z', last, last + 1).valid[0]).toBe(730 * BLOCK);
    expect(tl.end).toBe(750 * BLOCK);
  });
  it('A/C на тоне 63 Гц и одна поправка +6 дБ без двойного применения', () => {
    const n = 10, v = (w: Weight, c: boolean) => tl.variant(w, c);
    const [z, a, c] = WEIGHTS.map(w => tl.interval(n, n + 1, w, v(w, false)).bands[1].power);
    expect(db(a / z)).toBeCloseTo(db(weightPower(63, 'A')), 1);
    expect(db(c / z)).toBeCloseTo(db(weightPower(63, 'C')), 1);
    for (const w of WEIGHTS) {
      const raw = tl.interval(n, n + 1, w, v(w, false)).bands[1].power, corrected = tl.interval(n, n + 1, w, v(w, true)).bands[1].power;
      expect(db(corrected / raw)).toBeCloseTo(6, 6);
    }
    const at = tl.spectrumAt(10.5 * fs, v('A', true))!, raw = tl.spectrumAt(10.5 * fs, v('A', false))!;
    const b = bandOf(tl.spectrogramEdges, 63);
    expect(db(at.power[b] / raw.power[b])).toBeCloseTo(6, 5);
    // Уровни Z/A/C остаются исходными: поправка только в спектральных вариантах.
    expect(db(tl.series('leq1', 'Z', n, n + 1).power[0])).toBeCloseTo(db(0.3 ** 2 / 2), 6);
  });
  it('окна 1, 10 и 60 с: Z — по отсчётам, A — как скользящий LTAS шумомера; пропуск делает окно неполным', () => {
    const make = tone(fs, schedule), energy = new Float64Array(750 * BLOCK);
    for (let seq = 0; seq < 750; seq++) if (!skip(seq)) make(seq).forEach((x, i) => { energy[seq * BLOCK + i] = x * x; });
    for (const [metric, seconds] of [['leq1', 1], ['leq10', 10], ['leq60', 60]] as const) {
      const series = tl.series(metric, 'Z', 0, tl.levelCount);
      for (let n = 0; n < tl.levelCount; n++) {
        const from = Math.max(0, (n - seconds + 1) * fs), to = (n + 1) * fs;
        let e = 0, count = 0;
        for (let i = from; i < to; i++) { e += energy[i]; if (!skip(Math.floor(i / BLOCK))) count++; }
        expect(series.valid[n]).toBe(count);
        if (count) close(series.power[n], e / count, 1e-9); else expect(Number.isNaN(series.power[n])).toBe(true);
        const gap = from < 320 * BLOCK && to > 300 * BLOCK;
        expect(series.complete[n]).toBe(n + 1 >= seconds && !gap ? 1 : 0);
      }
    }
    const last = tl.levelCount - 1;
    for (const w of ['A', 'C'] as const) {
      const live = meter.spectral.average('60', w);
      const sum = live.density.reduce((s, d) => s + d, 0) * meter.spectral.binHz;
      close(tl.window(last, 60, w).power!, sum, 1e-9);
      expect(tl.window(last, 60, w).valid / fs).toBeCloseTo(live.seconds, 9);
    }
    // Первые секунды A/C — прогрев спектра: окно неполное, значения нет только до первого кадра.
    expect(tl.series('leq1', 'A', 0, 1).complete[0]).toBe(0);
    expect(tl.series('peak', 'Z', 5, 6).power[0]).toBeCloseTo(0.3 ** 2, 6);
  });
  it('пропуск: нет вымышленных значений в уровнях, полосах и спектрограмме', () => {
    const gapFrom = 300 * BLOCK / fs, gapTo = 320 * BLOCK / fs;
    const n = Math.ceil(gapFrom) + 0;  // столбец целиком внутри пропуска
    expect(n + 1).toBeLessThan(gapTo);
    expect(tl.pcmSamples(n)).toBe(0);
    expect(Number.isNaN(tl.series('leq1', 'Z', n, n + 1).power[0])).toBe(true);
    expect(Number.isNaN(tl.bandSeries(0, 0, n, n + 1).power[0])).toBe(true);
    expect(tl.bandSeries(0, 0, n, n + 1).valid[0]).toBe(0);
    expect(tl.peakAt(n)).toBeNull();
    const image = tl.spectrogramImage(n * fs, (n + 1) * fs, 4, 0);
    expect([...image.coverage]).toEqual([0, 0, 0, 0]);
    expect(image.power.every(Number.isNaN)).toBe(true);
    // После пропуска спектр снова появляется только через полное окно.
    const after = tl.spectrogramImage(gapTo * fs, gapTo * fs + N, 2, 0);
    expect([...after.coverage]).toEqual([0, 1]);
  });
});

describe('ограниченная память и длительные сеансы', () => {
  it('кольцо 10 мин, столбцы 10 с и 1 с за весь сеанс, предел 12 ч; переход на грубые столбцы', () => {
    // Малая сетка: те же функции, 12 ч за секунды.
    const fs = 4096, hop = 2048, bins = 33, psd = new Float64Array(bins).fill(1e-6);
    const tl = new NoiseTimeline({ sampleRate: fs, binHz: fs / 64, bins, hop, gains: [null, null, null] });
    const block = new Float32Array(4096).fill(0.01);
    const sizes: number[] = [];
    for (let s = 0; s < MAX_SESSION_SECONDS; s++) {
      tl.addBlock(block, s * fs);
      tl.addFrame((s + 0.5) * fs, psd, 1e-6, 1e-6);
      tl.addFrame((s + 1) * fs, psd, 1e-6, 1e-6);
      if (s % 3600 === 3599) sizes.push(tl.bytes);
    }
    expect(tl.levelCount).toBe(MAX_SESSION_SECONDS);
    expect(tl.coarseCount).toBe(MAX_SESSION_SECONDS / COARSE_SECONDS);
    expect(tl.fineTotal).toBe(2 * MAX_SESSION_SECONDS);
    expect(tl.fineDropped).toBe(2 * MAX_SESSION_SECONDS - tl.fineCapacity);
    expect(tl.fineCapacity).toBe(Math.ceil(FINE_SECONDS * fs / hop));
    expect(tl.fineFrom).toBe(tl.end - FINE_SECONDS * fs);
    // Удвоение ёмкости ограничено пределом: к 12 ч массивы ровно по пределу, дальше не растут.
    // Секунда: 5 × Float64 + Float32 пика + полосы энергии × 3 варианта Float32; 10 с и кадр: Float64 + полосы × 3 Float32.
    expect(tl.energyCount).toBe(5);
    const ceiling = MAX_SESSION_SECONDS * (5 * 8 + 4 + tl.energyCount * 3 * 4) + (MAX_SESSION_SECONDS / COARSE_SECONDS + tl.fineCapacity) * (8 + tl.bandCount * 3 * 4);
    expect(tl.bytes).toBe(ceiling);
    expect(Math.max(...sizes)).toBe(ceiling);
    expect(() => tl.addBlock(block, MAX_SESSION_SECONDS * fs)).toThrow(RangeError);
    expect(tl.tierFor(tl.end - 60 * fs)).toBe('fine');
    expect(tl.tierFor(tl.end - 700 * fs)).toBe('coarse');
    expect(tl.tierFor(0)).toBe('coarse');
    // Энергия не зависит от ширины картинки и от яруса.
    const energy = (t0: number, t1: number, width: number) => {
      const im = tl.spectrogramImage(t0, t1, width, 0), step = (t1 - t0) / width;
      let e = 0;
      for (let x = 0; x < width; x++) if (im.coverage[x]) e += im.power[x * tl.bandCount + 3] * im.coverage[x] * step;
      return e;
    };
    const t0 = tl.end - 300 * fs, t1 = tl.end;
    for (const w of [7, 333, 1000]) close(energy(t0, t1, w), energy(t0, t1, 50), 1e-6);
    close(energy(0, 3600 * fs, 360), energy(0, 3600 * fs, 17), 1e-6);
  });
  it('шумомер не принимает блок за пределом 12 ч и сообщает об этом', () => {
    const meter = new NoiseMeter(48000);
    const block = new Float32Array(BLOCK).fill(0.1);
    meter.push(block, 0);
    const limit = Math.floor(MAX_SESSION_SECONDS * 48000 / BLOCK);
    meter.push(block, limit - 1);
    expect(meter.limitReached).toBe(false);
    meter.push(block, limit);
    expect(meter.limitReached).toBe(true);
    expect(meter.history.length).toBe(2);
    expect(meter.timeline.levelCount).toBe(Math.ceil(limit * BLOCK / 48000));
  });
  it('новый сеанс начинается с пустой истории, прежний не меняется', () => {
    const first = new NoiseMeter(48000), make = tone(48000, () => ({ hz: 500, amp: 0.1 }));
    run(first, 40, make);
    const before = first.timeline.toData();
    const second = new NoiseMeter(48000);
    run(second, 10, make);
    expect(second.timeline.levelCount).toBe(1);
    expect(second.history.length).toBe(10);
    expect(first.timeline.toData()).toEqual(before);
  });
});

describe('снимок сеанса для блока 2', () => {
  const fs = 44100, meter = new NoiseMeter(fs, profile);
  run(meter, 260, tone(fs, t => ({ hz: t < 10 ? 125 : 2000, amp: 0.2 })), seq => seq === 100);
  const session = createNoiseSession(meter, { name: 'Тест', stopReason: 'Измерение остановлено', manualCheck: 'untested',
    build: { sha: 'test', time: '' } }, { backend: 'AudioWorklet', sampleRate: fs, constraintsFallback: false }, 'iPhone 17 Pro');
  it('переживает structured clone и восстанавливается в тот же просмотр', () => {
    const restored = restoreNoiseSession(structuredClone(session));
    const live = meter.timeline, tl = restored.timeline;
    for (const w of WEIGHTS) for (const metric of ['leq1', 'leq10', 'leq60', 'leqAll', 'peak'] as const)
      expect(tl.series(metric, w, 0, tl.levelCount)).toEqual(live.series(metric, w, 0, live.levelCount));
    for (let v = 0; v < 6; v++) {
      expect(tl.spectrogramImage(0, tl.end, 50, v)).toEqual(live.spectrogramImage(0, live.end, 50, v));
      expect(tl.interval(2, 20, 'A', v)).toEqual(live.interval(2, 20, 'A', v));
      expect(tl.bandSeries(v, 2, 0, 30)).toEqual(live.bandSeries(v, 2, 0, 30));
    }
    expect(restored.blocks.slice()).toEqual(meter.history.slice());
    expect(() => tl.addBlock(new Float32Array(4), 0)).toThrow();
    expect(session.settings.variants).toEqual([
      { weight: 'Z', corrected: false }, { weight: 'A', corrected: false }, { weight: 'C', corrected: false },
      { weight: 'Z', corrected: true }, { weight: 'A', corrected: true }, { weight: 'C', corrected: true }]);
    expect(session.calibration?.profile).toEqual(profile);
    expect(session.totals).toMatchObject({ blocks: 259, missingBlocks: 1, endSamples: 260 * BLOCK });
    expect(JSON.stringify(session.meta)).not.toMatch(/deviceId|groupId/);
    expect(noiseSessionBytes(session)).toBeGreaterThan(0);
  });
  it('отвергает неизвестную версию, другой формат и повреждённые массивы', () => {
    expect(() => checkNoiseSession({ ...session, version: 2 })).toThrow(/версия/);
    expect(() => checkNoiseSession({ ...session, kind: 'x' })).toThrow(/формат/);
    const broken = structuredClone(session);
    broken.timeline.levels.z = new Float64Array(3);
    expect(() => checkNoiseSession(broken)).toThrow(/z/);
    const negative = structuredClone(session);
    negative.timeline.coarse.energy[0] = -1;
    expect(() => checkNoiseSession(negative)).toThrow(/coarse/);
    expect(() => checkNoiseSession({ ...session, calibration: null })).toThrow(/настройки/);
  });
});

describe('600 с синтетического сигнала, 48 кГц, полный тракт NoiseMeter', () => {
  it('десять тонов по минуте, два пропуска: положение, уровни, полосы, итог и время обработки', () => {
    const fs = 48000, seconds = 600, blocks = Math.ceil(seconds * fs / BLOCK);
    const tones = [40, 63, 125, 250, 1000, 4000, 8000, 12000, 100, 2000], amps = [0.5, 0.3, 0.2, 0.1, 0.05, 0.02, 0.1, 0.2, 0.4, 0.01];
    const schedule = (t: number) => { const i = Math.min(9, Math.floor(t / 60)); return { hz: tones[i], amp: amps[i] }; };
    const gaps = [[2000, 2005], [5000, 5100]];
    const skip = (seq: number) => gaps.some(([a, b]) => seq >= a && seq < b);
    const make = tone(fs, schedule), meter = new NoiseMeter(fs), times: number[] = [];
    for (let seq = 0; seq < blocks; seq++) {
      if (skip(seq)) continue;
      const pcm = make(seq), t = performance.now();
      meter.push(pcm, seq);
      times.push(performance.now() - t);
    }
    const tl = meter.timeline, B = tl.bandCount;
    expect(meter.history.length).toBe(blocks - 105);
    expect(meter.snapshot().missing).toBe(105);
    expect(tl.end).toBe(blocks * BLOCK);
    expect(tl.levelCount).toBe(Math.ceil(blocks * BLOCK / fs));
    const gapSeconds = gaps.map(([a, b]) => [a * BLOCK / fs, b * BLOCK / fs]);
    for (let minute = 0; minute < 10; minute++) {
      // Столбцы 10 с внутри минуты: максимум — полоса тона; столбцы 1 с: уровень тона.
      const image = tl.spectrogramImage(minute * 60 * fs, (minute + 1) * 60 * fs, 6, 0);
      const band = bandOf(tl.spectrogramEdges, tones[minute]);
      for (let x = 1; x < 6; x++) {
        const column = image.power.subarray(x * B, (x + 1) * B);
        expect(column.indexOf(Math.max(...column))).toBe(band);
      }
      const leq = tl.series('leq1', 'Z', minute * 60 + 1, minute * 60 + 59);
      leq.power.forEach((p, i) => {
        const n = minute * 60 + 1 + i, inGap = gapSeconds.some(([a, b]) => n + 1 > a && n < b);
        if (inGap) expect(leq.complete[i]).toBe(0);
        else expect(db(p)).toBeCloseTo(db(amps[minute] ** 2 / 2), 2);
      });
    }
    close(tl.series('leqAll', 'Z', tl.levelCount - 1, tl.levelCount).power[0], meter.sessionPower!, 1e-12);
    const ltas = bandPowers(meter.spectral.average('session', 'Z').density, meter.spectral.binHz);
    tl.interval(0, tl.levelCount, 'Z', 0).bands.forEach((b, j) => close(b.power, ltas[j].power, 2e-6));
    expect(tl.tierFor(0)).toBe('fine');
    const sorted = times.sort((a, b) => a - b), p95 = sorted[Math.floor(0.95 * sorted.length)];
    const bytes = tl.bytes + meter.history.bytes;
    const session = createNoiseSession(meter, { name: '600 с', stopReason: 'test', manualCheck: 'untested', build: { sha: 'test', time: '' } }, null, null);
    const stored = noiseSessionBytes(session);
    console.log(`600 с, 48 кГц: ${times.length} блоков, обработка блока p50 ${sorted[sorted.length >> 1].toFixed(3)} мс, p95 ${p95.toFixed(3)} мс, max ${sorted.at(-1)!.toFixed(3)} мс; история в памяти ${(bytes / 2 ** 20).toFixed(2)} МиБ (уровни, спектрограмма, блоки); снимок сеанса ${(stored / 2 ** 20).toFixed(2)} МиБ`);
    expect(p95).toBeLessThan(25);
    expect(bytes).toBeLessThan(8 * 2 ** 20);
    expect(stored).toBeLessThan(6 * 2 ** 20);
    expect(restoreNoiseSession(session).timeline.series('leqAll', 'Z', tl.levelCount - 1, tl.levelCount).power[0]).toBe(tl.series('leqAll', 'Z', tl.levelCount - 1, tl.levelCount).power[0]);
  }, 300_000);
});
