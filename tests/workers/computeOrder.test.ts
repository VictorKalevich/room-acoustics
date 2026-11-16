// 035: порядок выполнения задач меняет то, что лежит в кэше волновой модели (src/core/acoustics.ts) к началу следующей
// задачи, — и тем самым её длительность, но не результат (с 036 путь расчёта не зависит от кэша). Одни и те же задачи воркера выполняются с пустым кэшем, подряд
// в прямом и обратном порядке и вперемешку; результаты каждой задачи совпадают. Задачи затрагивают все кэши модели:
// сетки (их не больше двух — третья геометрия сбрасывает сетки и расчёты), расчёты из точки с дополнением слоёв по
// высоте, моды системы и поле 3D.
import { describe, expect, it } from 'vitest';
import { clearWaveCache } from '../../src/core/acoustics';
import { isWave } from '../../src/core/geometry';
import type { Room } from '../../src/core/types';
import { runHandler } from '../../src/workers/computeHandlers';
import type { ComputePayload, ComputeType } from '../../src/workers/computeJobs';
import { defaultConstraints, defaultSetup, defaultSources, emptyRoom } from '../../src/state/project';
import { timeless, wire } from './jobCases';

const base = emptyRoom();
// большие комнаты: частота Шрёдера ниже, сетка крупнее — расчёт быстрее
const corridor: Room = {
  ...base, depth: 6.5, width: 5, height: 3,
  extensions: [{ id: 'e', name: 'к', wall: 'right', a0: 0.5, a1: 5.5, depth: 1.2, height: 2.6, arch: { a0: 1, a1: 2.4, height: 2.2 }, openStart: false, openEnd: true, openFar: false }],
};
const sloped: Room = { ...base, depth: 6.5, width: 5, height: 3, slope: { wall: 'front', low: 1.6, run: 1.5 } };
const nook: Room = { ...corridor, extensions: [{ ...corridor.extensions![0], wall: 'left', depth: 0.6 }] };

const sources = defaultSources(2, 1);
const constraints = defaultConstraints(corridor);
// слушатель не в узле сетки: иначе оба пути расчёта по взаимности дают одно и то же
const setup = { ...defaultSetup(corridor, sources, constraints), listener: { x: 2.83, y: 2.31, z: 1.1 } };
// слушатель выше: тот же расчёт из точки источника дополняется слоем на другой высоте
const standing = { ...setup, listener: { ...setup.listener, z: 1.7 } };

interface Task<K extends ComputeType = ComputeType> { name: string; type: K; payload: ComputePayload<K> }
const task = <K extends ComputeType>(name: string, type: K, payload: ComputePayload<K>): Task => ({ name, type, payload } as Task);
const forRoom = (room: Room, s = setup) => ({ room, sources, constraints: defaultConstraints(room), setup: s, ppo: 12 });

const tasks: Task[] = [
  task('оценка, коридор', 'evaluate', forRoom(corridor)),
  task('карта слушателя, коридор', 'listenerMap', forRoom(corridor)),
  task('оценка стоя, коридор', 'evaluate', forRoom(corridor, standing)),
  task('карта сабвуфера, коридор', 'subMap', { ...forRoom(corridor), subId: 'sub1' }),
  task('моды системы, коридор', 'modes', { room: corridor, fMax: 80 }),
  task('поле 3D, коридор', 'field', { room: corridor, sources, setup, kind: 'excited', freqs: [40, 63] }),
  task('оценка, скос', 'evaluate', forRoom(sloped)),
  task('оценка, ниша', 'evaluate', forRoom(nook)),
  task('подбор настроек, коридор', 'integrate', forRoom(corridor)),
];

const run = (t: Task) => timeless(runHandler(t.type, wire(t.payload), () => undefined));
/** Выполнить задачи в порядке `order` с общим кэшем; результат — по номеру задачи. */
function inOrder(order: number[]): unknown[] {
  clearWaveCache();
  const out: unknown[] = [];
  for (const i of order) out[i] = run(tasks[i]);
  return out;
}

describe('порядок задач и кэш волновой модели', () => {
  it('комнаты задач считаются волновой моделью', () => {
    expect([corridor, sloped, nook].every(isWave)).toBe(true);
  });

  it('результат задачи не зависит от того, что выполнялось до неё', () => {
    const cold = tasks.map((t) => { clearWaveCache(); return run(t); });
    const ids = tasks.map((_, i) => i);
    // вперемешку: после карты слушателя (расчёты из источников) — подбор и оценка с одним слушателем (расчёт из него)
    const orders = [[...ids].reverse(), [1, 8, 0, 5, 7, 2, 4, 6, 3]];
    for (const order of orders) {
      const got = inOrder(order);
      tasks.forEach((t, i) => expect(got[i], `${t.name}, порядок ${order.join(',')}`).toEqual(cold[i]));
    }
  }, 120_000);
});
