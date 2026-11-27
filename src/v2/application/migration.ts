// Сценарий переноса legacy → v2 (V2-009): только по действию пользователя, не при запуске. Каждый проект пишется
// одной транзакцией; уже перенесённый не дублируется, изменённая в v2 комната не перезаписывается.
import type { Project } from '../../state/project';
import { req, type V2Db } from '../storage/db';
import { setMeta } from '../storage/rooms';
import { convertProject, isEmptyProject, legacyRoomId } from '../storage/migration';
import { pickCandidates, type LegacyOrigin, type LegacyRead } from '../storage/legacySource';
import { hashInputs } from '../domain/provenance';
import type { Room } from '../domain/model';
import type { Clock } from './rooms';

export type MigrationStatus = 'migrated' | 'already-migrated' | 'legacy-changed' | 'skipped-empty' | 'failed';

export interface MigrationEntry {
  projectId: string;
  name: string;
  from: LegacyOrigin;
  status: MigrationStatus;
  roomId?: string;
  archived?: number;
  measurements?: number;
  notes: string[];
}

export interface MigrationReport {
  at: string;
  entries: MigrationEntry[];
  /** Записи legacy, которые не прочитались, и более старые копии тех же проектов (остались в legacy). */
  problems: { from: LegacyOrigin; id?: string; reason: string }[];
}

export interface MigrateOptions {
  /** Проекты, изменённые в legacy после переноса, перенести ещё раз отдельной комнатой. */
  reimport?: readonly string[];
}

async function migrateOne(db: V2Db, p: Project, from: LegacyOrigin, now: string, reimport: boolean): Promise<MigrationEntry> {
  const base: MigrationEntry = { projectId: p.id, name: p.name, from, status: 'failed', notes: [] };
  if (isEmptyProject(p)) return { ...base, status: 'skipped-empty', notes: ['Проект не начат: комната не создана, данных нет.'] };
  const firstId = legacyRoomId(p.id);
  return db.run(['rooms', 'measurements', 'measurementData', 'optimizationRuns'], 'readwrite', async (tx) => {
    const rooms = tx.objectStore('rooms');
    const existing = (await req(rooms.get(firstId))) as Room | undefined;
    let roomId = firstId;
    if (existing) {
      const sameState = existing.origin.kind === 'migrated' && existing.origin.legacyUpdatedAt === p.updatedAt;
      if (sameState) return { ...base, status: 'already-migrated' as const, roomId: firstId };
      if (!reimport) {
        return { ...base, status: 'legacy-changed' as const, roomId: firstId, notes: ['Проект изменён в legacy после переноса. Комната v2 не перезаписана; перенесите проект ещё раз отдельной комнатой.'] };
      }
      roomId = `${firstId}~${hashInputs(p.updatedAt).slice(0, 8)}`;
      const again = (await req(rooms.get(roomId))) as Room | undefined;
      if (again) return { ...base, status: 'already-migrated' as const, roomId };
    }
    const plan = convertProject(p, now, roomId);
    if (roomId !== firstId) plan.room.name = `${plan.room.name} (перенос ${p.updatedAt.slice(0, 10)})`;
    rooms.put(JSON.parse(JSON.stringify(plan.room)));
    for (const m of plan.measurements) {
      const known = await req(tx.objectStore('measurements').getKey(m.record.id));
      if (known !== undefined) continue;
      tx.objectStore('measurements').put(m.record);
      tx.objectStore('measurementData').put(m.data);
    }
    for (const r of plan.runs) tx.objectStore('optimizationRuns').put(JSON.parse(JSON.stringify(r)));
    return { ...base, status: 'migrated' as const, roomId, archived: plan.room.archive.length, measurements: plan.measurements.length, notes: plan.notes };
  });
}

export async function migrateLegacy(db: V2Db, read: LegacyRead, clock: Clock, opts: MigrateOptions = {}): Promise<MigrationReport> {
  const { chosen, older } = pickCandidates(read.candidates);
  const now = clock.now();
  const entries: MigrationEntry[] = [];
  for (const c of chosen) {
    try {
      entries.push(await migrateOne(db, c.project, c.from, now, !!opts.reimport?.includes(c.project.id)));
    } catch (e) {
      entries.push({ projectId: c.project.id, name: c.project.name, from: c.from, status: 'failed', notes: [e instanceof Error ? e.message : String(e)] });
    }
  }
  const problems = [
    ...read.problems,
    ...older.map((c) => ({ from: c.from, id: c.project.id, reason: `Более старая копия проекта «${c.project.name}» не перенесена и осталась в legacy.` })),
  ];
  const report: MigrationReport = { at: now, entries, problems };
  await setMeta(db, 'migration', report).catch(() => undefined);
  return report;
}
