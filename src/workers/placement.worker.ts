import { optimizePlacement, type PlacementInput } from '../core/placement';

self.onmessage = (e: MessageEvent<PlacementInput>) => {
  try {
    let last = 0;
    const result = optimizePlacement(e.data, (p) => {
      const now = Date.now();
      if (now - last > 80 || p >= 1) {
        last = now;
        self.postMessage({ type: 'progress', value: p });
      }
    });
    self.postMessage({ type: 'done', result });
  } catch (err) {
    self.postMessage({ type: 'error', error: (err as Error).message ?? String(err) });
  }
};
