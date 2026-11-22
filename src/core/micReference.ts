import { FFT_SIZE, type NoisePoint } from './noise';

/** Last five seconds of accepted raw blocks, including continuity, peak and drift checks. */
export function referenceLevel(meter: { sampleRate: number; history: { slice(start: number): NoisePoint[] } }) {
  const count = Math.ceil(5 * meter.sampleRate / FFT_SIZE);
  const blocks = meter.history.slice(-count);
  if (blocks.length !== count || blocks.some(p => p.clipped || p.missingBefore || p.peakHz === null ||
      Math.abs(p.peakHz - 1000) > meter.sampleRate / FFT_SIZE || p.rmsDbfs === null)) return null;
  const levels = blocks.map(p => p.rmsDbfs!);
  if (Math.max(...levels) - Math.min(...levels) > 1) return null;
  return 10 * Math.log10(levels.reduce((sum, db) => sum + 10 ** (db / 10), 0) / count);
}

export interface ReferencePair { measuredDbfs: number; referenceSpl: number }
export function absoluteOffset(first: ReferencePair, second: ReferencePair) {
  if (![first.measuredDbfs, second.measuredDbfs, first.referenceSpl, second.referenceSpl].every(Number.isFinite) ||
      Math.abs(first.referenceSpl - second.referenceSpl) < 10)
    throw new Error('Нужны два эталонных уровня с разницей не менее 10 дБ.');
  const a = first.referenceSpl - first.measuredDbfs, b = second.referenceSpl - second.measuredDbfs;
  if (Math.abs(a - b) > 2) throw new Error('Расхождение поправок превышает 2 дБ. Проверьте тракт и эталон.');
  return (a + b) / 2;
}
