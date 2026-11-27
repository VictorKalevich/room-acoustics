// Перенос проекта legacy в комнату v2 (059, V2-009). Чистое преобразование: legacy-хранилище не читается и не меняется
// здесь. Идентификаторы детерминированы — повторный перенос того же состояния не создаёт дубликатов.
import type { Project } from '../../state/project';
import type { Measurement, Setup } from '../../core/types';
import { fromCore, toCore } from '../adapters/core';
import { DEFAULT_GOALS, ROOM_SCHEMA, type ArchivedVariant, type Room } from '../domain/model';
import type { MeasurementData, MeasurementRecord, OptimizationRun } from '../domain/measurement';
import { hashInputs } from '../domain/provenance';
import { validateConfiguration } from '../domain/validation';

export const legacyRoomId = (projectId: string) => `legacy-${projectId}`;

export interface MigrationPlan {
  room: Room;
  measurements: { record: MeasurementRecord; data: MeasurementData }[];
  runs: OptimizationRun[];
  notes: string[];
}

/** Нетронутый проект (комната не создана, нет вариантов, замеров и результата подбора) переносить незачем. */
export function isEmptyProject(p: Project): boolean {
  const measured = (s: Setup) => !!s.measurement || !!s.history?.length;
  return !p.roomReady && !p.setups.length && !measured(p.current) && !p.result && !p.scanInfo;
}

const LIMIT_SNAPSHOT = 'Перенесено из проекта legacy: снимка комнаты на момент записи нет.';
const LIMIT_REF = 'Опора уровня в legacy не записана: значения относительные.';

function measurementId(roomId: string, m: Measurement): string {
  return `${roomId}:m:${hashInputs({ name: m.name, importedAt: m.importedAt, session: m.session, f: m.f, db: m.db })}`;
}

export function convertProject(p: Project, now: string, roomId = legacyRoomId(p.id)): MigrationPlan {
  const notes: string[] = [];
  const configId = `${roomId}:current`;
  const current = fromCore(
    { room: p.room, sources: p.sources, constraints: p.constraints, setup: p.current, precision: p.precision, voice: p.voice },
    { id: configId, role: 'current', revision: 1, scan: p.scanInfo },
  );
  const conv = toCore(current);
  if (!conv.ok) throw new Error(conv.reason);
  notes.push(...conv.warnings);
  for (const i of validateConfiguration(current)) notes.push(i.message);
  if (!p.roomReady) notes.push('В legacy комната не была создана: размеры могут быть значениями по умолчанию.');
  if (p.scanInfo) notes.push('Сетка скана осталась в legacy: геометрия комнаты перенесена, поправка границ по скану — в legacy.');

  const measurements = new Map<string, { record: MeasurementRecord; data: MeasurementData }>();
  const take = (m: Measurement, setup: Setup, slot: 'current' | 'history', archiveId?: string): string => {
    const id = measurementId(roomId, m);
    if (measurements.has(id)) return id;
    const app = !!m.session;
    measurements.set(id, {
      record: {
        id, roomId, configId: archiveId ? null : configId, kind: 'frequency-response', name: m.name, recordedAt: m.importedAt,
        source: { kind: 'legacy-project', projectId: p.id, setupId: setup.id, setupName: setup.name, slot },
        provenance: {
          kind: app ? 'measured' : 'imported', method: app ? 'Свип в приложении legacy' : 'Импорт кривой в legacy',
          algorithmVersion: 'legacy', inputHash: hashInputs({ f: m.f, db: m.db }), createdAt: m.importedAt,
          warnings: [], limitations: [LIMIT_SNAPSHOT, LIMIT_REF],
        },
        snapshotId: null, lateBinding: true,
        ...(m.points !== undefined ? { points: m.points } : {}), ...(m.session ? { session: m.session } : {}), ...(archiveId ? { archiveId } : {}),
        summary: { fMin: Math.min(...m.f), fMax: Math.max(...m.f), count: m.f.length },
      },
      data: { id, f: [...m.f], db: [...m.db], ref: 'dB re unknown' },
    });
    return id;
  };
  const measuredIn = (s: Setup, archiveId?: string) => [
    ...(s.measurement ? [take(s.measurement, s, 'current', archiveId)] : []),
    ...(s.history ?? []).map((m) => take(m, s, 'history', archiveId)),
  ];
  measuredIn(p.current);

  const archive: ArchivedVariant[] = p.setups.map((s) => {
    const id = `${roomId}:setup:${s.id}`;
    return {
      id, name: s.name, savedAt: null, origin: 'legacy-setup',
      layout: { listener: { ...s.listener }, positions: structuredClone(s.positions), subSettings: structuredClone(s.subSettings), crossoverHz: s.crossoverHz },
      measurementIds: measuredIn(s, id),
    };
  });

  const runs: OptimizationRun[] = [];
  if (p.result) {
    const { stale: _stale, ...result } = p.result;
    runs.push({
      id: `${roomId}:run:legacy`, roomId, configId, createdAt: null, result: structuredClone(result), stale: true,
      provenance: {
        kind: 'calculated', method: 'Подбор мест legacy', algorithmVersion: 'legacy', configId, revision: 1, inputHash: '', createdAt: now,
        warnings: [], limitations: ['Результат подбора перенесён из legacy: актуальность не проверена — пересчитайте.'],
      },
    });
  }

  const room: Room = {
    schema: ROOM_SCHEMA, id: roomId, name: p.name || 'Комната из legacy', createdAt: now, updatedAt: now,
    current, experimental: null, goals: structuredClone(DEFAULT_GOALS), archive, history: [],
    origin: { kind: 'migrated', legacyProjectId: p.id, migratedAt: now, legacyUpdatedAt: p.updatedAt },
  };
  return { room, measurements: [...measurements.values()], runs, notes };
}
