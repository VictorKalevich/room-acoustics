// Цели, бюджет и ограничения комнаты (V2-042): общие для обеих конфигураций, хранятся в комнате. Цель меняет порядок
// и актуальность советов, жёсткие ограничения — допустимость, мягкие — оговорки. Неизвестный бюджет — не ноль.
import { NumberField, SelectField, Switch, useToast } from '../../design-system';
import { GOAL_LABEL } from '../../application/advice';
import type { GoalId, Goals } from '../../domain/model';
import { isKnown, UNSET } from '../../domain/units';
import { useApp } from '../../shared/context';
import { Block } from '../analysis/common';
import type { AdviceData } from './useAdvice';

const GOALS: readonly GoalId[] = ['balanced', 'bass-uniformity', 'bass-depth', 'stereo', 'speech', 'reverb', 'custom'];
const GOAL_TEXT: Record<GoalId, string> = {
  balanced: 'Все группы советов в обычном порядке.',
  'bass-uniformity': 'Выше — место слушателя, провалы, согласование сабвуферов, ловушки и второй сабвуфер.',
  'bass-depth': 'Выше — сабвуферы и провалы; советы против заглушённости неактуальны.',
  stereo: 'Выше — стереоугол, симметрия, правила расстановки, SBIR и первые отражения.',
  speech: 'Выше — реверберация, порхающее эхо и первые отражения; покупка сабвуферов неактуальна.',
  reverb: 'Выше — реверберация и эхо; сабвуферы и срезы баса неактуальны.',
  custom: 'Своя цель: порядок не меняется, отметьте нужные советы в плане работ.',
};
const USE: readonly { value: Goals['use']; label: string }[] = [
  { value: 'music', label: 'Музыка' }, { value: 'cinema', label: 'Кино' }, { value: 'speech', label: 'Речь, подкасты' }, { value: 'recording', label: 'Запись' }, { value: 'mixed', label: 'Разное' },
];

export function GoalsSection({ d }: { d: AdviceData }) {
  const { clock } = useApp();
  const toast = useToast();
  const room = d.h.room!;
  const g = room.goals;
  const save = (patch: Partial<Goals>, label: string) =>
    void d.h.edit((r) => ({ ...r, goals: { ...r.goals, ...patch }, updatedAt: clock.now() }), label).then((ok) => { if (!ok) toast.show('Цели не сохранены', { tone: 'error' }); });
  const k = g.constraints;
  const setK = (patch: Partial<Goals['constraints']>, label: string) => save({ constraints: { ...k, ...patch } }, label);
  return (
    <div class="al-stack al-stack--24">
      <Block title="Цель" subtitle="Общая для текущей конфигурации и эксперимента.">
        <div class="al-grid al-grid--wide">
          <SelectField label="Главная цель" value={g.primary} options={GOALS.map((x) => ({ value: x, label: GOAL_LABEL[x] }))} onChange={(primary) => save({ primary }, 'Цель')} hint={GOAL_TEXT[g.primary]} />
          <SelectField label="Назначение комнаты" value={g.use} options={USE} onChange={(use) => save({ use }, 'Назначение комнаты')} />
        </div>
      </Block>
      <Block title="Бюджет" subtitle="Неизвестная стоимость не считается нулевой: покупки помечаются «стоимость неизвестна».">
        <div class="al-grid al-grid--wide">
          <NumberField label="Бюджет" unit="₽" optional placeholder="не задан" value={isKnown(g.budget) ? g.budget : null} min={0} max={100_000_000} decimals={0}
            onCommit={(v) => save({ budget: Number.isFinite(v) ? v : UNSET }, 'Бюджет')} hint="Пусто — не задан. Ноль — без покупок." />
        </div>
      </Block>
      <Block title="Ограничения" subtitle="Жёсткие ограничения убирают совет из предложенных, мягкие — добавляют оговорку.">
        <div class="al-stack al-stack--12">
          <Switch label="Оборудование можно двигать" checked={k.canMoveEquipment} onChange={(v) => setK({ canMoveEquipment: v }, 'Ограничение: оборудование')} hint="Нет — советы и варианты подбора, которые двигают колонки и сабвуферы, не предлагаются." />
          <Switch label="Мебель можно переставлять" checked={k.canMoveFurniture} onChange={(v) => setK({ canMoveFurniture: v }, 'Ограничение: мебель')} hint="Нет — к переносу места слушателя добавляется оговорка." />
          <Switch label="Сверлить нельзя" checked={k.noDrilling} onChange={(v) => setK({ noDrilling: v }, 'Ограничение: сверление')} hint="Да — для обработки предлагаются стойки и клеевое крепление." />
          <Switch label="Сохранить полезную площадь" checked={!!k.keepArea} onChange={(v) => setK({ keepArea: v }, 'Ограничение: площадь')} hint="Мягкое: к ловушкам и сабвуферам добавляется оговорка." />
          <Switch label="Важен внешний вид" checked={!!k.looks} onChange={(v) => setK({ looks: v }, 'Ограничение: внешний вид')} hint="Мягкое: к обработке добавляются варианты оформления." />
        </div>
        <div class="al-grid al-grid--wide">
          <NumberField label="Допустимая глубина конструкций" unit="см" optional placeholder="без ограничения" value={isKnown(k.maxDepthM) ? k.maxDepthM * 100 : null} min={1} max={100} decimals={0}
            onCommit={(v) => setK({ maxDepthM: Number.isFinite(v) ? v / 100 : UNSET }, 'Ограничение: глубина')} hint="Панели и ловушки подбираются по стандартным толщинам, которые помещаются." />
        </div>
        <p class="al-text-small al-text-secondary">Закреплённые на плане объекты подбор и советы не двигают: закрепить — в модели, в свойствах объекта.</p>
      </Block>
    </div>
  );
}
