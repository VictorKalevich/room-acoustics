// 030: воркер распознавания скана с подменённым `self`: те же сообщения, что отправляет ScanPanel, и те же ответы.
// Тест проходил и на прежнем воркере (до 030).
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { detectRoom } from '../../src/scan/detect';
import { analyzeLayout } from '../../src/scan/layout';
import type { ScanMessage, ScanReply } from '../../src/workers/detectJobs';
import { makeRoomScan } from '../fixtures/synthetic';

interface Posted { msg: ScanReply; transfer?: Transferable[] }
const posted: Posted[] = [];
const scope = {
  onmessage: null as ((e: MessageEvent<ScanMessage>) => void) | null,
  postMessage: (msg: ScanReply, transfer?: Transferable[]) => { posted.push({ msg, transfer }); },
};

beforeAll(async () => {
  vi.stubGlobal('self', scope);
  await import('../../src/workers/detect.worker');
});
afterAll(() => { vi.unstubAllGlobals(); });

/** Ответ воркера на одно сообщение (обработка синхронная). */
const ask = (m: unknown) => {
  posted.length = 0;
  scope.onmessage!({ data: m } as MessageEvent<ScanMessage>);
  expect(posted).toHaveLength(1);
  return posted[0];
};

const scan = makeRoomScan({ depth: 5, width: 4, height: 2.5, noise: 0.01, furniture: true, openings: true });

describe('воркер распознавания скана', () => {
  it('распознавание (сообщение без type): комната и разбор, передаётся буфер контура', () => {
    const r = ask({ units: undefined, labels: undefined, triangles: scan.slice() });
    if (!r.msg.ok || !('result' in r.msg)) throw new Error(`ждали распознавание: ${JSON.stringify(r.msg)}`);
    const result = detectRoom(scan, {});
    expect(r.msg.result).toEqual(result);
    expect(r.msg.layout).toEqual(analyzeLayout(scan, result.transform, result, undefined));
    expect(r.transfer).toHaveLength(1);
    expect(r.transfer![0]).toBe(r.msg.layout.outline.buffer);
  });

  it('разбор для выбранных границ: только layout', () => {
    const det = detectRoom(scan, {});
    const t = det.transform.slice();
    t[12] -= 0.5;
    const dims = { depth: det.depth - 0.5, width: det.width, height: det.height };
    const r = ask({ type: 'layout', labels: undefined, transform: t, dims, triangles: scan.slice() });
    if (!r.msg.ok) throw new Error(r.msg.error);
    expect('result' in r.msg).toBe(false);
    expect(r.msg.layout).toEqual(analyzeLayout(scan, t, dims, undefined));
    expect(r.transfer![0]).toBe(r.msg.layout.outline.buffer);
  });

  it('ошибка распознавания — { ok: false, error } без передачи буферов', () => {
    const r = ask({ triangles: new Float32Array(9) });
    expect(r.msg.ok).toBe(false);
    if (r.msg.ok) return;
    expect(r.msg.error).toMatch(/слишком мало поверхностей/);
    expect(r.transfer).toBeUndefined();
  });
});
