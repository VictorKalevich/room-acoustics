// Вкладка «Модель» (V2-021–V2-025): обзор — единый план и разделы; раздел — свой адрес `#/rooms/<id>/model/<раздел>`.
// Уровень сложности — общий или переопределённый для модели комнаты (scope `model`).
import { Icon, Section, buttonClass, type IconName } from '../../design-system';
import { effectiveComplexity } from '../../application/settings';
import { useApp } from '../../shared/context';
import { dimsText, systemText, volumeText } from '../../shared/format';
import { ROOM_SECTIONS, roomHref, type RoomSection } from '../../shared/router';
import type { RoomHandle } from '../rooms/useRoom';
import { PlanEditor } from './PlanEditor';
import { AudioSection, GeometrySection, HiddenNotice, InteriorSection, ListeningSection, SimulationSection, TreatmentSection, type SectionProps } from './sections';
import { CompareSection } from '../experiment/Compare';
import { HistorySection } from '../experiment/History';
import { useConfig } from './useConfig';
import type { ComponentType } from 'preact';
import type { Room, RoomConfiguration } from '../../domain/model';

type ModelSection = RoomSection<'model'>;

export const MODEL_SECTION: Record<ModelSection, { title: string; icon: IconName; view: ComponentType<SectionProps>; summary: (c: RoomConfiguration, r: Room) => string }> = {
  geometry: { title: 'Помещение', icon: 'model', view: GeometrySection, summary: (c) => `${dimsText(c)}${volumeText(c) ? ` · ${volumeText(c)}` : ''} · проёмов: ${c.openings.length}` },
  audio: { title: 'Аудиосистема', icon: 'speaker', view: AudioSection, summary: (c) => systemText(c) },
  listening: { title: 'Слушатели', icon: 'listener', view: ListeningSection, summary: (c) => `Мест: ${c.listening.listeners.length}` },
  interior: { title: 'Интерьер', icon: 'layers', view: InteriorSection, summary: (c) => `Предметов: ${c.interior.obstacles.length}, покрытий: ${c.interior.coverings.length}` },
  treatment: { title: 'Обработка', icon: 'panel', view: TreatmentSection, summary: (c) => `Элементов: ${c.treatment.items.length}${c.treatment.items.length ? (c.treatment.enabled ? ' · учитывается' : ' · не учитывается') : ''}` },
  simulation: { title: 'Параметры расчёта', icon: 'settings', view: SimulationSection, summary: (c) => `${c.simulation.temperatureC} °C` },
  compare: { title: 'Сравнение', icon: 'compare', view: CompareSection, summary: (_c, r) => (r.experimental ? 'Текущая и эксперимент: план, отличия, расчёт' : r.history.length ? 'Снимки истории и текущая' : 'Создайте эксперимент, чтобы сравнить') },
  history: { title: 'История', icon: 'history', view: HistorySection, summary: (_c, r) => `Снимков: ${r.history.length}${r.archive.length ? `, вариантов в архиве: ${r.archive.length}` : ''}` },
};

const isModelSection = (s: string | undefined): s is ModelSection => !!s && (ROOM_SECTIONS.model as readonly string[]).includes(s);

export function ModelTab({ h, section }: { h: RoomHandle; section?: string }) {
  const { settings } = useApp();
  const edit = useConfig(h);
  const level = effectiveComplexity(settings, 'model');
  const roomId = h.room!.id;
  if (isModelSection(section)) {
    const s = MODEL_SECTION[section];
    const View = s.view;
    return (
      <div class="al-stack al-stack--16">
        <div class="al-row"><a class={buttonClass('ghost', true)} href={roomHref(roomId, 'model')}><Icon name="back" small />Модель: обзор</a></div>
        <Section title={s.title}>
          <View h={h} edit={edit} level={level} />
        </Section>
      </div>
    );
  }
  return (
    <div class="al-stack al-stack--24">
      <HiddenNotice edit={edit} level={level} />
      <Section title="План комнаты">
        <PlanEditor h={h} edit={edit} level={level} />
      </Section>
      <Section title="Разделы модели">
        <nav class="al-tiles" aria-label="Разделы модели">
          {ROOM_SECTIONS.model.map((id) => {
            const s = MODEL_SECTION[id];
            return (
              <div key={id} class="al-tile">
                <div class="al-tile__head"><span class="al-tile__icon"><Icon name={s.icon} /></span><a class="al-tile__link al-tile__title al-text-title" href={roomHref(roomId, 'model', id)}>{s.title}</a></div>
                <p class="al-tile__text">{s.summary(edit.config, h.room!)}</p>
              </div>
            );
          })}
        </nav>
      </Section>
    </div>
  );
}
