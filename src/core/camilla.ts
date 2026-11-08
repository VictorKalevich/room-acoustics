// Экспорт настроек для CamillaDSP 3: микшер стерео → колонки и сабвуферы, эквалайзер комнаты,
// задержка, уровень, полярность и свои фильтры каждого сабвуфера, по желанию — раздел частот LR4.
// Синтаксис — по документации CamillaDSP 3.0 (pipeline: Filter с channels-списком).
import type { SourceSpec, SubSetting } from './types';
import type { PeqFilter } from './eq';

export interface CamillaOptions {
  sources: SourceSpec[];
  /** Эквалайзер комнаты — на все выходы (как общий фильтр в Equalizer APO). */
  eq: PeqFilter[];
  subSettings: Record<string, SubSetting>;
  crossoverHz?: number | null;
  /** Раздел частот делает CamillaDSP: ФНЧ LR4 на сабвуферы, ФВЧ LR4 на колонки. */
  withCrossover?: boolean;
}

const num = (v: number, d: number) => {
  const s = v.toFixed(d);
  return s === `-${(0).toFixed(d)}` ? (0).toFixed(d) : s;
};

const NAME: Record<string, string> = { spkL: 'левая колонка', spkR: 'правая колонка', spkC: 'колонка' };

/** Порядок выходных каналов: колонки (левая, правая, центральная), затем сабвуферы. */
export function camillaChannels(sources: SourceSpec[]): { id: string; label: string; isSub: boolean }[] {
  const order = (id: string) => (id === 'spkL' ? 0 : id === 'spkR' ? 1 : id === 'spkC' ? 2 : 3);
  const mains = sources.filter((s) => s.kind !== 'sub').sort((a, b) => order(a.id) - order(b.id));
  const subs = sources.filter((s) => s.kind === 'sub');
  return [
    ...mains.map((s) => ({ id: s.id, label: NAME[s.id] ?? s.id, isSub: false })),
    ...subs.map((s, i) => ({ id: s.id, label: `сабвуфер ${subs.length > 1 ? i + 1 : ''}`.trim(), isSub: true })),
  ];
}

export function exportCamillaDSP(o: CamillaOptions): string {
  const ch = camillaChannels(o.sources);
  const out = ch.length;
  const subs = ch.map((c, i) => ({ ...c, i })).filter((c) => c.isSub);
  const mains = ch.map((c, i) => ({ ...c, i })).filter((c) => !c.isSub);
  const xo = o.withCrossover && o.crossoverHz ? o.crossoverHz : null;
  const L: string[] = [];
  const notes: string[] = [];

  L.push('# Акустика комнаты — фильтры для CamillaDSP 3');
  L.push('# Вставьте разделы mixers, filters и pipeline в свой конфиг; раздел devices — ваш,');
  L.push(`# вход — стерео (2 канала), выход — ${out} ${out === 1 ? 'канал' : out < 5 ? 'канала' : 'каналов'}.`);
  L.push(`# Выходы: ${ch.map((c, i) => `${i} — ${c.label}`).join(', ')}.`);

  // микшер нужен, если есть сабвуферы или колонки не ровно «левая + правая»
  const plainStereo = out === 2 && ch[0].id === 'spkL' && ch[1].id === 'spkR';
  const mixer = `room_acoustics_2to${out}`;
  if (!plainStereo) {
    L.push('', 'mixers:', `  ${mixer}:`, '    channels:', '      in: 2', `      out: ${out}`, '    mapping:');
    for (const c of ch.map((x, i) => ({ ...x, i }))) {
      L.push(`      - dest: ${c.i}`, '        sources:');
      // левая/правая — свой канал; сабвуфер и одиночная колонка — сумма L+R по −6 дБ (моно без подъёма уровня)
      const src = c.id === 'spkL' ? [[0, 0]] : c.id === 'spkR' ? [[1, 0]] : [[0, -6], [1, -6]];
      for (const [chan, g] of src) L.push(`          - channel: ${chan}`, `            gain: ${g}`, '            inverted: false', '            scale: dB');
    }
  }

  const f: string[] = [];
  const eqNames = o.eq.map((p, i) => {
    const n = `room_eq_${i + 1}`;
    f.push(`  ${n}:`, '    type: Biquad', '    parameters:', '      type: Peaking', `      freq: ${num(p.f, 1)}`, `      gain: ${num(p.gainDb, 1)}`, `      q: ${num(p.q, 2)}`);
    return n;
  });
  if (xo) {
    f.push('  xo_lowpass:', '    type: BiquadCombo', '    parameters:', '      type: LinkwitzRileyLowpass', `      freq: ${num(xo, 0)}`, '      order: 4');
    f.push('  xo_highpass:', '    type: BiquadCombo', '    parameters:', '      type: LinkwitzRileyHighpass', `      freq: ${num(xo, 0)}`, '      order: 4');
  }
  const subNames = new Map<number, string[]>();
  subs.forEach((s, k) => {
    const set = o.subSettings[s.id];
    const pre = `sub${subs.length > 1 ? k + 1 : ''}`;
    const names: string[] = [];
    if (set && set.delayMs > 0.01) {
      f.push(`  ${pre}_delay:`, '    type: Delay', '    parameters:', `      delay: ${num(set.delayMs, 2)}`, '      unit: ms', '      subsample: true');
      names.push(`${pre}_delay`);
    }
    const ph = set ? ((Math.round(set.phaseDeg) % 360) + 360) % 360 : 0;
    const invert = ph === 180;
    if (set && (Math.abs(set.gainDb) > 0.01 || invert)) {
      f.push(`  ${pre}_gain:`, '    type: Gain', '    parameters:', `      gain: ${num(set.gainDb, 1)}`, `      inverted: ${invert}`, '      scale: dB');
      names.push(`${pre}_gain`);
    }
    if (invert) notes.push(`${s.label}: полярность переворачивает CamillaDSP — переключатель фазы на сабвуфере оставьте на 0°.`);
    else if (ph !== 0) notes.push(`${s.label}: фаза ${ph}° — ручкой на сабвуфере (постоянный сдвиг фазы CamillaDSP не делает).`);
    (set?.peq ?? []).forEach((p, i) => {
      f.push(`  ${pre}_peq_${i + 1}:`, '    type: Biquad', '    parameters:', '      type: Peaking', `      freq: ${num(p.f, 1)}`, `      gain: ${num(p.gainDb, 1)}`, `      q: ${num(p.q, 2)}`);
      names.push(`${pre}_peq_${i + 1}`);
    });
    (set?.allpass ?? []).forEach((p, i) => {
      f.push(`  ${pre}_ap_${i + 1}:`, '    type: Biquad', '    parameters:', '      type: Allpass', `      freq: ${num(p.f, 1)}`, `      q: ${num(p.q, 2)}`);
      names.push(`${pre}_ap_${i + 1}`);
    });
    subNames.set(s.i, names);
  });
  if (xo && subs.length) notes.push(`Раздел частот ${num(xo, 0)} Гц (LR4) делает CamillaDSP — встроенный фильтр сабвуфера выключите (режим LFE/Bypass), а колонки оставьте полнодиапазонными.`);
  if (notes.length) L.splice(4, 0, ...notes.map((n) => `# ${n}`));
  if (f.length) L.push('', 'filters:', ...f);

  const p: string[] = [];
  if (!plainStereo) p.push('  - type: Mixer', `    name: ${mixer}`);
  if (eqNames.length) p.push('  - type: Filter', `    description: "Эквалайзер комнаты"`, `    channels: [${ch.map((_, i) => i).join(', ')}]`, '    names:', ...eqNames.map((n) => `      - ${n}`));
  if (xo && subs.length) {
    p.push('  - type: Filter', `    description: "ФНЧ сабвуферов"`, `    channels: [${subs.map((s) => s.i).join(', ')}]`, '    names:', '      - xo_lowpass');
    if (mains.length) p.push('  - type: Filter', `    description: "ФВЧ колонок"`, `    channels: [${mains.map((s) => s.i).join(', ')}]`, '    names:', '      - xo_highpass');
  }
  for (const s of subs) {
    const names = subNames.get(s.i) ?? [];
    if (names.length) p.push('  - type: Filter', `    description: "${s.label[0].toUpperCase()}${s.label.slice(1)}"`, `    channels: [${s.i}]`, '    names:', ...names.map((n) => `      - ${n}`));
  }
  if (p.length) L.push('', 'pipeline:', ...p);
  else L.push('', '# Фильтров нет: эквалайзер не рассчитан, у сабвуферов настройки по нулям.');
  return L.join('\n') + '\n';
}
