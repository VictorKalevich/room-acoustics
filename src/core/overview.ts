// Обзор комнаты: оценка 0–100 с подоценками, время затухания мод и список проблем.
import type { Mode, ReverbResult, Room, Setup, SourceSpec } from './types';
import type { SetupEval } from './system';
import { modeDamping } from './response';
import { bonelloCheck, proportionsNotes } from './modes';

export interface ModeDecay { f: number; n: [number, number, number]; kind: Mode['kind']; t60: number; limit: number }

/** Рекомендованное время реверберации контрольной комнаты по EBU Tech 3276: Tm = 0,3·(V/100)^⅓. */
export function ebuTm(volume: number): number {
  return 0.3 * Math.cbrt(volume / 100);
}

/**
 * Верхняя граница допуска для времени затухания на частоте f (ориентир по EBU Tech 3276):
 * Tm + 0,05 с от 200 Гц и выше, плавно (по логарифму частоты) до Tm + 0,3 с на 63 Гц; ниже 63 Гц — как на 63 Гц.
 */
export function decayLimit(f: number, volume: number): number {
  const tm = ebuTm(volume);
  if (f >= 200) return tm + 0.05;
  if (f <= 63) return tm + 0.3;
  const t = Math.log(f / 63) / Math.log(200 / 63);
  return tm + 0.3 - 0.25 * t;
}

/** Время затухания каждой моды (T60 = 6,91/δ) ниже fMax. */
export function modeDecays(room: Room, modes: Mode[], rev: ReverbResult, fMax: number): ModeDecay[] {
  const scale = room.calibration?.dampingScale ?? 1;
  return modes
    .filter((m) => m.f > 0 && m.f <= fMax)
    .map((m) => {
      const delta = modeDamping(m, room, rev) * scale;
      return { f: m.f, n: m.n, kind: m.kind, t60: 6.91 / delta, limit: decayLimit(m.f, rev.volume) };
    });
}

export type Severity = 'high' | 'medium' | 'low';
export type ActionTarget = 'field' | 'tuning' | 'placement' | 'room';
export interface Problem {
  id: string;
  severity: Severity;
  title: string;
  detail: string;
  f?: number;
  actions: ActionTarget[];
}

export interface SubScore { id: 'bass' | 'decay' | 'symmetry' | 'reverb' | 'proportions'; value: number; weight: number; note: string }
export interface Overview { score: number; subs: SubScore[]; problems: Problem[]; decays: ModeDecay[] }

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const fmt1 = (v: number) => v.toFixed(1).replace('.', ',');

/** Пики и провалы АЧХ относительно цели (после вычитания медианы). */
export function responseExtremes(resp: SetupEval['response']): { peaks: { f: number; db: number }[]; dips: { f: number; db: number }[] } {
  const dev = resp.db.map((d, i) => d - resp.target[i]);
  const sorted = [...dev].sort((a, b) => a - b);
  const med = sorted[Math.floor(sorted.length / 2)] ?? 0;
  const e = dev.map((d) => d - med);
  const peaks: { f: number; db: number }[] = [];
  const dips: { f: number; db: number }[] = [];
  for (let i = 1; i < e.length - 1; i++) {
    if (e[i] >= e[i - 1] && e[i] > e[i + 1] && e[i] >= 5) peaks.push({ f: resp.f[i], db: e[i] });
    if (e[i] <= e[i - 1] && e[i] < e[i + 1] && e[i] <= -8) dips.push({ f: resp.f[i], db: e[i] });
  }
  peaks.sort((a, b) => b.db - a.db);
  dips.sort((a, b) => a.db - b.db);
  return { peaks: peaks.slice(0, 3), dips: dips.slice(0, 3) };
}

export function buildOverview(
  room: Room,
  sources: SourceSpec[],
  setup: Pick<Setup, 'listener' | 'positions'>,
  ev: SetupEval | null,
  modes: Mode[],
  rev: ReverbResult,
): Overview {
  const fHi = ev?.fHi ?? Math.min(300, Math.max(120, rev.schroeder));
  const decays = modeDecays(room, modes, rev, Math.min(fHi, 200));
  const problems: Problem[] = [];

  // 1. Ровность баса
  const s = ev?.score ?? NaN;
  const bass = Number.isFinite(s) ? clamp01((10 - s) / 8) : 0.5;
  if (ev) {
    const { peaks, dips } = responseExtremes(ev.response);
    for (const p of peaks) {
      problems.push({
        id: `peak-${p.f.toFixed(1)}`, severity: p.db >= 9 ? 'high' : 'medium', f: p.f,
        title: `Гул на ${fmt1(p.f)} Гц (+${fmt1(p.db)} дБ) в месте слушателя`,
        detail: 'Пик можно срезать эквалайзером или ослабить сменой места слушателя или сабвуфера.',
        actions: ['field', 'tuning', 'placement'],
      });
    }
    for (const d of dips) {
      problems.push({
        id: `dip-${d.f.toFixed(1)}`, severity: d.db <= -14 ? 'high' : 'medium', f: d.f,
        title: `Провал на ${fmt1(d.f)} Гц (${fmt1(d.db)} дБ) в месте слушателя`,
        detail: 'Провал эквалайзером не поднять: помогает другое место слушателя или сабвуфера, второй сабвуфер.',
        actions: ['field', 'placement'],
      });
    }
    for (const pen of ev.penalties) {
      problems.push({ id: `pen-${pen.name}`, severity: pen.value > 1.5 ? 'medium' : 'low', title: pen.name, detail: 'Правило расстановки колонок.', actions: ['placement'] });
    }
  }

  // 2. Затухание мод
  const strong = decays.filter((d) => d.kind !== 'oblique');
  const excess = strong.length ? strong.reduce((a, d) => a + Math.max(0, d.t60 - d.limit), 0) / strong.length : 0;
  const decay = clamp01(1 - excess / 0.4);
  const worst = [...strong].filter((d) => d.t60 > d.limit + 0.15).sort((a, b) => (b.t60 - b.limit) - (a.t60 - a.limit)).slice(0, 3);
  for (const d of worst) {
    problems.push({
      id: `decay-${d.f.toFixed(1)}`, severity: d.t60 > d.limit + 0.4 ? 'high' : 'medium', f: d.f,
      title: `Мода ${fmt1(d.f)} Гц (${d.n.join(' ')}) звучит ${fmt1(d.t60)} с`,
      detail: `Рекомендуется не больше ${fmt1(d.limit)} с. Помогают басовые ловушки в углах и у стен этой моды.`,
      actions: ['tuning', 'field'],
    });
  }

  // 3. Симметрия
  const spk = sources.filter((x) => x.kind === 'speaker' && setup.positions[x.id]).map((x) => setup.positions[x.id]);
  let asym = 0;
  if (spk.length === 2) {
    const [a, b] = spk[0].y < spk[1].y ? [spk[0], spk[1]] : [spk[1], spk[0]];
    asym = Math.max(Math.abs(a.y - (room.width - b.y)), Math.abs(a.x - b.x));
  }
  const lc = Math.abs(setup.listener.y - room.width / 2);
  const asymAll = Math.max(asym, lc);
  const symmetry = clamp01(1 - asymAll / 0.6);
  if (asymAll > 0.15) {
    problems.push({
      id: 'asym', severity: asymAll > 0.4 ? 'medium' : 'low',
      title: `Несимметричная расстановка (${fmt1(asymAll * 100)} см)`,
      detail: 'Колонки и слушатель смещены относительно боковых стен: стереообраз может «уплыть», бас в каналах будет разным.',
      actions: ['placement'],
    });
  }

  // 4. Реверберация
  const tm = ebuTm(rev.volume);
  const rtDev = Math.abs(rev.tMid - Math.max(0.25, tm));
  const reverb = clamp01(1 - rtDev / 0.4);
  if (rev.tMid > 0.6) problems.push({ id: 'rt-high', severity: rev.tMid > 0.8 ? 'high' : 'medium', title: `Гулкая комната: RT60 ≈ ${fmt1(rev.tMid)} с`, detail: 'Добавьте ковёр, шторы, мягкую мебель или панели на точки первых отражений.', actions: ['room', 'tuning'] });
  if (rev.tMid < 0.15) problems.push({ id: 'rt-low', severity: 'low', title: `Очень заглушённая комната: RT60 ≈ ${fmt1(rev.tMid)} с`, detail: 'Звук может казаться «ватным». Часть поглотителей можно заменить диффузорами.', actions: ['room'] });

  // 5. Пропорции
  const bon = bonelloCheck(modes, 200);
  const notes = proportionsNotes(room);
  const proportions = clamp01(1 - bon.violations.length * 0.2 - notes.length * 0.15);
  if (notes.length) problems.push({ id: 'prop', severity: 'low', title: 'Неудачные пропорции комнаты', detail: notes.join(' '), actions: ['room'] });

  const subs: SubScore[] = [
    { id: 'bass', value: Math.round(bass * 100), weight: 0.4, note: Number.isFinite(s) ? `неровность ${fmt1(s)} дБ` : 'нет оценки' },
    { id: 'decay', value: Math.round(decay * 100), weight: 0.2, note: worst.length ? `долгих мод: ${worst.length}` : 'в допуске' },
    { id: 'symmetry', value: Math.round(symmetry * 100), weight: 0.15, note: `смещение ${fmt1(asymAll * 100)} см` },
    { id: 'reverb', value: Math.round(reverb * 100), weight: 0.15, note: `RT60 ${fmt1(rev.tMid)} с` },
    { id: 'proportions', value: Math.round(proportions * 100), weight: 0.1, note: bon.ok && !notes.length ? 'хорошие' : 'есть замечания' },
  ];
  const score = Math.round(subs.reduce((a, x) => a + x.value * x.weight, 0));
  const order: Record<Severity, number> = { high: 0, medium: 1, low: 2 };
  problems.sort((a, b) => order[a.severity] - order[b.severity]);
  return { score, subs, problems, decays };
}
