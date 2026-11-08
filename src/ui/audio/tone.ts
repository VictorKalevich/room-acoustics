// Тон выбранной частоты через звуковой выход устройства (в вашу систему).
// Мягкое включение и выключение, чтобы не было щелчков.

export interface ToneState {
  playing: boolean;
  f: number;
  /** Громкость 0…1. */
  volume: number;
  label: string;
}

let ctx: AudioContext | null = null;
let osc: OscillatorNode | null = null;
let gain: GainNode | null = null;
let state: ToneState = { playing: false, f: 50, volume: 0.25, label: '' };
const subs = new Set<(s: ToneState) => void>();

function emit() { subs.forEach((s) => s(state)); }

export function getTone(): ToneState { return state; }

export function onTone(fn: (s: ToneState) => void): () => void {
  subs.add(fn);
  return () => { subs.delete(fn); };
}

export function audioContext(): AudioContext {
  if (!ctx) ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

export function playTone(f: number, label = '') {
  const ac = audioContext();
  if (!osc) {
    gain = ac.createGain();
    gain.gain.value = 0;
    gain.connect(ac.destination);
    osc = ac.createOscillator();
    osc.type = 'sine';
    osc.connect(gain);
    osc.start();
  }
  osc.frequency.setTargetAtTime(f, ac.currentTime, 0.02);
  gain!.gain.cancelScheduledValues(ac.currentTime);
  gain!.gain.setTargetAtTime(state.volume, ac.currentTime, 0.05);
  state = { ...state, playing: true, f, label };
  emit();
}

export function setToneFrequency(f: number) {
  if (!osc || !ctx) { state = { ...state, f }; emit(); return; }
  osc.frequency.setTargetAtTime(f, ctx.currentTime, 0.02);
  state = { ...state, f };
  emit();
}

export function setToneVolume(v: number) {
  state = { ...state, volume: Math.max(0, Math.min(1, v)) };
  if (gain && ctx && state.playing) gain.gain.setTargetAtTime(state.volume, ctx.currentTime, 0.05);
  emit();
}

export function stopTone() {
  if (osc && gain && ctx) {
    const o = osc, g = gain, t = ctx.currentTime;
    g.gain.cancelScheduledValues(t);
    g.gain.setTargetAtTime(0, t, 0.04);
    setTimeout(() => { try { o.stop(); o.disconnect(); g.disconnect(); } catch { /* уже остановлен */ } }, 300);
  }
  osc = null;
  gain = null;
  state = { ...state, playing: false };
  emit();
}

export function toggleTone(f: number, label = '') {
  if (state.playing && Math.abs(state.f - f) < 0.01) stopTone();
  else playTone(f, label);
}
