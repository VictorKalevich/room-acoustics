import { describe, expect, it } from 'vitest';
import { FFT_SIZE, NoiseMeter } from '../../src/core/noise';
import { defaultMicSelection } from '../../src/core/micCalibration';

describe('raw PCM', () => {
  for (const fs of [44100, 48000]) {
    it('измеряет RMS и амплитуду бина при ' + fs + ' Гц', () => {
      const pcm = Float32Array.from({length: FFT_SIZE}, (_, i) => Math.sin(2 * Math.PI * 128 * i / FFT_SIZE));
      const meter = new NoiseMeter();
      meter.push(pcm, 0);
      const m = meter.snapshot(fs);
      expect(m.rmsDbfs).toBeCloseTo(-3.0103, 4);
      expect(m.peakHz).toBe(128 * fs / FFT_SIZE);
      expect(Math.max(...m.db)).toBeCloseTo(0, 4);
      expect(m.activeSeconds).toBe(FFT_SIZE / fs);
      expect(m.clippedFraction).toBe(1);
    });
  }
  it('нулевой блок, пропуск и запоздалый дубликат', () => {
    const meter = new NoiseMeter();
    expect(meter.snapshot(48000).missingFraction).toBeNull();
    const zero = new Float32Array(FFT_SIZE);
    meter.push(zero, 0); meter.push(zero, 3); meter.push(zero, 2);
    expect(meter.snapshot(48000)).toMatchObject({
      rmsDbfs: null, blocks: 2, missing: 2, clipped: 0, missingFraction: 0.5, f: [], db: [],
      activeSeconds: 2 * FFT_SIZE / 48000,
    });
  });
  it('шумомер начинает без коррекции, прежние инструменты сохраняют legacy', () => {
    expect(defaultMicSelection({ tool: 'noise' })).toEqual({ mode: 'none' });
    for (const tool of ['sweep', 'rta', 'clap'] as const) {
      expect(defaultMicSelection({ tool, projectId: 'old' })).toEqual({ mode: 'legacy' });
    }
  });
});
