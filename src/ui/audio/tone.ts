// Тон выбранной частоты через звуковой выход устройства (в вашу систему).
// Мягкое включение и выключение, чтобы не было щелчков.
import { setBusy } from '../updates';

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

function emit() { setBusy('tone', state.playing); subs.forEach((s) => s(state)); }

let micOpen = 0;
const players = new Set<string>();

/**
 * Тип звуковой сессии iOS (Safari 17+): «play-and-record», пока открыт микрофон; «playback», пока что-то играет
 * (звук идёт и в беззвучном режиме); иначе «auto». В других браузерах ничего не делает.
 */
function applySession() {
  const nav = navigator as Navigator & { audioSession?: { type: string } };
  const type = micOpen > 0 ? 'play-and-record' : players.size ? 'playback' : 'auto';
  try { if (nav.audioSession && nav.audioSession.type !== type) nav.audioSession.type = type; } catch { /* не поддерживается */ }
}
/** Отметить, что источник звука (тон, прослушивание) играет или замолчал. */
export function playerActive(key: string, on: boolean) {
  if (on) players.add(key); else players.delete(key);
  applySession();
}
export function micOpened(on: boolean) {
  micOpen = Math.max(0, micOpen + (on ? 1 : -1));
  setBusy('mic', micOpen > 0);
  applySession();
}

export function getTone(): ToneState { return state; }

export function onTone(fn: (s: ToneState) => void): () => void {
  subs.add(fn);
  return () => { subs.delete(fn); };
}

/** Общий AudioContext. Вызывать синхронно в обработчике касания — иначе iOS оставит его на паузе. */
export function audioContext(): AudioContext {
  if (!ctx) {
    ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
  }
  // iOS: 'suspended' до касания, 'interrupted' после звонка или ухода в фон
  if (ctx.state !== 'running') void ctx.resume().catch(() => undefined);
  return ctx;
}

export function playTone(f: number, label = '') {
  playerActive('tone', true); // звук и в беззвучном режиме iPhone
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
  playerActive('tone', false);
  emit();
}

export function toggleTone(f: number, label = '') {
  if (state.playing && Math.abs(state.f - f) < 0.01) stopTone();
  else playTone(f, label);
}
