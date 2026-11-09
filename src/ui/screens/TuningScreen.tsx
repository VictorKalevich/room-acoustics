import type { Project } from '../../state/project';
import type { Mode, Room, Setup } from '../../core/types';
import { Panel } from '../components/Fields';
import { S } from '../strings';
import { SubPanel } from './tuning/SubPanel';
import { EqPanel } from './tuning/EqPanel';
import { MeasurePanel } from './tuning/MeasurePanel';
import { TreatmentPanel } from './tuning/TreatmentPanel';

interface Props {
  project: Project;
  modes: Mode[];
  onSetup: (s: Setup) => void;
  onRoom: (r: Room) => void;
}

export function TuningScreen({ project, modes, onSetup, onRoom }: Props) {
  const { sources, current } = project;
  const subs = sources.filter((s) => s.kind === 'sub' && current.positions[s.id]);
  return (
    <div class="screen">
      {subs.length ? <SubPanel project={project} onSetup={onSetup} /> : <Panel title={S.tuning.subTitle}><p class="muted small">{S.tuning.noSub}</p></Panel>}
      <EqPanel project={project} />
      <MeasurePanel project={project} onRoom={onRoom} onSetup={onSetup} />
      <TreatmentPanel project={project} modes={modes} onRoom={onRoom} />
    </div>
  );
}
