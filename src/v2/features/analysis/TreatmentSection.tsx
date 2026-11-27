// Раздел «Акустическая обработка» (V2-034): поглощение элементов по октавам (табличная модель пористого слоя ядра),
// нижняя граница эффективной работы, влияние на реверберацию (с обработкой и без), какие точки отражений закрыты.
import { useMemo } from 'preact/hooks';
import { Badge, DataTable, EmptyState, Notice, buttonClass } from '../../design-system';
import { OCTAVES } from '../../../core/materials';
import { calcReverb } from '../../adapters/calculations';
import { TREATMENT_LABEL } from '../../application/editing';
import { reflectionPaths, treatmentEffects } from '../../application/analysis';
import { toCore } from '../../adapters/core';
import { useApp } from '../../shared/context';
import { roomHref } from '../../shared/router';
import { Block, Limits, cm, hz, n1, n2, type AnalysisProps } from './common';

const SHOWN = [125, 250, 500, 1000, 2000] as const;
const octave = (f: number) => OCTAVES.indexOf(f as (typeof OCTAVES)[number]);
const band = (f: number) => (f >= 1000 ? `${f / 1000} кГц` : `${f} Гц`);

export function TreatmentSection(p: AnalysisProps) {
  const { clock } = useApp();
  const c = p.edit.config;
  const roomId = p.h.room!.id;
  const items = c.treatment.items;
  const effects = useMemo(() => treatmentEffects(c), [c]);
  const withT = useMemo(() => calcReverb({ ...c, treatment: { ...c.treatment, enabled: true } }, clock.now()), [c, clock]);
  const without = useMemo(() => calcReverb({ ...c, treatment: { ...c.treatment, enabled: false } }, clock.now()), [c, clock]);
  const refl = useMemo(() => (toCore(c).ok ? reflectionPaths({ ...c, treatment: { ...c.treatment, enabled: true } }) : []), [c]);
  if (!items.length) {
    return <EmptyState icon="panel" title="Обработки нет" text="Добавьте панели, угловые ловушки или облако в разделе модели «Обработка» — здесь появятся их поглощение и влияние на реверберацию."
      action={<a class={buttonClass('primary')} href={roomHref(roomId, 'model', 'treatment')}>Обработка</a>} />;
  }
  const covered = refl.filter((r) => r.treated && r.surface !== 'front').length;
  const lateral = refl.filter((r) => r.surface !== 'front').length;
  return (
    <div class="al-stack al-stack--24">
      {!c.treatment.enabled && <Notice tone="warning" title="Обработка не учитывается">Она выключена в разделе модели «Обработка»: ниже — сколько она дала бы.</Notice>}
      <Block title="Элементы обработки" subtitle="Коэффициент поглощения пористого слоя по октавам — табличная модель ядра с учётом толщины и зазора.">
        <DataTable caption="Поглощение элементов обработки" rowKey={(e) => e.id} rows={effects} columns={[
          { key: 'kind', title: 'Элемент', render: (e) => { const t = items.find((x) => x.id === e.id)!; return `${TREATMENT_LABEL[e.kind as keyof typeof TREATMENT_LABEL]}${t.enabled === false ? ' · выключен' : ''}`; } },
          { key: 'area', title: 'Площадь', numeric: true, render: (e) => `${n2(e.area)} м²` },
          { key: 'depth', title: 'Толщина + зазор', numeric: true, render: (e) => { const t = items.find((x) => x.id === e.id)!; return 'thickness' in t ? `${cm(t.thickness)}${'gap' in t && t.gap ? ` + ${cm(t.gap)}` : ''}` : '—'; } },
          ...SHOWN.map((f) => ({ key: String(f), title: band(f), numeric: true, render: (e: (typeof effects)[number]) => (e.alpha ? n2(e.alpha[octave(f)]) : '—') })),
          { key: 'low', title: 'Хорошо работает от', numeric: true, render: (e) => (e.lowLimit ? `≈ ${hz(e.lowLimit)}` : <Badge tone="neutral" icon={false}>не в расчёте</Badge>) },
        ]} />
        <p class="al-text-small al-text-secondary">
          «Хорошо работает от» — частота, где толщина с зазором равна четверти длины волны; ниже панель тоже поглощает, но слабее. Диффузоры и резонаторы хранятся в модели, но в расчёт ядра пока не входят.
        </p>
      </Block>
      {withT.ok && without.ok && (
        <Block title="Влияние на реверберацию" subtitle="Расчёт по Сэбину и Эйрингу с обработкой и без неё; остальное в комнате то же.">
          <DataTable caption="Влияние обработки на реверберацию" rowKey={(k) => String(k)} rows={withT.result.value.bands.map((_, k) => k)} columns={[
            { key: 'f', title: 'Полоса', render: (k) => band(withT.result.value.bands[k]) },
            { key: 'without', title: 'Без обработки', numeric: true, render: (k) => `${n2(without.result.value.used[k])} с` },
            { key: 'with', title: 'С обработкой', numeric: true, render: (k) => `${n2(withT.result.value.used[k])} с` },
            { key: 'a', title: 'Добавлено поглощения', numeric: true, render: (k) => `${n1(withT.result.value.absorptionArea[k] - without.result.value.absorptionArea[k])} м²` },
          ]} />
        </Block>
      )}
      {lateral > 0 && (
        <Block title="Точки первых отражений">
          <p class="al-text-small">Закрыто обработкой: {covered} из {lateral} (боковые стены, задняя стена, потолок). Подробно — в разделе <a href={roomHref(roomId, 'analysis', 'reflections')}>«Отражения»</a>.</p>
        </Block>
      )}
      <Limits title="Ограничения моделей" items={[
        'Пористое поглощение — упрощённые табличные коэффициенты ядра, а не модели Delany–Bazley, Miki или TMM; плотность материала сама по себе не определяет поглощение.',
        'Угловая ловушка считается как плоская панель с полостью: это не точный расчёт сложной угловой конструкции.',
        'Частота настройки резонатора сама по себе не определяет его поглощение; декоративный рельеф не считается диффузором.',
        'Акустическая эффективность не доказывает безопасность: учитывайте пожарную безопасность, выделение волокон, крепления и массу.',
      ]} />
    </div>
  );
}
