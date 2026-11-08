// Частотно-зависимая граница волновой модели: нормированная проводимость поверхности
// β(s) = β∞ + Σ ветвей «последовательный RLC» (пассивные резонаторы), подобранная так, чтобы
// диффузное поглощение α(f) совпадало с табличным в полосе расчёта (Bilbao 2013; Bilbao & Hamilton 2017).

/** Ветвь проводимости: амплитуда g = 1/R, центр f0, добротность Q. Y(jω) = g / (1 + jQ(ω/ω0 − ω0/ω)). */
export interface Branch {
  g: number;
  f0: number;
  q: number;
}

export interface AdmittanceFit {
  /** Частотно-независимая часть (действительная). */
  binf: number;
  branches: Branch[];
  /** Наибольшее отклонение достигнутого α от целевого в полосе подбора. */
  maxErr: number;
}

// 24-точечная квадратура Гаусса — Лежандра на [0, π/2] для интеграла Пари
const GL = (() => {
  const n = 24;
  const x: number[] = [], w: number[] = [];
  for (let i = 1; i <= n; i++) {
    let z = Math.cos((Math.PI * (i - 0.25)) / (n + 0.5));
    let pp = 0;
    for (let it = 0; it < 100; it++) {
      let p1 = 1, p2 = 0;
      for (let j = 1; j <= n; j++) { const p3 = p2; p2 = p1; p1 = ((2 * j - 1) * z * p2 - (j - 1) * p3) / j; }
      pp = (n * (z * p1 - p2)) / (z * z - 1);
      const z1 = z;
      z = z1 - p1 / pp;
      if (Math.abs(z - z1) < 1e-15) break;
    }
    x.push(z); w.push(2 / ((1 - z * z) * pp * pp));
  }
  const th = x.map((v) => (Math.PI / 4) * (v + 1));
  return { cos: th.map(Math.cos), sin2: th.map((t) => Math.sin(2 * t)), w: w.map((v) => (Math.PI / 4) * v) };
})();

/**
 * Диффузное поглощение локально реагирующей поверхности с комплексной нормированной проводимостью β:
 * α = ∫ (1 − |R(θ)|²) sin 2θ dθ, R = (cos θ − β)/(cos θ + β). Для действительной β совпадает с формулой Пари.
 */
export function alphaStatC(re: number, im: number): number {
  let s = 0;
  for (let i = 0; i < GL.w.length; i++) {
    const c = GL.cos[i];
    const nr = c - re, dr = c + re;
    const r2 = (nr * nr + im * im) / (dr * dr + im * im);
    s += GL.w[i] * (1 - r2) * GL.sin2[i];
  }
  return s;
}

/** Проводимость подобранной модели на частоте f (ω для ветвей можно передать «предыскажённую»). */
export function admittanceAt(fit: Pick<AdmittanceFit, 'binf' | 'branches'>, f: number): [number, number] {
  let re = fit.binf, im = 0;
  for (const b of fit.branches) {
    const x = b.q * (f / b.f0 - b.f0 / f);
    const d = 1 + x * x;
    re += b.g / d;
    im -= (b.g * x) / d;
  }
  return [re, im];
}

const CENTERS = [16, 22.6, 32, 45.3, 64, 90.5, 128, 181, 256, 362];
const Q = 1.6;

/**
 * Неотрицательные наименьшие квадраты (Lawson–Hanson): точное решение min‖Ax − y‖ при x ≥ 0.
 * Размер мал (≤ 11 неизвестных), подзадачи решаются по нормальным уравнениям.
 */
export function nnls(A: number[][], y: number[]): number[] {
  const m = A[0].length;
  const G = Array.from({ length: m }, (_, i) => Array.from({ length: m }, (__, j) => A.reduce((s, r) => s + r[i] * r[j], 0)));
  const h = Array.from({ length: m }, (_, i) => A.reduce((s, r, k) => s + r[i] * y[k], 0));
  const x: number[] = Array.from({ length: m }, () => 0);
  const P: boolean[] = Array.from({ length: m }, () => false);
  const grad = () => h.map((hi, i) => hi - G[i].reduce((s, g, j) => s + g * x[j], 0));
  const solveP = (): number[] => {
    const idx = P.flatMap((p, i) => (p ? [i] : []));
    const n = idx.length;
    const M = idx.map((i) => [...idx.map((j) => G[i][j]), h[i]]);
    for (let c = 0; c < n; c++) {
      let piv = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
      [M[c], M[piv]] = [M[piv], M[c]];
      const d = M[c][c] || 1e-300;
      for (let r = 0; r < n; r++) {
        if (r === c) continue;
        const f = M[r][c] / d;
        for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
      }
    }
    const z: number[] = Array.from({ length: m }, () => 0);
    idx.forEach((i, r) => { z[i] = M[r][n] / (M[r][r] || 1e-300); });
    return z;
  };
  const tol = 1e-12 * Math.max(1, ...h.map(Math.abs));
  for (let outer = 0; outer < 3 * m; outer++) {
    const w = grad();
    let t = -1;
    for (let j = 0; j < m; j++) if (!P[j] && w[j] > tol && (t < 0 || w[j] > w[t])) t = j;
    if (t < 0) break;
    P[t] = true;
    for (let inner = 0; inner < 3 * m; inner++) {
      const z = solveP();
      if (P.every((p, i) => !p || z[i] > 0)) { for (let i = 0; i < m; i++) x[i] = z[i]; break; }
      let alpha = 1;
      for (let i = 0; i < m; i++) if (P[i] && z[i] <= 0) alpha = Math.min(alpha, x[i] / (x[i] - z[i]));
      for (let i = 0; i < m; i++) { x[i] += alpha * (z[i] - x[i]); if (P[i] && x[i] <= 1e-15) { P[i] = false; x[i] = 0; } }
    }
  }
  return x;
}

/** Допуск подбора: на сколько α модели может отличаться от табличного. */
const TOL = 0.003;

/**
 * Подбор β(s) под целевое диффузное поглощение alphaOf(f) в полосе [fLo, fHi].
 * betaOf — обращение формулы Пари (действительная β по α). Действительная часть подбирается методом
 * неотрицательных наименьших квадратов (все ветви пассивны), затем цель поправляется на мнимую часть,
 * которая немного снижает поглощение, — несколько итераций. Потом лишние ветви убираются по одной
 * (самая слабая), пока α держится в допуске: у почти «плоских» материалов (бетон, штукатурка) ветвей
 * не остаётся вовсе — счёт с ними не дороже, чем с постоянной β.
 * warp(f) — частота, на которой дискретная схема реально «видит» ветвь (билинейное предыскажение).
 */
export function fitAdmittance(alphaOf: (f: number) => number, betaOf: (alpha: number) => number, fLo = 20, fHi = 300, warp: (f: number) => number = (f) => f): AdmittanceFit {
  const n = 40;
  const fs = Array.from({ length: n }, (_, i) => fLo * Math.pow(fHi / fLo, i / (n - 1)));
  const target = fs.map((f) => Math.max(0, alphaOf(f)));
  if (target.every((a) => a < 1e-6)) return { binf: 0, branches: [], maxErr: 0 };
  const fw = fs.map(warp);
  const fitWith = (centers: number[]): AdmittanceFit => {
    const A = fw.map((f) => [1, ...centers.map((c) => { const x = Q * (f / c - c / f); return 1 / (1 + x * x); })]);
    let goal = target.map(betaOf);
    let best: AdmittanceFit = { binf: 0, branches: [], maxErr: Infinity };
    for (let it = 0; it < 6; it++) {
      const x = nnls(A, goal);
      const fit = { binf: x[0], branches: centers.map((c, j) => ({ g: x[j + 1], f0: c, q: Q })).filter((b) => b.g > 0) };
      const got = fw.map((f) => { const [re, im] = admittanceAt(fit, f); return alphaStatC(re, im); });
      const maxErr = Math.max(...got.map((a, i) => Math.abs(a - target[i])));
      if (maxErr < best.maxErr) best = { ...fit, maxErr };
      // поправка цели: где поглощения не хватает — просим больше, где лишнее — меньше
      goal = goal.map((b, i) => b * Math.min(2, Math.max(0.5, (target[i] + 1e-4) / (got[i] + 1e-4))));
    }
    return best;
  };
  let best = fitWith(CENTERS);
  const fullErr = best.maxErr;
  // допуск: 0,003 по α плюс 6 % от самого α (ошибка затухания мод — в пределах нескольких процентов)
  const ok = (fit: AdmittanceFit) => {
    const got = fw.map((f) => { const [re, im] = admittanceAt(fit, f); return alphaStatC(re, im); });
    return got.every((a, i) => Math.abs(a - target[i]) <= Math.max(TOL + 0.06 * target[i], 1.2 * fullErr));
  };
  // убираем ветви по одной (сначала слабые), пока точность в допуске
  for (let changed = true; changed && best.branches.length;) {
    changed = false;
    for (const drop of [...best.branches].sort((a, b) => a.g - b.g)) {
      const trial = fitWith(best.branches.filter((b) => b !== drop).map((b) => b.f0));
      if (ok(trial)) { best = trial; changed = true; break; }
    }
  }
  return best;
}

/**
 * Коэффициенты дискретной ветви для схемы с шагом k: обновление «через шаг» (трапеция на 2k),
 * связанное с давлением неявно — схема остаётся пассивной (устойчивой) при любых R, L, C > 0.
 *   a·w⁺ + b·w⁻ + ψ⁻/C = (p⁺ + p⁻)/2,  ψ⁺ = ψ⁻ + k(w⁺ + w⁻)
 */
export function branchCoeffs(b: Branch, k: number, count = 1): { a: number; b: number; iC: number } {
  // count одинаковых граней параллельно = одна ветвь с проводимостью ×count
  const R = 1 / (b.g * count);
  const w0 = 2 * Math.PI * b.f0;
  const L = (b.q * R) / w0;
  const C = 1 / (w0 * w0 * L);
  return { a: L / (2 * k) + R / 2 + k / (2 * C), b: -L / (2 * k) + R / 2 + k / (2 * C), iC: 1 / C };
}
