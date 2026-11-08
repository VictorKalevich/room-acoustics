import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { camillaChannels, exportCamillaDSP } from '../../src/core/camilla';
import type { SourceSpec } from '../../src/core/types';

const spk = (id: string): SourceSpec => ({ id, kind: 'speaker', fLow: 45, fHigh: 20000, height: 1.1 });
const sub = (id: string): SourceSpec => ({ id, kind: 'sub', fLow: 25, fHigh: 150, height: 0.3, delayMode: 'none', phaseMode: 'polarity' });
const eq = [{ f: 42.04, gainDb: -6.04, q: 4.2 }, { f: 87.5, gainDb: -3, q: 6.123 }];

describe('экспорт в CamillaDSP', () => {
  it('2.1: микшер стерео → 3 канала, сабвуфер — сумма L+R по −6 дБ, эквалайзер на все выходы', () => {
    const y = exportCamillaDSP({ sources: [sub('sub1'), spk('spkR'), spk('spkL')], eq, subSettings: { sub1: { delayMs: 3.25, phaseDeg: 180, gainDb: -2 } } });
    const c = parse(y);
    const mx = c.mixers.room_acoustics_2to3;
    expect(mx.channels).toEqual({ in: 2, out: 3 });
    expect(mx.mapping[0].sources).toEqual([{ channel: 0, gain: 0, inverted: false, scale: 'dB' }]);
    expect(mx.mapping[1].sources[0].channel).toBe(1);
    expect(mx.mapping[2].sources.map((s: { channel: number; gain: number }) => [s.channel, s.gain])).toEqual([[0, -6], [1, -6]]);
    expect(c.filters.room_eq_1).toEqual({ type: 'Biquad', parameters: { type: 'Peaking', freq: 42, gain: -6, q: 4.2 } });
    expect(c.filters.room_eq_2.parameters.q).toBe(6.12);
    expect(c.filters.sub_delay.parameters).toEqual({ delay: 3.25, unit: 'ms', subsample: true });
    expect(c.filters.sub_gain.parameters).toEqual({ gain: -2, inverted: true, scale: 'dB' });
    expect(c.pipeline[0]).toEqual({ type: 'Mixer', name: 'room_acoustics_2to3' });
    expect(c.pipeline[1].channels).toEqual([0, 1, 2]);
    expect(c.pipeline[1].names).toEqual(['room_eq_1', 'room_eq_2']);
    expect(c.pipeline[2]).toMatchObject({ type: 'Filter', channels: [2], names: ['sub_delay', 'sub_gain'] });
    expect(y).toContain('# Выходы: 0 — левая колонка, 1 — правая колонка, 2 — сабвуфер.');
    expect(y).toContain('переключатель фазы на сабвуфере оставьте на 0°');
  });

  it('свои фильтры сабвуферов, два сабвуфера, раздел частот LR4', () => {
    const y = exportCamillaDSP({
      sources: [spk('spkL'), spk('spkR'), sub('sub1'), sub('sub2')], eq: [], crossoverHz: 80, withCrossover: true,
      subSettings: {
        sub1: { delayMs: 0, phaseDeg: 0, gainDb: 0, peq: [{ f: 55, gainDb: -4, q: 5 }], allpass: [{ f: 70, q: 0.9 }] },
        sub2: { delayMs: 1.5, phaseDeg: 90, gainDb: 0 },
      },
    });
    const c = parse(y);
    expect(c.mixers.room_acoustics_2to4.channels.out).toBe(4);
    expect(c.filters.xo_lowpass.parameters).toEqual({ type: 'LinkwitzRileyLowpass', freq: 80, order: 4 });
    expect(c.filters.sub1_ap_1.parameters).toEqual({ type: 'Allpass', freq: 70, q: 0.9 });
    expect(c.filters.sub2_delay.parameters.delay).toBe(1.5);
    expect(c.filters.sub2_gain).toBeUndefined();
    const steps = c.pipeline.map((p: { channels?: number[]; names?: string[] }) => [p.channels, p.names]);
    expect(steps).toContainEqual([[2, 3], ['xo_lowpass']]);
    expect(steps).toContainEqual([[0, 1], ['xo_highpass']]);
    expect(steps).toContainEqual([[2], ['sub1_peq_1', 'sub1_ap_1']]);
    expect(steps).toContainEqual([[3], ['sub2_delay']]);
    expect(y).toContain('сабвуфер 2: фаза 90° — ручкой на сабвуфере');
    expect(y).toContain('встроенный фильтр сабвуфера выключите');
  });

  it('просто стерео без сабвуфера — без микшера', () => {
    const c = parse(exportCamillaDSP({ sources: [spk('spkL'), spk('spkR')], eq, subSettings: {} }));
    expect(c.mixers).toBeUndefined();
    expect(c.pipeline).toHaveLength(1);
    expect(c.pipeline[0].channels).toEqual([0, 1]);
  });

  it('нечего экспортировать — валидный YAML с пояснением', () => {
    const y = exportCamillaDSP({ sources: [spk('spkL'), spk('spkR')], eq: [], subSettings: {} });
    expect(parse(y)).toBeNull();
    expect(y).toContain('Фильтров нет');
  });

  it('порядок каналов: колонки, затем сабвуферы', () => {
    expect(camillaChannels([sub('sub1'), spk('spkC')]).map((c) => c.id)).toEqual(['spkC', 'sub1']);
  });
});
