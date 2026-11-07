import { useMemo, useRef, useState } from 'preact/hooks';
import type { FunctionComponent } from 'preact';
import type { Object3D } from 'three';
import type { Project } from '../../state/project';
import { defaultConstraints, makeId, rotateRoom, rotateSetup } from '../../state/project';
import type { Room, SurfaceId, ReverbResult, Furnishing, Zone, ZoneKind, Leakage } from '../../core/types';
import { SURFACES } from '../../core/types';
import { MATERIALS, FURNISHING_LABEL } from '../../core/materials';
import { speedOfSound } from '../../core/physics';
import type { DetectResult, Units } from '../../scan/detect';
import { NumberField, Panel, SelectField, Note, Details, Segmented } from '../components/Fields';
import { PlanView } from '../components/PlanView';
import { S } from '../strings';
import { fmt, fmtInt } from '../format';

interface Props {
  project: Project;
  reverb: ReverbResult;
  onRoom: (room: Room, extra?: Partial<Project>) => void;
}

type ScanState =
  | { phase: 'idle' }
  | { phase: 'loading' | 'detecting'; fileName: string }
  | { phase: 'error'; message: string }
  | { phase: 'done'; fileName: string };

interface Loaded {
  preview: Object3D;
  triangles: Float32Array;
  format: string;
  count: number;
  decimated: boolean;
  fileName: string;
}

export function RoomScreen({ project, reverb, onRoom }: Props) {
  const room = project.room;
  const set = (patch: Partial<Room>) => onRoom({ ...room, ...patch });

  return (
    <div class="screen">
      <Panel class="panel--hero">
        <PlanView depth={room.depth} width={room.width} zones={room.zones} />
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

      <ScanPanel project={project} onRoom={onRoom} />

      <ZonesPanel room={room} onRoom={(r) => onRoom(r)} />

      <Panel title={S.room.materials}>
        <div class="grid-2">
          {SURFACES.map((s: SurfaceId) => (
            <SelectField
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
                {reverb.bands.map((b) => <th>{b >= 1000 ? `${b / 1000}к` : b}</th>)}
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">{S.room.rtRow}</th>
                {reverb.used.map((t) => <td>{fmt(t, 2)}</td>)}
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

function ScanPanel({ project, onRoom }: { project: Project; onRoom: Props['onRoom'] }) {
  const [state, setState] = useState<ScanState>({ phase: 'idle' });
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [det, setDet] = useState<DetectResult | null>(null);
  const [units, setUnits] = useState<Units | 'auto'>('auto');
  const [applied, setApplied] = useState(false);
  const [Preview, setPreview] = useState<FunctionComponent<any> | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const detect = (l: Loaded, u: Units | 'auto') =>
    new Promise<DetectResult>((resolve, reject) => {
      const w = new Worker(new URL('../../workers/detect.worker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (e) => {
        w.terminate();
        e.data.ok ? resolve(e.data.result) : reject(new Error(e.data.error));
      };
      w.onerror = (e) => { w.terminate(); reject(new Error(e.message || 'Ошибка анализа скана')); };
      const copy = l.triangles.slice();
      w.postMessage({ triangles: copy, units: u === 'auto' ? undefined : u }, [copy.buffer]);
    });

  const onFile = async (file: File) => {
    setApplied(false);
    setDet(null);
    setUnits('auto');
    setState({ phase: 'loading', fileName: file.name });
    try {
      const [{ loadScan }, preview] = await Promise.all([
        import('../../scan/load'),
        import('../components/ScanPreview'),
      ]);
      setPreview(() => preview.default);
      const s = await loadScan(file);
      const l: Loaded = { preview: s.preview, triangles: s.triangles, format: s.format, count: s.triangleCount, decimated: s.decimated, fileName: file.name };
      setLoaded(l);
      setState({ phase: 'detecting', fileName: file.name });
      setDet(await detect(l, 'auto'));
      setState({ phase: 'done', fileName: file.name });
    } catch (e) {
      setState({ phase: 'error', message: (e as Error).message || S.errors.generic });
    }
  };

  const changeUnits = async (u: Units | 'auto') => {
    if (!loaded) return;
    setUnits(u);
    setApplied(false);
    setState({ phase: 'detecting', fileName: loaded.fileName });
    try {
      setDet(await detect(loaded, u));
      setState({ phase: 'done', fileName: loaded.fileName });
    } catch (e) {
      setState({ phase: 'error', message: (e as Error).message });
    }
  };

  const apply = () => {
    if (!det || !loaded) return;
    const room: Room = { ...project.room, depth: det.depth, width: det.width, height: det.height, source: 'scan' };
    const { transform: _t, ...rest } = det;
    void _t;
    onRoom(room, {
      scanInfo: { ...rest, fileName: loaded.fileName, format: loaded.format },
      constraints: { ...project.constraints, ...zoneFor(room) },
    });
    setApplied(true);
  };

  const dims = useMemo(() => (det ? { depth: det.depth, width: det.width, height: det.height } : null), [det]);

  const busy = state.phase === 'loading' || state.phase === 'detecting';
  return (
    <Panel title={S.room.scan}>
      <p class="small">{S.room.scanIntro}</p>
      <input
        ref={input}
        type="file"
        accept=".obj,.glb,.gltf,.ply,.stl,model/gltf-binary,model/obj,model/stl"
        class="visually-hidden"
        id="scan-file"
        onChange={(e) => {
          const f = (e.target as HTMLInputElement).files?.[0];
          if (f) onFile(f);
          (e.target as HTMLInputElement).value = '';
        }}
      />
      <button type="button" class="btn" disabled={busy} onClick={() => input.current?.click()}>
        <FileIcon /> {S.room.chooseFile}
      </button>

      {busy && (
        <p class="progress-text" role="status">
          <span class="spinner" aria-hidden="true" /> {state.phase === 'loading' ? S.room.loading : S.room.detecting}
        </p>
      )}
      {state.phase === 'error' && <Note tone="warn">{state.message}</Note>}

      {loaded && Preview && (
        <div class="scan-result">
          <Preview object={loaded.preview} transform={det?.transform ?? null} dims={dims} />
          <p class="muted small">
            {loaded.fileName} — {S.room.triangles(fmtInt(loaded.count))}
          </p>
          {loaded.decimated && <Note>{S.room.decimated}</Note>}
        </div>
      )}

      {det && state.phase === 'done' && (
        <div class="scan-found">
          <h3 class="subhead">{S.room.found}</h3>
          <p class="scan-dims">
            {fmt(det.depth, 2)} × {fmt(det.width, 2)} × {fmt(det.height, 2)} <small>м</small>
          </p>
          <div class="meter" aria-label={`${S.room.confidence} ${Math.round(det.confidence * 100)} %`}>
            <span class="meter__label">{S.room.confidence}</span>
            <span class="meter__track">
              <span class={`meter__fill ${det.confidence < 0.5 ? 'is-low' : ''}`} style={{ width: `${Math.round(det.confidence * 100)}%` }} />
            </span>
            <span class="meter__value">{Math.round(det.confidence * 100)} %</span>
          </div>
          {det.warnings.map((w) => <Note tone="warn">{w}</Note>)}
          <Segmented
            label={S.room.unitsLabel}
            value={units}
            options={[
              { value: 'auto', label: `Авто (${det.units === 'm' ? 'м' : det.units === 'cm' ? 'см' : 'мм'})` },
              { value: 'm', label: 'м' },
              { value: 'cm', label: 'см' },
              { value: 'mm', label: 'мм' },
            ]}
            onChange={changeUnits}
          />
          <button type="button" class="btn btn--primary" onClick={apply} disabled={applied}>
            {applied ? S.room.applied : S.room.apply}
          </button>
        </div>
      )}
    </Panel>
  );
}

function ZonesPanel({ room, onRoom }: { room: Room; onRoom: (r: Room) => void }) {
  const zones = room.zones ?? [];
  const setZone = (id: string, patch: Partial<Zone>) => {
    const next = zones.map((z) => {
      if (z.id !== id) return z;
      const n = { ...z, ...patch };
      // держим границы внутри комнаты и в правильном порядке
      n.x0 = Math.max(0, Math.min(n.x0, room.depth - 0.1));
      n.x1 = Math.min(room.depth, Math.max(n.x1, n.x0 + 0.1));
      n.y0 = Math.max(0, Math.min(n.y0, room.width - 0.1));
      n.y1 = Math.min(room.width, Math.max(n.y1, n.y0 + 0.1));
      return n;
    });
    onRoom({ ...room, zones: next });
  };
  const add = () => {
    const z: Zone = { id: makeId(), kind: 'door', x0: Math.max(0, room.depth - 1), x1: room.depth, y0: 0, y1: Math.min(1, room.width), canSit: false };
    onRoom({ ...room, zones: [...zones, z] });
  };
  return (
    <Panel title={S.zones.title}>
      <p class="small">{S.zones.intro}</p>
      {zones.length === 0 && <p class="muted small">{S.zones.none}</p>}
      {zones.map((z, i) => (
        <div class="zone-card">
          <div class="zone-card__head">
            <SelectField
              label={`${S.zones.kind} ${i + 1}`}
              value={z.kind}
              options={(['door', 'window', 'furniture', 'other'] as ZoneKind[]).map((k) => ({ value: k, label: S.zones.kinds[k] }))}
              onChange={(v) => setZone(z.id, { kind: v as ZoneKind })}
            />
            <button type="button" class="btn btn--small btn--ghost" onClick={() => onRoom({ ...room, zones: zones.filter((x) => x.id !== z.id) })}>
              {S.zones.remove}
            </button>
          </div>
          <div class="grid-2">
            <NumberField compact id={`${z.id}-x0`} label={S.zones.x0} value={z.x0} unit="м" min={0} max={room.depth} onChange={(v) => setZone(z.id, { x0: v })} />
            <NumberField compact id={`${z.id}-x1`} label={S.zones.x1} value={z.x1} unit="м" min={0} max={room.depth} onChange={(v) => setZone(z.id, { x1: v })} />
            <NumberField compact id={`${z.id}-y0`} label={S.zones.y0} value={z.y0} unit="м" min={0} max={room.width} onChange={(v) => setZone(z.id, { y0: v })} />
            <NumberField compact id={`${z.id}-y1`} label={S.zones.y1} value={z.y1} unit="м" min={0} max={room.width} onChange={(v) => setZone(z.id, { y1: v })} />
          </div>
          <label class="check">
            <input type="checkbox" checked={z.canSit} onChange={(e) => setZone(z.id, { canSit: (e.target as HTMLInputElement).checked })} />
            <span>{S.zones.canSit}</span>
          </label>
        </div>
      ))}
      <button type="button" class="btn" onClick={add}>{S.zones.add}</button>
      <SelectField
        label={S.zones.leakage}
        value={room.leakage ?? 'typical'}
        options={(['sealed', 'typical', 'door', 'open'] as Leakage[]).map((k) => ({ value: k, label: S.zones.leakages[k] }))}
        onChange={(v) => onRoom({ ...room, leakage: v as Leakage })}
      />
      <p class="muted small">{S.zones.leakageHint}</p>
    </Panel>
  );
}

function zoneFor(room: Room) {
  const d = defaultConstraints(room);
  return { listenerMinX: d.listenerMinX, listenerMaxX: d.listenerMaxX };
}

const RotateIcon = () => (
  <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M4 12a8 8 0 0 1 13.7-5.6M20 12a8 8 0 0 1-13.7 5.6" />
    <path d="M18 3v4h-4M6 21v-4h4" />
  </svg>
);
const FileIcon = () => (
  <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" />
    <path d="M12 12l8-4.5M12 12v9M12 12L4 7.5" />
  </svg>
);
