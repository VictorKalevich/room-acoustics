// Общая система советов (V2-041, V2-042): детерминированные локальные правила с версией поверх расчёта ядра
// (сводка, отклик, реверберация) и показателей анализа v2. Каждое правило называет причину, источник, метод,
// условия применимости, эффект, побочные последствия, стоимость, трудоёмкость, действия и проверку. Цели меняют
// порядок и актуальность, ограничения — допустимость. Формулы ядра не меняются; оценки правил названы оценками.
import { responseExtremes, rtBand, type Overview } from '../../core/overview';
import { suggestTreatments, THICKNESSES } from '../../core/treatments';
import type { SetupEval } from '../../core/system';
import type { ReverbResult, Treatment, Vec3 } from '../../core/types';
import { ADVICE_GROUPS, type AdviceGroup, type Effort, type Evidence, type Proposal, type Recommendation } from '../domain/advice';
import type { GoalId, Goals, RoomConfiguration, TreatmentItem } from '../domain/model';
import { coreInputs, toCore } from '../adapters/core';
import type { MeasurementRecord } from '../domain/measurement';
import { moveObject, primaryListener } from '../domain/operations';
import { isKnown } from '../domain/units';
import { flutterRisk, reflectionPaths, sbirNotches, soundSpeed, stereoPair } from './analysis';
import { SURFACE_LABEL } from './editing';

export const ADVICE_VERSION = 'v2-advice-1';

const ON_WALL: Record<string, string> = { left: 'левой стене', right: 'правой стене', front: 'передней стене', back: 'задней стене' };

export const GROUP_LABEL: Record<AdviceGroup, string> = {
  data: 'Проверка исходных данных', placement: 'Расстановка — бесплатно', settings: 'Настройка оборудования',
  treatment: 'Акустическая обработка', dsp: 'Коррекция DSP', equipment: 'Покупка оборудования',
};
export const EVIDENCE_LABEL: Record<Evidence, string> = {
  measured: 'Подтверждено измерением', predicted: 'Предсказано моделью', assumption: 'Предположение', 'needs-check': 'Требует проверки',
};
export const EFFORT_LABEL: Record<Effort, string> = { minutes: 'минуты', hours: 'часы', days: 'дни' };
export const GOAL_LABEL: Record<GoalId, string> = {
  balanced: 'Сбалансированная акустика', 'bass-uniformity': 'Равномерность баса', 'bass-depth': 'Глубина баса', stereo: 'Стереопанорама',
  speech: 'Разборчивость речи', reverb: 'Реверберация', custom: 'Своя цель',
};

/** Правила в приоритете и неактуальные для цели. */
const GOAL_RULES: Record<GoalId, { goal: readonly string[]; off: readonly string[] }> = {
  balanced: { goal: [], off: [] },
  'bass-uniformity': { goal: ['listener-mid', 'bass-dips', 'sub-settings', 'bass-traps', 'second-sub', 'dsp-peaks'], off: [] },
  'bass-depth': { goal: ['add-sub', 'second-sub', 'bass-dips', 'sub-settings'], off: ['rt-low'] },
  stereo: { goal: ['stereo-angle', 'symmetry', 'speaker-rules', 'sbir-front', 'reflections'], off: ['add-sub'] },
  speech: { goal: ['rt-high', 'flutter', 'reflections'], off: ['add-sub', 'second-sub'] },
  reverb: { goal: ['rt-high', 'rt-low', 'flutter'], off: ['add-sub', 'second-sub', 'dsp-peaks'] },
  custom: { goal: [], off: [] },
};

/** Правила, которые двигают колонки или сабвуферы. */
const MOVES_EQUIPMENT = new Set(['stereo-angle', 'symmetry', 'speaker-rules', 'sbir-front', 'bass-dips']);
/** Правила, которые занимают площадь пола. */
const TAKES_AREA = new Set(['bass-traps', 'second-sub', 'add-sub']);

export interface AdviceInput {
  config: RoomConfiguration;
  goals: Goals;
  /** Расчёт ядра для этой конфигурации; null — недоступен (тогда правила модели не срабатывают). */
  analysis: { ev: SetupEval; overview: Overview; reverb: ReverbResult } | null;
  measurements: readonly MeasurementRecord[];
  /** Последний замер АЧХ этой конфигурации на сетке расчёта (выровнен по цели); null — замера нет. */
  measured: { name: string; response: SetupEval['response'] } | null;
  /** Предупреждения перевода конфигурации в ядро. */
  warnings: readonly string[];
}

/** Замер на сетке отклика модели, выровненный по среднему цели (как коррекция по замеру в legacy). */
export function measuredOnGrid(resp: SetupEval['response'], at: readonly (number | null)[]): SetupEval['response'] | null {
  const idx = at.map((v, k) => (v == null ? -1 : k)).filter((k) => k >= 0);
  if (idx.length < 8) return null;
  const f = idx.map((k) => resp.f[k]);
  const target = idx.map((k) => resp.target[k]);
  const raw = idx.map((k) => at[k] as number);
  const mean = raw.reduce((x, y) => x + y, 0) / raw.length - target.reduce((x, y) => x + y, 0) / target.length;
  return { f, db: raw.map((v) => v - mean), target };
}

/** Самая толстая стандартная толщина ядра, которая с зазором помещается в допустимую глубину; null — не помещается. */
function fitThickness(want: number, gap: number, depth: number | null): number | null {
  if (depth === null) return want;
  const ok = THICKNESSES.filter((t) => t <= want && t + gap <= depth + 1e-9);
  return ok.length ? ok[ok.length - 1] : null;
}

const n0 = (v: number) => String(Math.round(v)).replace('-', '−');
const n1 = (v: number) => v.toFixed(1).replace('.', ',').replace('-', '−');
const n2 = (v: number) => v.toFixed(2).replace('.', ',');
const hzText = (f: number) => `${f >= 100 ? n0(f) : n1(f)} Гц`;
const list = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} и ${xs[xs.length - 1]}`);

type Draft = Omit<Recommendation, 'ruleVersion' | 'relevance' | 'conflicts' | 'notes'> & { conflicts?: string[]; notes?: string[] };

export function buildAdvice(i: AdviceInput): Recommendation[] {
  const c = i.config;
  const conv = toCore(c);
  if (!conv.ok) {
    return finish(i.goals, [{
      id: 'data-model', rule: 'data-model', group: 'data', evidence: 'needs-check', severity: 'high', title: 'Советы недоступны для этой модели',
      cause: conv.reason, source: 'Модель помещения', method: 'Проверка входов ядра', applicability: 'Всегда', effect: 'Станут доступны расчёт и советы',
      sideEffects: 'Нет', cost: { kind: 'free' }, effort: 'minutes', actions: ['Уточните модель помещения'], verify: 'Анализ комнаты считается',
      link: { kind: 'room', tab: 'model', section: 'geometry', label: 'Модель: геометрия' },
    }]);
  }
  const out: Draft[] = [];
  const rect = c.geometry.kind === 'rect' ? c.geometry : null;
  const subs = c.audio.sources.filter((s) => s.kind === 'sub');
  const listener = primaryListener(c);
  const mine = i.measurements.filter((m) => m.configId === c.id && m.kind === 'frequency-response');

  // ---------- 1. Исходные данные ----------
  if (!mine.length) {
    out.push({
      id: 'data-measure', rule: 'data-measure', group: 'data', evidence: 'needs-check', severity: 'medium',
      title: 'Измерьте АЧХ в месте слушателя',
      cause: 'Для этой конфигурации нет замера: все советы ниже опираются только на модель.',
      source: 'Записи измерений комнаты', method: 'Сравнение модели с замером (раздел «Измерения»)',
      applicability: 'Нужен микрофон; без калибровки форма АЧХ относительная',
      effect: 'Подтвердит или опровергнет предсказанные пики и провалы', sideEffects: 'Нет',
      cost: { kind: 'free' }, effort: 'minutes',
      actions: ['Откройте «Измерение АЧХ свипом», поставьте микрофон на место слушателя', 'Сохраните замер в эту комнату и конфигурацию'],
      verify: 'Расхождение модели и замера в «Анализ → Измерения»',
      link: { kind: 'tool', toolId: 'sweep', label: 'Измерение АЧХ свипом' },
    });
  } else {
    const known = mine.map((m) => m.provenance.revision).filter((r): r is number => r !== undefined);
    if (known.length && Math.max(...known) < c.revision) {
      out.push({
        id: 'data-stale', rule: 'data-stale', group: 'data', evidence: 'needs-check', severity: 'low',
        title: 'Замер сделан до последних изменений',
        cause: 'Конфигурация менялась после записи последнего замера.', source: 'Ревизия конфигурации при записи замера',
        method: 'Сравнение ревизии снимка с текущей ревизией', applicability: 'Замеры, сохранённые со снимком',
        effect: 'Совпадение модели и замера снова можно будет проверить', sideEffects: 'Нет', cost: { kind: 'free' }, effort: 'minutes',
        actions: ['Повторите измерение после изменений'], verify: 'Новый замер привязан к текущей ревизии',
        link: { kind: 'tool', toolId: 'sweep', label: 'Измерение АЧХ свипом' },
      });
    }
  }
  if (i.warnings.length) {
    out.push({
      id: 'data-warnings', rule: 'data-warnings', group: 'data', evidence: 'needs-check', severity: 'low',
      title: 'Проверьте описание помещения', cause: i.warnings.join(' '), source: 'Перевод модели во входы ядра',
      method: 'Сверка модели с ограничениями ядра', applicability: 'Всегда', effect: 'Расчёт точнее отражает комнату',
      sideEffects: 'Нет', cost: { kind: 'free' }, effort: 'minutes', actions: ['Уточните проёмы и смежные пространства в модели'],
      verify: 'Предупреждение исчезает', link: { kind: 'room', tab: 'model', section: 'geometry', label: 'Модель: геометрия' },
    });
  }

  const a = i.analysis;
  const ext = i.measured ? responseExtremes(i.measured.response) : null;
  const byMeasure = i.measured ? `по замеру «${i.measured.name}»` : '';
  type Extreme = { f: number; db: number; high: boolean; title?: string };
  const fromModel = (prefix: string): Extreme[] => (a?.overview.problems.filter((p) => p.id.startsWith(prefix)) ?? []).map((p) => ({ f: p.f ?? 0, db: NaN, high: p.severity === 'high', title: p.title }));
  const dipList: Extreme[] = ext ? ext.dips.map((d) => ({ f: d.f, db: d.db, high: d.db <= -14 })) : fromModel('dip-');
  const peakList: Extreme[] = ext ? ext.peaks.map((d) => ({ f: d.f, db: d.db, high: d.db >= 9 })) : fromModel('peak-');
  const extText = (xs: Extreme[], what: string) => xs.map((x) => x.title ?? `${what} на ${hzText(x.f)} (${x.db > 0 ? '+' : ''}${n1(x.db)} дБ) ${byMeasure}`).join('; ');
  const fromMeasure: Evidence = ext ? 'measured' : 'predicted';
  // ---------- 2. Расстановка ----------
  if (rect) {
    const share = listener.position.x / rect.depth;
    if (share > 0.45 && share < 0.55) {
      const pl = c.simulation.placement;
      const x = Math.min(pl.listenerMaxX, Math.max(pl.listenerMinX, 0.38 * rect.depth));
      const to: Vec3 = { x: Math.round(x * 100) / 100, y: listener.position.y, z: listener.position.z };
      const f1 = soundSpeed(c) / (2 * rect.depth);
      out.push({
        id: 'listener-mid', rule: 'listener-mid', group: 'placement', evidence: 'predicted', severity: 'medium',
        title: 'Сместите место слушателя из середины комнаты',
        cause: `Слушатель на ${n0(share * 100)} % глубины: там узел первой продольной моды (${hzText(f1)}) — провал баса.`,
        source: 'Размеры комнаты и место основного слушателя', method: 'Положение узлов продольных мод прямоугольной комнаты',
        applicability: 'Прямоугольная комната; основной слушатель',
        effect: `Меньше провал около ${hzText(f1)}; ориентир — около 38 % глубины (${n2(to.x)} м от передней стены)`,
        sideEffects: 'Меняются расстояние до колонок и стереоугол; ближе к задней стене растёт бас от её отражения',
        cost: { kind: 'free' }, effort: 'minutes',
        actions: [`Переставьте место слушателя на ${n2(to.x)} м от передней стены`, 'Проверьте стереоугол после переноса'],
        verify: 'Замер АЧХ до и после в том же месте микрофона',
        conflicts: listener.locked ? ['Место слушателя закреплено на плане.'] : [],
        notes: i.goals.constraints.canMoveFurniture ? [] : ['Мебель переставлять нельзя: место может быть привязано к дивану.'],
        link: { kind: 'room', tab: 'analysis', section: 'bass', label: 'Анализ: качество баса' },
        proposal: { kind: 'move-listener', listenerId: listener.id, to },
      });
    }
  }
  const pair = stereoPair(c);
  if (pair && (pair.angleDeg < 45 || pair.angleDeg > 75)) {
    out.push({
      id: 'stereo-angle', rule: 'stereo-angle', group: 'placement', evidence: 'predicted', severity: pair.angleDeg < 35 || pair.angleDeg > 85 ? 'medium' : 'low',
      title: `Стереоугол ${n0(pair.angleDeg)}°: ${pair.angleDeg < 45 ? 'узкая' : 'широкая'} сцена`,
      cause: `Колонки видны под углом ${n0(pair.angleDeg)}°; начальная цель — около 60°.`, source: 'Места колонок и слушателя',
      method: 'Геометрия стереопары', applicability: 'Две фронтальные колонки',
      effect: 'Устойчивый фантомный центр и ширина сцены', sideEffects: 'Меняются расстояния колонок до стен и SBIR',
      cost: { kind: 'free' }, effort: 'minutes',
      actions: [pair.angleDeg < 45 ? 'Разведите колонки шире или сядьте ближе' : 'Сведите колонки или сядьте дальше', 'Разверните колонки на слушателя'],
      verify: 'Центральный голос звучит посередине; угол в «Анализ → Колонки»',
      link: { kind: 'room', tab: 'analysis', section: 'speakers', label: 'Анализ: колонки' },
    });
  }
  if (a) {
    const asym = a.overview.problems.find((p) => p.id === 'asym');
    if (asym) {
      out.push({
        id: 'symmetry', rule: 'symmetry', group: 'placement', evidence: 'predicted', severity: asym.severity,
        title: 'Расставьте колонки симметрично', cause: asym.title, source: 'Сводка ядра', method: 'Смещение пары относительно оси комнаты и слушателя',
        applicability: 'Стереосистема', effect: 'Одинаковые отражения слева и справа, точнее сцена', sideEffects: 'Нет',
        cost: { kind: 'free' }, effort: 'minutes', actions: ['Выровняйте расстояния колонок до боковых стен и до слушателя'],
        verify: 'Смещение в «Анализ → Колонки»', link: { kind: 'room', tab: 'analysis', section: 'speakers', label: 'Анализ: колонки' },
      });
    }
    const pens = a.overview.problems.filter((p) => p.id.startsWith('pen-'));
    if (pens.length) {
      out.push({
        id: 'speaker-rules', rule: 'speaker-rules', group: 'placement', evidence: 'predicted', severity: pens.some((p) => p.severity !== 'low') ? 'medium' : 'low',
        title: 'Колонки нарушают правила расстановки', cause: pens.map((p) => p.title).join('; '), source: 'Сводка ядра (штрафы расстановки)',
        method: 'Правила расстояний ядра', applicability: 'Колонки на полу или стойках', effect: 'Меньше влияние ближних поверхностей',
        sideEffects: 'Меняются стереоугол и SBIR', cost: { kind: 'free' }, effort: 'minutes', actions: ['Подвиньте колонки по правилам в разделе «Колонки»'],
        verify: 'Штрафы исчезают из сводки', link: { kind: 'room', tab: 'analysis', section: 'speakers', label: 'Анализ: колонки' },
      });
    }
  }
  const front = sbirNotches(c, c.audio.sources.filter((s) => s.kind === 'speaker')).filter((nn) => nn.surface === 'front' && nn.f >= 60 && nn.f <= 250);
  if (front.length) {
    const worst = front.sort((x, y) => x.f - y.f)[0];
    const v = soundSpeed(c);
    out.push({
      id: 'sbir-front', rule: 'sbir-front', group: 'placement', evidence: 'predicted', severity: 'medium',
      title: `Провал от стены за колонками около ${hzText(worst.f)}`,
      cause: `Колонка в ${n2(worst.distance)} м от передней стены: отражение гасит прямой звук на f = c/(4d).`,
      source: 'Расстояния колонок до передней стены', method: 'Интерференция с отражением (SBIR)', applicability: 'Колонки, излучающие бас во все стороны',
      effect: `Провал уходит выше 250 Гц при расстоянии меньше ${n2(v / 1000)} м или ниже 60 Гц при расстоянии больше ${n2(v / 240)} м`,
      sideEffects: 'Ближе к стене — больше баса (подъём), дальше — меньше места в комнате',
      cost: { kind: 'free' }, effort: 'minutes',
      actions: [`Поставьте колонки ближе ${n2(v / 1000)} м или дальше ${n2(v / 240)} м от стены`, 'Если двигать нельзя — толстый поглотитель (от 10 см) на стене за колонками'],
      verify: 'Замер АЧХ: провал на этой частоте меньше', link: { kind: 'room', tab: 'analysis', section: 'speakers', label: 'Анализ: колонки' },
    });
  }
  {
    const dips = dipList;
    if (dips.length) {
      out.push({
        id: 'bass-dips', rule: 'bass-dips', group: 'placement', evidence: fromMeasure, severity: dips.some((d) => d.high) ? 'high' : 'medium',
        title: `Провалы баса: ${list(dips.map((d) => hzText(d.f)))}`,
        cause: extText(dips, 'Провал'), source: ext ? 'Замер АЧХ в месте слушателя' : 'Отклик ядра в месте слушателя', method: 'Поиск провалов относительно цели (ядро)',
        applicability: 'Ниже частоты Шрёдера', effect: 'Ровнее бас без потери запаса усилителя',
        sideEffects: 'Новое место может открыть другие провалы — поиск сравнивает весь диапазон',
        cost: { kind: 'free' }, effort: 'hours',
        actions: ['Запустите подбор мест сабвуфера и слушателя', 'Провалы эквалайзером не поднимайте: это тратит запас и не помогает'],
        verify: 'Замер АЧХ до и после', link: { kind: 'room', tab: 'advice', section: 'optimize', label: 'Советы: подбор' },
      });
    }
    // ---------- 3. Настройка оборудования ----------
    if (a && subs.length && (dips.length || a.ev.score > 6)) {
      out.push({
        id: 'sub-settings', rule: 'sub-settings', group: 'settings', evidence: 'predicted', severity: 'medium',
        title: 'Согласуйте сабвуфер с колонками', cause: `Неровность баса ${n1(a.ev.score)} дБ (модель); в полосе раздела сабвуфер и колонки могут гасить друг друга.`,
        source: 'Отклик ядра', method: 'Подбор задержки, фазы и уровня сабвуфера', applicability: 'Сабвуфер с регулировкой фазы или задержки',
        effect: 'Ровнее переход на частоте раздела', sideEffects: 'Меняется общий уровень баса',
        cost: { kind: 'free' }, effort: 'minutes', actions: ['Запустите согласование сабвуферов в разделе «Подбор»', 'Перенесите найденные фазу, задержку и уровень на сабвуфер'],
        verify: 'Замер АЧХ около частоты раздела', link: { kind: 'room', tab: 'advice', section: 'optimize', label: 'Советы: подбор' },
      });
    }
  }

  // ---------- 4. Обработка ----------
  const depth = isKnown(i.goals.constraints.maxDepthM) ? i.goals.constraints.maxDepthM : null;
  const drill = i.goals.constraints.noDrilling ? ['Без сверления: панели на стойках или на клеевом креплении.'] : [];
  const refl = rect ? reflectionPaths(c) : [];
  const plan = rect ? suggestTreatments(coreInputs(c).room, refl, () => '') : [];
  if (rect) {
    const open = refl.filter((r) => !r.treated && (r.surface === 'left' || r.surface === 'right'));
    const thickness = fitThickness(0.1, 0.05, depth);
    const panels = plan.filter((t) => t.kind === 'panel' && open.some((r) => r.surface === t.wall && Math.abs(r.point.x - (t.at ?? 0)) < 0.01))
      .filter((t, k, xs) => xs.findIndex((x) => x.wall === t.wall && Math.abs((x.at ?? 0) - (t.at ?? 0)) < 0.3) === k)
      .map((t): Treatment => ({ ...t, thickness: thickness ?? t.thickness }));
    if (panels.length) {
      out.push({
        id: 'reflections', rule: 'reflections', group: 'treatment', evidence: 'predicted', severity: 'low',
        title: `Закройте первые отражения на боковых стенах (${panels.length})`,
        cause: `Первые отражения от боковых стен приходят через ${n1(Math.min(...open.map((r) => r.delayMs)))}–${n1(Math.max(...open.map((r) => r.delayMs)))} мс после прямого звука.`,
        source: 'Места колонок и слушателя, материалы стен', method: 'Мнимые источники первого порядка',
        applicability: 'Средние и высокие частоты; бас панель 10 см почти не поглощает',
        effect: 'Чётче сцена и разборчивость', sideEffects: 'Комната суше; слишком много поглощения делает звук «глухим»',
        cost: { kind: 'purchase', what: `панели 60 × 120 см, ${panels.length} шт.` }, effort: 'hours',
        actions: panels.map((t) => `Панель ${n0((thickness ?? 0.1) * 100)} см на ${ON_WALL[t.wall!]} в ${n2(t.at ?? 0)} м от передней стены, центр на высоте ${n2(t.z ?? 0)} м, зазор 5 см`),
        verify: 'Метод зеркала: из места слушателя в зеркале на стене видна колонка — там и нужна панель',
        conflicts: thickness === null ? [`Панели 5 см с зазором 5 см не помещаются в допустимую глубину ${n0((depth ?? 0) * 100)} см.`] : [], notes: drill,
        link: { kind: 'room', tab: 'analysis', section: 'reflections', label: 'Анализ: отражения' },
        proposal: { kind: 'add-treatments', what: 'panels', items: panels },
      });
    }
  }
  if (a) {
    const band = rtBand(a.reverb.volume);
    const t = a.reverb.tMid, V = a.reverb.volume;
    if (a.overview.problems.some((p) => p.id === 'rt-high')) {
      const extra = 0.161 * V * (1 / band[1] - 1 / t);
      out.push({
        id: 'rt-high', rule: 'rt-high', group: 'treatment', evidence: 'predicted', severity: t > band[1] + 0.3 ? 'high' : 'medium',
        title: `Комната гулкая: RT60 ${n2(t)} с при ориентире до ${n2(band[1])} с`,
        cause: 'Мало поглощения на средних частотах.', source: 'Реверберация ядра (500–1000 Гц)', method: 'Сэбин: нужная добавка эквивалентной площади',
        applicability: 'Диффузное поле; оценка', effect: `Нужно около ${n1(Math.max(0, extra))} м² поглощения (столько же м² панелей 10 см)`,
        sideEffects: 'Бас поглощается слабее средних — тонкие панели делают баланс «темнее»', cost: { kind: 'purchase', what: 'панели или текстиль' }, effort: 'hours',
        actions: ['Сначала — мягкая мебель, ковёр, шторы', `Затем панели: около ${n0(Math.max(1, extra / 0.72))} шт. 60 × 120 см`],
        verify: 'Хлопок или свип: «Измерение затухания»', notes: drill, link: { kind: 'room', tab: 'analysis', section: 'reverb', label: 'Анализ: реверберация' },
      });
    }
    if (a.overview.problems.some((p) => p.id === 'rt-low')) {
      out.push({
        id: 'rt-low', rule: 'rt-low', group: 'treatment', evidence: 'predicted', severity: 'low',
        title: `Комната заглушена: RT60 ${n2(t)} с`, cause: 'Поглощения больше, чем нужно для живого звучания.', source: 'Реверберация ядра',
        method: 'Сравнение с ориентиром для объёма', applicability: 'Оценка', effect: 'Звук живее, меньше утомляет',
        sideEffects: 'Отражения могут вернуться в точки первых отражений', cost: { kind: 'free' }, effort: 'minutes',
        actions: ['Уберите часть панелей вне точек первых отражений или замените их диффузорами'],
        verify: '«Измерение затухания»', link: { kind: 'room', tab: 'analysis', section: 'reverb', label: 'Анализ: реверберация' },
      });
    }
    const long = a.overview.decays.filter((d) => d.t60 > d.limit);
    if (long.length >= 2 || long.some((d) => d.t60 > 1.5 * d.limit)) {
      const taken = new Set(c.treatment.items.flatMap((x) => (x.kind === 'corner' && x.enabled !== false && x.corner ? [x.corner] : [])));
      const thickness = fitThickness(0.3, 0, depth);
      const free = plan.filter((x) => x.kind === 'corner' && x.corner && !taken.has(x.corner)).map((x): Treatment => ({ ...x, thickness: thickness ?? x.thickness }));
      out.push({
        id: 'bass-traps', rule: 'bass-traps', group: 'treatment', evidence: 'predicted', severity: long.length >= 4 ? 'high' : 'medium',
        title: `Затянутые резонансы: ${list(long.slice(0, 4).map((d) => hzText(d.f)))}`,
        cause: `${long.length} мод звучат дольше допуска; в углах сходятся пучности всех мод.`, source: 'Затухание мод ядра', method: 'Допуск затухания для объёма (EBU)',
        applicability: 'Пористые ловушки работают от толщины ~λ/10; ниже 60 Гц нужны резонаторы', effect: 'Короче гул резонансов, чётче бас',
        sideEffects: 'Ловушки занимают углы', cost: free.length ? { kind: 'purchase', what: `угловые ловушки ${n0((thickness ?? 0.3) * 100)} см, ${free.length} шт.` } : { kind: 'free' }, effort: free.length ? 'days' : 'hours',
        actions: ['Поставьте ловушки во все вертикальные углы, начиная с углов за колонками', 'Чем толще и выше ловушка, тем ниже её рабочая частота'],
        verify: '«Измерение затухания» или водопад по замеру',
        conflicts: free.length && (thickness === null || thickness < 0.2) ? [`Ловушкам нужна глубина от 20 см, допустимо ${n0((depth ?? 0) * 100)} см.`] : [],
        notes: [...drill, ...(free.length ? [] : ['Во всех углах уже есть ловушки: нужны толще или резонаторы (V2-052).'])],
        link: { kind: 'room', tab: 'analysis', section: 'bass', label: 'Анализ: качество баса' },
        proposal: free.length ? { kind: 'add-treatments', what: 'corners', items: free } : undefined,
      });
    }
  }
  if (rect) {
    const fl = flutterRisk(c);
    if (fl.length) {
      out.push({
        id: 'flutter', rule: 'flutter', group: 'treatment', evidence: 'assumption', severity: 'low',
        title: 'Возможно порхающее эхо', cause: fl.map((p) => `${SURFACE_LABEL[p.a].toLowerCase()} — ${SURFACE_LABEL[p.b].toLowerCase()}, повтор ${n0(p.repeatMs)} мс`).join('; '),
        source: 'Материалы поверхностей', method: 'Пары параллельных отражающих поверхностей без обработки', applicability: 'Проверяется на слух',
        effect: 'Нет «звона» после хлопка', sideEffects: 'Нет', cost: { kind: 'purchase', what: 'панель или диффузор на одну из поверхностей' }, effort: 'hours',
        actions: ['Хлопните между стенами: звон — это эхо', 'Закройте одну из пары поверхностей поглотителем или диффузором'],
        verify: 'Хлопок без звона', notes: drill, link: { kind: 'room', tab: 'analysis', section: 'reverb', label: 'Анализ: реверберация' },
      });
    }
  }

  // ---------- 5. DSP ----------
  {
    const peaks = peakList;
    if (peaks.length) {
      out.push({
        id: 'dsp-peaks', rule: 'dsp-peaks', group: 'dsp', evidence: fromMeasure, severity: peaks.some((p) => p.high) ? 'high' : 'medium',
        title: `Срежьте пики эквалайзером: ${list(peaks.map((p) => hzText(p.f)))}`,
        cause: extText(peaks, 'Пик'), source: ext ? 'Замер АЧХ в месте слушателя' : 'Отклик ядра в месте слушателя', method: 'Параметрический EQ: только ослабление',
        applicability: 'Точные Gain и Q — по измерению; по модели — начальная оценка', effect: 'Меньше гула на этих частотах',
        sideEffects: 'В других местах комнаты пик может быть меньше — коррекция для одного места', cost: { kind: 'free' }, effort: 'minutes',
        actions: ['Сначала попробуйте расстановку — это бесплатно и для всех мест', 'Подберите фильтры в разделе «DSP» и перенесите их в эквалайзер'],
        verify: 'Замер АЧХ с фильтрами', link: { kind: 'room', tab: 'advice', section: 'dsp', label: 'Советы: DSP' },
      });
    }
  }

  // ---------- 6. Покупка ----------
  if (a) {
    const deep = dipList.filter((d) => d.high);
    if (subs.length === 1 && deep.length) {
      out.push({
        id: 'second-sub', rule: 'second-sub', group: 'equipment', evidence: fromMeasure, severity: 'medium',
        title: 'Второй сабвуфер выровняет бас', cause: `Глубокие провалы (${list(deep.map((d) => hzText(d.f)))}) с одним сабвуфером расстановкой не убрать полностью.`,
        source: 'Отклик ядра', method: 'Два источника возбуждают моды по-разному и заполняют провалы', applicability: 'Ниже ~120 Гц',
        effect: 'Ровнее бас и в соседних местах', sideEffects: 'Нужно место и согласование', cost: { kind: 'purchase', what: 'сабвуфер' }, effort: 'hours',
        actions: ['Проверьте вариант с двумя сабвуферами в эксперименте и подборе'], verify: 'Замер АЧХ в нескольких местах',
        link: { kind: 'room', tab: 'model', section: 'audio', label: 'Модель: аудиосистема' },
      });
    }
  }
  if (!subs.length && (i.goals.primary === 'bass-depth' || i.goals.use === 'cinema')) {
    out.push({
      id: 'add-sub', rule: 'add-sub', group: 'equipment', evidence: 'assumption', severity: 'low',
      title: 'Добавьте сабвуфер для глубокого баса', cause: 'В системе нет сабвуфера; цель — глубина баса или кино.', source: 'Состав аудиосистемы и цель',
      method: 'Правило состава системы', applicability: 'Если колонки не воспроизводят ниже ~40 Гц', effect: 'Глубже бас, разгрузка колонок',
      sideEffects: 'Нужно согласование и место', cost: { kind: 'purchase', what: 'сабвуфер' }, effort: 'hours',
      actions: ['Добавьте сабвуфер в модель эксперимента и сравните'], verify: 'Замер АЧХ ниже 60 Гц',
      link: { kind: 'room', tab: 'model', section: 'audio', label: 'Модель: аудиосистема' },
    });
  }

  return finish(i.goals, out);
}

/** Цель и ограничения: актуальность, нарушенные жёсткие ограничения, оговорки. Неизвестная стоимость — не ноль. */
function finish(goals: Goals, out: Draft[]): Recommendation[] {
  const rules = GOAL_RULES[goals.primary];
  const budgetZero = isKnown(goals.budget) && goals.budget === 0;
  return out.map((d): Recommendation => {
    const conflicts = [...(d.conflicts ?? [])];
    if (MOVES_EQUIPMENT.has(d.rule) && !goals.constraints.canMoveEquipment) conflicts.push('Оборудование перемещать нельзя (ограничение комнаты).');
    if (d.cost.kind === 'purchase' && budgetZero) conflicts.push('Бюджет — ноль.');
    const notes = [...(d.notes ?? [])];
    if (d.cost.kind === 'purchase' && isKnown(goals.budget) && goals.budget > 0) notes.push('Стоимость неизвестна: сверьте с бюджетом.');
    if (goals.constraints.keepArea && TAKES_AREA.has(d.rule)) notes.push('Занимает площадь пола, а её важно сохранить: выберите компактный вариант или откажитесь.');
    if (goals.constraints.looks && d.group === 'treatment') notes.push('Внешний вид важен: панели в ткани под цвет стен, обработка за мебелью или в виде картин.');
    const relevance = rules.goal.includes(d.rule) ? 'goal' : rules.off.includes(d.rule) ? 'off-goal' : 'normal';
    return { ...d, ruleVersion: ADVICE_VERSION, relevance, conflicts, notes };
  });
}

const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 } as const;

/** Порядок: группа приоритета, затем цель, затем серьёзность. Неактуальные для цели и противоречащие ограничениям — отдельно. */
export function sortAdvice(recs: readonly Recommendation[]): { active: Recommendation[]; offGoal: Recommendation[]; blocked: Recommendation[] } {
  const order = (r: Recommendation) => ADVICE_GROUPS.indexOf(r.group) * 10 + (r.relevance === 'goal' ? 0 : 3) + SEVERITY_ORDER[r.severity];
  const sorted = [...recs].sort((x, y) => order(x) - order(y));
  return {
    active: sorted.filter((r) => !r.conflicts.length && r.relevance !== 'off-goal'),
    offGoal: sorted.filter((r) => !r.conflicts.length && r.relevance === 'off-goal'),
    blocked: sorted.filter((r) => r.conflicts.length > 0),
  };
}

/** Операция предложения над конфигурацией (для applyProposal: только эксперимент, после подтверждения). */
export function proposalOp(p: Proposal, newId: () => string): (c: RoomConfiguration) => RoomConfiguration {
  switch (p.kind) {
    case 'move-listener':
      return (c) => moveObject(c, { type: 'listener', id: p.listenerId }, p.to);
    case 'add-treatments':
      return (c) => {
        const items: TreatmentItem[] = p.items.map((t) => ({ ...structuredClone(t), id: newId() }));
        return { ...c, treatment: { ...c.treatment, enabled: true, items: [...c.treatment.items, ...items] } };
      };
  }
}

/** Что сделает предложение — одной строкой для диалога подтверждения. */
export function proposalText(p: Proposal): string {
  switch (p.kind) {
    case 'move-listener': return `Место слушателя → ${n2(p.to.x)} м от передней стены`;
    case 'add-treatments': return p.what === 'panels'
      ? `Панели 60 × 120 см, ${n0(p.items[0].thickness * 100)} см: ${p.items.length} шт. в точках первых отражений`
      : `Угловые ловушки ${n0(p.items[0].thickness * 100)} см: ${p.items.length} шт. в свободные углы`;
  }
}
