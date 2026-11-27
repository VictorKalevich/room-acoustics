// Звук инструментов v2 (V2-036, V2-037, R32): собственный модуль, звуковая часть legacy не подключается. Запуск —
// только по нажатию; одновременно работает одна запись или одно воспроизведение; при уходе со страницы или
// скрытии вкладки звук останавливается и сам не возобновляется.
import { useEffect, useRef } from 'preact/hooks';

const BLOCK = 4096;
const WORKLET = `
class V2Capture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(${BLOCK});
    this.offset = 0;
    this.sequence = 0;
    this.on = true;
    this.port.onmessage = ({ data }) => { if (data === 'stop') this.on = false; };
  }
  process(inputs) {
    if (!this.on) return false;
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    let pos = 0;
    while (pos < ch.length) {
      const count = Math.min(ch.length - pos, this.buffer.length - this.offset);
      this.buffer.set(ch.subarray(pos, pos + count), this.offset);
      this.offset += count;
      pos += count;
      if (this.offset === this.buffer.length) {
        this.port.postMessage({ pcm: this.buffer.slice(), sequence: this.sequence++ });
        this.offset = 0;
      }
    }
    return true;
  }
}
registerProcessor('v2-capture', V2Capture);
`;

type Ctor = typeof AudioContext;
let ctx: AudioContext | null = null;
let worklet: Promise<void> | null = null;
let active: (() => void) | null = null;

export function audioSupport(): { input: boolean; output: boolean } {
  const C = (globalThis as { AudioContext?: Ctor; webkitAudioContext?: Ctor }).AudioContext ?? (globalThis as { webkitAudioContext?: Ctor }).webkitAudioContext;
  return { output: !!C, input: !!C && !!globalThis.navigator?.mediaDevices?.getUserMedia && typeof AudioWorkletNode !== 'undefined' };
}

function context(): AudioContext {
  if (!ctx || ctx.state === 'closed') {
    const C = (globalThis as { AudioContext?: Ctor }).AudioContext ?? (globalThis as unknown as { webkitAudioContext: Ctor }).webkitAudioContext;
    ctx = new C({ latencyHint: 'interactive' });
    worklet = null;
  }
  return ctx;
}

/** Частота дискретизации, с которой будут играться и записываться сигналы. */
export const outputRate = () => context().sampleRate;

/** Остановить то, что сейчас звучит или пишет. */
export function stopAudio(): void {
  const stop = active;
  active = null;
  stop?.();
}

function claim(stop: () => void) {
  stopAudio();
  active = stop;
  return () => { if (active === stop) active = null; };
}

export interface Playback { stop: () => void; ended: Promise<void> }

/** Воспроизвести каналы [левый, правый]; loop — по кругу до «Стоп». */
export async function play(channels: readonly Float32Array[], fs: number, loop: boolean): Promise<Playback> {
  const c = context();
  await c.resume();
  const buf = c.createBuffer(channels.length, channels[0].length, fs);
  channels.forEach((ch, i) => buf.copyToChannel(ch as Float32Array<ArrayBuffer>, i));
  const src = c.createBufferSource();
  src.buffer = buf;
  src.loop = loop;
  src.connect(c.destination);
  let done!: () => void;
  const ended = new Promise<void>((r) => { done = r; });
  let release = () => undefined as void;
  const stop = () => { try { src.stop(); } catch { /* уже остановлен */ } src.disconnect(); release(); done(); };
  src.onended = () => { src.disconnect(); release(); done(); };
  release = claim(stop);
  src.start();
  return { stop, ended };
}

export interface Capture {
  sampleRate: number;
  device: string;
  /** Обработка речи (эхо, шумоподавление, автоусиление), которую браузер не дал выключить. */
  processing: string[];
  stop: () => void;
}

const SPEECH: [keyof MediaTrackSettings, string][] = [['echoCancellation', 'эхоподавление'], ['noiseSuppression', 'шумоподавление'], ['autoGainControl', 'автоусиление']];

/** Открыть микрофон без обработки речи; блоки по 4096 отсчётов с номером (пропуски видны по номеру). */
export async function openCapture(onBlock: (pcm: Float32Array, sequence: number) => void): Promise<Capture> {
  if (!audioSupport().input) throw new Error('Браузер не даёт доступ к микрофону. Откройте приложение по HTTPS в Safari или Chrome.');
  const c = context();
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
  try {
    await c.resume();
    if (!worklet) {
      const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
      worklet = c.audioWorklet.addModule(url).finally(() => URL.revokeObjectURL(url));
      worklet.catch(() => { worklet = null; });
    }
    await worklet;
  } catch (e) {
    stream.getTracks().forEach((t) => t.stop());
    throw e;
  }
  const source = c.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(c, 'v2-capture', { numberOfInputs: 1, numberOfOutputs: 0, channelCount: 1, channelCountMode: 'explicit' });
  node.port.onmessage = ({ data }: MessageEvent<{ pcm: Float32Array; sequence: number }>) => onBlock(data.pcm, data.sequence);
  source.connect(node);
  const track = stream.getAudioTracks()[0];
  const settings = track?.getSettings?.() ?? {};
  let release = () => undefined as void;
  let closed = false;
  const stop = () => {
    if (closed) return;
    closed = true;
    node.port.postMessage('stop');
    node.port.onmessage = null;
    source.disconnect();
    stream.getTracks().forEach((t) => t.stop());
    release();
  };
  release = claim(stop);
  return { sampleRate: c.sampleRate, device: track?.label || 'Микрофон', processing: SPEECH.filter(([k]) => settings[k] === true).map(([, v]) => v), stop };
}

/** Воспроизвести сигнал и одновременно записать микрофон; запись идёт ещё `tail` секунд после конца сигнала. */
export async function playAndRecord(channels: readonly Float32Array[], tail: number, signal: AbortSignal): Promise<{ rec: Float32Array; fs: number; device: string; processing: string[] }> {
  const local = new AbortController();
  const abort = () => local.abort();
  signal.addEventListener('abort', abort, { once: true });
  const blocks: Float32Array[] = [];
  const cap = await openCapture((pcm) => blocks.push(pcm));
  // остановка (кнопкой, уходом со страницы или новым звуком) прерывает и воспроизведение, и запись
  active = abort;
  const stopped = () => new DOMException('Остановлено', 'AbortError');
  try {
    if (local.signal.aborted) throw stopped();
    const c = context(), fs = cap.sampleRate;
    const buf = c.createBuffer(channels.length, channels[0].length, fs);
    channels.forEach((ch, i) => buf.copyToChannel(ch as Float32Array<ArrayBuffer>, i));
    const src = c.createBufferSource();
    src.buffer = buf;
    src.connect(c.destination);
    const ended = new Promise<void>((resolve, reject) => {
      src.onended = () => resolve();
      local.signal.addEventListener('abort', () => { try { src.stop(); } catch { /* уже остановлен */ } reject(stopped()); }, { once: true });
    });
    src.start(c.currentTime + 0.3);
    try { await ended; } finally { src.disconnect(); }
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(resolve, tail * 1000);
      local.signal.addEventListener('abort', () => { clearTimeout(t); reject(stopped()); }, { once: true });
    });
    const rec = new Float32Array(blocks.length * BLOCK);
    blocks.forEach((b, i) => rec.set(b, i * BLOCK));
    return { rec, fs, device: cap.device, processing: cap.processing };
  } finally {
    signal.removeEventListener('abort', abort);
    if (active === abort) active = null;
    cap.stop();
  }
}

/** Остановить звук при уходе с экрана, скрытии вкладки и закрытии страницы. */
export function useStopOnLeave(stop: () => void): void {
  const ref = useRef(stop);
  useEffect(() => { ref.current = stop; });
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden') ref.current(); };
    const onPageHide = () => ref.current();
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onPageHide);
      ref.current();
    };
  }, []);
}
