// 035: сообщения воркеру из compute.ts — задача видимого раздела уходит как раньше, без поля `hidden`; скрытого — с ним;
// смена видимости — сообщение `priority`, только пока ответа нет и задача не снята, и только когда признак изменился.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { compute } from '../../src/ui/compute';
import type { ComputeMessage, ComputeReply } from '../../src/workers/computeJobs';
import { defaultRoom } from '../../src/state/project';

const sent: ComputeMessage[] = [];
let reply: ((e: { data: ComputeReply }) => void) | null = null;

class FakeWorker {
  onerror: unknown = null;
  set onmessage(fn: (e: { data: ComputeReply }) => void) { reply = fn; }
  postMessage(m: ComputeMessage) { sent.push(m); }
  terminate() {}
}

const original = globalThis.Worker;
beforeAll(() => { (globalThis as { Worker: unknown }).Worker = FakeWorker; });
afterAll(() => { (globalThis as { Worker: unknown }).Worker = original; });

const payload = { room: defaultRoom(), fMax: 80 };
const last = () => sent[sent.length - 1];
const flush = async () => { for (let i = 0; i < 4; i++) await Promise.resolve(); };

describe('035: видимость задачи в сообщениях воркеру', () => {
  it('видимая задача — сообщение без поля `hidden`, скрытая — с `hidden: true`', () => {
    compute('modes', payload);
    expect(Object.keys(last())).toEqual(['id', 'type', 'payload']);
    compute('modes', payload, undefined, true);
    expect(last()).toMatchObject({ type: 'modes', hidden: true });
  });

  it('смена видимости — `priority`, только при изменении признака и пока нет ответа', async () => {
    const job = compute('modes', payload, undefined, true);
    const id = (last() as { id: number }).id;
    const n = sent.length;
    job.setHidden(true);
    expect(sent).toHaveLength(n);
    job.setHidden(false);
    expect(sent.slice(n)).toEqual([{ priority: id, hidden: false }]);
    reply!({ data: { id, kind: 'done', result: [] } });
    await expect(job.promise).resolves.toEqual([]);
    await flush();
    job.setHidden(true);
    expect(sent).toHaveLength(n + 1);
  });

  it('снятая задача смену видимости не получает', () => {
    const job = compute('modes', payload);
    job.cancel();
    const n = sent.length;
    job.setHidden(true);
    expect(sent).toHaveLength(n);
  });
});
