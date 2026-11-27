// «Мои данные» (V2-020): девять категорий, списки записей, экспорт записи в JSON и удаление с подтверждением.
// Управление хранилищем и резервная копия — в настройках.
import { useCallback, useEffect, useState } from 'preact/hooks';
import { Button, ConfirmDialog, EmptyState, ErrorState, Icon, IconButton, LoadingState, buttonClass, useToast } from '../../design-system';
import type { EquipmentProfile, MaterialProfile } from '../../domain/profiles';
import { EquipmentEditor, MaterialEditor } from './ProfileEditors';
import { CATEGORY_INFO, LIBRARY_CATEGORIES, countCategories, deleteEntry, getEntry, listCategory, type LibraryCategory, type LibraryEntry } from '../../storage/library';
import { useApp } from '../../shared/context';
import { downloadText, safeFileName } from '../../shared/files';
import { dateTime } from '../../shared/format';
import { href, roomHref } from '../../shared/router';
import { Screen } from '../../shared/Screen';

export function Library({ category }: { category?: LibraryCategory }) {
  return category ? <CategoryView category={category} /> : <Overview />;
}

function Overview() {
  const { db } = useApp();
  const [counts, setCounts] = useState<Record<LibraryCategory, number> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => { countCategories(db).then(setCounts, (e) => setError(String(e?.message ?? e))); }, [db]);
  useEffect(load, [load]);
  return (
    <Screen title="Мои данные">
      <div class="al-stack al-stack--24">
        <div class="al-stack al-stack--8">
          <h1 class="al-text-headline">Мои данные</h1>
          <p class="al-text-secondary">Измерения, профили, материалы, конструкции, пресеты, расчёты и отчёты на этом устройстве. Профили имеют версии: изменение профиля не меняет прежние расчёты и отчёты.</p>
        </div>
        {error ? <ErrorState text={error} onRetry={load} /> : !counts ? <LoadingState /> : (
          <div class="al-tiles">
            {LIBRARY_CATEGORIES.map((c) => (
              <div key={c} class="al-tile">
                <div class="al-tile__head">
                  <a class="al-tile__link al-tile__title" href={href({ name: 'library', category: c })}>{CATEGORY_INFO[c].title}</a>
                  <span class="al-tile__aside al-num al-text-secondary" aria-label={`Записей: ${counts[c]}`}>{counts[c]}</span>
                </div>
                <p class="al-tile__text">{CATEGORY_INFO[c].text}</p>
              </div>
            ))}
          </div>
        )}
        <div class="al-row"><a class={buttonClass('secondary')} href={`${href({ name: 'settings' })}`}><Icon name="download" />Резервная копия и хранилище</a></div>
      </div>
    </Screen>
  );
}

function CategoryView({ category }: { category: LibraryCategory }) {
  const { db } = useApp();
  const toast = useToast();
  const info = CATEGORY_INFO[category];
  const [items, setItems] = useState<LibraryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<LibraryEntry | null>(null);
  /** Профиль в редакторе (V2-047): null — новый, undefined — редактор закрыт. */
  const [editing, setEditing] = useState<EquipmentProfile | MaterialProfile | null | undefined>(undefined);
  const profiles = category === 'equipment' || category === 'materials';
  const openEditor = async (e: LibraryEntry) => setEditing((await getEntry<EquipmentProfile | MaterialProfile>(db, category, e.id)) ?? undefined);
  const load = useCallback(() => { listCategory(db, category).then(setItems, (e) => setError(String(e?.message ?? e))); }, [db, category]);
  useEffect(load, [load]);

  const exportOne = async (e: LibraryEntry) => {
    const rec = await getEntry(db, category, e.id);
    downloadText(`${safeFileName(e.name)}.json`, JSON.stringify(rec, null, 2));
  };

  return (
    <Screen title={info.title} context="Мои данные" backHref={href({ name: 'library' })}>
      <div class="al-stack al-stack--16">
        <p class="al-text-secondary">{info.text}</p>
        {profiles && (
          <div class="al-row">
            <Button icon="plus" variant="primary" small onClick={() => setEditing(null)}>{category === 'equipment' ? 'Новый профиль оборудования' : 'Новый материал'}</Button>
          </div>
        )}
        {error ? <ErrorState text={error} onRetry={load} /> : !items ? <LoadingState /> : items.length === 0 ? (
          <EmptyState icon="library" title="Пока пусто" text={profiles ? 'Создайте профиль кнопкой выше или сохраните параметры объекта комнаты как профиль в его свойствах.' : 'Записи появятся, когда вы сохраните их в инструменте или комнате.'} />
        ) : (
          <ul class="al-list" aria-label={info.title}>
            {items.map((e) => (
              <li key={e.id} class="al-list__item al-list__item--wrap">
                <span class="al-list__text">
                  <span class="al-list__title">{e.name}</span>
                  <span class="al-list__meta">
                    {dateTime(e.createdAt ?? e.recordedAt ?? '')}
                    {e.version !== undefined && ` · версия ${e.version}`}
                    {e.roomId && <> · <a href={roomHref(e.roomId)}>комната</a></>}
                  </span>
                </span>
                <span class="al-row al-row--nowrap">
                  {profiles && <IconButton icon="edit" small label={`Изменить «${e.name}»`} onClick={() => void openEditor(e)} />}
                  <IconButton icon="download" small label={`Сохранить «${e.name}» в файл`} onClick={() => exportOne(e)} />
                  <IconButton icon="trash" small variant="danger-ghost" label={`Удалить «${e.name}»`} onClick={() => setRemoving(e)} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {editing !== undefined && category === 'equipment' && (
        <EquipmentEditor key={editing?.id ?? 'new'} profile={editing as EquipmentProfile | null} onClose={() => setEditing(undefined)} onSaved={(p) => { setEditing(p); load(); }} />
      )}
      {editing !== undefined && category === 'materials' && (
        <MaterialEditor key={editing?.id ?? 'new'} profile={editing as MaterialProfile | null} onClose={() => setEditing(undefined)} onSaved={(p) => { setEditing(p); load(); }} />
      )}
      {removing && (
        <ConfirmDialog title={`Удалить «${removing.name}»?`} text="Запись будет удалена с устройства. Расчёты и отчёты, которые на неё ссылались, сохранят свои данные." confirmLabel="Удалить" danger
          onCancel={() => setRemoving(null)} onConfirm={async () => {
            const e = removing;
            setRemoving(null);
            await deleteEntry(db, category, e.id);
            toast.show('Запись удалена');
            load();
          }} />
      )}
    </Screen>
  );
}
