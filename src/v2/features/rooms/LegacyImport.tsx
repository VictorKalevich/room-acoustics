// Перенос проектов прежней версии (V2-009, V2-018): только по действию пользователя. Хранилище legacy видно
// только на том же адресе сайта (R09), иначе — из файла проекта `.roomacoustics.json`. Legacy не изменяется.
import { useState } from 'preact/hooks';
import { Badge, Button, DataTable, Notice, type BadgeTone } from '../../design-system';
import { migrateLegacy, type MigrationReport, type MigrationStatus } from '../../application/migration';
import { readLegacyFile, readLegacyStore, type LegacyRead } from '../../storage/legacySource';
import { useApp } from '../../shared/context';
import { roomHref } from '../../shared/router';

const STATUS: Record<MigrationStatus, [string, BadgeTone]> = {
  migrated: ['Перенесён', 'success'],
  'already-migrated': ['Уже перенесён', 'current'],
  'legacy-changed': ['Изменён после переноса', 'warning'],
  'skipped-empty': ['Пустой, пропущен', 'neutral'],
  failed: ['Ошибка', 'danger'],
};

export function LegacyImport({ onDone }: { onDone?: () => void }) {
  const { db, clock } = useApp();
  const [read, setRead] = useState<LegacyRead | null>(null);
  const [source, setSource] = useState<'device' | 'file' | null>(null);
  const [report, setReport] = useState<MigrationReport | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (r: LegacyRead, reimport?: string[]) => {
    setBusy(true);
    try {
      setReport(await migrateLegacy(db, r, clock, { reimport }));
      onDone?.();
    } finally { setBusy(false); }
  };

  const scanDevice = async () => {
    setBusy(true);
    setReport(null);
    try { setRead(await readLegacyStore()); setSource('device'); } finally { setBusy(false); }
  };
  const openFile = async (file: File | undefined) => {
    if (!file) return;
    setReport(null);
    setRead(readLegacyFile(await file.text()));
    setSource('file');
  };

  const changed = report?.entries.filter((e) => e.status === 'legacy-changed').map((e) => e.projectId) ?? [];

  return (
    <div class="al-stack al-stack--12">
      <p class="al-text-small al-text-secondary">Проекты прежней версии переносятся копией: комната, система, места, сохранённые варианты (в архив) и замеры. Прежняя версия и её данные не меняются.</p>
      <div class="al-row al-row--12">
        <Button icon="search" busy={busy && !read} onClick={scanDevice}>Найти на этом устройстве</Button>
        <label class={'al-btn al-btn--secondary'}>
          <input class="al-visually-hidden" type="file" accept=".json,application/json" onChange={(e) => openFile(e.currentTarget.files?.[0])} />
          Открыть файл проекта
        </label>
      </div>
      {read && !report && (
        read.candidates.length === 0 ? (
          <Notice tone={read.problems.length ? 'warning' : 'info'} title="Проектов не найдено">
            {source === 'device' && !read.dbFound && 'Хранилище прежней версии на этом адресе сайта не найдено. Если прежняя версия открывается по другому адресу, сохраните проект в файл и откройте его здесь. '}
            {read.problems.map((p) => p.reason).join(' ')}
          </Notice>
        ) : (
          <Notice title={`Найдено проектов: ${new Set(read.candidates.map((c) => c.project.id)).size}`} action={<Button variant="primary" busy={busy} onClick={() => run(read)}>Перенести</Button>}>
            {[...new Set(read.candidates.map((c) => c.project.name))].join(', ')}
          </Notice>
        )
      )}
      {report && (
        <div class="al-stack al-stack--12">
          <DataTable caption="Отчёт о переносе" rowKey={(e) => e.projectId} rows={report.entries} empty="Нечего переносить." columns={[
            { key: 'n', title: 'Проект', render: (e) => (e.roomId && e.status !== 'failed' && e.status !== 'skipped-empty' ? <a href={roomHref(e.roomId)}>{e.name}</a> : e.name) },
            { key: 's', title: 'Итог', render: (e) => <Badge tone={STATUS[e.status][1]} icon={false}>{STATUS[e.status][0]}</Badge> },
            { key: 'd', title: 'Варианты / замеры', numeric: true, render: (e) => (e.status === 'migrated' ? `${e.archived ?? 0} / ${e.measurements ?? 0}` : '—') },
            { key: 'x', title: 'Примечания', render: (e) => e.notes.join(' ') || '—' },
          ]} />
          {report.problems.length > 0 && <Notice tone="warning" title="Не перенесено">{report.problems.map((p) => p.reason).join(' ')}</Notice>}
          {changed.length > 0 && read && <Button busy={busy} onClick={() => run(read, changed)}>Перенести изменённые ещё раз отдельной комнатой</Button>}
        </div>
      )}
    </div>
  );
}
