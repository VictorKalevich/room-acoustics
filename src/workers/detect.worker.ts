import { detectRoom, type Units } from '../scan/detect';

self.onmessage = (e: MessageEvent<{ triangles: Float32Array; units?: Units }>) => {
  try {
    const result = detectRoom(e.data.triangles, { units: e.data.units });
    self.postMessage({ ok: true, result });
  } catch (err) {
    self.postMessage({ ok: false, error: (err as Error).message ?? String(err) });
  }
};
