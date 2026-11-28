// Настройки (V2-020): уровень сложности и локальные уровни, тема, хранилище и резервная копия, перенос из
// прежней версии, сведения о приложении.
import { useEffect, useState } from 'preact/hooks';
import { Badge, Button, Card, ConfirmDialog, KeyValue, Notice, Section, SegmentedControl, THEME_LABEL, applyTheme, readTheme, saveTheme, useToast, type ThemeChoice } from '../../design-system';
import { COMPLEXITIES, COMPLEXITY_LABEL, COMPLEXITY_TEXT, setOverride } from '../../application/settings';
import { backupFileName, exportBackup, parseBackup, requestPersistence, restoreBackup, storageStatus, type Backup, type Persistence, type RestoreResult } from '../../storage/backup';
import { useApp } from '../../shared/context';
import { downloadText } from '../../shared/files';
import { Screen } from '../../shared/Screen';
import { LegacyImport } from '../rooms/LegacyImport';
import { scopeLabel } from './scopes';

const mb = (b: number | null) => (b === null ? 'неизвестно' : `${(b / 1048576).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} МБ`);

export function Settings() {
  const { db, clock, settings, updateSettings } = useApp();
  const toast = useToast();
  const [theme, setTheme] = useState<ThemeChoice>(readTheme());
  const [persist, setPersist] = useState<Persistence | null>(null);
  const [pending, setPending] = useState<Backup | null>(null);
  const [restored, setRestored] = useState<RestoreResult | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { void storageStatus().then(setPersist); }, []);

  const pickTheme = (t: ThemeChoice) => { setTheme(t); applyTheme(t); saveTheme(t); };
  const overrides = Object.entries(settings.overrides);
  const level = settings.complexity ?? 'simple';
  const protection = persist?.persisted === true ? <Badge tone="success">Включена</Badge> : persist?.persisted === false ? <Badge tone="warning">Не включена</Badge> : 'неизвестно';

  const doExport = async () => {
    setBusy(true);
    try {
      const now = clock.now();
      downloadText(backupFileName(now), JSON.stringify(await exportBackup(db, now)));
      toast.show('Резервная копия сохранена');
    } catch (e) { toast.show(e instanceof Error ? e.message : String(e), { tone: 'error' }); }
    setBusy(false);
  };
  const openBackup = async (file?: File) => {
    if (!file) return;
    setRestored(null);
    try { setPending(parseBackup(await file.text())); } catch (e) { toast.show(e instanceof Error ? e.message : String(e), { tone: 'error' }); }
  };
  const restore = async (mode: 'merge' | 'replace') => {
    const b = pending!;
    setPending(null);
    setBusy(true);
    try { setRestored(await restoreBackup(db, b, mode)); } catch (e) { toast.show(e instanceof Error ? e.message : String(e), { tone: 'error' }); }
    setBusy(false);
  };

  return (
    <Screen title="Настройки" reading>
      <div class="al-stack al-stack--32">
        <h1 class="al-text-headline">Настройки</h1>
        <Section title="Уровень сложности" id="complexity">
          <SegmentedControl label="Уровень сложности" block value={level} onChange={(c) => updateSettings((s) => ({ ...s, complexity: c }))}
            options={COMPLEXITIES.map((c) => ({ value: c, label: COMPLEXITY_LABEL[c] }))} />
          <p class="al-text-small al-text-secondary">{COMPLEXITY_TEXT[level]} Смена уровня не удаляет и не сбрасывает скрытые параметры.</p>
          {overrides.length > 0 && (
            <Card title="Свой уровень в разделах">
              <ul class="al-list" aria-label="Свой уровень в разделах">
                {overrides.map(([scope, l]) => (
                  <li key={scope} class="al-list__item al-list__item--wrap">
                    <span class="al-list__text"><span class="al-list__title">{scopeLabel(scope)}</span><span class="al-list__meta">{COMPLEXITY_LABEL[l]}</span></span>
                    <Button small onClick={() => updateSettings((s) => setOverride(s, scope, null))}>Как везде</Button>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </Section>

        <Section title="Оформление" id="theme">
          <SegmentedControl label="Тема" block value={theme} onChange={pickTheme} options={(['system', 'light', 'dark'] as const).map((v) => ({ value: v, label: THEME_LABEL[v] }))} />
        </Section>

        <Section title="Данные на устройстве" id="storage">
          <p class="al-text-small al-text-secondary">Все данные хранятся только в этом браузере, без сервера и регистрации. Браузер может удалить их при нехватке места или очистке сайта — сохраняйте резервную копию.</p>
          <KeyValue items={[
            ['Защита от очистки', protection],
            ['Занято', mb(persist?.usage ?? null)],
            ['Доступно браузеру', mb(persist?.quota ?? null)],
          ]} />
          <div class="al-row al-row--12">
            {persist?.persisted !== true && (
              <Button onClick={async () => {
                const p = await requestPersistence();
                setPersist(p);
                toast.show(p.persisted ? 'Браузер не будет очищать данные сам' : 'Браузер не разрешил защиту от очистки');
              }}>Попросить не очищать</Button>
            )}
            <Button icon="download" busy={busy} onClick={doExport}>Сохранить резервную копию</Button>
            <label class="al-btn al-btn--secondary">
              <input class="al-visually-hidden" type="file" accept=".json,application/json" onChange={(e) => openBackup(e.currentTarget.files?.[0])} />
              Восстановить из копии
            </label>
          </div>
          {restored && (
            <Notice tone="success" title="Копия восстановлена">
              Добавлено записей: {restored.added}.{restored.differing.length > 0 && ` Не перезаписаны отличающиеся записи: ${restored.differing.length} — они уже есть на устройстве в другой версии.`}
            </Notice>
          )}
        </Section>

        <Section title="Перенос из прежней версии" id="migration">
          <LegacyImport />
        </Section>

        <Section title="О приложении" id="about">
          <KeyValue items={[['Версия', 'Room Acoustics v2 (в разработке)'], ['Работа без сети', 'Расчёты выполняются на устройстве'], ['Звук и микрофон', 'Только по кнопке в инструменте']]} />
        </Section>
      </div>
      {pending && (
        <ConfirmDialog title="Восстановить резервную копию?" confirmLabel="Добавить недостающее" onConfirm={() => restore('merge')} onCancel={() => setPending(null)}
          text={`Копия от ${pending.createdAt.slice(0, 10)}. «Добавить недостающее» не трогает записи, которые уже есть. «Заменить всё» сначала удаляет все данные v2 на устройстве.`}>
          <div class="al-row al-row--end"><Button variant="danger" onClick={() => restore('replace')}>Заменить всё</Button></div>
        </ConfirmDialog>
      )}
    </Screen>
  );
}
