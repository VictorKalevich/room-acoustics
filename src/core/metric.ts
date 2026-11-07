/**
 * Ровность АЧХ: СКО отклонения (дБ) уровня в комнате от целевой кривой после вычитания
 * среднего уровня (Welti & Devantier, JAES 2006). Отклонения ограничены ±25 дБ, чтобы
 * один глубокий провал не подавлял остальные различия.
 */
export function flatnessScore(roomDb: ArrayLike<number>, targetDb: ArrayLike<number>): number {
  const n = roomDb.length;
  if (n === 0) return 0;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += roomDb[i] - targetDb[i];
  mean /= n;
  let m2 = 0;
  let m1 = 0;
  for (let i = 0; i < n; i++) {
    const d = Math.max(-25, Math.min(25, roomDb[i] - targetDb[i] - mean));
    m1 += d;
    m2 += d * d;
  }
  m1 /= n;
  return Math.sqrt(Math.max(0, m2 / n - m1 * m1));
}
