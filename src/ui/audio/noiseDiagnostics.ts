const keys = ['echoCancellation', 'noiseSuppression', 'autoGainControl', 'channelCount', 'sampleRate'] as const;
type PublicKey = typeof keys[number];

function audioFields(read: () => object | undefined, missing: false | null = null) {
  let fields: Partial<Record<PublicKey, unknown>> | undefined;
  try { fields = read(); } catch { /* API отсутствует или недоступен */ }
  return Object.fromEntries(keys.map(key => [key, fields ? fields[key] ?? missing : null]));
}

/** Разрешённый список исключает deviceId, groupId и произвольные названия устройств. */
export function noiseDiagnostics(track: MediaStreamTrack, sampleRate: number, backend: 'AudioWorklet' | 'ScriptProcessor', fallback: boolean) {
  return {
    sampleRate, backend, constraintsFallback: fallback,
    supported: audioFields(() => navigator.mediaDevices.getSupportedConstraints?.(), false),
    settings: audioFields(() => track.getSettings?.()),
    capabilities: audioFields(() => track.getCapabilities?.()),
    constraints: audioFields(() => track.getConstraints?.()),
  };
}

export type NoiseDiagnostics = ReturnType<typeof noiseDiagnostics>;
