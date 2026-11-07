import { useEffect, useMemo, useState } from 'preact/hooks';
import type { Project } from '../state/project';
import { defaultConstraints, newProject } from '../state/project';
import { loadDraft, saveDraft } from '../state/storage';
import type { Constraints, Room, SourceSpec } from '../core/types';
import { computeReverb } from '../core/reverb';
import { computeModes } from '../core/modes';
import { RoomScreen } from './screens/RoomScreen';
import { ModesScreen } from './screens/ModesScreen';
import { PlacementScreen } from './screens/PlacementScreen';
import { ProjectsScreen } from './screens/ProjectsScreen';
import { S } from './strings';
import { fmt } from './format';

type Tab = 'room' | 'modes' | 'placement' | 'projects';
const TABS: Tab[] = ['room', 'modes', 'placement', 'projects'];
const TITLES: Record<Tab, string> = {
  room: S.room.title,
  modes: S.modes.title,
  placement: S.placement.title,
  projects: S.projects.title,
};

function readTab(): Tab {
  const h = location.hash.replace('#', '') as Tab;
  return TABS.includes(h) ? h : 'room';
}

/** Держит зону слушателя внутри комнаты после изменения размеров. */
function fitConstraints(c: Constraints, room: Room): Constraints {
  const d = defaultConstraints(room);
  const bad = c.listenerMaxX >= room.depth - 0.05 || c.listenerMinX >= c.listenerMaxX || c.listenerMinX <= 0;
  return bad ? { ...c, listenerMinX: d.listenerMinX, listenerMaxX: d.listenerMaxX } : c;
}

export function App() {
  const [tab, setTab] = useState<Tab>(readTab);
  const [project, setProject] = useState<Project>(() => newProject());
  const [ready, setReady] = useState(false);

  useEffect(() => {
    loadDraft()
      .then((d) => d && setProject(d))
      .catch(() => undefined)
      .finally(() => setReady(true));
    const onHash = () => setTab(readTab());
    addEventListener('hashchange', onHash);
    return () => removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => saveDraft(project).catch(() => undefined), 300);
    return () => clearTimeout(t);
  }, [project, ready]);

  const go = (t: Tab) => {
    setTab(t);
    history.replaceState(null, '', `#${t}`);
    scrollTo({ top: 0 });
  };

  const touch = (p: Partial<Project>, invalidate = true) =>
    setProject((prev) => ({
      ...prev,
      ...p,
      updatedAt: new Date().toISOString(),
      result: invalidate && prev.result ? { ...prev.result, stale: true } : p.result !== undefined ? p.result : prev.result,
    }));

  const onRoom = (room: Room, extra: Partial<Project> = {}) =>
    touch({ room, constraints: fitConstraints(extra.constraints ?? project.constraints, room), ...extra });
  const onSources = (sources: SourceSpec[]) => touch({ sources });
  const onConstraints = (constraints: Constraints) => touch({ constraints });

  const reverb = useMemo(() => computeReverb(project.room), [project.room]);
  const fMax = Math.min(500, Math.max(200, reverb.schroeder));
  const modes = useMemo(() => computeModes(project.room, fMax), [project.room, fMax]);

  const r = project.room;
  return (
    <div class="app">
      <header class="topbar">
        <div class="topbar__inner">
          <h1 class="topbar__title">{TITLES[tab]}</h1>
          <span class="topbar__room">
            {project.name}, {fmt(r.depth, 2)} × {fmt(r.width, 2)} × {fmt(r.height, 2)} м
          </span>
        </div>
      </header>

      <main class="content">
        <div hidden={tab !== 'room'}>
          <RoomScreen project={project} reverb={reverb} onRoom={onRoom} />
        </div>
        {tab === 'modes' && <ModesScreen room={r} modes={modes} fMax={fMax} reverb={reverb} />}
        <div hidden={tab !== 'placement'}>
          <PlacementScreen
            project={project}
            onSources={onSources}
            onConstraints={onConstraints}
            onResult={(result, selectedIndex) => touch({ result, selectedIndex }, false)}
            onSelect={(selectedIndex) => setProject((p) => ({ ...p, selectedIndex }))}
          />
        </div>
        {tab === 'projects' && (
          <ProjectsScreen
            project={project}
            onReplace={(p) => { setProject(p); go('room'); }}
            onRename={(name) => touch({ name }, false)}
          />
        )}
      </main>

      <nav class="tabbar" aria-label="Разделы">
        {TABS.map((t) => (
          <button type="button" class={t === tab ? 'is-on' : ''} aria-current={t === tab ? 'page' : undefined} onClick={() => go(t)}>
            <TabIcon tab={t} />
            <span>{S.tabs[t]}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

function TabIcon({ tab }: { tab: Tab }) {
  const paths: Record<Tab, string> = {
    room: 'M4 5h16v14H4z M4 5l3 3h10l3-3 M7 8v8 M17 8v8',
    modes: 'M3 19h18 M6 19V7 M10 19v-7 M14 19V5 M18 19v-9',
    placement: 'M5 4h4v5H5z M15 4h4v5h-4z M12 19.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z M7 9l5 6 5-6',
    projects: 'M4 6h6l2 2h8v11H4z',
  };
  return (
    <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d={paths[tab]} />
    </svg>
  );
}
