import type { Project } from '../../state/project';
import type { Mode, Room, Setup } from '../../core/types';
import { isWave } from '../../core/geometry';
import { useSetupEval } from '../useEval';
import { PlanView } from '../components/PlanView';
import { Panel } from '../components/Fields';
import { S } from '../strings';
import { fmt } from '../format';
import { SubPanel } from './tuning/SubPanel';
import { EqPanel } from './tuning/EqPanel';
import { MeasurePanel } from './tuning/MeasurePanel';
import { TreatmentPanel } from './tuning/TreatmentPanel';
import { itemsOf } from './tuning/shared';

interface Props {
  project: Project;
  modes: Mode[];
  onSetup: (s: Setup) => void;
  onRoom: (r: Room) => void;
}

export function TuningScreen({ project, modes, onSetup, onRoom }: Props) {
  const { room, sources, constraints: c, current } = project;
  const { ev } = useSetupEval(room, sources, c, current);
  const subs = sources.filter((s) => s.kind === 'sub' && current.positions[s.id]);
  return (
    <div class="screen">
      <Panel title={S.tuning.setup}>
        <PlanView depth={room.depth} width={room.width} items={itemsOf(project)} seats={ev?.seats ?? []} zones={room.zones} extensions={room.extensions} openings={room.openings} features={room.features} treatments={room.treatments} slope={room.slope} showDims={false} />
        <div class="score">
          <div class="score__main">
            <span class="score__value">{ev ? fmt(ev.score, 1) : '…'}</span>
            <span class="score__unit">дБ</span>
          </div>
          <div class="score__text">
            <span class="score__label">{S.placement.score}</span>
            <span class="muted small">{S.tuning.setupHint}</span>
            <span class="model-tag">{isWave(room) ? S.model.waveTag : S.model.modalTag}</span>
          </div>
        </div>
      </Panel>
      {subs.length ? <SubPanel project={project} onSetup={onSetup} /> : <Panel title={S.tuning.subTitle}><p class="muted small">{S.tuning.noSub}</p></Panel>}
      <EqPanel project={project} />
      <MeasurePanel project={project} onRoom={onRoom} onSetup={onSetup} />
      <TreatmentPanel project={project} modes={modes} onRoom={onRoom} />
    </div>
  );
}
