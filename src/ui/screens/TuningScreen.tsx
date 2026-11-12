import type { Project } from '../../state/project';
import type { Mode, Room, Setup } from '../../core/types';
import { Panel } from '../design-system';
import { S } from '../strings';
import { SubPanel } from './tuning/SubPanel';
import { EqPanel } from './tuning/EqPanel';
import { TreatmentPanel } from './tuning/TreatmentPanel';
import { SectionNav } from '../design-system';
import { RetainedSection } from '../components/RetainedSection';
import type { Destination, TuningView } from '../navigation';

interface Props {
  project: Project;
  modes: Mode[];
  onSetup: (s: Setup) => void;
  onRoom: (r: Room) => void;
  view: TuningView;
  active: boolean;
  onGo: (destination: Destination) => void;
}

export function TuningScreen({ project, modes, onSetup, onRoom, view, active, onGo }: Props) {
  const { sources, current } = project;
  const subs = sources.filter((s) => s.kind === 'sub' && current.positions[s.id]);
  // Preserve drafts across navigation, but never show results from different inputs.
  const setupKey = JSON.stringify([project.room, sources, project.constraints, current.positions, current.listener, project.precision]);
  const eqKey = JSON.stringify([setupKey, current.subSettings, current.crossoverHz, current.measurement]);
  return (
    <div class="screen">
      <SectionNav label="Раздел настройки" value={view} onChange={(v) => onGo(`tuning/${v}`)} options={[
        { value: 'sub', label: 'Сабвуфер', hint: 'Фаза, уровень и фильтры' },
        { value: 'eq', label: 'Эквалайзер', hint: 'Коррекция и экспорт' },
        { value: 'treatment', label: 'Обработка', hint: 'Отражения и панели' },
      ]} />
      <div class="workspace-context"><span>Настройка текущей расстановки</span>
        <button type="button" class="btn btn--small btn--ghost" onClick={() => onGo('measure/compare')}>Измерения и REW</button>
      </div>
      <RetainedSection active={view === 'sub'}>
      {subs.length ? <SubPanel key={setupKey} project={project} onSetup={onSetup} /> : <Panel title={S.tuning.subTitle}><p class="muted small">{S.tuning.noSub}</p></Panel>}
      </RetainedSection>
      <RetainedSection active={view === 'eq'}>
      <EqPanel key={eqKey} project={project} active={active && view === 'eq'} />
      </RetainedSection>
      <RetainedSection active={view === 'treatment'}>
      <TreatmentPanel project={project} modes={modes} onRoom={onRoom} />
      </RetainedSection>
    </div>
  );
}
