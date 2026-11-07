import type { ReverbResult, Room, SurfaceId } from './types';
import { SURFACES } from './types';
import { FURNISHING, OCTAVES, alphaAt, getMaterial } from './materials';
import { absorbingOpenings, openingArea } from './geometry';

/** Площади поверхностей комнаты, м². */
export function surfaceAreas(room: Room): Record<SurfaceId, number> {
  const { depth: x, width: y, height: z } = room;
  return { floor: x * y, ceiling: x * y, front: y * z, back: y * z, left: x * z, right: x * z };
}

/**
 * Коэффициент поглощения воздуха m (1/м) при 20 °C и 50 % влажности по октавам
 * (ISO 9613-1; ≈ α[дБ/км]/4343). Учитывается только на 1–4 кГц.
 */
const AIR_M = [0, 0, 0, 0, 0.00108, 0.00223, 0.0076];

/**
 * Эквивалентная площадь поглощения каждой поверхности на частоте f, м².
 * Поглощение мебели распределяется пропорционально площадям поверхностей.
 */
export function surfaceAbsorptionAt(room: Room, f: number): Record<SurfaceId, number> {
  const S = surfaceAreas(room);
  const total = SURFACES.reduce((s, k) => s + S[k], 0);
  const furn = alphaAt(FURNISHING[room.furnishing], f) * S.floor;
  const out = {} as Record<SurfaceId, number>;
  for (const k of SURFACES) {
    out[k] = alphaAt(getMaterial(room.materials[k]).alpha, f) * S[k] + (furn * S[k]) / total;
  }
  // Проёмы поглощают полностью: добавляем (1 − α стены) × площадь проёма
  for (const o of absorbingOpenings(room)) {
    const a = openingArea(room, o);
    const alpha = alphaAt(getMaterial(room.materials[o.wall]).alpha, f);
    out[o.wall] += a * (1 - alpha);
  }
  return out;
}

/** Частота Шрёдера f_S = 2000·√(T/V) (Schroeder, 1962). */
export function schroederFrequency(tMid: number, volume: number): number {
  return 2000 * Math.sqrt(tMid / volume);
}

/**
 * Время реверберации по октавам: Сэбин T = 0,161V/(A + 4mV),
 * Эйринг T = 0,161V/(−S·ln(1 − ᾱ) + 4mV). Основная формула — Эйринг при ᾱ > 0,2.
 */
export function computeReverb(room: Room): ReverbResult {
  const V = room.depth * room.width * room.height;
  const S = Object.values(surfaceAreas(room)).reduce((a, b) => a + b, 0);
  const sabine: number[] = [];
  const eyring: number[] = [];
  const used: number[] = [];
  const formula: ('sabine' | 'eyring')[] = [];
  const meanAlpha: number[] = [];
  const absorptionArea: number[] = [];
  OCTAVES.forEach((f, i) => {
    const A = Object.values(surfaceAbsorptionAt(room, f)).reduce((a, b) => a + b, 0);
    const air = 4 * AIR_M[i] * V;
    const a = Math.min(A / S, 0.99);
    const ts = (0.161 * V) / (A + air);
    const te = (0.161 * V) / (-S * Math.log(1 - a) + air);
    sabine.push(ts);
    eyring.push(te);
    meanAlpha.push(A / S);
    absorptionArea.push(A);
    const useEyring = a > 0.2;
    formula.push(useEyring ? 'eyring' : 'sabine');
    used.push(useEyring ? te : ts);
  });
  const tMid = (used[OCTAVES.indexOf(500)] + used[OCTAVES.indexOf(1000)]) / 2;
  return {
    bands: [...OCTAVES],
    sabine,
    eyring,
    used,
    formula,
    meanAlpha,
    absorptionArea,
    tMid,
    schroeder: schroederFrequency(tMid, V),
    volume: V,
    surfaceArea: S,
  };
}

/** Эквивалентная площадь поглощения (без воздуха) на частоте f — интерполяция по октавам. */
export function absorptionAreaAt(rev: ReverbResult, f: number): number {
  return alphaAt(rev.absorptionArea, f);
}

/** Время реверберации на частоте f (интерполяция по октавам). */
export function rt60At(rev: ReverbResult, f: number): number {
  return alphaAt(rev.used, f);
}
