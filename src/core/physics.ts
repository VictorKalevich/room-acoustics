/** Скорость звука в воздухе, м/с: c = 331,3·√(1 + t/273,15) (идеальный газ). */
export function speedOfSound(tempC: number): number {
  return 331.3 * Math.sqrt(1 + tempC / 273.15);
}

/** Плотность воздуха при 101,325 кПа, кг/м³. */
export function airDensity(tempC: number): number {
  return 101325 / (287.05 * (tempC + 273.15));
}
