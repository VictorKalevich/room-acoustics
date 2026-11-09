import type { Project } from '../../state/project';
import { shownTreatments } from '../../core/treatments';
import { defaultRoom, rotateRoom, rotateSetup } from '../../state/project';
import type { Room, SurfaceId, ReverbResult, Furnishing } from '../../core/types';
import { SURFACES } from '../../core/types';
import { MATERIALS, FURNISHING_LABEL } from '../../core/materials';
import { speedOfSound } from '../../core/physics';
import { NumberField, Panel, SelectField, Details } from '../components/Fields';
import { PlanView } from '../components/PlanView';
import { S } from '../strings';
import { fmt } from '../format';
import { ScanPanel } from './room/ScanPanel';
import { OpeningsPanel } from './room/OpeningsPanel';
import { ZonesPanel } from './room/ZonesPanel';
import { FileIcon, RotateIcon } from './room/icons';

interface Props {
  project: Project;
  reverb: ReverbResult;
  onRoom: (room: Room, extra?: Partial<Project>) => void;
  /** Переход к следующему шагу после применения скана. */
  onGo?: (t: 'placement') => void;
}

export function RoomScreen({ project, reverb, onRoom, onGo }: Props) {
  const room = project.room;
  const set = (patch: Partial<Room>) => onRoom({ ...room, ...patch });

  // комната ещё не задана: ни скана, ни своих размеров — подсказываем, с чего начать
  const d0 = defaultRoom();
  const fresh = room.source !== 'scan' && !project.scanInfo && room.depth === d0.depth && room.width === d0.width && room.height === d0.height;
  return (
    <div class="screen">
      {fresh && (
        <Panel class="start-card" title={S.start.title}>
          <p class="small">{S.start.text}</p>
          <div class="btn-row">
            <button type="button" class="btn btn--primary" onClick={() => document.getElementById('scan-file')?.click()}>
              <FileIcon /> {S.start.scan}
            </button>
            <button type="button" class="btn" onClick={() => { const el = document.getElementById(`f-${S.room.depth.replace(/\s+/g, '-')}`) as HTMLInputElement | null; el?.scrollIntoView({ behavior: 'smooth', block: 'center' }); el?.focus(); }}>
              {S.start.manual}
            </button>
          </div>
          <p class="muted small">{S.start.note}</p>
        </Panel>
      )}
      <Panel class="panel--hero">
        <PlanView depth={room.depth} width={room.width} zones={room.zones} extensions={room.extensions} openings={room.openings} features={room.features} treatments={shownTreatments(room)} slope={room.slope} />
        <div class="dims">
          <NumberField label={S.room.depth} hint={S.room.depthHint} value={room.depth} unit="м" min={1} max={50} onChange={(v) => set({ depth: v })} />
          <NumberField label={S.room.width} hint={S.room.widthHint} value={room.width} unit="м" min={1} max={50} onChange={(v) => set({ width: v })} />
          <NumberField label={S.room.height} value={room.height} unit="м" min={1} max={20} onChange={(v) => set({ height: v })} />
        </div>
        <button
          type="button"
          class="btn btn--ghost"
          onClick={() => onRoom(rotateRoom(room), { current: rotateSetup(room, project.current), setups: project.setups.map((x) => rotateSetup(room, x)) })}
        >
          <RotateIcon /> {S.room.rotate}
        </button>
        <Details summary={S.room.temperature}>
          <NumberField
            label={S.room.temperature}
            value={room.temperatureC}
            unit="°C"
            min={-10}
            max={40}
            digits={0}
            hint={S.room.speed(fmt(speedOfSound(room.temperatureC), 1))}
            onChange={(v) => set({ temperatureC: v })}
          />
        </Details>
      </Panel>

      <ScanPanel project={project} onRoom={onRoom} onGo={onGo} />

      <OpeningsPanel room={room} onRoom={(r) => onRoom(r)} />

      <ZonesPanel room={room} onRoom={(r) => onRoom(r)} />

      <Panel title={S.room.materials}>
        <div class="grid-2 grid-2--wide-items">
          {SURFACES.map((s: SurfaceId, ki) => (
            <SelectField key={ki}
              label={S.room.surfaces[s]}
              value={room.materials[s]}
              options={MATERIALS.map((m) => ({ value: m.id, label: m.name }))}
              onChange={(v) => set({ materials: { ...room.materials, [s]: v } })}
            />
          ))}
        </div>
        <SelectField
          label={S.room.furnishing}
          value={room.furnishing}
          options={(Object.keys(FURNISHING_LABEL) as Furnishing[]).map((k) => ({ value: k, label: FURNISHING_LABEL[k] }))}
          onChange={(v) => set({ furnishing: v as Furnishing })}
        />
        <p class="muted small">{S.room.furnishingHint}</p>
      </Panel>

      <Panel title={S.room.reverb}>
        <div class="stat-row">
          <div class="stat">
            <span class="stat__value">{fmt(reverb.tMid, 2)} <small>с</small></span>
            <span class="stat__label">RT60 на 500–1000 Гц</span>
          </div>
          <div class="stat">
            <span class="stat__value">{fmt(reverb.schroeder, 0)} <small>Гц</small></span>
            <span class="stat__label">{S.room.schroeder}</span>
          </div>
        </div>
        <p class="muted small">{S.room.schroederHint}.</p>
        <div class="table-scroll">
          <table class="rt-table">
            <thead>
              <tr>
                <th scope="row">{S.room.rtHeader}</th>
                {reverb.bands.map((b, ki) => <th key={ki}>{b >= 1000 ? `${b / 1000}к` : b}</th>)}
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">{S.room.rtRow}</th>
                {reverb.used.map((t, ki) => <td key={ki}>{fmt(t, 2)}</td>)}
              </tr>
            </tbody>
          </table>
        </div>
        <p class="muted small">{S.room.formulaNote(reverb.formula.includes('eyring'))}</p>
        <Details summary="Допущения">
          <p class="small">{S.room.reverbAssumptions}</p>
        </Details>
      </Panel>
    </div>
  );
}
