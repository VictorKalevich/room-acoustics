import { detectRoom, type Units } from '../scan/detect';
import { analyzeLayout } from '../scan/layout';

type Msg =
  | { type?: 'detect'; triangles: Float32Array; units?: Units }
  | { type: 'layout'; triangles: Float32Array; transform: number[]; dims: { depth: number; width: number; height: number } };

self.onmessage = (e: MessageEvent<Msg>) => {
  const m = e.data;
  try {
    if (m.type === 'layout') {
      const layout = analyzeLayout(m.triangles, m.transform, m.dims);
      self.postMessage({ ok: true, layout }, [layout.outline.buffer] as any);
      return;
    }
    const result = detectRoom(m.triangles, { units: m.units });
    const layout = analyzeLayout(m.triangles, result.transform, result);
    self.postMessage({ ok: true, result, layout }, [layout.outline.buffer] as any);
  } catch (err) {
    self.postMessage({ ok: false, error: (err as Error).message ?? String(err) });
  }
};
