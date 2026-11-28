// Список комнат (V2-018, макеты M05/D05): открытие, активная комната, переименование, копия, удаление с
// подтверждением, повреждённые записи и перенос проектов прежней версии.
import { useCallback, useEffect, useState } from 'preact/hooks';
import { Badge, Button, ConfirmDialog, Dialog, EmptyState, ErrorState, Icon, IconButton, LoadingState, Notice, Section, TextField, buttonClass, useToast } from '../../design-system';
import type { Room } from '../../domain/model';
import { renameRoom } from '../../domain/operations';
import type { DamagedRecord } from '../../storage/rooms';
import { useApp } from '../../shared/context';
import { dateTime, dimsText, roomOriginText, systemText, volumeText } from '../../shared/format';
import { href, roomHref } from '../../shared/router';
import { Screen } from '../../shared/Screen';
import { LegacyImport } from './LegacyImport';

type Data = { rooms: Room[]; damaged: DamagedRecord[]; activeId: string | null };

export function RoomsList() {
  const { rooms, clock } = useApp();
  const toast = useToast();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<Room | null>(null);
  const [name, setName] = useState('');
  const [removing, setRemoving] = useState<Room | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [list, active] = await Promise.all([rooms.list(), rooms.active()]);
      setData({ rooms: [...list.rooms].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), damaged: list.damaged, activeId: active?.id ?? null });
      setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, [rooms]);
  useEffect(() => { void refresh(); }, [refresh]);

  const act = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try { await fn(); toast.show(done); } catch (e) { toast.show(e instanceof Error ? e.message : String(e), { tone: 'error' }); }
    setBusy(false);
    await refresh();
  };

  return (
    <Screen title="Мои комнаты" actions={<a class={buttonClass('primary', true)} href={href({ name: 'room-new' })}><Icon name="plus" small />Создать</a>}>
      {error ? <ErrorState text={error} onRetry={refresh} /> : !data ? <LoadingState /> : (
        <div class="al-stack al-stack--24">
          {data.damaged.length > 0 && (
            <Notice tone="danger" title="Не все комнаты прочитаны">
              Записей с ошибкой: {data.damaged.length} ({data.damaged.map((d) => `${d.id}: ${d.reason}`).join('; ')}). Они не удалены. Восстановите их из резервной копии в настройках.
            </Notice>
          )}
          {data.rooms.length === 0 ? (
            <EmptyState icon="rooms" title="Комнат пока нет" text="Комнату можно создать по скану или вручную, по трём размерам. Остальное можно добавить позже." action={<a class={buttonClass('primary')} href={href({ name: 'room-new' })}><Icon name="plus" />Создать комнату</a>} />
          ) : (
            <ul class="al-list" aria-label="Комнаты">
              {data.rooms.map((r) => (
                <li key={r.id} class="al-list__item al-list__item--wrap">
                  <Icon name="rooms" />
                  <a class="al-list__text al-list__link" href={roomHref(r.id)} onClick={() => { void rooms.setActive(r.id); }}>
                    <span class="al-list__title">{r.name}</span>
                    <span class="al-list__meta">{dimsText(r.current)}{volumeText(r.current) ? ` · ${volumeText(r.current)}` : ''} · {systemText(r.current)}</span>
                    <span class="al-list__meta">Изменена {dateTime(r.updatedAt)}</span>
                  </a>
                  <span class="al-row al-row--nowrap">
                    {r.id === data.activeId && <Badge tone="current">Активная</Badge>}
                    {r.experimental && <Badge tone="experimental" icon={false}>Эксперимент</Badge>}
                    {roomOriginText(r) && <Badge tone="imported" icon={false}>Перенос</Badge>}
                  </span>
                  <span class="al-row al-row--nowrap">
                    <IconButton icon="edit" small label={`Переименовать «${r.name}»`} disabled={busy} onClick={() => { setRenaming(r); setName(r.name); }} />
                    <IconButton icon="copy" small label={`Копия «${r.name}»`} disabled={busy} onClick={() => act(() => rooms.duplicate(r.id), 'Копия создана')} />
                    <IconButton icon="trash" small label={`Удалить «${r.name}»`} variant="danger-ghost" disabled={busy} onClick={() => setRemoving(r)} />
                  </span>
                </li>
              ))}
            </ul>
          )}
          <Section title="Из прежней версии">
            <LegacyImport onDone={refresh} />
          </Section>
        </div>
      )}
      {renaming && (
        <Dialog title="Переименовать комнату" onClose={() => setRenaming(null)} actions={<>
          <Button onClick={() => setRenaming(null)}>Отмена</Button>
          <Button variant="primary" disabled={!name.trim()} onClick={async () => {
            const r = renaming;
            setRenaming(null);
            await act(() => rooms.save(renameRoom(r, name, clock.now()), r), 'Название изменено');
          }}>Сохранить</Button>
        </>}>
          <TextField label="Название" value={name} onInput={setName} maxLength={80} autoFocus />
        </Dialog>
      )}
      {removing && (
        <ConfirmDialog title={`Удалить «${removing.name}»?`} text="Комната, её эксперимент, измерения, снимки и отчёты будут удалены с этого устройства. Отменить удаление нельзя; сохраните резервную копию, если данные нужны." confirmLabel="Удалить" danger busy={busy}
          onCancel={() => setRemoving(null)} onConfirm={async () => {
            const r = removing;
            setRemoving(null);
            await act(() => rooms.remove(r.id), 'Комната удалена');
          }} />
      )}
    </Screen>
  );
}
