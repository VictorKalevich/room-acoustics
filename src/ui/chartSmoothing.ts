/** Display-only processing. Never feed these values into scores, maps or exports. */
/**
 * index — выбранная точка базового набора экрана (как в 015). fine — более узкое сглаживание, доступное только
 * при подробных данных (026, повышенная точность расчёта): действует, пока данные его допускают, иначе — index.
 */
export type ChartSmoothing = { mode: 'octave' | 'psycho'; index: number; fine?: string };
export type ChartScreen = 'voice' | 'placement-auto' | 'placement-manual';
/** base — номер точки базового набора (015); null — точка есть только при подробных данных. */
export interface SmoothingOption { label: string; width: number; base: number | null }

const BASE: Record<'voice' | 'placement', { label: string; width: number }[]> = {
  voice: [{ label: '1/6', width: 0 }, { label: '1/3', width: 1 / 3 }, { label: '1/2', width: 1 / 2 }],
  placement: [{ label: 'Без', width: 0 }, { label: '1/12', width: 1 / 12 }, { label: '1/6', width: 1 / 6 }, { label: '1/3', width: 1 / 3 }, { label: '1/2', width: 1 / 2 }],
};

/** Узкое сглаживание 1/N октавы показывается, если в данных не меньше 2 отсчётов на его ширину. */
const FINE = [{ label: '1/48', width: 1 / 48, ppo: 96 }, { label: '1/24', width: 1 / 24, ppo: 48 }];
const has = (ppo: number | undefined, need: number) => (ppo ?? 0) >= need * 0.98;

/**
 * Точки ползунка от «больше деталей» к «общей форме». ppo — отсчётов на октаву в данных графика:
 * расстановка — 24 (стандарт), 48 или 96; голос — полос на октаву: 6 (стандарт), 24 или 48.
 * Без ppo или при стандартных данных — базовый набор 015.
 */
export function smoothingOptions(screen: ChartScreen, ppo?: number): SmoothingOption[] {
  if (screen !== 'voice') {
    const base = BASE.placement.map((o, i) => ({ ...o, base: i }));
    const fine = FINE.filter((o) => has(ppo, o.ppo)).map((o) => ({ label: o.label, width: o.width, base: null }));
    return [base[0], ...fine, ...base.slice(1)];
  }
  const base = BASE.voice.map((o, i) => ({ ...o, base: i }));
  // голос: исходная кривая — полосы расчёта; при полосах уже 1/6 октавы точка «1/6» становится сглаживанием
  const native = has(ppo, 48) ? '1/48' : has(ppo, 24) ? '1/24' : null;
  if (!native) return base;
  const steps = [{ label: '1/48', width: 1 / 48 }, { label: '1/24', width: 1 / 24 }, { label: '1/12', width: 1 / 12 }];
  const from = steps.findIndex((o) => o.label === native);
  return [
    { label: native, width: 0, base: null },
    ...steps.slice(from + 1).map((o) => ({ ...o, base: null })),
    { ...base[0], width: 1 / 6 },
    ...base.slice(1),
  ];
}

export function normalizeSmoothing(value: unknown, screen: ChartScreen): ChartSmoothing {
  const v = value as Partial<ChartSmoothing> | null;
  const n = BASE[screen === 'voice' ? 'voice' : 'placement'].length;
  const out: ChartSmoothing = {
    mode: v?.mode === 'psycho' ? 'psycho' : 'octave',
    index: Number.isInteger(v?.index) && v!.index! >= 0 && v!.index! < n ? v!.index! : screen === 'voice' ? 0 : 1,
  };
  if (typeof v?.fine === 'string' && ['1/48', '1/24', '1/12'].includes(v.fine)) out.fine = v.fine;
  return out;
}

/** Положение ползунка в наборе options: узкое сглаживание, если оно выбрано и доступно, иначе базовая точка. */
export function smoothingPosition(setting: ChartSmoothing, options: SmoothingOption[]): number {
  if (setting.fine) {
    const i = options.findIndex((o) => o.base === null && o.label === setting.fine);
    if (i >= 0) return i;
  }
  const i = options.findIndex((o) => o.base === setting.index);
  return i >= 0 ? i : 0;
}

/** Выбор точки ползунка: базовая точка сбрасывает узкое сглаживание, узкая — запоминается поверх базовой. */
export function pickSmoothing(setting: ChartSmoothing, option: SmoothingOption): ChartSmoothing {
  return option.base === null ? { mode: setting.mode, index: setting.index, fine: option.label } : { mode: setting.mode, index: option.base };
}

/** REW-inspired bandwidth: 1/3 below 100 Hz, 1/6 above 1 kHz.
 * Gaussian averaging on the available log-frequency samples; not a bit-exact REW implementation.
 * Cubic amplitude mean emphasises peaks in psycho mode. Fixed octave mode averages power.
 * No interpolation, new frequency samples or acoustic calculation is performed.
 */
export function smoothChart(f: number[], db: number[], setting: ChartSmoothing, screen: ChartScreen, ppo?: number): number[] {
  const options = smoothingOptions(screen, ppo);
  const fixed = options[smoothingPosition(setting, options)]?.width ?? 0;
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
