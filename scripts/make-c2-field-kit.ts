// Комплект физической проверки C2 (054): npx vite-node scripts/make-c2-field-kit.ts
// Файлы детерминированы; повторный запуск даёт те же байты.
import { writeFileSync } from 'node:fs';
import { logSweep, wav16 } from '../src/core/dsp';

const dir = 'public/field-check';
writeFileSync(`${dir}/c2-correction.txt`, [
  '# SYNTHETIC C2 TEST ONLY - not a microphone calibration',
  '# Select correction. Columns: frequency (Hz), correction (dB)',
  '15 6', '50 6', '70 0', '120 0', '180 -6', '500 -6', '',
].join('\n'));

// Три одновременных тона на плато поправки: 40 Гц (+6), 90 Гц (0), 220 Гц (−6). 30 с, края 50 мс.
const rate = 24000, seconds = 30, fade = 0.05 * rate;
const tones = Float32Array.from({ length: rate * seconds }, (_, i) => {
  const edge = Math.min(1, i / fade, (rate * seconds - 1 - i) / fade);
  return edge * [40, 90, 220].reduce((sum, f) => sum + 0.25 * Math.sin(2 * Math.PI * f * i / rate), 0);
});
writeFileSync(`${dir}/c2-bass-tones.wav`, Buffer.from(wav16(tones, rate)));

// 058: вариант для динамиков со слабым басом ниже 50–60 Гц — те же три знака поправки выше: +6 до 90 Гц, 0 в 115–170 Гц, −6 от 200 Гц.
writeFileSync(`${dir}/c2-midbass-correction.txt`, [
  '# SYNTHETIC C2 TEST ONLY - not a microphone calibration (limited-bass variant)',
  '# Select correction. Columns: frequency (Hz), correction (dB)',
  '15 6', '90 6', '115 0', '170 0', '200 -6', '500 -6', '',
].join('\n'));
const midbass = Float32Array.from({ length: rate * seconds }, (_, i) => {
  const edge = Math.min(1, i / fade, (rate * seconds - 1 - i) / fade);
  return edge * [65, 140, 235].reduce((sum, f) => sum + 0.25 * Math.sin(2 * Math.PI * f * i / rate), 0);
});
writeFileSync(`${dir}/c2-midbass-tones.wav`, Buffer.from(wav16(midbass, rate)));

// Тот же сигнал, что «Скачать сигнал (WAV, 6 с)» в «Свипе».
writeFileSync(`${dir}/c2-sweep-10-1000Hz-6s.wav`, Buffer.from(wav16(logSweep(10, 1000, 6, 48000), 48000)));
console.log('Готово:', dir);
