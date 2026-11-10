import { useEffect, useState } from 'preact/hooks';
import type { Project } from '../state/project';
import { defaultConstraints, newProject, syncSetup } from '../state/project';
import { loadDraft, saveDraft } from '../state/storage';
import type { Constraints, Room, Setup, SourceSpec } from '../core/types';
import type { VoiceSettings } from '../core/voice';
import { clampToRoom } from '../core/system';
import { setBeforeReload } from './updates';

/** Приводит расстановку к текущим источникам и размерам комнаты. */
function fitSetup(s: Setup, p: Project): Setup {
  const synced = syncSetup(s, p.room, p.sources, p.constraints);
  return {
    ...synced,
    listener: clampToRoom(p.room, synced.listener, 0.1),
    positions: Object.fromEntries(Object.entries(synced.positions).map(([k, v]) => [k, clampToRoom(p.room, v)])),
  };
}

/** Держит зону слушателя внутри комнаты после изменения размеров. */
function fitConstraints(c: Constraints, room: Room): Constraints {
  const d = defaultConstraints(room);
  const bad = c.listenerMaxX >= room.depth - 0.05 || c.listenerMinX >= c.listenerMaxX || c.listenerMinX <= 0;
  return bad ? { ...c, listenerMinX: d.listenerMinX, listenerMaxX: d.listenerMaxX } : c;
}

export function useProject() {
  const [project, setProject] = useState<Project>(() => newProject());
  const [ready, setReady] = useState(false);
  useEffect(() => {
    loadDraft()
      .then((d) => d && setProject(d))
      .catch(() => undefined)
      .finally(() => setReady(true));
  }, []);

  useEffect(() => {
    if (ready) setBeforeReload(() => saveDraft(project));
  }, [project, ready]);

  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => saveDraft(project).catch(() => undefined), 300);
    return () => clearTimeout(t);
  }, [project, ready]);

  const touch = (p: Partial<Project>, invalidate = true) =>
    setProject((prev) => {
      const next: Project = {
        ...prev,
        ...p,
        updatedAt: new Date().toISOString(),
        // явно переданный результат (в том числе null после очистки комнаты) важнее пометки «устарел»
        result: p.result !== undefined ? p.result : invalidate && prev.result ? { ...prev.result, stale: true } : prev.result,
      };
      if (p.room || p.sources || p.constraints || p.current) {
        next.current = fitSetup(next.current, next);
        if (p.room || p.sources) next.setups = next.setups.map((x) => fitSetup(x, next));
      }
      return next;
    });

  const onRoom = (room: Room, extra: Partial<Project> = {}) =>
    touch({ ...extra, room, constraints: fitConstraints(extra.constraints ?? project.constraints, room) });
  const onSources = (sources: SourceSpec[]) => touch({ sources });
  const onConstraints = (constraints: Constraints) => touch({ constraints });
  const onSetup = (current: Setup) => touch({ current }, false);
  const onSetups = (setups: Setup[]) => touch({ setups }, false);
  const onVoice = (voice: VoiceSettings) => touch({ voice }, false);
  return { project, setProject, ready, touch, onRoom, onSources, onConstraints, onSetup, onSetups, onVoice };
}
