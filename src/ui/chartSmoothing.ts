/** Display-only processing. Never feed these values into scores, maps or exports. */
export type ChartSmoothing = { mode: 'octave' | 'psycho'; index: number };
export type ChartScreen = 'voice' | 'placement-auto' | 'placement-manual';
export const smoothingOptions = (screen: ChartScreen) => screen === 'voice'
  ? [{ label: '1/6', width: 0 }, { label: '1/3', width: 1 / 3 }, { label: '1/2', width: 1 / 2 }]
  : [{ label: 'Без', width: 0 }, { label: '1/12', width: 1 / 12 }, { label: '1/6', width: 1 / 6 }, { label: '1/3', width: 1 / 3 }, { label: '1/2', width: 1 / 2 }];

export function normalizeSmoothing(value: unknown, screen: ChartScreen): ChartSmoothing {
  const v = value as Partial<ChartSmoothing> | null;
  return {
    mode: v?.mode === 'psycho' ? 'psycho' : 'octave',
    index: Number.isInteger(v?.index) && v!.index! >= 0 && v!.index! < smoothingOptions(screen).length
      ? v!.index! : screen === 'voice' ? 0 : 1,
  };
}

/** REW-inspired bandwidth: 1/3 below 100 Hz, 1/6 above 1 kHz.
 * Gaussian averaging on the available log-frequency samples; not a bit-exact REW implementation.
 * Cubic amplitude mean emphasises peaks in psycho mode. Fixed octave mode averages power.
 * No interpolation, new frequency samples or acoustic calculation is performed.
 */
export function smoothChart(f: number[], db: number[], setting: ChartSmoothing, screen: ChartScreen): number[] {
  const fixed = smoothingOptions(screen)[setting.index]?.width ?? 0;
  if (setting.mode === 'octave' && fixed === 0) return db.slice();
  const exponent = setting.mode === 'psycho' ? 3 : 2;
  const x = f.map((v) => Math.log2(v));
  return db.map((value, i) => {
    if (!Number.isFinite(value) || !Number.isFinite(x[i])) return value;
    const band = setting.mode === 'psycho'
      ? 1 / 3 - Math.max(0, Math.min(1, Math.log10(f[i] / 100))) / 6 : fixed;
    const sigma = band / Math.sqrt(8 * Math.log(2));
    let sum = 0, weight = 0;
    for (let j = 0; j < db.length; j++) {
      const delta = (x[j] - x[i]) / sigma;
      if (!Number.isFinite(db[j]) || !Number.isFinite(delta) || Math.abs(delta) > 3) continue;
      const cell = x.length < 2 ? 1 : j === 0 ? x[1] - x[0] : j === x.length - 1 ? x[j] - x[j - 1] : (x[j + 1] - x[j - 1]) / 2;
      const w = Math.exp(-delta * delta / 2) * Math.max(0, cell);
      sum += w * 10 ** ((db[j] - value) * exponent / 20);
      weight += w;
    }
    return weight > 0 ? value + 20 / exponent * Math.log10(sum / weight) : value;
  });
}
