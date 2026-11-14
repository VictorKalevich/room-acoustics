// 030: воркер расчётов целиком, с подменённым `self`: сообщения те же, что отправляет ui/compute.ts, ответы те же,
// что ждёт интерфейс. Тест проходил и на прежнем воркере со switch (до 030) — он фиксирует поведение обвязки:
// результат, передачу буферов field и voiceMap, ход расчёта, ошибки и отмену задачи в очереди.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ComputeMessage, ComputeReply } from '../../src/workers/computeJobs';
import type { FieldResult } from '../../src/core/field3d';
import type { VoiceMap } from '../../src/core/voice';
import { JOB_TYPES, jobCases, timeless, wire } from './jobCases';

interface Posted { msg: ComputeReply; transfer?: Transferable[] }
const posted: Posted[] = [];
const scope = {
  onmessage: null as ((e: MessageEvent<ComputeMessage>) => void) | null,
  postMessage: (msg: ComputeReply, transfer?: Transferable[]) => { posted.push({ msg, transfer }); },
};

beforeAll(async () => {
  vi.stubGlobal('self', scope);
  await import('../../src/workers/compute.worker');
});
afterAll(() => { vi.unstubAllGlobals(); });

let seq = 1000;
/** Отправить сообщение воркеру так же, как это делает браузер. */
const send = (m: unknown) => scope.onmessage!({ data: m } as MessageEvent<ComputeMessage>);
/** Итоговый ответ (результат или ошибка) на задачу id. */
const final = (id: number) => vi.waitFor(() => {
  const r = posted.find((p) => p.msg.id === id && p.msg.kind !== 'progress');
  if (!r) throw new Error(`нет ответа на задачу ${id}`);
  return r;
}, { timeout: 30_000, interval: 5 });

describe('воркер расчётов', () => {
  for (const type of JOB_TYPES) {
    it(`${type}: результат как у прямого вызова ядра, буферы передаются только у field и voiceMap`, async () => {
      const c = jobCases[type];
      const id = ++seq;
      send({ id, type, payload: wire(c.payload) });
      const r = await final(id);
      if (r.msg.kind !== 'done') throw new Error(`ошибка: ${JSON.stringify(r.msg)}`);
      expect(timeless(r.msg.result)).toEqual(timeless(c.direct()));
      if (type === 'field') {
        const f = r.msg.result as FieldResult;
        expect(r.transfer).toHaveLength(2);
        expect(r.transfer![0]).toBe(f.energy.buffer);
        expect(r.transfer![1]).toBe(f.mask.buffer);
      } else if (type === 'voiceMap') {
        const v = r.msg.result as VoiceMap;
        expect(r.transfer).toHaveLength(3);
        expect(r.transfer![0]).toBe(v.scores.buffer);
        expect(r.transfer![1]).toBe(v.facing.buffer);
        expect(r.transfer![2]).toBe(v.allowed.buffer);
      } else {
        expect(r.transfer).toEqual([]);
      }
      for (const p of posted.filter((x) => x.msg.id === id && x.msg.kind === 'progress')) {
        if (p.msg.kind !== 'progress') continue;
        expect(p.msg.value).toBeGreaterThanOrEqual(0);
        expect(p.msg.value).toBeLessThanOrEqual(1);
        expect(p.transfer).toBeUndefined();
      }
    });
  }

  it('ход расчёта приходит до результата', async () => {
    const id = ++seq;
    send({ id, type: 'voiceMap', payload: wire(jobCases.voiceMap.payload) });
    await final(id);
    const mine = posted.filter((p) => p.msg.id === id);
    expect(mine.length).toBeGreaterThan(1);
    expect(mine.at(-1)!.msg.kind).toBe('done');
    expect(mine.slice(0, -1).every((p) => p.msg.kind === 'progress')).toBe(true);
  });

  it('неизвестный вид задачи — ошибка «Неизвестная задача …»', async () => {
    const id = ++seq;
    send({ id, type: 'nope', payload: {} });
    const r = await final(id);
    expect(r.msg).toMatchObject({ id, kind: 'error', error: 'Неизвестная задача nope' });
    expect(r.transfer).toBeUndefined();
  });

  it('ошибка ядра уходит с текстом и стеком', async () => {
    const id = ++seq;
    send({ id, type: 'field', payload: wire({ ...jobCases.field.payload, freqs: [] }) });
    const r = await final(id);
    if (r.msg.kind !== 'error') throw new Error('ждали ошибку');
    expect(r.msg.error).toBe('Не выбраны частоты');
    expect(r.msg.stack).toContain('Не выбраны частоты');
  });

  it('отменённая задача из очереди не выполняется, остальные — по порядку', async () => {
    const a = ++seq, b = ++seq, c = ++seq;
    send({ id: a, type: 'compare', payload: wire(jobCases.compare.payload) });
    send({ id: b, type: 'compare', payload: wire(jobCases.compare.payload) });
    send({ id: c, type: 'modes', payload: wire(jobCases.modes.payload) });
    send({ cancel: b });
    await final(c);
    const order = posted.filter((p) => [a, b, c].includes(p.msg.id) && p.msg.kind === 'done').map((p) => p.msg.id);
    expect(order).toEqual([a, c]);
  });
});
