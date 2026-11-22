// Комплект итоговой физической проверки шумомера (058): npx vite-node scripts/make-noise-field-kit.ts
// Файлы детерминированы; повторный запуск даёт те же байты. Структуру сигнала читает scripts/check-noise-final.mjs.
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { wav16 } from '../src/core/dsp';
import { FIELD_SIGNAL, synthesizeFieldSignal } from './noise-field-signal';

const dir = 'public/field-check', fs = FIELD_SIGNAL.sampleRate;
const wav = Buffer.from(wav16(synthesizeFieldSignal(fs), fs));
const pcm = new Int16Array(wav.buffer, wav.byteOffset + 44, (wav.length - 44) / 2);
let peak = 0;
for (const v of pcm) peak = Math.max(peak, Math.abs(v));
// Запас до полной шкалы: при воспроизведении Windows может добавить усиление; клиппинг файла недопустим.
if (peak / 32767 > 0.89) throw new Error(`Пик ${peak / 32767} выше 0,89 полной шкалы.`);
const half = FIELD_SIGNAL.fadeSeconds / 2;
const segments = FIELD_SIGNAL.segments.map(s => {
  const n0 = Math.round((s.from + half) * fs), n1 = Math.round((s.to - half) * fs);
  let sum = 0;
  for (let n = n0; n < n1; n++) sum += (pcm[n] / 32767) ** 2;
  return { ...s, fileRmsDbfs: sum ? Number((10 * Math.log10(sum / (n1 - n0))).toFixed(2)) : null };
});
writeFileSync(`${dir}/${FIELD_SIGNAL.file}`, wav);
writeFileSync(`${dir}/noise-final-signal.json`, JSON.stringify({
  ...FIELD_SIGNAL, samples: pcm.length, peakDbfs: Number((20 * Math.log10(peak / 32767)).toFixed(2)),
  sha256: createHash('sha256').update(wav).digest('hex'), segments,
}, null, 2) + '\n');
console.log('Готово: %s/%s, %s байт, пик %s dBFS', dir, FIELD_SIGNAL.file, wav.length, (20 * Math.log10(peak / 32767)).toFixed(2));
