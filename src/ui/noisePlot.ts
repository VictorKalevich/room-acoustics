/** Отбор одного максимума на колонку логарифмической оси сохраняет узкие
 * пики. Сглаживаем только ординату графика, в линейных единицах PSD. */
export function noisePlot(density: Float64Array, step: number, upper: number, octaveDivisor: number) {
  const f: number[] = [], db: number[] = [];
  const first = Math.ceil(20 / step);
  const last = Math.min(density.length - 1, Math.floor(upper / step));
  const scale = 480 / Math.log(upper / 20);
  const ratio = octaveDivisor ? 2 ** (0.5 / octaveDivisor) : 1;
  let peak = first;
  for (let k = first; k <= last;) {
    const column = Math.floor(scale * Math.log(k * step / 20));
    let best = k++;
    while (k <= last && Math.floor(scale * Math.log(k * step / 20)) === column) {
      if (density[k] > density[best]) best = k;
      k++;
    }
    if (density[best] > density[peak]) peak = best;
    let value = density[best];
    if (octaveDivisor) {
      const lo = Math.ceil(best / ratio), hi = Math.min(density.length - 1, Math.floor(best * ratio));
      let sum = 0;
      for (let j = lo; j <= hi; j++) sum += density[j];
      value = sum / (hi - lo + 1);
    }
    f.push(best * step);
    db.push(10 * Math.log10(Math.max(1e-30, value)));
  }
  return { f, db, peakHz: density[peak] > 0 ? peak * step : null };
}
