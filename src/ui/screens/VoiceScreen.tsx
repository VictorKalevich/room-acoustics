// «Запись голоса»: где встать с микрофоном и куда петь, чтобы комната меньше окрашивала голос.
// Комната — та же, что на экране «Комната»: карта и оценка пересчитываются при любом её изменении.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Project } from '../../state/project';
import type { Heatmap } from '../../core/field';
import { shownTreatments } from '../../core/treatments';
import {
  evaluateVoice, facingAngle, facingName, facingScores, relativeSide, spotAllowed, voiceContext, voiceGrade,
  VOICE_BAND, VOICE_DEFAULTS, FACINGS, type MicPattern, type VoiceMap, type VoiceSettings, type VoiceSpot,
} from '../../core/voice';
import { compute, type ComputeJob } from '../compute';
import { Details, Note, NumberField, Panel, Segmented } from '../components/Fields';
import { HeatLegend, PlanView, type PlanMark, type WallMark } from '../components/PlanView';
import { SmoothedResponseChart } from '../components/SmoothedResponseChart';
import { S } from '../strings';
import { fmt } from '../format';

interface Props {
  project: Project;
  onVoice: (v: VoiceSettings) => void;
}

const STEP = (2 * Math.PI) / FACINGS;
const wrap = (a: number) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);

export function VoiceScreen({ project, onVoice }: Props) {
  const room = project.room;
  const v = project.voice ?? VOICE_DEFAULTS;
  const set = (patch: Partial<VoiceSettings>) => onVoice({ ...v, ...patch });
  const t = S.voice;
  // всё, что влияет на карту, кроме места исполнителя
  const calc = useMemo(() => ({ ...v, spot: null }), [v.mic, v.distance, v.posture, v.mouthZ, v.fLo, v.fHi]); // eslint-disable-line react-hooks/exhaustive-deps
  const bandOk = v.fHi >= 2 * v.fLo;

  // карта — в воркере, с небольшой задержкой, пока меняют поля
  const [map, setMap] = useState<VoiceMap | null>(null);
  const [busy, setBusy] = useState(false);
  const job = useRef<ComputeJob<VoiceMap> | null>(null);
  useEffect(() => {
    if (!bandOk) return;
    // прежний расчёт больше не нужен: его результат не покажем
    job.current?.cancel();
    job.current = null;
    setBusy(true);
    const tm = setTimeout(() => {
      const j = compute<VoiceMap>('voiceMap', { room, settings: calc });
      job.current = j;
      j.promise.then((m) => { if (job.current === j) { setMap(m); setBusy(false); } }).catch(() => { if (job.current === j) setBusy(false); });
    }, 250);
    return () => clearTimeout(tm);
  }, [room, calc, bandOk]);
  useEffect(() => () => job.current?.cancel(), []);

  const ctx = useMemo(() => (bandOk ? voiceContext(room, calc) : null), [room, calc, bandOk]);
  const spot: VoiceSpot | null = v.spot && spotAllowed(room, v.spot.x, v.spot.y, v.spot.facing, v) ? v.spot : null;
  // места ещё нет (или оно стало недоступно после правки комнаты) — встаём в лучшее
  useEffect(() => {
    if (!spot && map && map.best[0]) set({ spot: { x: map.best[0].x, y: map.best[0].y, facing: map.best[0].facing } });
  }, [spot, map]); // eslint-disable-line react-hooks/exhaustive-deps

  const ev = useMemo(() => (ctx && spot ? evaluateVoice(ctx, spot) : null), [ctx, spot?.x, spot?.y, spot?.facing]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirs = useMemo(() => (ctx && spot ? facingScores(ctx, spot.x, spot.y) : null), [ctx, spot?.x, spot?.y]); // eslint-disable-line react-hooks/exhaustive-deps
  const bestDir = useMemo(() => {
    if (!dirs) return null;
    let i = -1;
    dirs.forEach((s, k) => { if (Number.isFinite(s) && (i < 0 || s < dirs[i])) i = k; });
    const fin = dirs.filter(Number.isFinite);
    return i < 0 ? null : { facing: facingAngle(i), score: dirs[i], spread: Math.max(...fin) - Math.min(...fin) };
  }, [dirs]);
  const [cant, setCant] = useState(false);

  /** Встать в точку: направление — лучшее для неё. */
  const standAt = (x: number, y: number, facing?: number) => {
    if (!ctx) return;
    if (facing != null && spotAllowed(room, x, y, facing, v)) { setCant(false); set({ spot: { x, y, facing } }); return; }
    const sc = facingScores(ctx, x, y);
    let i = -1;
    sc.forEach((s, k) => { if (Number.isFinite(s) && (i < 0 || s < sc[i])) i = k; });
    if (i < 0) { setCant(true); return; }
    setCant(false);
    set({ spot: { x, y, facing: facingAngle(i) } });
  };
  const rotate = (d: number) => {
    if (!spot) return;
    for (let k = 1; k <= FACINGS; k++) {
      const f = wrap(spot.facing + d * k * STEP);
      if (spotAllowed(room, spot.x, spot.y, f, v)) { set({ spot: { ...spot, facing: f } }); return; }
    }
  };

  const heat: Heatmap | null = map ? {
    kind: 'voice', x0: map.x0, y0: map.y0, step: map.step, nx: map.nx, ny: map.ny, scores: map.scores, allowed: map.allowed,
    best: map.best.map((b) => ({ pos: { x: b.x, y: b.y }, score: b.score })), current: ev?.score ?? map.min, min: map.min, max: map.max, elapsedMs: 0,
    // разница в доли децибела уже слышна в голосе: шкала уже, чем для баса
    minSpan: 0.6,
  } : null;
  const fin = map ? Array.from(map.scores).filter(Number.isFinite).sort((a, b) => a - b) : [];
  const flatRoom = fin.length > 0 && fin[Math.floor(fin.length * 0.75)] - fin[0] < 0.15;
  const dB = (x: number) => fmt(x, 0).replace('-', '−');

  // ранние отражения для места: метки на стенах и потолке
  const first = (ev?.reflections ?? []).filter((r) => !r.body);
  const wallMarks: WallMark[] = first.filter((r) => ['front', 'back', 'left', 'right'].includes(r.surface)).map((r) => ({
    surface: r.surface as WallMark['surface'],
    at: r.surface === 'front' || r.surface === 'back' ? r.point.y : r.point.x,
  }));
  // точки на потолке и полу — почти над и под исполнителем: на плане не отмечаем, они в списке ниже
  const marks: PlanMark[] = (map?.best ?? []).map((b, i) => ({ x: b.x, y: b.y, label: String(i + 1), kind: 'best' as const }));
  // в списке — заметные отражения: от стен, потолка и пола до −45 дБ, от тела — до −40 дБ
  const shown = (ev?.reflections ?? []).filter((r) => r.db >= (r.body ? -40 : -45));
  const where = (r: (typeof first)[number]) =>
    r.surface === 'floor' ? t.floorWhere
      : r.surface === 'ceiling' || r.surface === 'slope' ? S.tuning.reflWhere('ceiling', fmt(r.point.x, 2), fmt(r.point.y, 2), '')
        : S.tuning.reflWhere(r.surface, fmt(r.point.x, 2), fmt(r.point.y, 2), fmt(r.point.z, 2));
  const grade = ev ? voiceGrade(ev.score) : null;

  return (
    <div class="screen">
      <Panel title={t.setup}>
        <p class="small">{t.intro}</p>
        <Segmented label={t.mic} value={v.mic} options={(['cardioid', 'supercardioid'] as MicPattern[]).map((m) => ({ value: m, label: t.mics[m] }))} onChange={(mic) => set({ mic })} />
        <p class="muted small">{t.micHint[v.mic]}</p>
        <div class="grid-2">
          <NumberField compact id="voice-mouth" label={t.mouthZ} value={v.mouthZ * 100} unit="см" digits={1} min={60} max={220} onChange={(cm) => set({ mouthZ: cm / 100 })} />
          <NumberField compact id="voice-dist" label={t.distance} value={Math.round(v.distance * 100)} unit="см" digits={0} min={5} max={60} onChange={(cm) => set({ distance: cm / 100 })} />
        </div>
        <p class="muted small">Микрофон расположен на высоте рта. Для записи сидя или стоя укажите нужную высоту.</p>
        <span class="range-row__label">{t.band}</span>
        <div class="grid-2">
          <NumberField compact id="voice-flo" label={t.bandFrom} value={v.fLo} unit="Гц" digits={0} min={20} max={2000} onChange={(fLo) => set({ fLo })} />
          <NumberField compact id="voice-fhi" label={t.bandTo} value={v.fHi} unit="Гц" digits={0} min={200} max={20000} onChange={(fHi) => set({ fHi })} />
        </div>
        {!bandOk && <Note tone="warn">{t.bandBad}</Note>}
        <p class="muted small">{t.bandHint}</p>
        {(v.fLo !== VOICE_BAND[0] || v.fHi !== VOICE_BAND[1]) && (
          <button type="button" class="btn btn--small btn--ghost" onClick={() => set({ fLo: VOICE_BAND[0], fHi: VOICE_BAND[1] })}>{t.bandReset}</button>
        )}
      </Panel>

      <Panel title={t.mapTitle}>
        <p class="map-help__line small">{t.mapLine}</p>
        <PlanView
          depth={room.depth}
          width={room.width}
          zones={room.zones}
          extensions={room.extensions}
          openings={room.openings}
          features={room.features}
          treatments={shownTreatments(room)}
          slope={room.slope}
          heatmap={heat}
          items={spot ? [{ id: 'singer', kind: 'singer', pos: { x: spot.x, y: spot.y, z: v.mouthZ }, facing: spot.facing, micDist: v.distance }] : []}
          marks={marks}
          wallMarks={wallMarks}
          onMove={(_, pos) => { if (spot) standAt(pos.x, pos.y, spot.facing); }}
          onTap={(pos) => standAt(pos.x, pos.y)}
          keyNotes={{ heat: t.mapLine, best: t.keyBest }}
          label="План комнаты: где встать с микрофоном"
        />
        {heat && <HeatLegend hm={heat} hint={t.legend} />}
        <p class="progress-text small" role="status" aria-live="polite">
          {busy && <><span class="spinner" aria-hidden="true" /> {t.computing}</>}
        </p>
        {cant && <Note tone="warn">{t.cantStand}</Note>}
        {spot && (
          <div class="voice-facing">
            <strong>{t.facingNow(facingName(spot.facing))}</strong>
            <div class="btn-row">
              <button type="button" class="btn btn--small" onClick={() => rotate(-1)}>{t.rotateLeft}</button>
              <button type="button" class="btn btn--small" onClick={() => rotate(1)}>{t.rotateRight}</button>
              <button
                type="button"
                class="btn btn--small btn--ghost"
                disabled={!bestDir || Math.cos(bestDir.facing - spot.facing) > 0.9999}
                onClick={() => bestDir && set({ spot: { ...spot, facing: bestDir.facing } })}
              >
                {t.bestHere}
              </button>
            </div>
            {bestDir && ev && (bestDir.spread < 0.1
              ? <p class="muted small">{t.facingFree}</p>
              : ev.score - bestDir.score > 0.05 && <p class="small">{t.facingBest(facingName(bestDir.facing), fmt(ev.score - bestDir.score, 1))}</p>)}
          </div>
        )}
      </Panel>

      <Panel title={t.scorePanel}>
        <div class="score score--key score-block">
          <div class="score__main">
            <span class="score__value">{ev ? fmt(ev.score, 1) : '…'}</span>
            <span class="score__unit">дБ</span>
          </div>
          <div class="score__text">
            <span class="score__context small">{t.here}</span>
            <span class="score__label">{t.scoreTitle}</span>
            <span class="small">{ev ? t.scoreExplain(fmt(ev.score, 1)) : ''}</span>
            {grade && <span class={`score__grade is-${grade}`}>{t.grade[grade]}</span>}
            {map && <span class="muted small">{t.bestScore(fmt(map.min, 1))}</span>}
            {flatRoom && <span class="muted small">{t.flat}</span>}
          </div>
          {ev && (
            <div class="score__second">
              <span>{t.roomLevel(fmt(-ev.roomDb, 0))}</span>
              <span class="muted small">{t.roomHint}</span>
            </div>
          )}
        </div>
        <ul class="best-list">
          {(map?.best ?? []).map((b, i) => (
            <li key={i}>
              <span class="best-list__n">{i + 1}</span>
              <span class="best-list__text">
                <strong>{fmt(b.score, 1)} дБ</strong>
                <span class="muted small">{t.bestRow(fmt(b.x, 2), fmt(b.y, 2), facingName(b.facing))}</span>
              </span>
              <button type="button" class="btn btn--small" onClick={() => standAt(b.x, b.y, b.facing)}>{t.standHere}</button>
            </li>
          ))}
        </ul>
        {ev && (
          <>
            <h3 class="subhead">{t.response}</h3>
            <SmoothedResponseChart screen="voice" fLo={v.fLo} fHi={v.fHi} yRange={[-6, 6]} yTicks={[-5, 0, 5]} lines={[{ f: ev.f, db: ev.db, cls: 'is-room' }]} />
            <p class="muted small">{t.responseHint(fmt(v.fLo, 0), fmt(v.fHi, 0))}</p>
          </>
        )}
      </Panel>

      {ev && spot && (
        <Panel title={t.reflTitle}>
          <p class="small">{t.reflIntro}</p>
          <ul class="plain-list small voice-refl">
            {shown.map((r, ki) => (
              <li key={ki}>
                {r.body
                  ? t.bodyRow(t.surfGen[r.surface], dB(r.db), fmt(r.ms, 1))
                  : t.reflRow(t.side[relativeSide(spot, r.point, r.surface)], t.surf[r.surface], where(r), dB(r.db), fmt(r.ms, 1), r.on && r.on !== 'opening' ? t.on[r.on] : null)}
              </li>
            ))}
          </ul>
          <Details summary={t.how}>
            <p class="small">{t.howText}</p>
          </Details>
        </Panel>
      )}
    </div>
  );
}
