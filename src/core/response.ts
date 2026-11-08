import type { Complex, Leakage, Mode, ReverbResult, Room, SurfaceId, Vec3 } from './types';
import { SURFACES } from './types';

/** Частота «утечки» воздуха для нулевой моды, Гц (research R15). */
export const LEAK_HZ: Record<Leakage, number> = { sealed: 0, typical: 8, door: 25, open: 45 };
import { speedOfSound } from './physics';
import { roomVolume } from './geometry';
import { computeReverb, surfaceAreas } from './reverb';
import { patchModeIntegral, patchWallAlpha, roomPatches, type Patch } from './patches';
import { FURNISHING, alphaAt, getMaterial } from './materials';
import { apertureBeta, betaFromAlpha } from './paris';

/**
 * «Площади поглощения» поверхностей для затухания мод, м²: 8·β·S отделки — β по табличному α (обращение
 * формулы Пари, как у границ волновой модели) — плюс обстановка линейно (её поглощение подобрано по замерам T60
 * жилых комнат через формулу Сэбина), долями по площадям. Без подстройки по замеру, окон, дверей и обработки.
 */
export function modalAbsorptionAt(room: Room, f: number): Record<SurfaceId, number> {
  const S = surfaceAreas(room);
  const total = SURFACES.reduce((s, k) => s + S[k], 0);
  const furn = alphaAt(FURNISHING[room.furnishing], f) * S.floor;
  const out = {} as Record<SurfaceId, number>;
  for (const k of SURFACES) out[k] = 8 * betaFromAlpha(alphaAt(getMaterial(room.materials[k]).alpha, f)) * S[k] + (furn * S[k]) / total;
  return out;
}

/**
 * Затухание моды δ (1/с) — теория возмущений для слабо поглощающих стен (Kuttruff, Room Acoustics, § 3.4):
 * δ_n = (c/2V)·Πε·∮ Re(β)·ψ_n² dS. Для равномерно поглощающих стен δ = (c/16V)·(εx·Bx + εy·By + εz·Bz),
 * B_i = 8·Σβ·S пары стен, перпендикулярных оси i; ε_i = 2 при n_i > 0, иначе 1; у косых мод — c·B/(8V).
 *
 * β — по табличному (диффузному) α через формулу Пари, как в волновой модели: при малых α это α/8 (формула
 * Сэбина), при α = 0,2 — на 23 % больше, при 0,3 — на 35 %. Так и должно быть: отдельная мода падает на стены
 * под своими углами, а в диффузное α входят и скользящие волны, которые поглощаются слабее (до версии 3 модели
 * здесь было α/8 при любом α, и волновая модель затухала на 15–30 % быстрее прямоугольной).
 * Обстановка — линейно, окна, двери и обработка — на своих участках через ∫ψ² dS (вклад зависит от того,
 * пучность моды там или узел), проёмы — проводимость проёма (0,15–0,6 на басу, см. apertureBeta).
 * Подстройка по замеру умножает всё, кроме проёмов.
 */
export function modeDamping(mode: Pick<Mode, 'n' | 'f'>, room: Room, rev?: ReverbResult, patches: Patch[] = roomPatches(room)): number {
  const V = rev?.volume ?? roomVolume(room);
  const c = speedOfSound(room.temperatureC);
  const f = Math.max(mode.f, 20);
  const scale = room.calibration?.dampingScale ?? 1;
  const a = modalAbsorptionAt(room, f);
  const e = (n: number) => (n > 0 ? 2 : 1);
  const ex = e(mode.n[0]), ey = e(mode.n[1]), ez = e(mode.n[2]);
  let sum = scale * (ex * (a.front + a.back) + ey * (a.left + a.right) + ez * (a.floor + a.ceiling));
  if (patches.length) {
    const kx = (mode.n[0] * Math.PI) / room.depth, ky = (mode.n[1] * Math.PI) / room.width, kz = (mode.n[2] * Math.PI) / room.height;
    const prod = ex * ey * ez;
    const S = surfaceAreas(room);
    const furnPerArea = (alphaAt(FURNISHING[room.furnishing], f) * S.floor) / SURFACES.reduce((s, k) => s + S[k], 0);
    for (const p of patches) {
      const aw = patchWallAlpha(room, p, f);
      const bw = betaFromAlpha(aw);
      let d: number;
      // проём: вместо стены с её долей обстановки — проводимость проёма (масса воздуха в нём, см. apertureBeta)
      if (!p.alpha) d = 8 * apertureBeta(p.area, f, c) - scale * (8 * bw + furnPerArea);
      else {
        const ap = alphaAt(p.alpha, f);
        d = scale * 8 * (betaFromAlpha(p.overlay ? aw + Math.max(0, ap - aw) : ap) - bw);
      }
      sum += prod * d * patchModeIntegral(p, kx, ky, kz);
    }
  }
  return Math.max(1e-3, (c / (16 * V)) * sum);
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
  const patches = roomPatches(room);
  list.forEach((m, i) => {
    pm.kx[i] = (m.n[0] * Math.PI) / L[0];
    pm.ky[i] = (m.n[1] * Math.PI) / L[1];
    pm.kz[i] = (m.n[2] * Math.PI) / L[2];
    const w = 2 * Math.PI * m.f;
    pm.omega2[i] = w * w;
    let delta = modeDamping(m, room, r, patches);
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
