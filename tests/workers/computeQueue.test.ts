// 035: правило очереди воркера расчётов без воркера — порядок внутри приоритета, смена приоритета, отмена.
import { describe, expect, it } from 'vitest';
import { ComputeQueue, type Queued } from '../../src/workers/computeQueue';

const queue = (...jobs: Queued[]) => {
  const q = new ComputeQueue<Queued>();
  for (const j of jobs) q.push({ ...j });
  return q;
};
/** Номера задач в том порядке, в каком их выдаст очередь. */
const drain = (q: ComputeQueue<Queued>) => {
  const out: number[] = [];
  for (let j = q.take(); j; j = q.take()) out.push(j.id);
  return out;
};

describe('очередь воркера расчётов', () => {
  it('задачи без поля hidden — в порядке поступления, как до 035', () => {
    expect(drain(queue({ id: 1 }, { id: 2 }, { id: 3 }))).toEqual([1, 2, 3]);
  });

  it('пустая очередь ничего не выдаёт', () => {
    const q = queue();
    expect(q.take()).toBeUndefined();
    expect(q.size).toBe(0);
  });

  it('сначала видимые в порядке поступления, затем скрытые в порядке поступления', () => {
    const q = queue({ id: 1, hidden: true }, { id: 2 }, { id: 3, hidden: true }, { id: 4, hidden: false }, { id: 5 });
    expect(drain(q)).toEqual([2, 4, 5, 1, 3]);
  });

  it('только скрытые — в порядке поступления', () => {
    expect(drain(queue({ id: 1, hidden: true }, { id: 2, hidden: true }))).toEqual([1, 2]);
  });

  it('видимая задача, пришедшая позже, выполняется раньше скрытой, ждущей в очереди', () => {
    const q = queue({ id: 1, hidden: true });
    q.push({ id: 2 });
    expect(q.take()!.id).toBe(2);
    expect(q.take()!.id).toBe(1);
  });

  it('повышение приоритета: задача становится видимой и встаёт по порядку поступления среди видимых', () => {
    const q = queue({ id: 1 }, { id: 2, hidden: true }, { id: 3 }, { id: 4, hidden: true });
    q.setHidden(2, false);
    expect(drain(q)).toEqual([1, 2, 3, 4]);
  });

  it('понижение приоритета: задача ставшего скрытым раздела ждёт видимые', () => {
    const q = queue({ id: 1 }, { id: 2 }, { id: 3, hidden: true });
    q.setHidden(1, true);
    expect(drain(q)).toEqual([2, 1, 3]);
  });

  it('повышение и понижение вместе: вернувшийся раздел — первым, ушедший — после него', () => {
    const q = queue({ id: 1 }, { id: 2, hidden: true });
    q.setHidden(1, true);
    q.setHidden(2, false);
    expect(drain(q)).toEqual([2, 1]);
  });

  it('смена приоритета выданной или неизвестной задачи ничего не меняет', () => {
    const q = queue({ id: 1 }, { id: 2, hidden: true }, { id: 3, hidden: true });
    expect(q.take()!.id).toBe(1);
    q.setHidden(1, false);
    q.setHidden(99, false);
    expect(drain(q)).toEqual([2, 3]);
  });

  it('отмена убирает ждущую задачу, остальные — по прежнему правилу', () => {
    const q = queue({ id: 1, hidden: true }, { id: 2 }, { id: 3 }, { id: 4, hidden: true });
    q.cancel(2);
    q.cancel(4);
    expect(q.size).toBe(2);
    expect(drain(q)).toEqual([3, 1]);
  });

  it('отмена выданной или неизвестной задачи ничего не меняет', () => {
    const q = queue({ id: 1 }, { id: 2 });
    expect(q.take()!.id).toBe(1);
    q.cancel(1);
    q.cancel(99);
    expect(drain(q)).toEqual([2]);
  });

  it('отменённую задачу нельзя поднять: она не вернётся в очередь', () => {
    const q = queue({ id: 1, hidden: true }, { id: 2, hidden: true });
    q.cancel(1);
    q.setHidden(1, false);
    expect(drain(q)).toEqual([2]);
  });
});
