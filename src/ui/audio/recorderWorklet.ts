/** Булевы сообщения сохраняют старую запись свипа/хлопка. Для потока максимум один пакет в пути. */
export const recorderWorklet = `
class RaRec extends AudioWorkletProcessor {
  constructor() {
    super();
    this.mode = false;
    this.buffer = new Float32Array(4096);
    this.offset = 0;
    this.pending = false;
    this.sequence = 0;
    this.port.onmessage = ({data}) => {
      if (data === 'ack') this.pending = false;
      else this.mode = data;
    };
  }
  process(inputs) {
    const ch = inputs[0]?.[0];
    if (!ch || !this.mode) return true;
    if (this.mode === true) { this.port.postMessage(ch.slice()); return true; }
    let pos = 0;
    while (pos < ch.length) {
      const count = Math.min(ch.length - pos, this.buffer.length - this.offset);
      this.buffer.set(ch.subarray(pos, pos + count), this.offset);
      this.offset += count;
      pos += count;
      if (this.offset === this.buffer.length) {
        if (!this.pending) {
          this.port.postMessage({ pcm: this.buffer, sequence: this.sequence });
          this.pending = true;
        }
        this.sequence++;
        this.offset = 0;
      }
    }
    return true;
  }
}
registerProcessor('ra-rec', RaRec);
`;

const modules = new WeakMap<AudioContext, Promise<void>>();
export function loadRecorder(ctx: AudioContext) {
  let loading = modules.get(ctx);
  if (!loading) {
    const url = URL.createObjectURL(new Blob([recorderWorklet], { type: 'application/javascript' }));
    loading = Promise.resolve().then(() => ctx.audioWorklet.addModule(url))
      .catch(error => { modules.delete(ctx); throw error; })
      .finally(() => URL.revokeObjectURL(url));
    modules.set(ctx, loading);
  }
  return loading;
}
