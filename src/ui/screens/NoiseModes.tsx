import { useMemo } from 'preact/hooks';
import { modeWhere } from '../../core/modes';
import {
  coincident, matchPeaks, matchUpper, modeMarkers, PEAK_MIN_FRAMES, PEAK_PROMINENCE_DB, spectralPeaks, type NoiseMode, type NoiseRoomSnapshot,
} from '../../core/noiseModes';
import { SPECTRUM_HOP } from '../../core/noiseSpectrum';
import { speedOfSound } from '../../core/physics';
import type { ModeKind } from '../../core/types';
import type { ChartMark } from '../components/Charts';
import { Details, Note, SelectField } from '../design-system';
import { fmt } from '../format';
import { S } from '../strings';

const t = S.noise.modes;
/** Открытый проект для шумомера (057): комната — снимок из того же списка мод, что на экране «Моды». */
export interface NoiseProject { id: string; name: string; room: NoiseRoomSnapshot }
/** Моды измерения (057): снимок комнаты на момент измерения; null — связь с проектом есть, снимка нет. */
export interface ModeSource { project: string; snapshot: NoiseRoomSnapshot | null; changed: boolean }

export const roomText = (s: NoiseRoomSnapshot) =>
  t.room(fmt(s.depth, 2), fmt(s.width, 2), fmt(s.height, 2), fmt(s.temperatureC, 0), fmt(speedOfSound(s.temperatureC), 1));

const KINDS: Record<string, readonly ModeKind[]> = { axial: ['axial'], planar: ['axial', 'tangential'], all: ['axial', 'tangential', 'oblique'] };
export const modeKey = (m: NoiseMode) => m.n.join('-');
const indices = (m: NoiseMode) => m.n.join(', ');
const title = (m: NoiseMode) => `${fmt(m.f, 1)} Гц, ${S.modes.kinds[m.kind]}${m.kind === 'oblique' ? '' : ', ' + modeWhere(m.n)}`;

/** Маркеры для графика: по диапазону графика и выбранным типам, не больше MAX_MARKERS. */
export function useModeMarks(source: ModeSource | null | undefined, show: string, picked: string, highHz: number) {
  const snapshot = show !== 'none' ? source?.snapshot ?? null : null;
  const markers = useMemo(() => snapshot ? modeMarkers(snapshot.modes, { lo: 20, hi: highHz, kinds: KINDS[show] }) : null, [snapshot, show, highHz]);
  const marks: ChartMark[] | undefined = markers?.shown.map(m => ({ f: m.f, kind: m.kind, title: title(m), selected: modeKey(m) === picked }));
  return { markers, marks };
}

export function ModeOverlay({ source, show, onShow, picked, onPick, markers, density, binHz, seconds, sampleRate, highHz }: {
  source: ModeSource; show: string; onShow(v: string): void; picked: string; onPick(v: string): void;
  markers: ReturnType<typeof modeMarkers> | null; density: Float64Array | null; binHz: number; seconds: number; sampleRate: number; highHz: number;
}) {
  const s = source.snapshot;
  const frames = Math.floor(seconds * sampleRate / SPECTRUM_HOP + 1e-9);
  const upper = s ? matchUpper(s, highHz) : 0;
  const search = useMemo(() => s && show !== 'none' && density ? spectralPeaks(density, binHz, { lo: 20, hi: upper, frames }) : null,
    [s, show, density, binHz, upper, frames]);
  const matches = useMemo(() => search?.ok && s ? matchPeaks(search.peaks, s.modes, binHz) : [], [search, s, binHz]);
  if (!s) return <Note>{t.noSnapshot}</Note>;
  const selected = markers?.shown.find(m => modeKey(m) === picked) ?? null;
  return <>
    <SelectField label={t.show} value={show} onChange={onShow} options={Object.entries(t.options).map(([value, label]) => ({ value, label }))} />
    {show !== 'none' && markers && <>
      <div class="legend">
        <span class="legend__item legend__item--measured">{S.noise.spectrum.toLowerCase()}</span>
        {KINDS[show].map(k => <span key={k} class={`legend__item legend__item--${k}`}>{S.modes.kinds[k]}</span>)}
      </div>
      <p class="small">{t.source(source.project, roomText(s))}</p>
      {s.approximate && <Note>{t.approximate}</Note>}
      {source.changed && <Note tone="warn">{t.changed}</Note>}
      <p class="small">{markers.total ? t.count(markers.shown.length, markers.total) : t.none}</p>
      {!!markers.shown.length && <SelectField label={t.pick} value={selected ? picked : ''} onChange={onPick} options={[
        { value: '', label: t.notPicked },
        ...markers.shown.map(m => ({ value: modeKey(m), label: t.option(fmt(m.f, 1), S.modes.kinds[m.kind], indices(m)) })),
      ]} />}
      {selected && <p class="small">{t.detail(fmt(selected.f, 1), S.modes.kinds[selected.kind], indices(selected),
        selected.kind === 'oblique' ? '' : modeWhere(selected.n))} {coincident(s.modes, selected) ? t.coincident : ''}</p>}
      <Details summary={t.peaks + ' · ' + t.peaksSummary}>
        <Note tone="warn">{t.caution}</Note>
        {s.schroederHz < highHz && <p class="small">{t.schroeder(fmt(s.schroederHz, 0))}</p>}
        {!search ? null : !search.ok ? <p class="small">{search.reason === 'frames'
          ? t.peaksNeedAverage(fmt(PEAK_MIN_FRAMES * SPECTRUM_HOP / sampleRate, 1)) : t.peaksRange}</p> : <>
          <p class="small">{t.peaksScope(fmt(search.lo, 1), fmt(search.hi, 1), fmt(binHz, 3), fmt(PEAK_PROMINENCE_DB, 0))}</p>
          {matches.length ? <ul class="plain-list">{matches.map(m => <li key={m.peak.bin}>
            <strong>{t.peak(fmt(m.peak.f, 1), fmt(m.peak.prominenceDb, 1))}</strong>
            <br />{m.candidates.length ? <>{t.candidates(fmt(m.tolerance, 1))} {m.candidates.slice(0, 3)
              .map(c => t.option(fmt(c.mode.f, 1), S.modes.kinds[c.mode.kind], indices(c.mode))).join('; ')}
              {m.candidates.length > 3 ? '; ' + t.more(m.candidates.length - 3) : ''}</> : t.noCandidate(fmt(m.tolerance, 1))}
          </li>)}</ul> : <p class="small">{t.peaksNone(fmt(PEAK_PROMINENCE_DB, 0))}</p>}
        </>}
      </Details>
    </>}
  </>;
}
