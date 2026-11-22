const keys = ['echoCancellation', 'noiseSuppression', 'autoGainControl', 'channelCount', 'sampleRate'] as const;
type PublicKey = typeof keys[number];

function audioFields(read: () => object | undefined, missing: false | null = null) {
  let fields: Partial<Record<PublicKey, unknown>> | undefined;
  try { fields = read(); } catch { /* API отсутствует или недоступен */ }
  return Object.fromEntries(keys.map(key => [key, fields ? fields[key] ?? missing : null]));
}

/** 057: событие входа за время захвата; время — от открытия входа. Без идентификаторов и названий. */
export interface InputEvent { atMs: number; type: 'mute' | 'unmute' | 'ended' | 'devicechange' | 'context'; state?: string }
export const MAX_INPUT_EVENTS = 32;

/** 057: как запущено приложение. Без UA: только режим отображения и свойство navigator.standalone (есть лишь в WebKit iOS). */
export function launchEnvironment() {
  let displayMode: 'standalone' | 'browser' | null = null;
  try { displayMode = matchMedia('(display-mode: standalone)').matches ? 'standalone' : 'browser'; } catch { /* нет matchMedia */ }
  const apple = (navigator as Navigator & { standalone?: unknown }).standalone;
  return { displayMode, appleStandalone: typeof apple === 'boolean' ? apple : null };
}

/** Разрешённый список исключает deviceId, groupId и произвольные названия устройств. events пополняется, пока вход открыт. */
export function noiseDiagnostics(track: MediaStreamTrack, sampleRate: number, backend: 'AudioWorklet' | 'ScriptProcessor', fallback: boolean,
  events: InputEvent[] = []) {
  return {
    sampleRate, backend, constraintsFallback: fallback, environment: launchEnvironment(), events,
    supported: audioFields(() => navigator.mediaDevices.getSupportedConstraints?.(), false),
    settings: audioFields(() => track.getSettings?.()),
    capabilities: audioFields(() => track.getCapabilities?.()),
    constraints: audioFields(() => track.getConstraints?.()),
  };
}

export type NoiseDiagnostics = ReturnType<typeof noiseDiagnostics>;
