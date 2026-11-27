// Общие блоки разделов анализа (V2-031–V2-035): состояние расчёта, вторая конфигурация для сравнения, ограничения.
import type { ComponentChildren } from 'preact';
import { Button, CalcStatus, Card, Notice, PlanView, type PlanMap, type SeriesKind } from '../../design-system';
import type { Complexity, RoomConfiguration } from '../../domain/model';
import { LAYERS, planItems } from '../model/planItems';
import type { ConfigEdit } from '../model/useConfig';
import type { RoomHandle } from '../rooms/useRoom';
import type { Analysis, AnalysisState } from './useAnalysis';
import type { JobState } from './useJob';
import { hz, n0, n1, n2 } from '../../shared/format';

/** Вторая конфигурация комнаты — для сравнения в разделах, где оно применимо. */
export interface Other { label: string; kind: SeriesKind; config: RoomConfiguration; state: AnalysisState }

export interface AnalysisProps {
  h: RoomHandle;
  edit: ConfigEdit;
  level: Complexity;
  /** Подпись и вид выбранной конфигурации. */
  label: string;
  kind: SeriesKind;
  state: AnalysisState;
  other: Other | null;
}

export { n0, n1, n2, hz };
export const metres = (v: number) => `${n2(v)} м`;
export const cm = (v: number) => `${n0(v * 100)} см`;

export function analysisStatus(s: AnalysisState | JobState<unknown>, onStart?: () => void, idle = 'Расчёт не запускался.') {
  if (s.status === 'running') return <CalcStatus state="running" progress={s.progress} />;
  if (s.status === 'error') return <CalcStatus state="error" text={`Ошибка расчёта: ${s.message}`} onRetry={onStart} />;
  if (s.status === 'unavailable') return <CalcStatus state="unavailable" text={s.reason} />;
  if (s.status === 'idle') return <div class="al-row al-row--12"><CalcStatus state="idle" text={idle} />{onStart && <Button variant="secondary" small icon="play" onClick={onStart}>Рассчитать</Button>}</div>;
  return null;
}

/** Показывает детей, когда расчёт конфигурации готов; иначе — его состояние. */
export function Gate({ state, children }: { state: AnalysisState; children: (a: Analysis) => ComponentChildren }) {
  if (state.status !== 'ready') return analysisStatus(state);
  return <>{children(state.value)}</>;
}

export function Limits({ items, title = 'Ограничения расчёта' }: { items: readonly string[]; title?: string }) {
  const list = [...new Set(items)].filter(Boolean);
  if (!list.length) return null;
  return <Notice title={title}><ul>{list.map((l) => <li key={l}>{l}</li>)}</ul></Notice>;
}

const ALL = new Set(LAYERS);

/** План сверху для анализа: объекты конфигурации без правки и наложение (карта, пути). */
export function AnalysisPlan({ config, title, renderOverlay, selectedId, onSelect, children }: {
  config: RoomConfiguration; title: string; renderOverlay?: (m: PlanMap) => ComponentChildren; selectedId?: string | null; onSelect?: (id: string | null) => void; children?: ComponentChildren;
}) {
  if (config.geometry.kind !== 'rect') return <Notice>План доступен для прямоугольной комнаты.</Notice>;
  const g = config.geometry;
  const p = planItems(config, ALL);
  return <PlanView title={title} depth={g.depth} width={g.width} height={g.height} items={p.items} openings={p.openings} renderOverlay={renderOverlay} selectedId={selectedId} onSelect={onSelect}>{children}</PlanView>;
}

/** Карточка раздела анализа: содержимое — столбцом с отступом 12. */
export function Block({ title, subtitle, children }: { title: string; subtitle?: ComponentChildren; children?: ComponentChildren }) {
  return <Card title={title} subtitle={subtitle}><div class="al-stack al-stack--12">{children}</div></Card>;
}
