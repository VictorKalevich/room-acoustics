// Очистка треугольников скана перед распознаванием: нечисловые координаты и далёкие выбросы.
// Без неё одна «улетевшая» вершина (1e6 м) растягивает габарит, гистограммы стен занимают гигабайты,
// а NaN превращает все размеры в NaN.

export interface CleanResult {
  triangles: Float32Array;
  /** Номера размеченных объектов по треугольникам (если были) — синхронно с triangles. */
  ids?: Uint16Array;
  /** Сколько треугольников выброшено: с NaN/бесконечностью и далёкие выбросы. */
  invalid: number;
  outliers: number;
}

/** Координаты по модулю больше этого — заведомо мусор (10 000 км в миллиметрах). */
const ABSURD = 1e10;
const SAMPLE = 50_000;

function quantile(sorted: Float64Array, q: number): number {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[i];
}

/**
 * Убирает треугольники с нечисловыми координатами и те, чей центр лежит дальше одного «надёжного» габарита
 * (между 1-м и 99-м процентилем центров) от основной массы. Коридор за аркой, мебель, ниша остаются:
 * они в пределах размера самой комнаты от её границ.
 */
export function cleanTriangles(t: Float32Array, ids?: Uint16Array): CleanResult {
  const n = Math.floor(t.length / 9);
  const valid = new Uint8Array(n);
  let invalid = 0;
  for (let i = 0; i < n; i++) {
    const o = i * 9;
    let ok = 1;
    for (let k = 0; k < 9; k++) {
      const v = t[o + k];
      if (!Number.isFinite(v) || Math.abs(v) > ABSURD) { ok = 0; break; }
    }
    valid[i] = ok;
    if (!ok) invalid++;
  }
  const good = n - invalid;
  // надёжные границы по выборке центров
  const lo = [0, 0, 0], hi = [0, 0, 0];
  if (good > 0) {
    const stride = Math.max(1, Math.floor(good / SAMPLE));
    const m = Math.ceil(good / stride);
    const axes = [new Float64Array(m), new Float64Array(m), new Float64Array(m)];
    let s = 0, seen = 0;
    for (let i = 0; i < n && s < m; i++) {
      if (!valid[i]) continue;
      if (seen++ % stride !== 0) continue;
      const o = i * 9;
      for (let k = 0; k < 3; k++) axes[k][s] = (t[o + k] + t[o + 3 + k] + t[o + 6 + k]) / 3;
      s++;
    }
    const ext = [0, 0, 0];
    for (let k = 0; k < 3; k++) {
      const a = axes[k].subarray(0, s).sort();
      lo[k] = quantile(a, 0.01);
      hi[k] = quantile(a, 0.99);
      ext[k] = hi[k] - lo[k];
    }
    // запас — габарит по этой оси, но не меньше десятой доли наибольшего (плоские сканы)
    const big = Math.max(...ext);
    for (let k = 0; k < 3; k++) {
      const pad = Math.max(ext[k], 0.1 * big);
      lo[k] -= pad;
      hi[k] += pad;
    }
  }
  const keep = new Uint8Array(n);
  let outliers = 0, kept = 0;
  for (let i = 0; i < n; i++) {
    if (!valid[i]) continue;
    const o = i * 9;
    let inside = true;
    for (let k = 0; k < 3; k++) {
      const c = (t[o + k] + t[o + 3 + k] + t[o + 6 + k]) / 3;
      if (c < lo[k] || c > hi[k]) { inside = false; break; }
    }
    if (inside) { keep[i] = 1; kept++; } else outliers++;
  }
  if (kept === n) return { triangles: t, ids, invalid: 0, outliers: 0 };
  const out = new Float32Array(kept * 9);
  const outIds = ids ? new Uint16Array(kept) : undefined;
  let j = 0;
  for (let i = 0; i < n; i++) {
    if (!keep[i]) continue;
    out.set(t.subarray(i * 9, i * 9 + 9), j * 9);
    if (outIds && ids) outIds[j] = ids[i];
    j++;
  }
  return { triangles: out, ids: outIds, invalid, outliers };
}
