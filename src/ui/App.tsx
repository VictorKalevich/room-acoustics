import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Room } from '../core/types';
import { useProject } from './useProject';
import { computeReverb } from '../core/reverb';
import { computeModes } from '../core/modes';
import { RoomScreen } from './screens/RoomScreen';
import { RoomEditor } from './screens/room/RoomEditor';
import { ModesScreen } from './screens/ModesScreen';
import { PlacementScreen } from './screens/PlacementScreen';
import { ProjectsScreen } from './screens/ProjectsScreen';
import { TuningScreen } from './screens/TuningScreen';
import { FieldScreen } from './screens/FieldScreen';
import { Drawer } from './components/Drawer';
import { SectionNav } from './design-system';
import { RetainedSection } from './components/RetainedSection';
import { useNavigation, type Tab, type AnalysisView } from './navigation';
import { TermSheet } from './components/Term';
import { MiniPlayer } from './components/MiniPlayer';
import { WizardStrip } from './components/WizardStrip';
import { wizardOn } from './wizard';
import { HelpScreen } from './screens/HelpScreen';
import { MeasureScreen } from './screens/MeasureScreen';
import { ReportScreen } from './screens/ReportScreen';
import { VoiceScreen } from './screens/VoiceScreen';
import { OverviewScreen } from './screens/OverviewScreen';
import { PlacementFirst, RoomFirst } from './screens/Gates';
import { AboutScreen } from './screens/AboutScreen';
import { setFieldFocus } from './screens/FieldScreen';
import { S } from './strings';
import { fmt } from './format';
import { consumeJustUpdated } from './updates';
import { activeTreatments } from '../core/treatments';

/**
 * Экраны с расчётами: пока комната не создана, на них — «Сначала создайте комнату» (021). С 022 до создания
 * комнаты этих разделов нет ни в нижней панели, ни в меню; заглушка остаётся для старых ссылок.
 */
const NEEDS_ROOM: Tab[] = ['modes', 'placement', 'tuning', 'measure', 'voice', 'report'];

/** Вкладки нижней панели по порядку зависимостей (022); «Проекты» — в меню (024, раньше — кнопка в верхней панели). */
const BAR: ('room' | 'placement' | 'modes' | 'tuning' | 'voice')[] = ['room', 'placement', 'modes', 'tuning', 'voice'];
const TITLES: Record<Tab, string> = {
  room: S.room.title,
  modes: S.tabs.modes,
  placement: S.placement.title,
  tuning: S.tuning.title,
  projects: S.projects.title,
  measure: S.drawer.items.measure,
  voice: S.drawer.items.voice,
  report: S.drawer.items.report,
  help: S.drawer.items.help,
  about: S.drawer.items.about,
};

export function App() {
  const { route, go } = useNavigation();
  const { tab, placement: placementMode, analysis: modesView } = route;
  // 023: «Проекты» возвращают туда, откуда их открыли (кнопка «← Назад»)
  const lastTab = useRef<Tab>(tab === 'projects' ? 'room' : tab);
  useEffect(() => { if (tab !== 'projects') lastTab.current = tab; }, [tab]);
  const back = () => go(lastTab.current);
  const [drawer, setDrawer] = useState(false);
  const [wizard, setWizard] = useState(wizardOn());
  const [, setWizardTick] = useState(0);
  const { project, setProject, ready, touch, onRoom, onSources, onConstraints, onSetup, onSetups, onVoice } = useProject();
  const [justUpdated, setJustUpdated] = useState(consumeJustUpdated);

  const setModes = (v: AnalysisView) => go(v === 'list' ? 'analysis/list' : v === 'overview' ? 'analysis' : 'field');
  const refreshWizard = () => { setWizard(wizardOn()); setWizardTick((x) => x + 1); };
  const setMode = (m: 'auto' | 'manual') => {
    go(m === 'manual' ? 'manual' : 'placement/auto');
  };

  const reverb = useMemo(() => computeReverb(project.room), [project.room]);
  const fMax = Math.min(500, Math.max(200, reverb.schroeder));
  const modes = useMemo(() => computeModes(project.room, fMax), [project.room, fMax]);

  const r = project.room;
  const roomReady = project.roomReady;
  // 022: места колонок, сабвуфера и слушателя выбраны (подбор, вручную или «Колонки стоят так»)
  const placed = !!project.current.placed;
  const toPlacement = (m: 'auto' | 'manual') => go(m === 'manual' ? 'manual' : 'placement/auto');
  const title = tab === 'room' && route.room !== 'overview' ? S.editor.title : TITLES[tab];
  if (!ready) return <div class="screen"><p role="status">Открываем проект…</p></div>;
  return (
    <div class={`app${roomReady ? '' : ' app--start'}`}>
      <header class="topbar">
        <div class="topbar__inner">
          <button type="button" class="topbar__menu" aria-label={S.drawer.open} aria-expanded={drawer} onClick={() => setDrawer(true)}>
            <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16 M4 12h16 M4 17h16" /></svg>
          </button>
          <div class="topbar__text">
            <h1 class={`topbar__title${title.length > 14 ? ' is-long' : ''}`}>{title}</h1>
            <span class="topbar__room">
              {project.name}{roomReady ? `, ${fmt(r.depth, 2)} × ${fmt(r.width, 2)} × ${fmt(r.height, 2)} м` : ''}
            </span>
          </div>
        </div>
      </header>

      {justUpdated && (
        <div class="update-banner" role="status">
          <span>{S.projects.updated}</span>
          <button type="button" class="update-banner__close" aria-label="Закрыть" onClick={() => setJustUpdated(false)}>×</button>
        </div>
      )}

      <Drawer open={drawer} current={tab} roomReady={roomReady} onClose={() => setDrawer(false)} onPick={(i) => { setDrawer(false); go(i); }} />
      <TermSheet />

      <main class="content" key={project.id}>
        {wizard && <WizardStrip project={project} onGo={(t) => go(t)} onChange={refreshWizard} />}
        {activeTreatments(r).length > 0 && (
          <div class="whatif-strip" role="status">
            <span>{S.treat.whatIf}</span>
            <span class="whatif-strip__btns">
              {(tab !== 'tuning' || route.tuning !== 'treatment') && <button type="button" class="btn btn--small btn--ghost" onClick={() => go('tuning/treatment')}>{S.treat.whatIfOpen}</button>}
              <button type="button" class="btn btn--small" onClick={() => onRoom({ ...r, treatmentsOn: false })}>{S.treat.whatIfOff}</button>
            </span>
          </div>
        )}
        <div hidden={tab !== 'room' || route.room !== 'overview'}>
          <RoomScreen project={project} reverb={reverb} onRoom={onRoom} onGo={(t) => go(t)} />
        </div>
        {tab === 'room' && route.room !== 'overview' && (
          <RoomEditor project={project} step={route.room} onStep={(s) => go(`room/${s}`)} onRoom={onRoom} onBack={() => go('room/overview')} />
        )}
        {!roomReady && NEEDS_ROOM.includes(tab) && <RoomFirst onGo={() => go('room/overview')} />}
        {roomReady && tab === 'modes' && (
          <>
            <div class="screen modes-switch">
              <SectionNav label="Раздел анализа" value={modesView} options={[{ value: 'overview', label: S.modesView.overview }, { value: 'list', label: S.modesView.list }, { value: 'field', label: S.modesView.field }]} onChange={setModes} />
            </div>
            {modesView === 'list' && <ModesScreen room={r} modes={modes} fMax={fMax} reverb={reverb} />}
            {modesView === 'field' && (placed ? <FieldScreen project={project} modes={modes} onSetup={onSetup} /> : <PlacementFirst onGo={toPlacement} />)}
            {modesView === 'overview' && (placed ? (
              <OverviewScreen project={project} modes={modes} reverb={reverb} onGo={(t, f) => { if (t === 'field') { if (f) setFieldFocus(f); setModes('field'); } else go(t); }} />
            ) : <PlacementFirst onGo={toPlacement} />)}
          </>
        )}
        {roomReady && <div hidden={tab !== 'placement'}>
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
        </div>}
        {roomReady && placed && <RetainedSection active={tab === 'tuning'}>
          <TuningScreen project={project} modes={modes} onSetup={onSetup} onRoom={(room) => onRoom(room)} view={route.tuning} active={tab === 'tuning'} onGo={go} />
        </RetainedSection>}
        {roomReady && !placed && tab === 'tuning' && <PlacementFirst onGo={toPlacement} />}
        {tab === 'projects' && (
          <ProjectsScreen
            project={project}
            onReplace={(p) => { setProject(p); go('room/overview'); }}
            onRename={(name) => touch({ name }, false)}
            onBack={back}
            onGo={go}
          />
        )}
        {roomReady && <RetainedSection active={tab === 'measure'}>
          <MeasureScreen project={project} onSetup={onSetup} onRoom={(room: Room) => onRoom(room)} onGo={go} view={route.measure} active={tab === 'measure'} onPlacement={toPlacement} />
        </RetainedSection>}
        {roomReady && tab === 'voice' && <VoiceScreen project={project} onVoice={onVoice} />}
        {roomReady && tab === 'report' && <ReportScreen project={project} modes={modes} reverb={reverb} onPlacement={toPlacement} />}
        {tab === 'help' && <HelpScreen project={project} onGo={(t) => go(t)} onWizard={refreshWizard} />}
        {tab === 'about' && <AboutScreen project={project} />}
      </main>

      <MiniPlayer />

      {roomReady && <nav class="tabbar" aria-label="Разделы">
        {BAR.map((t, ki) => (
          <button key={ki} type="button" class={t === tab ? 'is-on' : ''} aria-current={t === tab ? 'page' : undefined} onClick={() => go(t)}>
            <TabIcon tab={t} />
            <span>{S.tabs[t]}</span>
          </button>
        ))}
      </nav>}
    </div>
  );
}

function TabIcon({ tab }: { tab: Tab }) {
  const paths: Partial<Record<Tab, string>> = {
    room: 'M4 5h16v14H4z M4 5l3 3h10l3-3 M7 8v8 M17 8v8',
    modes: 'M3 19h18 M6 19V7 M10 19v-7 M14 19V5 M18 19v-9',
    placement: 'M5 4h4v5H5z M15 4h4v5h-4z M12 19.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z M7 9l5 6 5-6',
    tuning: 'M5 4v16 M12 4v16 M19 4v16 M3 15h4 M10 8h4 M17 13h4',
    voice: 'M10 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z M3.5 21v-1.5a6.5 6.5 0 0 1 13 0V21 M18.2 5.5a1.5 1.5 0 0 1 3 0v3a1.5 1.5 0 0 1-3 0z M19.7 10v3.5',
  };
  return (
    <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d={paths[tab] ?? ''} />
    </svg>
  );
}
