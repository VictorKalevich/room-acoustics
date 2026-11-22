import { describe, expect, it } from 'vitest';
import { FFT_SIZE, NoiseMeter } from '../../src/core/noise';
import { defaultMicSelection } from '../../src/core/micCalibration';

describe('raw PCM', () => {
  for (const fs of [44100, 48000]) {
    it('измеряет RMS и амплитуду бина при ' + fs + ' Гц', () => {
      const pcm = Float32Array.from({length: FFT_SIZE}, (_, i) => Math.sin(2 * Math.PI * 128 * i / FFT_SIZE));
      const meter = new NoiseMeter(fs);
      meter.push(pcm, 0);
      const m = meter.snapshot();
      expect(m.rmsDbfs).toBeCloseTo(-3.0103, 4);
      expect(m.peakHz).toBe(128 * fs / FFT_SIZE);
      expect(Math.max(...m.db)).toBeCloseTo(0, 4);
      expect(m.activeSeconds).toBe(FFT_SIZE / fs);
      expect(m.clippedFraction).toBe(1);
    });
  }
  it('сохраняет пиковую частоту каждого принятого блока и клиппинг только его блока', () => {
    const meter = new NoiseMeter(48000);
    for (const [seq, bin] of [85, 171].entries()) {
      const pcm = Float32Array.from({length: FFT_SIZE}, (_, i) =>
        (seq === 0 ? 0.5 : 1) * Math.sin(2 * Math.PI * bin * i / FFT_SIZE));
      meter.push(pcm, seq);
    }
    expect(meter.history.map(p => [p.peakHz, p.clipped])).toEqual([[996.09375, false], [2003.90625, true]]);
  });
  it('нулевой блок, пропуск и запоздалый дубликат', () => {
    const meter = new NoiseMeter(48000);
    expect(meter.snapshot().missingFraction).toBeNull();
    const zero = new Float32Array(FFT_SIZE);
    meter.push(zero, 0); meter.push(zero, 3); meter.push(zero, 2);
    expect(meter.snapshot()).toMatchObject({
      rmsDbfs: null, blocks: 2, missing: 2, clipped: 0, missingFraction: 0.5, f: [], db: [],
      activeSeconds: 2 * FFT_SIZE / 48000,
    });
  });
  for (const fs of [44100, 48000]) {
    it('скользящая секунда учитывает хвост первого блока при ' + fs + ' Гц', () => {
      const meter = new NoiseMeter(fs);
      const input = Float32Array.from({length: 20 * FFT_SIZE}, (_, i) =>
        (i < 10 * FFT_SIZE ? 0.01 : 0.1) * (i % FFT_SIZE < 800 ? 2 : 1));
      for (let i = 0; i < 20; i++) {
        const end = (i + 1) * FFT_SIZE;
        meter.push(input.subarray(end - FFT_SIZE, end), i);
        const row = meter.history.at(i)!;
        expect(row.windowComplete).toBe(end >= fs);
        if (end >= fs) {
          const energy = input.subarray(end - fs, end).reduce((sum, x) => sum + x * x, 0);
          expect(row.rms1sDbfs).toBeCloseTo(10 * Math.log10(energy / fs), 8);
        } else expect(row.rms1sDbfs).toBeNull();
      }
    });
  }
  it('время по аудиочасам, пропуск сбрасывает окно, тишина заполняет его, дубликаты не входят', () => {
    const meter = new NoiseMeter(2 * FFT_SIZE);
    const impulse = new Float32Array(FFT_SIZE);
    impulse[0] = 1;
    meter.push(impulse, 0, 1500);
    const zero = new Float32Array(FFT_SIZE);
    meter.push(zero, 1, 1700);
    meter.push(zero, 4, 4000);
    meter.push(zero, 4, 5000);
    meter.push(zero, 5, 5400);
    expect(meter.audioStartMs).toBe(1000);
    expect(meter.history.map(r => [r.endSeconds, r.clipped, r.missingBefore, r.windowComplete])).toEqual([
      [0.5,true,0,false], [1,false,0,true], [2.5,false,2,false], [3,false,0,true],
    ]);
    expect(meter.history.at(3)!.rms1sDbfs).toBeNull();
    expect(meter.snapshot().activeSeconds).toBe(2);
  });
  it('шумомер начинает без коррекции, прежние инструменты сохраняют legacy', () => {
    expect(defaultMicSelection({ tool: 'noise' })).toEqual({ mode: 'none' });
    for (const tool of ['sweep', 'rta', 'clap'] as const) {
      expect(defaultMicSelection({ tool, projectId: 'old' })).toEqual({ mode: 'legacy' });
    }
  });
});
