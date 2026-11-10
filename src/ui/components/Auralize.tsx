// Прослушивание в наушниках: музыка через смоделированный бас комнаты в месте слушателя, «до» и «после» эквалайзера.
import { useEffect, useRef, useState } from 'preact/hooks';
import type { PeqFilter } from '../../core/eq';
import { peqResponse } from '../../core/eq';
import { firMinPhaseFromCurve } from '../../core/dsp';
import { audioContext, playerActive } from '../audio/tone';
import { setBusy } from '../updates';
import { S } from '../strings';

interface Props {
  active?: boolean;
  /** АЧХ в месте слушателя и цель (дБ) на сетке f. */
  response: { f: number[]; db: number[]; target: number[] };
  filters: PeqFilter[];
}

/** Тестовый басовый фрагмент: ноты 30–110 Гц с атакой, 8 с, по кругу. */
function demoBass(ctx: AudioContext): AudioBuffer {
  const fs = ctx.sampleRate, dur = 8;
  const buf = ctx.createBuffer(2, fs * dur, fs);
  const notes = [41.2, 55, 49, 36.7, 61.7, 73.4, 46.2, 82.4, 98, 41.2, 110, 55, 65.4, 43.7, 51.9, 32.7];
  const L = buf.getChannelData(0), R = buf.getChannelData(1);
  const step = dur / notes.length;
  for (let i = 0; i < L.length; i++) {
    const t = i / fs, k = Math.floor(t / step), tt = t - k * step, f = notes[k];
    const env = Math.min(1, tt * 60) * Math.exp(-tt * 2.2);
    const kick = tt < 0.12 ? Math.sin(2 * Math.PI * (50 + 80 * Math.exp(-tt * 40)) * tt) * Math.exp(-tt * 25) * 0.6 : 0;
    const v = 0.35 * env * (Math.sin(2 * Math.PI * f * t) + 0.3 * Math.sin(4 * Math.PI * f * t)) + kick;
    L[i] = v; R[i] = v;
  }
  return buf;
}

export function Auralize({ response, filters, active = true }: Props) {
  const [playing, setPlaying] = useState(false);
  const [after, setAfter] = useState(false);
  const [file, setFile] = useState<AudioBuffer | null>(null);
  const [name, setName] = useState('');
  const nodes = useRef<{ src: AudioBufferSourceNode; gA: GainNode; gB: GainNode } | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const stop = () => {
    const n = nodes.current;
    if (n) { try { n.src.stop(); } catch { /* */ } n.src.disconnect(); n.gA.disconnect(); n.gB.disconnect(); }
    nodes.current = null;
    setPlaying(false);
    setBusy('aural', false);
    playerActive('aural', false);
  };
  useEffect(() => stop, []);
  useEffect(() => { if (!active) stop(); }, [active]);

  const start = () => {
    playerActive('aural', true);
    const ctx = audioContext();
    const dev = response.db.map((v, i) => v - response.target[i]);
    const mean = dev.reduce((a, b) => a + b, 0) / dev.length;
    const room = dev.map((v) => v - mean);
    const eq = peqResponse(filters, response.f);
    // минимально-фазовый фильтр: резонансы комнаты «звенят» после ноты, как в реальности (без предзвона)
    const mk = (db: number[]) => {
      const ir = firMinPhaseFromCurve(response.f, db, ctx.sampleRate, 131072);
      const b = ctx.createBuffer(1, ir.length, ctx.sampleRate);
      b.copyToChannel(ir as Float32Array<ArrayBuffer>, 0);
      const c = ctx.createConvolver();
      c.normalize = false;
      c.buffer = b;
      return c;
    };
    const cA = mk(room), cB = mk(room.map((v, i) => v + eq[i]));
    const src = ctx.createBufferSource();
    src.buffer = file ?? demoBass(ctx);
    src.loop = true;
    const gA = ctx.createGain(), gB = ctx.createGain();
    gA.gain.value = after ? 0 : 0.7;
    gB.gain.value = after ? 0.7 : 0;
    src.connect(cA); src.connect(cB);
    cA.connect(gA); cB.connect(gB);
    gA.connect(ctx.destination); gB.connect(ctx.destination);
    src.start();
    nodes.current = { src, gA, gB };
    setPlaying(true);
    setBusy('aural', true);
  };

  const flip = (v: boolean) => {
    setAfter(v);
    const n = nodes.current;
    if (!n) return;
    const t = audioContext().currentTime;
    n.gA.gain.setTargetAtTime(v ? 0 : 0.7, t, 0.03);
    n.gB.gain.setTargetAtTime(v ? 0.7 : 0, t, 0.03);
  };

  return (
    <div class="auralize">
      <p class="small">{S.aural.intro}</p>
      <div class="btn-row">
        <button type="button" class="btn btn--primary" onClick={playing ? stop : start}>{playing ? S.aural.stop : S.aural.play}</button>
        <button type="button" class="btn btn--ghost" onClick={() => input.current?.click()}>{S.aural.pick}</button>
      </div>
      <p class="muted small">{file ? S.aural.file(name) : S.aural.demo}</p>
      <div class="segmented" role="radiogroup" aria-label={S.aural.ab}>
        <button type="button" role="radio" aria-checked={!after} class={!after ? 'is-on' : ''} onClick={() => flip(false)}>{S.aural.before}</button>
        <button type="button" role="radio" aria-checked={after} class={after ? 'is-on' : ''} onClick={() => flip(true)} disabled={!filters.length}>{S.aural.after}</button>
      </div>
      <p class="muted small">{S.aural.note}</p>
      <input
        ref={input}
        type="file"
        accept="audio/*"
        class="visually-hidden"
        onChange={async (e) => {
          const f = (e.target as HTMLInputElement).files?.[0];
          (e.target as HTMLInputElement).value = '';
          if (!f) return;
          try {
            const buf = await audioContext().decodeAudioData(await f.arrayBuffer());
            stop();
            setFile(buf);
            setName(f.name);
          } catch { setName(''); }
        }}
      />
    </div>
  );
}
