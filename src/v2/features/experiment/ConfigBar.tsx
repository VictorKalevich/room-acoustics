// Переключатель конфигураций комнаты (V2-026, V2-027, V2-029): создание эксперимента, общий выбор «Текущая» /
// «Эксперимент», сравнение, подтверждение эксперимента как фактического, перезапуск и удаление — с подтверждением.
import { useState } from 'preact/hooks';
import { Badge, Button, ConfirmDialog, Notice, SegmentedControl, buttonClass, useToast } from '../../design-system';
import { experimentBehind, restartExperiment } from '../../application/experiment';
import { confirmExperiment, createExperiment, discardExperiment } from '../../domain/operations';
import type { ConfigRole } from '../../domain/model';
import { useApp } from '../../shared/context';
import { roomHref } from '../../shared/router';
import type { RoomHandle } from '../rooms/useRoom';
import { ChangeList } from './ChangeList';

const ROLE_OPTIONS = [{ value: 'current', label: 'Текущая' }, { value: 'experimental', label: 'Эксперимент' }] as const;

type Ask = 'confirm' | 'restart' | 'discard' | null;

export function ConfigBar({ h }: { h: RoomHandle }) {
  const { clock } = useApp();
  const toast = useToast();
  const [ask, setAsk] = useState<Ask>(null);
  const [busy, setBusy] = useState(false);
  const room = h.room!;
  const exp = room.experimental;

  const run = async (fn: Parameters<RoomHandle['edit']>[0], label: string, role: ConfigRole, done: string) => {
    setBusy(true);
    const ok = await h.edit(fn, label);
    setBusy(false);
    setAsk(null);
    if (ok) {
      h.setRole(role);
      toast.show(done, { action: { label: 'Отменить', run: () => { void h.undo(); } } });
    }
  };

  if (!exp) {
    return (
      <div class="al-row al-row--12 al-row--between">
        <div class="al-row"><Badge tone="current">Текущая конфигурация</Badge><span class="al-text-small al-text-secondary">Эксперимента нет</span></div>
        <Button small icon="flask" onClick={() => run((r) => createExperiment(r, clock.newId, clock.now()), 'Создание эксперимента', 'experimental', 'Эксперимент создан копией текущей конфигурации')}>Создать эксперимент</Button>
      </div>
    );
  }
  return (
    <div class="al-stack al-stack--12">
      <div class="al-row al-row--12 al-row--between">
        <SegmentedControl label="Конфигурация" value={h.role} onChange={h.setRole} options={ROLE_OPTIONS} />
        <div class="al-row">
          <a class={buttonClass('secondary', true)} href={roomHref(room.id, 'model', 'compare')}>Сравнить</a>
          <Button small variant="primary" icon="check" onClick={() => setAsk('confirm')}>Сделать фактической</Button>
          <Button small variant="ghost" icon="undo" onClick={() => setAsk('restart')}>Начать заново</Button>
          <Button small variant="danger-ghost" icon="trash" onClick={() => setAsk('discard')}>Удалить эксперимент</Button>
        </div>
      </div>
      {h.role === 'experimental' && (
        <Notice title="Вы меняете эксперимент">Изменения идут только в эксперимент; текущая конфигурация — фактическое состояние комнаты — не меняется.</Notice>
      )}
      {experimentBehind(room) && (
        <Notice tone="warning" title="Текущая конфигурация изменилась после создания эксперимента">
          Эксперимент сам не обновляется: в нём осталось состояние на момент создания. Сравните конфигурации или начните эксперимент заново.
        </Notice>
      )}
      {ask === 'confirm' && (
        <ConfirmDialog title="Сделать эксперимент фактическим?" confirmLabel="Сделать фактической" busy={busy} onCancel={() => setAsk(null)}
          text="Эксперимент станет текущей конфигурацией. Прежняя текущая сохранится в истории неизменяемым снимком; отдельного эксперимента не останется."
          onConfirm={() => run((r) => confirmExperiment(r, clock.newId, clock.now()), 'Подтверждение эксперимента', 'current', 'Эксперимент стал текущей конфигурацией; прежняя — в истории')}>
          <ChangeList a={room.current} b={exp} title="Что изменится" />
        </ConfirmDialog>
      )}
      {ask === 'restart' && (
        <ConfirmDialog title="Начать эксперимент заново?" confirmLabel="Начать заново" busy={busy} onCancel={() => setAsk(null)}
          text="Эксперимент заменится новой копией текущей конфигурации. Его изменения пропадут; отменить можно сразу после действия."
          onConfirm={() => run((r) => restartExperiment(r, clock.newId, clock.now()), 'Перезапуск эксперимента', 'experimental', 'Эксперимент начат заново')} />
      )}
      {ask === 'discard' && (
        <ConfirmDialog title="Удалить эксперимент?" confirmLabel="Удалить" danger busy={busy} onCancel={() => setAsk(null)}
          text="Текущая конфигурация не изменится. Отменить удаление можно сразу после действия."
          onConfirm={() => run((r) => discardExperiment(r, clock.now()), 'Удаление эксперимента', 'current', 'Эксперимент удалён')} />
      )}
    </div>
  );
}
