import { audioContext, micOpened } from './tone';
import { loadRecorder } from './recorderWorklet';
import { noiseDiagnostics, type NoiseDiagnostics } from './noiseDiagnostics';

export interface Mic {
  sampleRate: number;
  label: string;
  start(): void;
  stop(): Float32Array;
  analyser(fftSize?: number): AnalyserNode;
  close(): void;
  running(): boolean;
}

interface StreamOptions {
  signal: AbortSignal;
  onBlock(pcm: Float32Array, sequence: number): void;
  onInterrupt(reason: 'track' | 'context' | 'device'): void;
}
let owner: symbol | null = null;
const preferred = { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 };

export function openMic(): Promise<Mic>;
export function openMic(options: StreamOptions): Promise<Mic & { diagnostics: NoiseDiagnostics }>;
/** Общий контекст запускается внутри жеста. Один владелец, включая ожидание разрешения. */
export async function openMic(options?: StreamOptions): Promise<Mic & { diagnostics?: NoiseDiagnostics }> {
  const devices = navigator.mediaDevices;
  if (!devices?.getUserMedia) throw new DOMException('Откройте приложение в Safari по HTTPS.', 'NotSupportedError');
  if (owner) throw new DOMException('Микрофон уже занят другим измерением.', 'InvalidStateError');
  options?.signal.throwIfAborted();
  const ctx = audioContext();
  const lease = owner = Symbol();
  const chunks: Float32Array[] = [];
  const nodes: AudioNode[] = [];
  const listeners = new AbortController();
  let activeStream: MediaStream | null = null;
  let port: MessagePort | undefined;
  let processor: ScriptProcessorNode | undefined;
  let recording = false;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    listeners.abort();
    if (port) { port.onmessage = null; port.close(); }
    if (processor) processor.onaudioprocess = null;
    for (const node of nodes) node.disconnect();
    if (activeStream) {
      activeStream.getTracks().forEach(t => t.stop());
      micOpened(false);
    }
    chunks.length = 0;
    if (owner === lease) owner = null;
  };
  options?.signal.addEventListener('abort', close, { once: true, signal: listeners.signal });
  try {
    let stream: MediaStream;
    let fallback = false;
    try {
      stream = await devices.getUserMedia({ audio: preferred });
    } catch (error) {
      if (!options || closed || (error as Error).name !== 'OverconstrainedError') throw error;
      fallback = true;
      stream = await devices.getUserMedia({ audio: true });
    }
    if (closed) {
      stream.getTracks().forEach(t => t.stop());
      throw new DOMException('Запуск отменён', 'AbortError');
    }
    activeStream = stream;
    micOpened(true);
    if (ctx.state !== 'running' && !options) await ctx.resume().catch(() => undefined);
    const track = stream.getAudioTracks()[0];
    if (!track) throw new DOMException('Нет аудиодорожки', 'NotFoundError');
    if (options) {
      const listen = { signal: listeners.signal };
      const interruptTrack = () => options.onInterrupt('track');
      track.addEventListener('mute', interruptTrack, listen);
      track.addEventListener('ended', interruptTrack, listen);
      devices.addEventListener('devicechange', () => options.onInterrupt('device'), listen);
      ctx.addEventListener('statechange', () => {
        if (ctx.state !== 'running') options.onInterrupt('context');
      }, listen);
    }
    const src = ctx.createMediaStreamSource(stream);
    nodes.push(src);
    const mute = ctx.createGain();
    nodes.push(mute);
    mute.gain.value = 0;
    let rec: AudioNode | undefined;
    if (ctx.audioWorklet) {
      try {
        await loadRecorder(ctx);
        if (!closed) {
          const w = new AudioWorkletNode(ctx, 'ra-rec');
          rec = w;
          port = w.port;
          w.port.onmessage = ({ data }) => {
            if (closed) return;
            if (options) {
              w.port.postMessage('ack');
              options.onBlock(data.pcm, data.sequence);
            } else if (recording) chunks.push(data);
          };
        }
      } catch { /* ScriptProcessor ниже */ }
    }
    if (closed) throw new DOMException('Запуск отменён', 'AbortError');
    if (!rec) {
      processor = ctx.createScriptProcessor(4096, 1, 1);
      rec = processor;
      let sequence = 0;
      let lastTime: number | undefined;
      processor.onaudioprocess = e => {
        const pcm = e.inputBuffer.getChannelData(0);
        if (options) {
          if (lastTime !== undefined) sequence += Math.max(1, Math.round((e.playbackTime - lastTime) * ctx.sampleRate / pcm.length));
          lastTime = e.playbackTime;
          options.onBlock(pcm, sequence);
        } else if (recording) chunks.push(new Float32Array(pcm));
      };
    }
    nodes.push(rec);
    src.connect(rec);
    rec.connect(mute);
    mute.connect(ctx.destination);
    if (options && (track.muted || track.readyState === 'ended' || ctx.state !== 'running')) {
      throw new DOMException('Вход прерван. Коснитесь «Начать» ещё раз.', 'NotReadableError');
    }
    if (options) port?.postMessage('stream');
    return {
      sampleRate: ctx.sampleRate,
      label: track.label ?? '',
      diagnostics: options ? noiseDiagnostics(track, ctx.sampleRate, port ? 'AudioWorklet' : 'ScriptProcessor', fallback) : undefined,
      running: () => ctx.state === 'running',
      start() {
        chunks.length = 0;
        recording = true;
        port?.postMessage(true);
      },
      stop() {
        recording = false;
        port?.postMessage(false);
        const out = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
        let offset = 0;
        for (const c of chunks) { out.set(c, offset); offset += c.length; }
        chunks.length = 0;
        return out;
      },
      analyser(fftSize = 32768) {
        const a = ctx.createAnalyser();
        nodes.push(a);
        a.fftSize = fftSize;
        a.smoothingTimeConstant = 0.75;
        src.connect(a);
        a.connect(mute);
        return a;
      },
      close,
    };
  } catch (error) { close(); throw error; }
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
/** Передать файл через «Поделиться» (на iPhone — «Сохранить в Файлы») или скачать. false — пользователь отменил (024). */
export async function shareFile(data: BlobPart, name: string, type: string): Promise<boolean> {
  const file = new File([data], name, { type });
  const nav = navigator as Navigator & { canShare?: (d: unknown) => boolean };
  if (nav.canShare?.({ files: [file] })) {
    try { await nav.share({ files: [file], title: name }); return true; } catch (e) { if ((e as Error).name === 'AbortError') return false; }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return true;
}
