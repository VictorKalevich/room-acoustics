import { useEffect, useMemo, useState } from 'preact/hooks';
import type { Project } from '../state/project';
import { defaultConstraints, newProject, syncSetup } from '../state/project';
import { loadDraft, saveDraft } from '../state/storage';
import type { Constraints, Room, Setup, SourceSpec } from '../core/types';
import { clampToRoom } from '../core/system';
import { computeReverb } from '../core/reverb';
import { computeModes } from '../core/modes';
import { RoomScreen } from './screens/RoomScreen';
import { ModesScreen } from './screens/ModesScreen';
import { PlacementScreen } from './screens/PlacementScreen';
import { ProjectsScreen } from './screens/ProjectsScreen';
import { TuningScreen } from './screens/TuningScreen';
import { FieldScreen } from './screens/FieldScreen';
import { Segmented } from './components/Fields';
import { Drawer, type DrawerItem } from './components/Drawer';
import { TermSheet } from './components/Term';
import { MiniPlayer } from './components/MiniPlayer';
import { WizardStrip } from './components/WizardStrip';
import { wizardOn } from './wizard';
import { HelpScreen } from './screens/HelpScreen';
import { MeasureScreen } from './screens/MeasureScreen';
import { ReportScreen } from './screens/ReportScreen';
import { SyncScreen } from './screens/SyncScreen';
import { OverviewScreen } from './screens/OverviewScreen';
import { AboutPanel } from './screens/ProjectsScreen';
import { ProblemReport } from './components/ProblemReport';
import { setFieldFocus } from './screens/FieldScreen';
import { S } from './strings';
import { fmt } from './format';
import { consumeJustUpdated, setBeforeReload } from './updates';
import { activeTreatments } from '../core/treatments';

type Tab = 'room' | 'modes' | 'placement' | 'tuning' | 'projects' | DrawerItem;
const TABS: Tab[] = ['room', 'modes', 'placement', 'tuning', 'projects', 'measure', 'report', 'sync', 'help', 'about'];
/** Вкладки нижней панели; «Проекты» — кнопка в верхней панели. */
const BAR: ('room' | 'modes' | 'placement' | 'tuning')[] = ['room', 'modes', 'placement', 'tuning'];
const TITLES: Record<Tab, string> = {
  room: S.room.title,
  modes: S.modes.title,
  placement: S.placement.title,
  tuning: S.tuning.title,
  projects: S.projects.title,
  measure: S.drawer.items.measure,
  report: S.drawer.items.report,
  sync: S.drawer.items.sync,
  help: S.drawer.items.help,
  about: S.drawer.items.about,
};

function readTab(): Tab {
  const h = location.hash.replace('#', '');
  if (h === 'manual') return 'placement';
  if (h === 'field' || h === 'overview') return 'modes';
  return TABS.includes(h as Tab) ? (h as Tab) : 'room';
}

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

export function App() {
  const [tab, setTab] = useState<Tab>(readTab);
  const [placementMode, setPlacementMode] = useState<'auto' | 'manual'>(location.hash === '#manual' ? 'manual' : 'auto');
  const [modesView, setModesView] = useState<'list' | 'field' | 'overview'>(location.hash === '#field' ? 'field' : location.hash === '#overview' ? 'overview' : 'list');
  const [drawer, setDrawer] = useState(false);
  const [wizard, setWizard] = useState(wizardOn());
  const [, setWizardTick] = useState(0);
  const [project, setProject] = useState<Project>(() => newProject());
  const [ready, setReady] = useState(false);
  const [justUpdated, setJustUpdated] = useState(consumeJustUpdated);

  useEffect(() => {
    loadDraft()
      .then((d) => d && setProject(d))
      .catch(() => undefined)
      .finally(() => setReady(true));
    const onHash = () => {
      setTab(readTab());
      if (location.hash === '#manual') setPlacementMode('manual');
      if (location.hash === '#field') setModesView('field');
      if (location.hash === '#overview') setModesView('overview');
    };
    addEventListener('hashchange', onHash);
    return () => removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    if (ready) setBeforeReload(() => saveDraft(project));
  }, [project, ready]);

  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => saveDraft(project).catch(() => undefined), 300);
    return () => clearTimeout(t);
  }, [project, ready]);

  const go = (t: Tab) => {
    setTab(t);
    // адрес отражает и подраздел: «Моды → 3D / Обзор», «Расстановка → Вручную»
    const hash = t === 'modes' && modesView !== 'list' ? modesView : t === 'placement' && placementMode === 'manual' ? 'manual' : t;
    history.replaceState(null, '', `#${hash}`);
    scrollTo({ top: 0 });
  };

  const touch = (p: Partial<Project>, invalidate = true) =>
    setProject((prev) => {
      const next: Project = {
        ...prev,
        ...p,
        updatedAt: new Date().toISOString(),
        result: invalidate && prev.result ? { ...prev.result, stale: true } : p.result !== undefined ? p.result : prev.result,
      };
      if (p.room || p.sources || p.constraints || p.current) {
        next.current = fitSetup(next.current, next);
        if (p.room || p.sources) next.setups = next.setups.map((x) => fitSetup(x, next));
      }
      return next;
    });

  const onRoom = (room: Room, extra: Partial<Project> = {}) =>
    touch({ room, constraints: fitConstraints(extra.constraints ?? project.constraints, room), ...extra });
  const onSources = (sources: SourceSpec[]) => touch({ sources });
  const onConstraints = (constraints: Constraints) => touch({ constraints });
  const onSetup = (current: Setup) => touch({ current }, false);
  const onSetups = (setups: Setup[]) => touch({ setups }, false);
  const setModes = (v: 'list' | 'field' | 'overview') => {
    setModesView(v);
    history.replaceState(null, '', v === 'list' ? '#modes' : `#${v}`);
  };
  const refreshWizard = () => { setWizard(wizardOn()); setWizardTick((x) => x + 1); };
  const setMode = (m: 'auto' | 'manual') => {
    setPlacementMode(m);
    history.replaceState(null, '', m === 'manual' ? '#manual' : '#placement');
  };

  const reverb = useMemo(() => computeReverb(project.room), [project.room]);
  const fMax = Math.min(500, Math.max(200, reverb.schroeder));
  const modes = useMemo(() => computeModes(project.room, fMax), [project.room, fMax]);

  const r = project.room;
  return (
    <div class="app">
      <header class="topbar">
        <div class="topbar__inner">
          <button type="button" class="topbar__menu" aria-label={S.drawer.open} aria-expanded={drawer} onClick={() => setDrawer(true)}>
            <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16 M4 12h16 M4 17h16" /></svg>
          </button>
          <div class="topbar__text">
            <h1 class={`topbar__title${TITLES[tab].length > 14 ? ' is-long' : ''}`}>{TITLES[tab]}</h1>
            <span class="topbar__room">
              {project.name}, {fmt(r.depth, 2)} × {fmt(r.width, 2)} × {fmt(r.height, 2)} м
            </span>
          </div>
          <button
            type="button"
            class={`topbar__projects${tab === 'projects' ? ' is-on' : ''}`}
            aria-current={tab === 'projects' ? 'page' : undefined}
            onClick={() => go('projects')}
          >
            <TabIcon tab="projects" />
            <span>{S.tabs.projects}</span>
          </button>
        </div>
      </header>

      {justUpdated && (
        <div class="update-banner" role="status">
          <span>{S.projects.updated}</span>
          <button type="button" class="update-banner__close" aria-label="Закрыть" onClick={() => setJustUpdated(false)}>×</button>
        </div>
      )}

      <Drawer open={drawer} current={tab} onClose={() => setDrawer(false)} onPick={(i) => { setDrawer(false); go(i); }} />
      <TermSheet />

      <main class="content">
        {wizard && <WizardStrip project={project} onGo={(t) => go(t)} onChange={refreshWizard} />}
        {activeTreatments(r).length > 0 && (
          <div class="whatif-strip" role="status">
            <span>{S.treat.whatIf}</span>
            <span class="whatif-strip__btns">
              {tab !== 'tuning' && <button type="button" class="btn btn--small btn--ghost" onClick={() => go('tuning')}>{S.treat.whatIfOpen}</button>}
              <button type="button" class="btn btn--small" onClick={() => onRoom({ ...r, treatmentsOn: false })}>{S.treat.whatIfOff}</button>
            </span>
          </div>
        )}
        <div hidden={tab !== 'room'}>
          <RoomScreen project={project} reverb={reverb} onRoom={onRoom} onGo={(t) => go(t)} />
        </div>
        {tab === 'modes' && (
          <>
            <div class="screen modes-switch">
              <Segmented label={S.modes.title} value={modesView} options={[{ value: 'list' as const, label: S.modesView.list }, { value: 'field' as const, label: S.modesView.field }, { value: 'overview' as const, label: S.modesView.overview }]} onChange={setModes} />
            </div>
            {modesView === 'list' && <ModesScreen room={r} modes={modes} fMax={fMax} reverb={reverb} />}
            {modesView === 'field' && <FieldScreen project={project} modes={modes} onSetup={onSetup} />}
            {modesView === 'overview' && (
              <OverviewScreen project={project} modes={modes} reverb={reverb} onGo={(t, f) => { if (t === 'field') { if (f) setFieldFocus(f); setModes('field'); } else go(t as Tab); }} />
            )}
          </>
        )}
        <div hidden={tab !== 'placement'}>
          <PlacementScreen
            project={project}
            onSources={onSources}
            onConstraints={onConstraints}
            onResult={(result, selectedIndex) => touch({ result, selectedIndex }, false)}
            onSelect={(selectedIndex) => setProject((p) => ({ ...p, selectedIndex }))}
            mode={placementMode}
            onMode={setMode}
            onSetup={onSetup}
            onSetups={onSetups}
            onGo={(t) => go(t)}
          />
        </div>
        {tab === 'tuning' && <TuningScreen project={project} modes={modes} onSetup={onSetup} onRoom={(room) => onRoom(room)} />}
        {tab === 'projects' && (
          <ProjectsScreen
            project={project}
            onReplace={(p) => { setProject(p); go('room'); }}
            onRename={(name) => touch({ name }, false)}
          />
        )}
        {tab === 'measure' && <MeasureScreen project={project} onSetup={onSetup} onRoom={(room: Room) => onRoom(room)} onGo={(t: Tab) => go(t)} />}
        {tab === 'report' && <ReportScreen project={project} modes={modes} reverb={reverb} />}
        {tab === 'sync' && <SyncScreen project={project} onReplace={(p: Project) => setProject(p)} />}
        {tab === 'help' && <HelpScreen project={project} onGo={(t) => go(t)} onWizard={refreshWizard} />}
        {tab === 'about' && <div class="screen"><AboutPanel /><ProblemReport project={project} /></div>}
      </main>

      <MiniPlayer />

      <nav class="tabbar" aria-label="Разделы">
        {BAR.map((t, ki) => (
          <button key={ki} type="button" class={t === tab ? 'is-on' : ''} aria-current={t === tab ? 'page' : undefined} onClick={() => go(t)}>
            <TabIcon tab={t} />
            <span>{S.tabs[t]}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

function TabIcon({ tab }: { tab: Tab }) {
  const paths: Partial<Record<Tab, string>> = {
    room: 'M4 5h16v14H4z M4 5l3 3h10l3-3 M7 8v8 M17 8v8',
    modes: 'M3 19h18 M6 19V7 M10 19v-7 M14 19V5 M18 19v-9',
    placement: 'M5 4h4v5H5z M15 4h4v5h-4z M12 19.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z M7 9l5 6 5-6',
    tuning: 'M5 4v16 M12 4v16 M19 4v16 M3 15h4 M10 8h4 M17 13h4',
    projects: 'M4 6h6l2 2h8v11H4z',
  };
  return (
    <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d={paths[tab] ?? ''} />
    </svg>
  );
}
