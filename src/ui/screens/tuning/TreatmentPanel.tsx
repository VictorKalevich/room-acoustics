// Акустическая обработка: точки первых отражений, план ловушек и «что если».
import { useMemo, useState } from 'preact/hooks';
import type { Project } from '../../../state/project';
import type { Mode, Room, Treatment } from '../../../core/types';
import { makeId } from '../../../state/project';
import { computeReverb } from '../../../core/reverb';
import { modeDecays, type ModeDecay } from '../../../core/overview';
import { THICKNESSES, suggestTreatments } from '../../../core/treatments';
import { useSetupEval } from '../../useEval';
import { bassAdvice, porousLowLimit, reflectionPoints } from '../../../core/treatment';
import { porousAlpha } from '../../../core/treatments';
import { speedOfSound } from '../../../core/physics';
import { PlanView, type PlanMark, type WallMark } from '../../components/PlanView';
import { NumberField, Panel, SelectField } from '../../components/Fields';
import { S } from '../../strings';
import { fmt } from '../../format';
import { itemsOf } from './shared';
import { isWave } from '../../../core/geometry';
import { ConfirmSheet } from '../../components/ConfirmSheet';
import { ScoreBlock } from '../../components/ScoreBlock';

// ---------- Обработка ----------

export function TreatmentPanel({ project, modes, onRoom }: { project: Project; modes: Mode[]; onRoom: (r: Room) => void }) {
  const { room, sources, constraints: c, current } = project;
  const spk = sources.filter((s) => s.kind === 'speaker' && current.positions[s.id]).map((s) => ({ id: s.id, pos: current.positions[s.id] }));
  const refl = reflectionPoints(room, spk, current.listener);
  const { ev } = useSetupEval(room, sources, c, current, 48);
  const advice = ev ? bassAdvice(ev.response, modes) : [];
  const wallMarks: WallMark[] = refl.filter((r) => r.surface !== 'ceiling').map((r) => ({ surface: r.surface as 'left' | 'right', at: r.point.x }));
  const ceilMarks: PlanMark[] = refl.filter((r) => r.surface === 'ceiling').map((r) => ({ x: r.point.x, y: r.point.y, label: '', kind: 'trap' }));
  return (
    <Panel title={S.tuning.treatTitle}>
      <h3 class="subhead">{S.tuning.reflections}</h3>
      <PlanView depth={room.depth} width={room.width} items={itemsOf(project)} zones={room.zones} extensions={room.extensions} openings={room.openings} features={room.features} treatments={room.treatments} slope={room.slope} wallMarks={wallMarks} marks={ceilMarks} showDims={false} />
      <p class="muted small">{S.tuning.reflectionsHint} Кружки на стенах — боковые отражения, кольца внутри — точки на потолке.</p>
      <ul class="plain-list small">
        {refl.map((r, ki) => (
          <li key={ki}>
            {S.tuning.reflRow(
              S.placement.sourceName(r.speakerId),
              S.tuning.surfaces[r.surface],
              fmt(r.point.x, 2),
              r.surface === 'ceiling' ? `${fmt(r.point.y, 2)} м от левой стены` : `высота ${fmt(r.point.z, 2)} м`,
            )}
          </li>
        ))}
      </ul>
      <h3 class="subhead">{S.tuning.bass}</h3>
      {advice.length === 0 ? <p class="muted small">{S.tuning.bassNone}</p> : (
        <ul class="advice-list">
          {advice.map((a, ki) => (
            <li key={ki}>
              <strong>+{fmt(a.excessDb, 1)} дБ на {fmt(a.f, 0)} Гц</strong>
              <span class="small">{a.text}</span>
            </li>
          ))}
        </ul>
      )}
      <p class="muted small">{S.tuning.porous(fmt(porousLowLimit(0.1, 0.1, speedOfSound(room.temperatureC)), 0), fmt(porousAlpha(0.1, 0.1)[1] * 100, 0), fmt(porousAlpha(0.1, 0.1)[0] * 100, 0))}</p>
      <TreatmentPlan project={project} modes={modes} onRoom={onRoom} reflections={refl} />
    </Panel>
  );
}

// ---------- План обработки и «что если» ----------

function TreatmentPlan({ project, modes, onRoom, reflections }: { project: Project; modes: Mode[]; onRoom: (r: Room) => void; reflections: ReturnType<typeof reflectionPoints> }) {
  const { room, sources, constraints: c, current } = project;
  const list = room.treatments ?? [];
  const set = (treatments: Treatment[]) => onRoom({ ...room, treatments });
  const patch = (id: string, p: Partial<Treatment>) => set(list.map((t) => (t.id === id ? { ...t, ...p } : t)));
  const add = (kind: Treatment['kind']) => {
    const t: Treatment = kind === 'corner'
      ? { id: makeId(), kind, corner: 'front-left', thickness: 0.3, width: 0.6, height: Math.min(room.height, 2.4), enabled: true }
      : kind === 'panel'
        ? { id: makeId(), kind, wall: 'left', at: room.depth / 3, z: 1.2, thickness: 0.1, gap: 0.05, width: 0.6, height: 1.2, enabled: true }
        : { id: makeId(), kind, x: room.depth / 3, y: room.width / 2, thickness: 0.1, gap: 0.1, width: 1.2, height: 1.2, enabled: true };
    set([...list, t]);
    setOpenId(t.id);
  };
  // новый элемент открыт для правки, остальные — свёрнуты в строку с описанием
  const [openId, setOpenId] = useState<string | null>(null);
  const cm = (v: number) => `${Math.round(v * 100)} см`;
  const describe = (t: Treatment): string => {
    const size = `${fmt(t.width, 2)} × ${fmt(t.height, 2)} м`;
    const gap = t.gap ? `, зазор ${cm(t.gap)}` : '';
    if (t.kind === 'corner') return `${S.treat.corners[t.corner ?? 'front-left']} угол · ${cm(t.thickness)} · ${size}`;
    if (t.kind === 'panel') return `${S.openings.walls[t.wall ?? 'left']}, ${fmt(t.at ?? 0, 2)} м · ${cm(t.thickness)}${gap} · ${size}`;
    return `${S.treat.kinds.cloud}: центр ${fmt(t.x ?? 0, 2)} × ${fmt(t.y ?? 0, 2)} м · ${cm(t.thickness)}${gap} · ${size}`;
  };
  // «что если»: сравнение без обработки и с ней
  const bare = useMemo(() => ({ ...room, treatmentsOn: false }), [room]);
  const withT = useMemo(() => ({ ...room, treatmentsOn: true }), [room]);
  const dBare = useMemo(() => modeDecays(bare, modes, computeReverb(bare), 150), [bare, modes]);
  const dWith = useMemo(() => modeDecays(withT, modes, computeReverb(withT), 150), [withT, modes]);
  // без элементов обработки оба варианта совпадают: считаем один
  const { ev: evBare } = useSetupEval(bare, sources, c, current);
  const { ev: evWith } = useSetupEval(withT, sources, c, list.length ? current : null);
  const evNow = room.treatmentsOn && list.length ? evWith : evBare;
  const [askClear, setAskClear] = useState(false);
  const scoreBlock = (
    <div class="treat-score">
      <ScoreBlock
        objective={c.objective}
        objScore={evNow ? evNow.objScore : null}
        flatScore={evNow ? evNow.score : null}
        context={!list.length ? S.treat.scoreNone : room.treatmentsOn ? S.treat.scoreWith : S.treat.scoreWithout}
      >
        <span class="muted small">{S.tuning.setupHint}</span>
        <span class="model-tag">{isWave(room) ? S.model.waveTag : S.model.modalTag}</span>
      </ScoreBlock>
    </div>
  );
  const longCount = (d: ModeDecay[]) => d.filter((x) => x.kind !== 'oblique' && x.t60 > x.limit).length;
  const meanAx = (d: ModeDecay[]) => { const a = d.filter((x) => x.kind === 'axial'); return a.length ? a.reduce((s, x) => s + x.t60, 0) / a.length : 0; };
  const area: Record<string, number> = {};
  for (const tr of list.filter((x) => x.enabled !== false)) area[tr.thickness] = (area[tr.thickness] ?? 0) + tr.width * tr.height;
  return (
    <>
      <h3 class="subhead">{S.treat.title}</h3>
      <p class="small">{S.treat.intro}</p>
      {list.length === 0 && (
        <>
          {scoreBlock}
          <button type="button" class="btn btn--primary" onClick={() => onRoom({ ...room, treatments: suggestTreatments(room, reflections, makeId) })}>{S.treat.suggest}</button>
        </>
      )}
      {list.length > 0 && (
        <>
          <label class="check">
            <input type="checkbox" checked={!!room.treatmentsOn} onChange={(e) => onRoom({ ...room, treatmentsOn: (e.target as HTMLInputElement).checked })} />
            <span>{S.treat.apply}</span>
          </label>
          {scoreBlock}
          <div class="treat-compare">
            <div><span class="muted small">{S.treat.longModes}</span><strong>{longCount(dBare)} → {longCount(dWith)}</strong></div>
            <div><span class="muted small">{S.treat.axialT60}</span><strong>{fmt(meanAx(dBare), 1)} → {fmt(meanAx(dWith), 1)} с</strong></div>
            <div><span class="muted small">{S.treat.flatness}</span><strong>{evBare ? fmt(evBare.score, 1) : '…'} → {evWith ? fmt(evWith.score, 1) : '…'} дБ</strong></div>
            <div><span class="muted small">RT60</span><strong>{fmt(computeReverb(bare).tMid, 2)} → {fmt(computeReverb(withT).tMid, 2)} с</strong></div>
          </div>
          <p class="muted small">{room.treatmentsOn ? S.treat.onNote : S.treat.offNote}</p>
          <PlanView depth={room.depth} width={room.width} items={itemsOf(project)} zones={room.zones} extensions={room.extensions} openings={room.openings} features={room.features} treatments={list} showDims={false} />
          {list.map((t, i) => (
            <div key={t.id} class="zone-card">
              <div class="zone-card__head">
                <label class="check">
                  <input type="checkbox" checked={t.enabled !== false} onChange={(e) => patch(t.id, { enabled: (e.target as HTMLInputElement).checked })} />
                  <span><strong>{S.treat.kinds[t.kind]} {i + 1}</strong></span>
                </label>
                <button type="button" class="btn btn--small btn--ghost" onClick={() => set(list.filter((x) => x.id !== t.id))}>{S.openings.remove}</button>
              </div>
              <p class="muted small">{describe(t)}</p>
              <details class="details" open={openId === t.id} onToggle={(e) => { const o = (e.currentTarget as HTMLDetailsElement).open; if (o) setOpenId(t.id); else if (openId === t.id) setOpenId(null); }}>
                <summary>{S.treat.edit}</summary>
                <div class="details__body">
              {t.kind === 'corner' && (
                <SelectField label={S.treat.corner} value={t.corner ?? 'front-left'} options={(['front-left', 'front-right', 'back-left', 'back-right'] as const).map((k) => ({ value: k, label: S.treat.corners[k] }))} onChange={(v) => patch(t.id, { corner: v as Treatment['corner'] })} />
              )}
              {t.kind === 'panel' && (
                <div class="grid-2">
                  <SelectField label={S.openings.wall} value={t.wall ?? 'left'} options={(['front', 'back', 'left', 'right'] as const).map((w) => ({ value: w, label: S.openings.walls[w] }))} onChange={(v) => patch(t.id, { wall: v as Treatment['wall'] })} />
                  <NumberField compact id={`${t.id}-at`} label={S.treat.center} value={t.at ?? 0} unit="м" min={0} max={30} onChange={(v) => patch(t.id, { at: v })} />
                </div>
              )}
              {t.kind === 'cloud' && (
                <div class="grid-2">
                  <NumberField compact id={`${t.id}-x`} label={S.treat.cx} value={t.x ?? 0} unit="м" min={0} max={30} onChange={(v) => patch(t.id, { x: v })} />
                  <NumberField compact id={`${t.id}-y`} label={S.treat.cy} value={t.y ?? 0} unit="м" min={0} max={30} onChange={(v) => patch(t.id, { y: v })} />
                </div>
              )}
              <div class="grid-3">
                <SelectField label={S.treat.thickness} value={String(t.thickness)} options={THICKNESSES.map((d) => ({ value: String(d), label: `${Math.round(d * 100)} см` }))} onChange={(v) => patch(t.id, { thickness: +v })} />
                <NumberField compact id={`${t.id}-w`} label={t.kind === 'cloud' ? S.treat.sizeY : S.treat.width} value={t.width} unit="м" min={0.1} max={10} onChange={(v) => patch(t.id, { width: v })} />
                <NumberField compact id={`${t.id}-h`} label={t.kind === 'cloud' ? S.treat.sizeX : S.treat.height} value={t.height} unit="м" min={0.1} max={10} onChange={(v) => patch(t.id, { height: v })} />
              </div>
              {t.kind !== 'corner' && (
                <NumberField compact id={`${t.id}-g`} label={S.treat.gap} value={t.gap ?? 0} unit="м" min={0} max={0.5} onChange={(v) => patch(t.id, { gap: v })} />
              )}
                </div>
              </details>
            </div>
          ))}
          <div class="btn-row">
            <button type="button" class="btn btn--small" onClick={() => add('corner')}>{S.treat.addCorner}</button>
            <button type="button" class="btn btn--small" onClick={() => add('panel')}>{S.treat.addPanel}</button>
            <button type="button" class="btn btn--small" onClick={() => add('cloud')}>{S.treat.addCloud}</button>
          </div>
          <button type="button" class="btn btn--small btn--ghost treat-clear" onClick={() => setAskClear(true)}>{S.treat.clearAll}</button>
          {askClear && (
            <ConfirmSheet
              title={S.treat.clearTitle}
              text={S.treat.clearText(list.length)}
              confirm={S.treat.clearAll}
              onCancel={() => setAskClear(false)}
              onConfirm={() => { setAskClear(false); onRoom({ ...room, treatments: [], treatmentsOn: false }); }}
            />
          )}
          <h4 class="subhead">{S.treat.shopping}</h4>
          <ul class="plain-list small">
            {Object.entries(area).sort((a, b) => +a[0] - +b[0]).map(([d, a], ki) => <li key={ki}>{S.treat.material(Math.round(+d * 100), fmt(a, 1))}</li>)}
          </ul>
          <p class="muted small">{S.treat.materialNote}</p>
        </>
      )}
    </>
  );
}
