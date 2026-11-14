// Воркер распознавания скана; запросы и ответы — в detectJobs.ts (030).
import { detectRoom } from '../scan/detect';
import { analyzeLayout } from '../scan/layout';
import type { ScanMessage, ScanReply } from './detectJobs';

/** `self` воркера с типами договора: что он принимает и что отправляет. */
interface ScanScope {
  onmessage: ((e: MessageEvent<ScanMessage>) => void) | null;
  postMessage(reply: ScanReply, transfer?: Transferable[]): void;
}
const scope = self as unknown as ScanScope;

scope.onmessage = (e) => {
  const m = e.data;
  try {
    // контур создан как ArrayBuffer, а тип объявляет ArrayBufferLike — отсюда приведение
    if (m.type === 'layout') {
      const layout = analyzeLayout(m.triangles, m.transform, m.dims, m.labels);
      scope.postMessage({ ok: true, layout }, [layout.outline.buffer as ArrayBuffer]);
      return;
    }
    const result = detectRoom(m.triangles, { units: m.units });
    const layout = analyzeLayout(m.triangles, result.transform, result, m.labels);
    scope.postMessage({ ok: true, result, layout }, [layout.outline.buffer as ArrayBuffer]);
  } catch (err) {
    scope.postMessage({ ok: false, error: (err as Error).message ?? String(err) });
  }
};
