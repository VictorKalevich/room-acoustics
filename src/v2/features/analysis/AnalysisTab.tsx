// Вкладка «Анализ» (V2-031–V2-035): обзор — ключевые физические показатели, проблемы по ядру и переходы в восемь
// разделов; раздел — свой адрес `#/rooms/<id>/analysis/<раздел>`. Анализируется выбранная конфигурация (текущая или
// эксперимент); вторая, если есть, — для сравнения. Сводная оценка 0–100 — вторичная строка (R26).
import type { ComponentType } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import { Badge, Button, Icon, MetricCard, Section, buttonClass, type IconName } from '../../design-system';
import { rtBand, type Problem } from '../../../core/overview';
import { SURFACE_LABEL as SURFACE_NAME } from '../../application/editing';
import { flutterRisk, reflectionPaths, sbirNotches, stereoPair } from '../../application/analysis';
import { effectiveComplexity } from '../../application/settings';
import { useApp } from '../../shared/context';
import { ROOM_SECTIONS, roomHref, type RoomSection } from '../../shared/router';
import { useConfig } from '../model/useConfig';
import type { RoomHandle } from '../rooms/useRoom';
import { BassSection } from './BassSection';
import { Block, Gate, Limits, hz, n0, n1, n2, type AnalysisProps, type Other } from './common';
import { MeasurementsSection } from './MeasurementsSection';
import { ListenersSection, SpeakersSection, SubwoofersSection } from './PlacementSections';
import { ReflectionsSection } from './ReflectionsSection';
import { ReverbSection } from './ReverbSection';
import { TreatmentSection } from './TreatmentSection';
import { useAnalysis, type Analysis } from './useAnalysis';

type AnalysisSection = RoomSection<'analysis'>;

export const ANALYSIS_SECTION: Record<AnalysisSection, { title: string; icon: IconName; view: ComponentType<AnalysisProps>; text: string }> = {
  bass: { title: 'Качество баса', icon: 'wave', view: BassSection, text: 'Моды, затухание резонансов, отклик в месте слушателя, пропорции' },
  speakers: { title: 'Колонки', icon: 'speaker', view: SpeakersSection, text: 'Стереоугол, расстояния до поверхностей и слушателя, направление, SBIR' },
  subwoofers: { title: 'Сабвуферы', icon: 'sub', view: SubwoofersSection, text: 'Места, настройки, разброс между слушателями, карта места' },
  listeners: { title: 'Места прослушивания', icon: 'listener', view: ListenersSection, text: 'Точки оценки, карта качества баса, устойчивость, место для записи' },
  reflections: { title: 'Отражения', icon: 'layers', view: ReflectionsSection, text: 'Первые отражения на плане и во времени, задержки, углы, обработанные точки' },
  reverb: { title: 'Эхо и реверберация', icon: 'analysis', view: ReverbSection, text: 'Сэбин и Эйринг по октавам, частота Шрёдера, вклад поверхностей, порхающее эхо' },
  treatment: { title: 'Акустическая обработка', icon: 'panel', view: TreatmentSection, text: 'Поглощение элементов по частотам, влияние на реверберацию, ограничения моделей' },
  measurements: { title: 'Измерения', icon: 'measure', view: MeasurementsSection, text: 'Замеры комнаты, сравнение с моделью, связь с конфигурацией' },
};

const problemSection = (id: string): AnalysisSection => (id.startsWith('rt-') ? 'reverb' : id.startsWith('pen-') || id === 'asym' ? 'speakers' : 'bass');
const SEVERITY: Record<Problem['severity'], { tone: 'danger' | 'warning' | 'neutral'; text: string }> = {
  high: { tone: 'danger', text: 'Серьёзно' }, medium: { tone: 'warning', text: 'Заметно' }, low: { tone: 'neutral', text: 'Слабо' },
};

const isSection = (s: string | undefined): s is AnalysisSection => !!s && (ROOM_SECTIONS.analysis as readonly string[]).includes(s);

export function AnalysisTab({ h, section }: { h: RoomHandle; section?: string }) {
  const { settings } = useApp();
  const edit = useConfig(h);
  const level = effectiveComplexity(settings, 'analysis');
  const room = h.room!;
  const exp = edit.role === 'experimental';
  const otherConfig = exp ? room.current : room.experimental;
  const state = useAnalysis(edit.config);
  const otherState = useAnalysis(otherConfig ?? null);
  const other: Other | null = otherConfig ? { label: exp ? 'Текущая' : 'Эксперимент', kind: exp ? 'current' : 'experimental', config: otherConfig, state: otherState } : null;
  const props: AnalysisProps = { h, edit, level, label: exp ? 'Эксперимент' : 'Текущая', kind: exp ? 'experimental' : 'current', state, other };

  if (isSection(section)) {
    const s = ANALYSIS_SECTION[section];
    const View = s.view;
    return (
      <div class="al-stack al-stack--16">
        <div class="al-row"><a class={buttonClass('ghost', true)} href={roomHref(room.id, 'analysis')}><Icon name="back" small />Анализ: обзор</a></div>
        <Section title={s.title}>
          <View {...props} />
        </Section>
      </div>
    );
  }
  return (
    <div class="al-stack al-stack--24">
      <Section title="Главное">
        <Gate state={state}>{(a) => <Overview p={props} a={a} />}</Gate>
      </Section>
      <Section title="Разделы анализа">
        <nav class="al-tiles" aria-label="Разделы анализа">
          {ROOM_SECTIONS.analysis.map((id) => {
            const s = ANALYSIS_SECTION[id];
            return (
              <div key={id} class="al-tile">
                <div class="al-tile__head"><span class="al-tile__icon"><Icon name={s.icon} /></span><a class="al-tile__link al-tile__title al-text-title" href={roomHref(room.id, 'analysis', id)}>{s.title}</a></div>
                <p class="al-tile__text">{s.text}</p>
              </div>
            );
          })}
        </nav>
      </Section>
    </div>
  );
}

interface Row { id: string; title: string; value: string; note: string; tone?: 'success' | 'warning' | 'neutral'; section: AnalysisSection }

function rows(a: Analysis, c: AnalysisProps['edit']['config']): Row[] {
  const out: Row[] = [];
  out.push({ id: 'bass', title: 'Неровность баса в месте слушателя', value: `${n1(a.ev.score)} дБ`, note: `${hz(a.ev.fLo)}–${hz(a.ev.fHi)}; меньше — ровнее`, section: 'bass' });
  const worst = [...a.overview.decays].sort((x, y) => y.t60 / y.limit - x.t60 / x.limit)[0];
  if (worst) {
    const over = worst.t60 > worst.limit;
    out.push({ id: 'decay', title: `Самый затянутый резонанс, ${hz(worst.f)}`, value: `${n2(worst.t60)} с`, note: `допуск ${n2(worst.limit)} с`, tone: over ? 'warning' : 'success', section: 'bass' });
  }
  const pair = stereoPair(c);
  if (pair) out.push({ id: 'angle', title: 'Стереоугол', value: `${n0(pair.angleDeg)}°`, note: 'начальная цель — около 60°, не обязательное значение', section: 'speakers' });
  const front = sbirNotches(c, c.audio.sources.filter((s) => s.kind === 'speaker')).filter((n) => n.surface === 'front')[0];
  if (front) out.push({ id: 'sbir', title: 'Провал от передней стены (SBIR)', value: hz(front.f), note: `оценка; колонка в ${n2(front.distance)} м от стены`, section: 'speakers' });
  const refl = reflectionPaths(c);
  if (refl.length) {
    const open = refl.filter((r) => !r.treated && r.surface !== 'front');
    out.push({ id: 'refl', title: 'Первые отражения без обработки', value: `${open.length} из ${refl.filter((r) => r.surface !== 'front').length}`, note: 'боковые стены, задняя стена и потолок', tone: open.length ? 'neutral' : 'success', section: 'reflections' });
  }
  const band = rtBand(a.reverb.volume);
  const t = a.reverb.tMid;
  out.push({ id: 'rt', title: 'Время реверберации, 500–1000 Гц', value: `${n2(t)} с`, note: `ориентир для этого объёма ${n2(band[0])}–${n2(band[1])} с`, tone: t > band[1] || t < band[0] ? 'warning' : 'success', section: 'reverb' });
  const flutter = flutterRisk(c);
  out.push({ id: 'flutter', title: 'Порхающее эхо', value: flutter.length ? `${flutter.length} ${flutter.length === 1 ? 'пара' : 'пары'}` : 'нет', note: flutter.length ? `возможно: ${flutter.map((f) => `${SURFACE_NAME[f.a].toLowerCase()} — ${SURFACE_NAME[f.b].toLowerCase()}`).join('; ')}` : 'не ожидается по материалам поверхностей', tone: flutter.length ? 'warning' : 'success', section: 'reverb' });
  return out;
}

function Overview({ p, a }: { p: AnalysisProps; a: Analysis }) {
  const roomId = p.h.room!.id;
  const c = p.edit.config;
  const list = useMemo(() => rows(a, c), [a, c]);
  const otherA = p.other?.state.status === 'ready' ? p.other.state.value : null;
  const otherRows = useMemo(() => (otherA && p.other ? rows(otherA, p.other.config) : null), [otherA, p.other]);
  const [allProblems, setAllProblems] = useState(false);
  const problems = allProblems ? a.overview.problems : a.overview.problems.slice(0, 5);
  return (
    <div class="al-stack al-stack--24">
      <Block title="Ключевые показатели" subtitle={`${p.label} конфигурация. Расчёт ядра (${a.model === 'wave' ? 'волновая модель' : 'модель прямоугольной комнаты'}), а не измерение.`}>
        <div class="al-grid" role="list" aria-label="Ключевые показатели">
          {list.map((r) => {
            const o = otherRows?.find((x) => x.id === r.id);
            return (
              <div role="listitem" key={r.id}>
                <MetricCard label={r.title} value={r.value} tone={r.tone === 'success' ? 'good' : r.tone === 'warning' ? 'warning' : 'neutral'}
                  note={<>{r.note}{o && p.other ? `. ${p.other.label}: ${o.value}` : ''}. <a class="al-list__link" href={roomHref(roomId, 'analysis', r.section)}>{`Подробнее: ${ANALYSIS_SECTION[r.section].title.toLowerCase()}`}</a></>} />
              </div>
            );
          })}
        </div>
        <p class="al-text-small al-text-secondary">Сводная оценка прежней версии — {n0(a.overview.score)} из 100. Она объединяет эти показатели с весами и служит только для сравнения вариантов.</p>
      </Block>
      <Block title="Что мешает" subtitle="Проблемы по расчёту ядра, от серьёзных к слабым.">
        {a.overview.problems.length === 0 ? <p class="al-text-small al-text-secondary">Заметных проблем расчёт не нашёл.</p> : (
          <ul class="al-list" aria-label="Проблемы">
            {problems.map((pr) => {
              const sec = problemSection(pr.id);
              return (
                <li key={pr.id} class="al-list__item al-list__item--wrap">
                  <div class="al-stack al-stack--8">
                    <div class="al-row al-row--12"><Badge tone={SEVERITY[pr.severity].tone}>{SEVERITY[pr.severity].text}</Badge><a class="al-list__link" href={roomHref(roomId, 'analysis', sec)}>{pr.title}</a></div>
                    <span class="al-text-small al-text-secondary">{pr.detail}</span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {a.overview.problems.length > 5 && <Button variant="ghost" small onClick={() => setAllProblems(!allProblems)}>{allProblems ? 'Свернуть' : `Показать все (${a.overview.problems.length})`}</Button>}
      </Block>
      <Limits items={[...a.provenance.limitations, ...a.provenance.warnings]} />
    </div>
  );
}
