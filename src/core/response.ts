import type { Complex, Leakage, Mode, ReverbResult, Room, Vec3 } from './types';

/** Частота «утечки» воздуха для нулевой моды, Гц (research R15). */
export const LEAK_HZ: Record<Leakage, number> = { sealed: 0, typical: 8, door: 25, open: 45 };
import { speedOfSound } from './physics';
import { computeReverb, surfaceAbsorptionAt } from './reverb';

/**
 * Затухание моды δ (1/с) по Куттруфу: δ = (c/8V)·(εx·Ax + εy·Ay + εz·Az)/2,
 * A_i — площадь поглощения пары стен, перпендикулярных оси i, на частоте моды;
 * ε_i = 2 при n_i > 0, иначе 1. Нормировка /2 даёт для косых мод значение Сэбина cA/(8V).
 */
export function modeDamping(mode: Pick<Mode, 'n' | 'f'>, room: Room, rev?: ReverbResult): number {
  const V = rev?.volume ?? room.depth * room.width * room.height;
  const c = speedOfSound(room.temperatureC);
  const a = surfaceAbsorptionAt(room, Math.max(mode.f, 20));
  const Ax = a.front + a.back;
  const Ay = a.left + a.right;
  const Az = a.floor + a.ceiling;
  const e = (n: number) => (n > 0 ? 2 : 1);
  return ((c / (8 * V)) * (e(mode.n[0]) * Ax + e(mode.n[1]) * Ay + e(mode.n[2]) * Az)) / 2;
}

export interface PreparedModes {
  count: number;
  /** Волновые числа по осям, рад/м (k = nπ/L). */
  kx: Float64Array;
  ky: Float64Array;
  kz: Float64Array;
  omega2: Float64Array;
  delta: Float64Array;
  /** 1/Λ — нормировка моды (Λ = Π(1 при n=0, ½ иначе)). */
  invLambda: Float64Array;
  freq: Float64Array;
}

/**
 * Готовит моды для модальной суммы, включая нулевую (0,0,0) — она описывает
 * «эффект герметичного объёма» на самых низких частотах.
 */
export function prepareModes(room: Room, fMax: number, rev?: ReverbResult): PreparedModes {
  const r = rev ?? computeReverb(room);
  const c = speedOfSound(room.temperatureC);
  const L = [room.depth, room.width, room.height];
  const nMax = L.map((l) => Math.floor((2 * fMax * l) / c));
  const list: { n: [number, number, number]; f: number }[] = [];
  for (let a = 0; a <= nMax[0]; a++)
    for (let b = 0; b <= nMax[1]; b++)
      for (let d = 0; d <= nMax[2]; d++) {
        const f = (c / 2) * Math.hypot(a / L[0], b / L[1], d / L[2]);
        if (f <= fMax) list.push({ n: [a, b, d], f });
      }
  const n = list.length;
  const pm: PreparedModes = {
    count: n,
    kx: new Float64Array(n),
    ky: new Float64Array(n),
    kz: new Float64Array(n),
    omega2: new Float64Array(n),
    delta: new Float64Array(n),
    invLambda: new Float64Array(n),
    freq: new Float64Array(n),
  };
  list.forEach((m, i) => {
    pm.kx[i] = (m.n[0] * Math.PI) / L[0];
    pm.ky[i] = (m.n[1] * Math.PI) / L[1];
    pm.kz[i] = (m.n[2] * Math.PI) / L[2];
    const w = 2 * Math.PI * m.f;
    pm.omega2[i] = w * w;
    const scale = room.calibration?.dampingScale ?? 1;
    let delta = modeDamping(m, room, r) * scale;
    if (i === 0) delta = Math.max(delta, Math.PI * LEAK_HZ[room.leakage ?? 'typical']);
    pm.delta[i] = delta;
    pm.invLambda[i] = (m.n[0] > 0 ? 2 : 1) * (m.n[1] > 0 ? 2 : 1) * (m.n[2] > 0 ? 2 : 1);
    pm.freq[i] = m.f;
  });
  return pm;
}

/** Значения собственных функций ψ_n(p) = cos(kx·x)·cos(ky·y)·cos(kz·z) для всех мод. */
export function modeShapes(pm: PreparedModes, p: Vec3): Float64Array {
  const out = new Float64Array(pm.count);
  for (let i = 0; i < pm.count; i++) {
    out[i] = Math.cos(pm.kx[i] * p.x) * Math.cos(pm.ky[i] * p.y) * Math.cos(pm.kz[i] * p.z);
  }
  return out;
}

/**
 * Ядро приёмника: K_n(f) = ψ_n(r)·(1/Λ_n) / (ω_n² − ω² + 2jδ_nω).
 * Звуковое давление от источника в p: H(f) = Σ_n ψ_n(p)·K_n(f). Источник — с постоянным
 * ускорением диафрагмы (плоская АЧХ в свободном поле), поэтому множитель jω не нужен.
 */
export interface Kernel {
  nF: number;
  nM: number;
  re: Float64Array;
  im: Float64Array;
}

export function receiverKernel(pm: PreparedModes, rcv: Vec3, freqs: number[]): Kernel {
  const psi = modeShapes(pm, rcv);
  const nF = freqs.length;
  const nM = pm.count;
  const re = new Float64Array(nM * nF);
  const im = new Float64Array(nM * nF);
  for (let m = 0; m < nM; m++) {
    const g = psi[m] * pm.invLambda[m];
    if (g === 0) continue;
    for (let j = 0; j < nF; j++) {
      const w = 2 * Math.PI * freqs[j];
      const dr = pm.omega2[m] - w * w;
      const di = 2 * pm.delta[m] * w;
      const d = dr * dr + di * di;
      re[m * nF + j] = (g * dr) / d;
      im[m * nF + j] = (-g * di) / d;
    }
  }
  return { nF, nM, re, im };
}

/** Применяет ядро к источнику с собственными функциями psiSrc. Результат: [re[], im[]]. */
export function applyKernel(k: Kernel, psiSrc: Float64Array): [Float64Array, Float64Array] {
  const re = new Float64Array(k.nF);
  const im = new Float64Array(k.nF);
  for (let m = 0; m < k.nM; m++) {
    const s = psiSrc[m];
    if (Math.abs(s) < 1e-12) continue;
    const base = m * k.nF;
    for (let j = 0; j < k.nF; j++) {
      re[j] += s * k.re[base + j];
      im[j] += s * k.im[base + j];
    }
  }
  return [re, im];
}

/** Передаточная функция источник → приёмник на заданных частотах (модальная сумма). */
export function transfer(pm: PreparedModes, src: Vec3, rcv: Vec3, freqs: number[]): Complex[] {
  const [re, im] = applyKernel(receiverKernel(pm, rcv, freqs), modeShapes(pm, src));
  return Array.from(re, (r, i) => ({ re: r, im: im[i] }));
}
