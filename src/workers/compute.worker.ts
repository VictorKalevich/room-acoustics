// Общий воркер тяжёлых расчётов: автоподбор, карты, настройка сабвуфера, подстройка модели.
import { optimizePlacement } from '../core/placement';
import { listenerHeatmap, subHeatmap } from '../core/field';
import { optimizeSubs } from '../core/integration';
import { calibrate } from '../core/measure';

self.onmessage = (e: MessageEvent<{ type: string; payload: any }>) => {
  const { type, payload: p } = e.data;
  try {
    let result: unknown;
    let last = 0;
    const progress = (v: number) => {
      const now = Date.now();
      if (now - last > 80 || v >= 1) { last = now; self.postMessage({ kind: 'progress', value: v }); }
    };
    switch (type) {
      case 'optimize': result = optimizePlacement(p, progress); break;
      case 'listenerMap': result = listenerHeatmap(p.room, p.sources, p.constraints, p.setup); break;
      case 'subMap': result = subHeatmap(p.room, p.sources, p.constraints, p.setup, p.subId); break;
      case 'integrate': result = optimizeSubs(p.room, p.sources, p.constraints, p.setup); break;
      case 'calibrate': result = calibrate(p.room, p.sources, p.constraints, p.setup, p.measurement); break;
      default: throw new Error(`Неизвестная задача ${type}`);
    }
    self.postMessage({ kind: 'done', result });
  } catch (err) {
    self.postMessage({ kind: 'error', error: (err as Error).message ?? String(err) });
  }
};
