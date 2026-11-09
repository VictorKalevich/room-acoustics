import { describe, expect, it } from 'vitest';
import {
  evaluateVoice, facingName, micGain, micREE, normalizeVoice, relativeSide, spotAllowed, voiceBands, voiceContext, voiceDir, voiceMap, voicePaths,
  VOICE_DEFAULTS, type VoiceSettings,
} from '../../src/core/voice';
import { emptyRoom } from '../../src/state/project';
import type { Room } from '../../src/core/types';

const room = emptyRoom(); // 4 × 3 × 2,7 м
const S: VoiceSettings = { ...VOICE_DEFAULTS };
const db = (a: number) => 20 * Math.log10(a);
const BACK = 0; // лицом к задней стене (x растёт)
const FRONT = Math.PI;

describe('микрофон и голос', () => {
  it('кардиоида и суперкардиоида: нули, задний лепесток, чувствительность к диффузному полю', () => {
    expect(micGain('cardioid', 1)).toBe(1);
    expect(db(micGain('cardioid', 0))).toBeCloseTo(-6.02, 1);
    expect(db(micGain('cardioid', -1))).toBeCloseTo(-26, 0); // реальный ноль не бесконечный
    expect(db(micGain('supercardioid', -1))).toBeCloseTo(-11.3, 0);
    expect(micREE('cardioid')).toBeCloseTo(1 / 3, 9);
    expect(micREE('supercardioid')).toBeCloseTo(0.269, 2);
  });

  it('голос вперёд громче, чем назад; на ВЧ разница больше', () => {
    expect(voiceDir(1, 14)).toBe(1);
    expect(db(voiceDir(-1, 14))).toBeCloseTo(-14, 9);
    expect(voiceDir(0, 3)).toBeGreaterThan(voiceDir(0, 14));
  });

  it('полосы 1/6 октавы точно покрывают выбранный диапазон', () => {
    const b = voiceBands(80, 12000);
    expect(b.fc.length).toBe(43);
    expect(b.f1[0]).toBeCloseTo(80, 9);
    expect(b.f2[b.f2.length - 1]).toBeCloseTo(12000, 6);
    expect(voiceBands(300, 3000).fc.length).toBe(20);
  });
});

describe('пути звука к микрофону', () => {
  const ctx = voiceContext(room, S);

  it('в центре пустой комнаты — 6 первых отражений; потолок: d/L × отражение × голос × микрофон', () => {
    const paths = voicePaths(ctx, 2, 1.5, FRONT);
    const first = paths.filter((p) => p.order === 1 && !p.body);
    expect(first.map((p) => p.surface).sort()).toEqual(['back', 'ceiling', 'floor', 'front', 'left', 'right']);
    const ceil = first.find((p) => p.surface === 'ceiling')!;
    // рот 1,6 м, потолок 2,7 м, микрофон в 0,2 м: путь √(2,2² + 0,2²)
    const L = Math.hypot(2 * (2.7 - 1.6), 0.2);
    expect(ceil.delay * 1000).toBeCloseTo(((L - 0.2) / ctx.c) * 1000, 6);
    expect(ceil.point!.z).toBe(2.7);
    // на 125 Гц голос почти ненаправленный: амплитуда близка к d/L·r·mic(≈90°)
    const k = 0;
    expect(ceil.amp[k]).toBeLessThan(0.2 / L);
    expect(ceil.amp[k]).toBeGreaterThan((0.2 / L) * 0.3);
  });

  it('стена за спиной даёт отражение сильнее, чем та же стена перед лицом (кардиоида её глушит)', () => {
    const backTo = evaluateVoice(ctx, { x: 3.6, y: 1.5, facing: FRONT }).reflections.find((r) => r.surface === 'back' && !r.body)!;
    const facingIt = evaluateVoice(ctx, { x: 3.6, y: 1.5, facing: BACK }).reflections.find((r) => r.surface === 'back' && !r.body)!;
    expect(backTo.db).toBeGreaterThan(facingIt.db + 8);
    // суперкардиоида: задний лепесток слышит стену перед лицом сильнее кардиоиды
    const sup = evaluateVoice(voiceContext(room, { ...S, mic: 'supercardioid' }), { x: 3.6, y: 1.5, facing: BACK }).reflections.find((r) => r.surface === 'back' && !r.body)!;
    expect(sup.db).toBeGreaterThan(facingIt.db + 5);
  });

  it('звук, вернувшийся от стены перед лицом, отражается от тела в микрофон', () => {
    const e = evaluateVoice(ctx, { x: 3.5, y: 1.5, facing: BACK });
    const body = e.reflections.find((r) => r.body && r.surface === 'back');
    expect(body).toBeTruthy();
    expect(body!.ms).toBeGreaterThan(0);
    // со стены за спиной к телу спереди звук не возвращается
    expect(evaluateVoice(ctx, { x: 0.5, y: 1.5, facing: BACK }).reflections.some((r) => r.body && r.surface === 'front')).toBe(false);
  });

  it('угол окрашивает голос сильнее центра', () => {
    const corner = evaluateVoice(ctx, { x: 0.4, y: 0.4, facing: Math.PI / 4 }).score;
    const center = evaluateVoice(ctx, { x: 2, y: 1.5, facing: FRONT }).score;
    expect(corner).toBeGreaterThan(center * 2);
  });

  it('окно, панель и проём в точке отражения: метка, слабее отражение, нет отражения', () => {
    const spot = { x: 3.5, y: 1.5, facing: FRONT };
    const base = evaluateVoice(ctx, spot).reflections.find((r) => r.surface === 'back' && !r.body)!;
    const at = (patch: Partial<Room>) => evaluateVoice(voiceContext({ ...room, ...patch }, S), spot).reflections.find((r) => r.surface === 'back' && !r.body);
    const win = at({ features: [{ id: 'w', kind: 'window', wall: 'back', a0: 1, a1: 2, bottom: 0.8, top: 2.3 }] })!;
    expect(win.on).toBe('window');
    const panel = at({ treatmentsOn: true, treatments: [{ id: 't', kind: 'panel', wall: 'back', at: 1.5, z: 1.6, thickness: 0.1, gap: 0.05, width: 0.6, height: 1.2, enabled: true }] })!;
    expect(panel.on).toBe('treatment');
    // панель гасит середину и верх полностью; остаётся бас, поэтому по всей полосе — на 4+ дБ
    expect(panel.db).toBeLessThan(base.db - 4);
    expect(at({ openings: [{ id: 'o', wall: 'back', a0: 1, a1: 2, height: 2.1 }] })).toBeUndefined();
  });

  it('под скосом есть отражение от наклонной плоскости, а плоского потолка там нет', () => {
    const r = { ...room, slope: { wall: 'front' as const, low: 1.2, run: 1.5 } };
    const e = evaluateVoice(voiceContext(r, S), { x: 0.6, y: 1.5, facing: BACK });
    expect(e.reflections.some((q) => q.surface === 'slope' && !q.body)).toBe(true);
    expect(e.reflections.some((q) => q.surface === 'ceiling' && !q.body)).toBe(false);
  });
});

describe('карта мест', () => {
  it('у стен и в мебели не встать; лучшие места разнесены; направление — одно из 16', () => {
    const r: Room = { ...room, zones: [{ id: 'z', kind: 'furniture', x0: 0, x1: 1, y0: 0, y1: 1.2, canSit: true }] };
    const m = voiceMap(r, S);
    for (let i = 0; i < m.nx; i++) for (let j = 0; j < m.ny; j++) {
      const x = m.x0 + i * m.step, y = m.y0 + j * m.step;
      if (x < 1.1 && y < 1.3) expect(Number.isNaN(m.scores[i * m.ny + j])).toBe(true);
      if (x < 0.3 || y < 0.3) expect(m.allowed[i * m.ny + j]).toBe(0);
    }
    expect(m.best.length).toBe(3);
    for (let a = 0; a < m.best.length; a++) for (let b = a + 1; b < m.best.length; b++) {
      expect(Math.hypot(m.best[a].x - m.best[b].x, m.best[a].y - m.best[b].y)).toBeGreaterThanOrEqual(0.6);
    }
    expect(m.best[0].score).toBe(m.min);
    for (const b of m.best) expect(Number.isInteger(Math.round((b.facing * 8) / Math.PI * 1e6) / 1e6)).toBe(true);
    expect(spotAllowed(r, 0.5, 0.5, 0, S)).toBe(false);
  });

  it('другая полоса частот меняет оценку', () => {
    const ctxA = voiceContext(room, S), ctxB = voiceContext(room, { ...S, fLo: 300, fHi: 3000 });
    const spot = { x: 3.6, y: 1.5, facing: FRONT };
    expect(evaluateVoice(ctxB, spot).f.length).toBe(20);
    expect(evaluateVoice(ctxA, spot).score).not.toBeCloseTo(evaluateVoice(ctxB, spot).score, 3);
  });
});

describe('слова и файл проекта', () => {
  it('направление и сторона словами', () => {
    expect(facingName(Math.PI)).toBe('к передней стене (к колонкам)');
    expect(facingName(0)).toBe('к задней стене');
    expect(facingName(Math.PI / 2)).toBe('к правой стене');
    expect(facingName(-Math.PI / 2)).toBe('к левой стене');
    // лицом к колонкам левая стена — слева
    expect(relativeSide({ x: 2, y: 1.5, facing: Math.PI }, { x: 2, y: 0, z: 1.6 }, 'left')).toBe('left');
    expect(relativeSide({ x: 2, y: 1.5, facing: Math.PI }, { x: 4, y: 1.5, z: 1.6 }, 'back')).toBe('back');
  });

  it('настройки из файла: мусор — к значениям по умолчанию', () => {
    expect(normalizeVoice(undefined)).toEqual(VOICE_DEFAULTS);
    expect(normalizeVoice({ mic: 'x', distance: 5, fLo: 5000, fHi: 50000, spot: { x: 'a' } })).toEqual(VOICE_DEFAULTS);
    expect(normalizeVoice({ mic: 'supercardioid', posture: 'sitting', fLo: 100, fHi: 8000, spot: { x: 1, y: 2, facing: 3 } })).toMatchObject({ mic: 'supercardioid', posture: 'sitting', mouthZ: 1.2, fLo: 100, fHi: 8000, spot: { x: 1, y: 2, facing: 3 } });
  });
});
