// Подсказки по акустической обработке (research R14).
import type { Mode, Room, Vec3 } from './types';
import { modeWhere } from './modes';

export type ReflectSurface = 'left' | 'right' | 'ceiling';

export interface Reflection {
  speakerId: string;
  surface: ReflectSurface;
  point: Vec3;
}

/** Точки первых отражений методом мнимого источника: отрезок колонка → зеркальный слушатель. */
export function reflectionPoints(room: Room, speakers: { id: string; pos: Vec3 }[], listener: Vec3): Reflection[] {
  const out: Reflection[] = [];
  const W = room.width;
  const H = room.height;
  for (const { id, pos: s } of speakers) {
    const cross = (img: Vec3, t: number): Vec3 => ({
      x: s.x + (img.x - s.x) * t,
      y: s.y + (img.y - s.y) * t,
      z: s.z + (img.z - s.z) * t,
    });
    // левая стена y = 0
    const li = { ...listener, y: -listener.y };
    out.push({ speakerId: id, surface: 'left', point: { ...cross(li, s.y / (s.y - li.y)), y: 0 } });
    // правая стена y = W
    const ri = { ...listener, y: 2 * W - listener.y };
    out.push({ speakerId: id, surface: 'right', point: { ...cross(ri, (W - s.y) / (ri.y - s.y)), y: W } });
    // потолок z = H
    const ci = { ...listener, z: 2 * H - listener.z };
    out.push({ speakerId: id, surface: 'ceiling', point: { ...cross(ci, (H - s.z) / (ci.z - s.z)), z: H } });
  }
  return out;
}

export interface BassAdvice {
  f: number;
  excessDb: number;
  modes: Mode[];
  where: string;
  text: string;
}

function median(a: number[]): number {
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const f1 = (v: number) => v.toFixed(1).replace('.', ',');

const AXIS = ['глубине (между передней и задней стенами)', 'ширине (между боковыми стенами)', 'высоте (между полом и потолком)'];
const WHERE_AXIAL = [
  'у передней и задней стен, лучше в углах этих стен',
  'у боковых стен, лучше в их углах',
  'на потолке и в стыках стен с потолком',
];

/** Пики АЧХ > +3 дБ, вызывающие их моды и где ставить басовые ловушки. */
export function bassAdvice(response: { f: number[]; db: number[]; target: number[] }, modes: Mode[], max = 4): BassAdvice[] {
  const dev = response.db.map((v, i) => v - response.target[i]);
  const ref = median(dev);
  const peaks: { i: number; d: number }[] = [];
  for (let i = 1; i < dev.length - 1; i++) {
    const d = dev[i] - ref;
    if (d > 3 && dev[i] >= dev[i - 1] && dev[i] >= dev[i + 1]) peaks.push({ i, d });
  }
  peaks.sort((a, b) => b.d - a.d);
  const out: BassAdvice[] = [];
  for (const { i, d } of peaks.slice(0, max)) {
    const f = response.f[i];
    const near = modes
      .filter((m) => Math.abs(m.f - f) / f <= 0.04)
      .sort((a, b) => (a.kind === 'axial' ? 0 : 1) - (b.kind === 'axial' ? 0 : 1) || Math.abs(a.f - f) - Math.abs(b.f - f));
    const m = near[0];
    let where = 'в вертикальных углах комнаты';
    let cause = 'Рядом нет отдельной моды — пик создаёт сложение нескольких мод и источников.';
    if (m) {
      const axes = m.n.map((v, k) => (v > 0 ? k : -1)).filter((k) => k >= 0);
      if (m.kind === 'axial') {
        where = WHERE_AXIAL[axes[0]];
        cause = `Осевая мода ${f1(m.f)} Гц${m.n[axes[0]] > 1 ? ` (${m.n[axes[0]]}-я)` : ''} по ${AXIS[axes[0]]}.`;
      } else if (m.kind === 'tangential') {
        where = axes.includes(2) ? 'в стыках стен с потолком и в углах' : 'в вертикальных углах комнаты';
        cause = `Тангенциальная мода ${f1(m.f)} Гц (${modeWhere(m.n)}).`;
      } else {
        where = 'в трёхгранных углах (стены с полом или потолком)';
        cause = `Косая мода ${f1(m.f)} Гц.`;
      }
    }
    out.push({
      f,
      excessDb: d,
      modes: near,
      where,
      text: `${cause} Мембранная или резонансная ловушка, настроенная примерно на ${Math.round(f)} Гц, ${where}.`,
    });
  }
  return out;
}

/** Нижняя частота эффективной работы пористой панели: ≈ c/(4·(толщина + зазор)). */
export function porousLowLimit(thicknessM: number, gapM: number, c = 343): number {
  return c / (4 * (thicknessM + gapM));
}
