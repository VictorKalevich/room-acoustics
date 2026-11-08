// Микрофон: запись без обработки (эхоподавление, шумоподавление и автоусиление выключены) и живой анализатор.
import { audioContext, micOpened } from './tone';

const WORKLET = `
class RaRec extends AudioWorkletProcessor {
  constructor() { super(); this.on = false; this.port.onmessage = (e) => { this.on = e.data; }; }
  process(inputs) { const ch = inputs[0] && inputs[0][0]; if (this.on && ch) this.port.postMessage(ch.slice(0)); return true; }
}
registerProcessor('ra-rec', RaRec);
`;

export interface Mic {
  sampleRate: number;
  label: string;
  start(): void;
  stop(): Float32Array;
  analyser(fftSize?: number): AnalyserNode;
  close(): void;
  /** Звук действительно идёт (на iPhone после первого разрешения может понадобиться ещё одно касание). */
  running(): boolean;
}

let workletReady: Promise<void> | null = null;

/**
 * Открывает микрофон. Вызывать из обработчика касания: AudioContext создаётся и запускается
 * до запроса разрешения, иначе iOS оставит его на паузе и запись будет пустой.
 */
export async function openMic(): Promise<Mic> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('Браузер не даёт доступа к микрофону. Откройте приложение в Safari по адресу сайта (https).');
  const ctx = audioContext();
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 } as MediaTrackConstraints,
  });
  micOpened(true);
  if (ctx.state !== 'running') await ctx.resume().catch(() => undefined);
  const src = ctx.createMediaStreamSource(stream);
  const label = stream.getAudioTracks()[0]?.label ?? '';
  const chunks: Float32Array[] = [];
  let recording = false;
  let node: AudioWorkletNode | ScriptProcessorNode | null = null;
  const mute = ctx.createGain();
  mute.gain.value = 0;
  mute.connect(ctx.destination);
  if (ctx.audioWorklet) {
    try {
      if (!workletReady) {
        const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
        workletReady = ctx.audioWorklet.addModule(url);
      }
      await workletReady;
      const w = new AudioWorkletNode(ctx, 'ra-rec');
      w.port.onmessage = (e) => { if (recording) chunks.push(e.data as Float32Array); };
      node = w;
    } catch {
      workletReady = null; // запасной путь ниже
    }
  }
  if (!node) {
    const sp = ctx.createScriptProcessor(4096, 1, 1);
    sp.onaudioprocess = (e) => { if (recording) chunks.push(new Float32Array(e.inputBuffer.getChannelData(0))); };
    node = sp;
  }
  const rec = node;
  src.connect(rec);
  rec.connect(mute);
  const analysers: AnalyserNode[] = [];
  let closed = false;
  return {
    sampleRate: ctx.sampleRate,
    label,
    running: () => ctx.state === 'running',
    start() {
      chunks.length = 0;
      recording = true;
      if (rec instanceof AudioWorkletNode) rec.port.postMessage(true);
    },
    stop() {
      recording = false;
      if (rec instanceof AudioWorkletNode) rec.port.postMessage(false);
      const n = chunks.reduce((a, c) => a + c.length, 0);
      const out = new Float32Array(n);
      let o = 0;
      for (const c of chunks) { out.set(c, o); o += c.length; }
      chunks.length = 0;
      return out;
    },
    analyser(fftSize = 32768) {
      const a = ctx.createAnalyser();
      a.fftSize = fftSize;
      a.smoothingTimeConstant = 0.75;
      src.connect(a);
      // анализатор должен быть подключён к выходу (через ноль), иначе Safari его не обрабатывает
      a.connect(mute);
      analysers.push(a);
      return a;
    },
    close() {
      if (closed) return;
      closed = true;
      recording = false;
      try { src.disconnect(); rec.disconnect(); mute.disconnect(); analysers.forEach((a) => a.disconnect()); } catch { /* уже отключено */ }
      stream.getTracks().forEach((t) => t.stop());
      micOpened(false);
    },
  };
}

/** Проиграть буфер через выход устройства; возвращает время окончания (с). */
export function playBuffer(x: Float32Array, delay = 0.4): Promise<void> {
  const ctx = audioContext();
  const buf = ctx.createBuffer(1, x.length, ctx.sampleRate);
  buf.copyToChannel(x as Float32Array<ArrayBuffer>, 0);
  const s = ctx.createBufferSource();
  s.buffer = buf;
  s.connect(ctx.destination);
  s.start(ctx.currentTime + delay);
  return new Promise((res) => { s.onended = () => res(); });
}

/** Отдать файл: «Поделиться» (на iPhone — сохранить в Файлы, AirDrop) или обычное скачивание. */
export async function shareFile(data: BlobPart, name: string, type: string): Promise<void> {
  const file = new File([data], name, { type });
  const nav = navigator as Navigator & { canShare?: (d: unknown) => boolean };
  if (nav.canShare?.({ files: [file] })) {
    try { await nav.share({ files: [file], title: name }); return; } catch (e) { if ((e as Error).name === 'AbortError') return; }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
