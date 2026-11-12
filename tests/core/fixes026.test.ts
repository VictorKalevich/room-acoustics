import { describe, it, expect } from 'vitest';
import { makeCtx, speakerPenalties } from '../../src/core/system';
import { optimizePlacement } from '../../src/core/placement';
import { evaluateVoice, voiceContext, VOICE_DEFAULTS } from '../../src/core/voice';
import { normalizeProject } from '../../src/state/storage';
import { defaultSources } from '../../src/state/project';

describe('исправления 026 в расчётах', () => {
  it('угол раскрытия — угол между направлениями на колонки, и когда слушатель перед колонками', () => {
    const p = normalizeProject({ room: { depth: 5, width: 4, height: 2.5 } });
    const ctx = makeCtx(p.room, p.sources);
    const spk = [{ x: 2.5, y: 1, z: 1 }, { x: 2.5, y: 3, z: 1 }];
    // слушатель между передней стеной и колонками: 90°, а не 270°
    expect(speakerPenalties(ctx, { x: 1.5, y: 2, z: 1.1 }, spk).angle).toBeCloseTo(90, 6);
    // обычное положение — как раньше: равносторонний треугольник даёт 60°
    const usual = speakerPenalties(ctx, { x: 2.5 + Math.sqrt(3), y: 2, z: 1.1 }, spk);
    expect(usual.angle).toBeCloseTo(60, 6);
    expect(usual.penalties.some((q) => q.name.startsWith('Угол'))).toBe(false);
  });

  it('автоподбор: у каждого сабвуфера своя высота; базовая расстановка в запретной зоне не попадает в лучшие', () => {
    const sources = defaultSources(2, 2).map((s) => (s.id === 'sub2' ? { ...s, height: 0.9 } : s));
    const p = normalizeProject({ room: { depth: 5, width: 4, height: 2.5 }, sources });
    const res = optimizePlacement({ room: p.room, sources: p.sources, constraints: p.constraints });
    const z = (id: string) => res.best[0].sources.find((s) => s.id === id)!.pos.z;
    expect(z('sub1')).toBe(0.3);
    expect(z('sub2')).toBe(0.9);
    // зона закрывает передний левый угол, где стоит сабвуфер базовой расстановки
    const blocked = { ...p.room, zones: [{ id: 'z', name: 'Шкаф', kind: 'furniture' as const, x0: 0, x1: 0.6, y0: 0, y1: 0.6, canSit: false }] };
    const r2 = optimizePlacement({ room: blocked as typeof p.room, sources: defaultSources(2, 1), constraints: p.constraints });
    expect(r2.best).not.toContain(r2.baseline);
    for (const b of r2.best) for (const s of b.sources) expect(s.pos.x < 0.6 && s.pos.y < 0.6).toBe(false);
    // сама базовая остаётся для сравнения
    expect(Number.isFinite(r2.baseline.score)).toBe(true);
  }, 120000);

  it('голос: стена под скосом не отражает выше своей высоты', () => {
    const room = normalizeProject({ room: { depth: 5, width: 4, height: 2.5, slope: { wall: 'front', low: 0.8, run: 2.5 } } }).room;
    const e = evaluateVoice(voiceContext(room, VOICE_DEFAULTS), { x: 1.8, y: 2, facing: Math.PI });
    expect(e.reflections.some((r) => r.surface === 'front' && !r.body && r.point.z > 0.8)).toBe(false);
    expect(e.reflections.some((r) => r.surface === 'slope')).toBe(true);
  });
});

describe('пределы техники для частоты раздела (026)', () => {
  const setup = () => {
    const sources = defaultSources(2, 1).map((s) => (s.kind === 'sub' ? { ...s, fHigh: 150 } : s));
    const p = normalizeProject({ room: { depth: 5, width: 4, height: 2.5 }, sources });
    return { p, c: { ...p.constraints, crossover: { adjustable: true, min: 60, max: 120 } } };
  };
  it('без пределов раздел ищется во всём диапазоне регулировки; с пределами — только внутри них', async () => {
    const { optimizeSubs } = await import('../../src/core/integration');
    const { p, c } = setup();
    const free = optimizeSubs(p.room, p.sources, c, p.current);
    // null — подбор не нашёл раздела лучше текущего (текущие настройки оставлены)
    const inside = (v: number | null, lo: number, hi: number) => v === null || (v >= lo && v <= hi);
    expect(inside(free.crossoverHz, 60, 120)).toBe(true);
    expect(free.notes.some((n) => n.includes('пределах техники'))).toBe(false);
    const lim = optimizeSubs(p.room, p.sources, { ...c, crossover: { ...c.crossover, spkLimit: 90, subLimit: 100 } }, p.current);
    expect(inside(lim.crossoverHz, 90, 100)).toBe(true);
    expect(lim.notes.some((n) => n.includes('90–100 Гц'))).toBe(true);
    // пределы шире диапазона регулировки ничего не меняют
    const wide = optimizeSubs(p.room, p.sources, { ...c, crossover: { ...c.crossover, spkLimit: 40, subLimit: 200 } }, p.current);
    expect(wide.crossoverHz).toBe(free.crossoverHz);
    expect(wide.after).toBe(free.after);
  });
  it('пределы, не оставляющие ни одной частоты, раздел не трогают и объясняют почему', async () => {
    const { optimizeSubs } = await import('../../src/core/integration');
    const { p, c } = setup();
    const r = optimizeSubs(p.room, p.sources, { ...c, crossover: { ...c.crossover, spkLimit: 130, subLimit: 50 } }, { ...p.current, crossoverHz: 80 });
    expect(r.crossoverHz).toBe(80);
    expect(r.notes.some((n) => n.includes('не оставляют ни одной частоты'))).toBe(true);
  });
  it('пределы и применённые границы скана переживают сохранение; мусор отбрасывается', () => {
    const { p } = setup();
    const raw = JSON.parse(JSON.stringify({ ...p, constraints: { ...p.constraints, crossover: { adjustable: true, min: 60, max: 120, spkLimit: 80, subLimit: 'x' } },
      scanInfo: { fileName: 'a.obj', applied: { rect: { x0: 0, x1: 5, y0: 1, y1: 4 }, units: 'm' } } }));
    const n = normalizeProject(raw);
    expect(n.constraints.crossover.spkLimit).toBe(80);
    expect('subLimit' in n.constraints.crossover).toBe(false);
    expect(n.scanInfo!.applied).toEqual({ rect: { x0: 0, x1: 5, y0: 1, y1: 4 }, units: 'm' });
    raw.scanInfo.applied = { rect: { x0: 3, x1: 1, y0: 0, y1: 4 }, units: 'm' };
    expect(normalizeProject(raw).scanInfo!.applied).toBeUndefined();
    expect(normalizeProject(raw).scanInfo!.fileName).toBe('a.obj');
  });
});
