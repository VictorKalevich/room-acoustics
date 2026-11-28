// V2-009: перенос legacy → v2 — legacy только читается, варианты уходят в архив, замеры не дублируются,
// снимки не выдумываются, повторный перенос не создаёт дубликатов и не перезаписывает изменённое в v2.
import { afterEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { newProject, type Project } from '../../src/state/project';
import { serializeProject } from '../../src/state/storage';
import type { Measurement } from '../../src/core/types';
import { convertProject, isEmptyProject, legacyRoomId } from '../../src/v2/storage/migration';
import { pickCandidates, readLegacyFile, readLegacyStore, LEGACY_DB } from '../../src/v2/storage/legacySource';
import { migrateLegacy } from '../../src/v2/application/migration';
import { openV2Db, req, type V2Db } from '../../src/v2/storage/db';
import { getMeta } from '../../src/v2/storage/rooms';
import { restoreArchived } from '../../src/v2/domain/operations';
import type { Clock } from '../../src/v2/application/rooms';

const NOW = '2026-11-27T12:00:00.000Z';
const meas = (name: string, shift = 0, session?: string): Measurement => ({
  name, importedAt: `2026-10-0${1 + shift}T10:00:00.000Z`, f: [20, 40, 80, 160], db: [70 + shift, 72, 69, 71], ...(session ? { session, points: 3 } : {}),
});

function project(id = 'p1', updatedAt = '2026-11-01T00:00:00.000Z'): Project {
  const p = newProject('Гостиная');
  p.id = id;
  p.updatedAt = updatedAt;
  p.roomReady = true;
  p.room.depth = 4.5;
  const shared = meas('Общий замер', 1);
  p.current = { ...p.current, measurement: meas('Свип', 0, 's1'), history: [shared], placed: true };
  p.setups = [
    { ...p.current, id: 's-a', name: 'У стены', positions: { ...p.current.positions, spkL: { x: 0.3, y: 1, z: 1 } }, measurement: shared, history: [] },
    { ...p.current, id: 's-b', name: 'Без замера', measurement: null, history: [] },
  ];
  p.result = { best: [], baseline: { listener: p.current.listener, seats: [], sources: [], score: 3, objScore: 3, scoreCenter: 3, scoreSeats: 3, penalties: [], angleDeg: null, response: { f: [], db: [], target: [] } }, fLo: 20, fHi: 120, schroeder: 150, evaluated: 10, elapsedMs: 5, notes: [], stale: true } as unknown as Project['result'];
  return p;
}

let n = 0;
const clock: Clock = { now: () => NOW, newId: () => `id-${++n}` };
let dbs: V2Db[] = [];
afterEach(() => { dbs.forEach((d) => d.close()); dbs = []; });
const v2db = (f: IDBFactory) => { const d = openV2Db(f); dbs.push(d); return d; };

/** База legacy той же схемы, что создаёт src/state/storage.ts (версия 2: projects, meta, scans). */
function seedLegacy(factory: IDBFactory, saved: unknown[], draft?: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const r = factory.open(LEGACY_DB, 2);
    r.onupgradeneeded = () => {
      r.result.createObjectStore('projects', { keyPath: 'id' });
      r.result.createObjectStore('meta');
      r.result.createObjectStore('scans', { keyPath: 'projectId' });
    };
    r.onsuccess = () => {
      const tx = r.result.transaction(['projects', 'meta'], 'readwrite');
      for (const s of saved) tx.objectStore('projects').put(s);
      if (draft) tx.objectStore('meta').put(draft, 'draft');
      tx.oncomplete = () => { r.result.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
    r.onerror = () => reject(r.error);
  });
}

function dumpLegacy(factory: IDBFactory): Promise<{ version: number; projects: unknown[]; draft: unknown }> {
  return new Promise((resolve, reject) => {
    const r = factory.open(LEGACY_DB);
    r.onsuccess = () => {
      const db = r.result;
      const tx = db.transaction(['projects', 'meta'], 'readonly');
      const a = tx.objectStore('projects').getAll();
      const b = tx.objectStore('meta').get('draft');
      tx.oncomplete = () => { db.close(); resolve({ version: db.version, projects: a.result, draft: b.result }); };
    };
    r.onerror = () => reject(r.error);
  });
}

describe('059 V2-009 · преобразование проекта', () => {
  it('текущее состояние, архив вариантов, замеры без дубликатов и без выдуманных снимков', () => {
    const plan = convertProject(project(), NOW);
    expect(plan.room).toMatchObject({ id: legacyRoomId('p1'), name: 'Гостиная', experimental: null, history: [], origin: { kind: 'migrated', legacyProjectId: 'p1', legacyUpdatedAt: '2026-11-01T00:00:00.000Z' } });
    expect(plan.room.current.geometry).toMatchObject({ depth: 4.5 });
    expect(plan.room.archive.map((a) => [a.name, a.origin, a.savedAt, a.measurementIds.length])).toEqual([['У стены', 'legacy-setup', null, 1], ['Без замера', 'legacy-setup', null, 0]]);
    expect(plan.measurements).toHaveLength(2);
    const [sweep, shared] = plan.measurements;
    expect(sweep.record).toMatchObject({ kind: 'frequency-response', snapshotId: null, lateBinding: true, session: 's1', points: 3, configId: plan.room.current.id, provenance: { kind: 'measured' } });
    expect(shared.record.provenance.kind).toBe('imported');
    expect(plan.room.archive[0].measurementIds).toEqual([shared.record.id]);
    expect(shared.data).toEqual({ id: shared.record.id, f: [20, 40, 80, 160], db: [71, 72, 69, 71], ref: 'dB re unknown' });
    expect(plan.runs).toHaveLength(1);
    expect(plan.runs[0]).toMatchObject({ stale: true, createdAt: null });
    expect('stale' in plan.runs[0].result).toBe(false);
  });

  it('детерминированные идентификаторы', () => {
    const a = convertProject(project(), NOW), b = convertProject(project(), '2027-01-01T00:00:00.000Z');
    expect(b.measurements.map((m) => m.record.id)).toEqual(a.measurements.map((m) => m.record.id));
    expect(b.room.archive.map((x) => x.id)).toEqual(a.room.archive.map((x) => x.id));
  });

  it('вариант из архива восстанавливается в эксперимент с прежними местами', () => {
    const plan = convertProject(project(), NOW);
    const room = restoreArchived(plan.room, plan.room.archive[0].id, clock.newId, NOW);
    expect(room.experimental!.audio.sources.find((s) => s.id === 'spkL')!.position).toEqual({ x: 0.3, y: 1, z: 1 });
    expect(room.current.audio.sources.find((s) => s.id === 'spkL')!.position).not.toEqual({ x: 0.3, y: 1, z: 1 });
  });

  it('нетронутый проект — пустой', () => {
    expect(isEmptyProject(newProject())).toBe(true);
    expect(isEmptyProject(project())).toBe(false);
  });
});

describe('059 V2-009 · чтение legacy', () => {
  it('нет базы legacy — она не создаётся', async () => {
    const f = new IDBFactory();
    const r = await readLegacyStore(f, { getItem: () => null });
    expect(r).toEqual({ candidates: [], problems: [], dbFound: false });
    expect(await f.databases()).toEqual([]);
  });

  it('рабочий проект, сохранённые проекты, запись при уходе; повреждённая запись — в проблемах; legacy не меняется', async () => {
    const f = new IDBFactory();
    const draft = project('p1', '2026-11-02T00:00:00.000Z');
    const saved = [project('p1', '2026-11-01T00:00:00.000Z'), project('p2'), { id: 'bad', room: { depth: 'x' }, sources: [{ id: 'spkL', kind: 'speaker', fLow: 900, fHigh: 100, height: 1 }] }];
    await seedLegacy(f, saved, draft);
    const before = await dumpLegacy(f);
    const pending = JSON.stringify(project('p3'));
    const r = await readLegacyStore(f, { getItem: (k) => (k === 'ra-draft-pending' ? pending : null) });
    expect(r.dbFound).toBe(true);
    expect(r.candidates.map((c) => [c.project.id, c.from])).toEqual([['p3', 'pending'], ['p1', 'draft'], ['p1', 'saved'], ['p2', 'saved']]);
    expect(r.problems.map((p) => p.id)).toEqual(['bad']);
    expect(await dumpLegacy(f)).toEqual(before);
    const { chosen, older } = pickCandidates(r.candidates);
    expect(chosen.map((c) => [c.project.id, c.from])).toEqual([['p3', 'pending'], ['p1', 'draft'], ['p2', 'saved']]);
    expect(older.map((c) => [c.project.id, c.from])).toEqual([['p1', 'saved']]);
  });

  it('файл проекта и чужой файл', () => {
    expect(readLegacyFile(serializeProject(project())).candidates[0].project.id).toBe('p1');
    expect(readLegacyFile('{"format":"other"}').problems[0].reason).toMatch(/не файл проекта/);
  });
});

describe('059 V2-009 · сценарий переноса', () => {
  it('повторный перенос не дублирует, изменённое в legacy не перезаписывает v2, отчёт сохраняется', async () => {
    const f = new IDBFactory();
    const db = v2db(f);
    const read = { candidates: [{ project: project(), from: 'draft' as const }, { project: newProject(), from: 'saved' as const }], problems: [], dbFound: true };
    const first = await migrateLegacy(db, read, clock);
    expect(first.entries.map((e) => e.status)).toEqual(['migrated', 'skipped-empty']);
    expect(first.entries[0]).toMatchObject({ archived: 2, measurements: 2 });
    const again = await migrateLegacy(db, read, clock);
    expect(again.entries[0].status).toBe('already-migrated');
    const count = () => db.run(['rooms', 'measurements', 'measurementData', 'optimizationRuns'], 'readonly', async (tx) => [
      await req(tx.objectStore('rooms').count()), await req(tx.objectStore('measurements').count()),
      await req(tx.objectStore('measurementData').count()), await req(tx.objectStore('optimizationRuns').count()),
    ]);
    expect(await count()).toEqual([1, 2, 2, 1]);

    const changed = { ...read, candidates: [{ project: project('p1', '2026-11-20T00:00:00.000Z'), from: 'draft' as const }] };
    const third = await migrateLegacy(db, changed, clock);
    expect(third.entries[0].status).toBe('legacy-changed');
    expect(await count()).toEqual([1, 2, 2, 1]);

    const fourth = await migrateLegacy(db, changed, clock, { reimport: ['p1'] });
    expect(fourth.entries[0]).toMatchObject({ status: 'migrated' });
    expect(fourth.entries[0].roomId).not.toBe(legacyRoomId('p1'));
    expect((await count())[0]).toBe(2);
    expect((await migrateLegacy(db, changed, clock, { reimport: ['p1'] })).entries[0].status).toBe('already-migrated');
    expect(await getMeta(db, 'migration')).toMatchObject({ at: NOW });
  });
});
