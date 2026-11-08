// Постоянный воркер тяжёлых расчётов с очередью: кэш волновой модели живёт между задачами.
import { optimizePlacement } from '../core/placement';
import { listenerHeatmap, subHeatmap } from '../core/field';
import { optimizeSubs } from '../core/integration';
import { calibrate, compareMeasurement } from '../core/measure';
import { evaluateSetup } from '../core/system';
import { waveSystemModes } from '../core/acoustics';
import { computeField } from '../core/field3d';
import { optimizeSubFilters } from '../core/subfilters';

interface Job { id: number; type: string; payload: any }
const queue: Job[] = [];
let running = false;

function run(job: Job) {
  const { id, type, payload: p } = job;
  let last = 0;
  const progress = (v: number) => {
    const now = Date.now();
    if (now - last > 100 || v >= 1) { last = now; self.postMessage({ id, kind: 'progress', value: Math.min(1, v) }); }
  };
  try {
    let result: unknown;
    switch (type) {
      case 'optimize': result = optimizePlacement(p, progress); break;
      case 'listenerMap': result = listenerHeatmap(p.room, p.sources, p.constraints, p.setup, { onProgress: progress }); break;
      case 'subMap': result = subHeatmap(p.room, p.sources, p.constraints, p.setup, p.subId, { onProgress: progress }); break;
      case 'integrate': result = optimizeSubs(p.room, p.sources, p.constraints, p.setup); break;
      case 'calibrate': result = calibrate(p.room, p.sources, p.constraints, p.setup, p.measurement); break;
      case 'compare': result = compareMeasurement(p.room, p.sources, p.constraints, p.setup, p.measurement); break;
      case 'evaluate': result = evaluateSetup(p.room, p.sources, p.constraints, p.setup, { ppo: p.ppo, onProgress: progress }); break;
      case 'modes': result = waveSystemModes(p.room, p.fMax, progress); break;
      case 'field': result = computeField(p, progress); break;
      case 'subFilters': result = optimizeSubFilters(p.room, p.sources, p.constraints, p.setup); break;
      default: throw new Error(`Неизвестная задача ${type}`);
    }
    const fr = result as { energy?: Float32Array; mask?: Uint8Array };
    const transfer = type === 'field' && fr.energy && fr.mask ? [fr.energy.buffer, fr.mask.buffer] : [];
    self.postMessage({ id, kind: 'done', result }, transfer as any);
  } catch (err) {
    self.postMessage({ id, kind: 'error', error: (err as Error).message ?? String(err), stack: (err as Error).stack });
  }
}

function pump() {
  if (running) return;
  const job = queue.shift();
  if (!job) return;
  running = true;
  run(job);
  running = false;
  // отдаём управление, чтобы успели прийти отмены
  setTimeout(pump, 0);
}

self.onmessage = (e: MessageEvent<{ cancel?: number; id?: number; type?: string; payload?: unknown }>) => {
  const m = e.data;
  if (m.cancel != null) {
    const i = queue.findIndex((j) => j.id === m.cancel);
    if (i >= 0) queue.splice(i, 1);
    return;
  }
  queue.push({ id: m.id!, type: m.type!, payload: m.payload });
  setTimeout(pump, 0);
};
