// Диффузоры (V2-052, экспертный уровень): последовательность первообразного корня (PRD) и оценка рассеивания
// одномерного диффузора с ячейками в дальнем поле по модели Фраунгофера (Кирхгофа) — Cox, D'Antonio, «Acoustic
// Absorbers and Diffusers», гл. 9: ячейка — плоская волна с отражением e^{−2jkd}, без потерь, перегородок и
// взаимодействия ячеек; падение по нормали. Коэффициент диффузии — AES-4id по энергии в 37 направлениях (через 5°),
// нормированный к плоской панели той же ширины. Это оценка, а не измерение по ISO 17497-2.
import { speedOfSound } from '../../core/physics';

/** Наименьший первообразный корень по модулю простого N. */
export function primitiveRoot(N: number): number {
  for (let g = 2; g < N; g++) {
    const seen = new Set<number>();
    let v = 1;
    for (let k = 1; k < N; k++) { v = (v * g) % N; seen.add(v); }
    if (seen.size === N - 1) return g;
  }
  return 1;
}

/** PRD: глубины d_n = (gⁿ mod N)·λ0/(2N), n = 1…N−1; рабочая полоса — как у QRD, но на f0 подавлено зеркальное отражение. */
export function prd(N: number, f0: number, well: number, tempC = 20) {
  const c = speedOfSound(tempC);
  const g = primitiveRoot(N);
  const step = c / f0 / (2 * N);
  const seq: number[] = [];
  let v = 1;
  for (let n = 1; n < N; n++) { v = (v * g) % N; seq.push(v); }
  return { g, seq, depths: seq.map((s) => s * step), maxDepth: Math.max(...seq) * step, fMax: c / (2 * well), period: (N - 1) * well, step };
}

/** Ниже c/период периодический диффузор даёт только зеркальный лепесток решётки (падение по нормали). */
export const latticeFloor = (period: number, tempC = 20) => speedOfSound(tempC) / period;

export const ANGLES = Array.from({ length: 37 }, (_, i) => -90 + i * 5);

/**
 * Энергия, рассеянная в направления θ (градусы) при падении по нормали: |Σ e^{−2jk·d_n}·w·sinc(k·w·sinθ/2)·e^{jk·x_n·sinθ}|²
 * с множителем наклона (1 + cosθ)/2; ячейки — `periods` повторов последовательности.
 */
export function scattering(depths: readonly number[], well: number, periods: number, f: number, angles: readonly number[] = ANGLES, tempC = 20): number[] {
  const k = (2 * Math.PI * f) / speedOfSound(tempC);
  const cells = Array.from({ length: periods }, () => depths).flat();
  const x0 = ((cells.length - 1) * well) / 2;
  return angles.map((deg) => {
    const s = Math.sin((deg * Math.PI) / 180);
    const u = (k * well * s) / 2;
    const sinc = Math.abs(u) < 1e-9 ? 1 : Math.sin(u) / u;
    let re = 0, im = 0;
    cells.forEach((d, n) => {
      const ph = -2 * k * d + k * (n * well - x0) * s;
      re += Math.cos(ph);
      im += Math.sin(ph);
    });
    const a = well * sinc * (1 + Math.cos((deg * Math.PI) / 180)) / 2;
    return (re * re + im * im) * a * a;
  });
}

/** Коэффициент диффузии по AES-4id: d = ((ΣE)² − ΣE²)/((n − 1)·ΣE²); 1 — равномерно во все стороны. */
export function diffusion(e: readonly number[]): number {
  const s = e.reduce((a, v) => a + v, 0), s2 = e.reduce((a, v) => a + v * v, 0);
  return s2 > 0 ? (s * s - s2) / ((e.length - 1) * s2) : 0;
}

/** Нормированный коэффициент: (d − d_плоской)/(1 − d_плоской), не меньше нуля. */
export function normalizedDiffusion(depths: readonly number[], well: number, periods: number, f: number, tempC = 20): { d: number; flat: number; norm: number } {
  const d = diffusion(scattering(depths, well, periods, f, ANGLES, tempC));
  const flat = diffusion(scattering(depths.map(() => 0), well, periods, f, ANGLES, tempC));
  return { d, flat, norm: Math.max(0, (d - flat) / (1 - flat)) };
}
