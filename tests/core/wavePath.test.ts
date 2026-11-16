// 036: в волновой модели отклик «источник → точка приёма» считается из точек приёма или из источников (по взаимности),
// и путь выбирается по входным данным, а не по тому, что уже лежит в кэше. Одна и та же задача с пустым кэшем и после
// расчётов другого направления даёт одинаковый результат (в 035 найдено: оценка 7,5 или 7,6 дБ, рекомендация уровня
// сабвуфера −6,0 или −5,5 дБ в зависимости от истории).
import { beforeEach, describe, expect, it } from 'vitest';
import { clearWaveCache, getSim, waveFMax } from '../../src/core/acoustics';
import { isWave } from '../../src/core/geometry';
import { listenerHeatmap } from '../../src/core/field';
import { optimizeSubs } from '../../src/core/integration';
import { evalBand, evaluateSetup, receiverSet } from '../../src/core/system';
import type { Constraints, Room } from '../../src/core/types';
import { defaultConstraints, defaultSetup, defaultSources, emptyRoom } from '../../src/state/project';

// комната из воспроизведения 035: 5 × 4 × 2,5 м с коридором 1,2 м справа; сабвуфер в углу
const room: Room = {
  ...emptyRoom(), depth: 5, width: 4, height: 2.5,
  extensions: [{ id: 'e', name: 'к', wall: 'right', a0: 0.5, a1: 4, depth: 1.2, height: 2.4, arch: { a0: 1, a1: 2.2, height: 2.1 }, openStart: false, openEnd: true, openFar: false }],
};
const sources = defaultSources(2, 1);
const c = defaultConstraints(room);
const setup = { ...defaultSetup(room, sources, c), listener: { x: 2.5, y: 2.8, z: 1.1 } };
const fMax = waveFMax(evalBand(room, sources).fHi);
const ppo = 24;

const evaluate = (cc: Constraints) => evaluateSetup(room, sources, cc, setup, { ppo });
/** Подбор настроек без времени расчёта (оно у каждого вызова своё). */
const integrate = () => { const { elapsedMs: _t, ...r } = optimizeSubs(room, sources, c, setup, { ppo }); return r; };
/** Расчёты из каждой точки — как после других задач, которые считали из этих точек. */
const warm = (from: { x: number; y: number; z: number }[], heights: number[]) => { for (const p of from) getSim(room, fMax, p, heights); };
const sourcePoints = () => sources.map((s) => setup.positions[s.id]);

beforeEach(() => clearWaveCache());

describe('волновая модель: результат не зависит от кэша', () => {
  it('комната считается волновой моделью', () => {
    expect(isWave(room)).toBe(true);
  });

  it('один слушатель: оценка и «Подобрать настройки» после карты слушателя — как с пустым кэшем', () => {
    const ev = evaluate(c);
    const ig = integrate();
    clearWaveCache();
    // карта слушателя считает из источников — в кэше расчёты другого направления
    listenerHeatmap(room, sources, c, setup, { ppo: 12 });
    expect(evaluate(c)).toEqual(ev);
    expect(integrate()).toEqual(ig);
  }, 60_000);

  it('точек приёма больше, чем источников: оценка после расчётов из точек приёма — как с пустым кэшем', () => {
    const seats: Constraints = { ...c, seats: { count: 4, spacing: 0.6 } };
    const rcv = receiverSet(room, seats, setup.listener).pts;
    expect(rcv.length).toBeGreaterThan(sources.length);
    const ev = evaluate(seats);
    clearWaveCache();
    warm(rcv, sourcePoints().map((p) => p.z));
    expect(evaluate(seats)).toEqual(ev);
  }, 60_000);

  it('один слушатель: после расчётов и из источников, и из места слушателя — как с пустым кэшем', () => {
    const ev = evaluate(c);
    clearWaveCache();
    warm(sourcePoints(), [setup.listener.z]);
    warm([setup.listener], sourcePoints().map((p) => p.z));
    expect(evaluate(c)).toEqual(ev);
  }, 60_000);
});
