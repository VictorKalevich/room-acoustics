// Связь табличного (диффузного) поглощения α с проводимостью поверхности β — общая для волновой
// и прямоугольной моделей: обе считают затухание мод через β (Kuttruff, Room Acoustics, § 2.5, § 3.4).

/**
 * Статистическое (диффузное) поглощение локально реагирующей поверхности с действительной нормированной
 * проводимостью β = 1/ζ (формула Пари): α = (8/ζ)·[1 + 1/(1+ζ) − (2/ζ)·ln(1+ζ)].
 * При малом β: α ≈ 8β. Максимум 0,951 при ζ ≈ 1,567.
 */
export function alphaStat(beta: number): number {
  if (beta <= 0) return 0;
  const z = 1 / beta;
  return (8 / z) * (1 + 1 / (1 + z) - (2 / z) * Math.log(1 + z));
}

const ZETA_OPT = 1.5675;
const BETA_TOP = 1 / ZETA_OPT;
const ALPHA_MAX = alphaStat(BETA_TOP);

/** dα/dβ формулы Пари (для метода Ньютона). */
function alphaStatDeriv(b: number): number {
  const L = Math.log(1 + 1 / b);
  const u = 1 + b / (1 + b) - 2 * b * L;
  const du = 1 / ((1 + b) * (1 + b)) - 2 * L + 2 / (1 + b);
  return 8 * u + 8 * b * du;
}

/**
 * β по табличному α (коэффициенты в таблицах — диффузные, измеренные в реверберационной камере):
 * обращение формулы Пари на ветви ζ ≥ ζ_opt. Корень всегда между α/8 (α(β) < 8β) и β вершины;
 * метод Ньютона с откатом к делению пополам — 4–8 шагов.
 */
export function betaFromAlpha(alpha: number): number {
  if (!(alpha > 0)) return 0;
  if (alpha >= ALPHA_MAX) return BETA_TOP;
  let lo = alpha / 8, hi = BETA_TOP;
  let b = lo * (1 + 2 * lo * Math.log(1 + 1 / lo)); // поправка второго порядка — уже близко к корню
  if (!(b > lo && b < hi)) b = (lo + hi) / 2;
  for (let i = 0; i < 60; i++) {
    const g = alphaStat(b) - alpha;
    if (Math.abs(g) < 1e-13) break;
    if (g > 0) hi = b; else lo = b;
    let next = b - g / alphaStatDeriv(b);
    if (!(next > lo && next < hi)) next = (lo + hi) / 2;
    if (Math.abs(next - b) < 1e-15 * b) { b = next; break; }
    b = next;
  }
  return b;
}

/**
 * Открытый конец смежного помещения (коридор уходит в большой объём): согласованная граница ρc, β = 1 —
 * волна уходит без отражения. Это верхняя оценка: у открытого конца трубы на низах заметная часть звука
 * отражается обратно (с переворотом фазы), а такую границу действительной β не описать.
 */
export const BETA_OPEN = 1;

function besselJ1(x: number): number {
  let term = x / 2, s = term;
  for (let m = 1; m < 40; m++) { term *= -(x * x) / (4 * m * (m + 1)); s += term; if (Math.abs(term) < 1e-16 * Math.abs(s)) break; }
  return s;
}

function struveH1(x: number): number {
  // H₁(x) = Σ (−1)^m (x/2)^(2m+2) / (Γ(m+3/2)·Γ(m+5/2)); Γ(3/2)Γ(5/2) = 3π/8
  let term = (x * x) / 4 / ((3 * Math.PI) / 8), s = term;
  for (let m = 1; m < 40; m++) { term *= -(x * x) / (4 * (m + 0.5) * (m + 1.5)); s += term; if (Math.abs(term) < 1e-16 * Math.abs(s)) break; }
  return s;
}

/** Толщина стены у проёма для присоединённой массы, м. */
const WALL_DEPTH = 0.15;

/**
 * Активная проводимость проёма в стене комнаты (дверной проём, арка в неучтённое помещение) площадью area
 * на частоте f. Поток через проём ограничен массой воздуха в нём: снаружи — излучение поршня в экране
 * (R = 1 − J₁(2ka)/ka, X = H₁(2ka)/ka), пересчитанное через короткий канал толщиной в стену, изнутри —
 * присоединённая масса (та же X); β = Re(1/Z). На басу это R/(R² + (2X + kl)²).
 * Для проёма 0,9 × 2 м: 0,15 на 30–60 Гц, 0,19 на 80 Гц, 0,37 на 160 Гц; у арки 1,5 × 2,2 м — 0,16…0,62;
 * на высоких частотах — около 1 (звук просто уходит). В «единицах α» малых поглощений на басу это
 * 8β ≈ 1,2–1,6 — близко к прежнему «проём поглощает полностью» (α = 1) в прямоугольной модели;
 * граница ρc (β = 1), как было у проёмов в волновой модели, давала на басу в 5–7 раз больше.
 */
export function apertureBeta(area: number, f: number, c = 343): number {
  const a = Math.sqrt(Math.max(area, 1e-4) / Math.PI);
  const k = (2 * Math.PI * Math.max(f, 1)) / c;
  const x = k * a;
  let R: number, Xo: number;
  if (x < 6) { R = 1 - besselJ1(2 * x) / x; Xo = struveH1(2 * x) / x; } else { R = 1; Xo = 2 / (Math.PI * x); }
  // канал длиной l: Z_вх = (Z + j·t)/(1 + j·Z·t), t = tg(kl); плюс присоединённая масса изнутри
  const t = Math.tan(k * WALL_DEPTH);
  const nRe = R, nIm = Xo + t;
  const dRe = 1 - Xo * t, dIm = R * t;
  const dd = dRe * dRe + dIm * dIm;
  const zRe = (nRe * dRe + nIm * dIm) / dd;
  const zIm = (nIm * dRe - nRe * dIm) / dd + Xo;
  return zRe / (zRe * zRe + zIm * zIm);
}
