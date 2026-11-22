/** Контракт этапа C. Версия численной кривой неизменяема после сохранения. */
export interface MicProfile {
  id: string;
  version: number;
  name: string;
  deviceModel: string;
  inputKind: 'built-in' | 'external' | 'unknown';
  captureMode: string;
  orientation: string | null;
  origin: 'builtin' | 'user';
  sourceURL: string | null;
  sourceDate: string | null;
  method: string;
  curve: { frequencyHz: readonly number[] } & (
    { kind: 'response'; responseDb: readonly number[] } | { kind: 'correction'; correctionDb: readonly number[] }
  );
  referenceHz: number;
  maxBoostDb?: number;
  validRangeHz: readonly [number, number];
  digitizationUncertaintyDb: number | null;
  validationStatus: 'experimental' | 'validated' | 'unverified';
  notes: string;
  directivitySource: string | null;
}
export type MicScope = { tool: 'noise' } | { tool: 'sweep' | 'clap' | 'rta'; projectId: string };
export type MicSelection = { mode: 'legacy' | 'none' } | { mode: 'catalog'; profileId: string; version: number };
export function defaultMicSelection(scope: MicScope): MicSelection {
  return { mode: scope.tool === 'noise' ? 'none' : 'legacy' };
}
export interface MicInputPreference {
  source: 'system' | { localDeviceId: string };
  confirmedModel: string | null;
  absoluteCalibration: { offsetDb: number; physicalInput: string; captureMode: string; verifiedAt: string;
    references?: readonly { referenceSpl: number; measuredDbfs: number }[] } | null;
}
/** Отдельное от Project хранилище. Импорт добавляет версию, выбор — отдельная операция. */
export interface MicCatalog {
  list(): Promise<readonly MicProfile[]>;
  saveVersion(profile: MicProfile): Promise<void>;
  readSelection(scope: MicScope): Promise<MicSelection>;
  select(scope: MicScope, selection: MicSelection): Promise<void>;
  readInput(scope: MicScope): Promise<MicInputPreference>;
  saveInput(scope: MicScope, preference: MicInputPreference): Promise<void>;
}
