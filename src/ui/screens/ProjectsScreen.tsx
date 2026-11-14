import { useEffect, useRef, useState } from 'preact/hooks';
import type { Project } from '../../state/project';
import { newProject } from '../../state/project';
import { deleteProject, deleteScan, listProjects, parseProjectFile, saveProject, storageAvailable } from '../../state/storage';
import { exportProject, readLastExport } from '../projectExport';
import { ConfirmSheet, Panel, Note } from '../design-system';
import { S } from '../strings';
import { fmt } from '../format';
import { dropRoomDraft, loadRoomDraft } from '../roomDraft';
import type { Destination } from '../navigation';

interface Props {
  project: Project;
  onReplace: (p: Project) => void;
  onRename: (name: string) => void;
  onGo: (t: Destination) => void;
}

/** Что заменит текущий проект (023): новый, сохранённый из списка или открытый из файла. */
type Replace = { kind: 'new' } | { kind: 'open'; p: Project } | { kind: 'import'; p: Project };
type Msg = { text: string; tone: 'good' | 'warn'; at: 'project' | 'file' };

const fmtDate = (iso: string) => new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

/**
 * Проекты — всё о файлах проекта, по группам (024): «Текущий проект» (название, «Сохранить», «Новый проект»),
 * «Импорт и экспорт» (перенос файлом, бывший одноимённый экран меню), «Сохранённые». Открывается из меню;
 * вернуться — нижней панелью или пунктом меню «Начать» (025; «← Назад» из 023 убрана).
 * 023: «Сохранить» и «Экспорт» — только у созданной комнаты;
 * «Новый проект», «Открыть» и «Импорт» спрашивают, если введённое в текущем проекте пропадёт.
 */
export function ProjectsScreen({ project, onReplace, onRename, onGo }: Props) {
  const [list, setList] = useState<Project[]>([]);
  const [canStore, setCanStore] = useState(true);
  const [msg, setMsg] = useState<Msg | null>(null);
  const [ask, setAsk] = useState<Replace | null>(null);
  const [lastExport, setLastExport] = useState(() => readLastExport(project.id));
  const fileInput = useRef<HTMLInputElement>(null);

  const ready = project.roomReady;
  const draft = ready ? null : loadRoomDraft(project.id);
  // комната задана частично: начата ручная настройка или распознан скан, но «Сохранить» ещё не нажато
  const partial = !ready && (!!draft || !!project.scanInfo);
  const savedCopy = list.find((p) => p.id === project.id);
  // созданная комната, которой нет в списке или которая изменилась после сохранения
  const unsaved = ready && (!savedCopy || project.updatedAt > savedCopy.updatedAt);
  const toRoom = () => onGo(draft ? `room/${draft.reached}` : 'room/overview');
  const replaceNow = (r: Replace) => {
    setAsk(null);
    const next = r.kind === 'new' ? newProject() : r.p;
    // незаконченная настройка текущего проекта больше не нужна; скан проекта, которого нет в списке, — тоже
    dropRoomDraft(project.id);
    if (!savedCopy && next.id !== project.id) void deleteScan(project.id).catch(() => undefined);
    onReplace(next);
    if (r.kind === 'import') setMsg({ text: S.projects.imported, tone: 'good', at: 'file' });
  };
  // спросить, только если введённое пропадёт: комната задана частично или созданная комната не сохранена
  const replace = (r: Replace) => (partial || unsaved ? setAsk(r) : replaceNow(r));

  const refresh = () => listProjects().then(setList).catch(() => setList([]));
  useEffect(() => {
    storageAvailable().then((ok) => { setCanStore(ok); if (ok) refresh(); });
  }, []);

  const save = async () => {
    try {
      await saveProject({ ...project, updatedAt: new Date().toISOString() });
      setMsg({ text: S.projects.saved, tone: 'good', at: 'project' });
      refresh();
    } catch {
      setMsg({ text: S.projects.storageOff, tone: 'warn', at: 'project' });
    }
  };

  // 024: экспорт — через «Поделиться» (на iPhone «Сохранить в Файлы» → iCloud Drive), на компьютере — скачивание
  const exportFile = async () => {
    const now = await exportProject(project);
    if (!now) return;
    setLastExport(now);
    setMsg({ text: S.projects.exported, tone: 'good', at: 'file' });
  };

  const importFile = async (f: File) => {
    try {
      const p = parseProjectFile(await f.text());
      // 024: в файле более старая версия этого же проекта — спросить всегда, как прежний «Импорт и экспорт»
      if (p.id === project.id && p.updatedAt < project.updatedAt) setAsk({ kind: 'import', p });
      else replace({ kind: 'import', p });
    } catch (e) {
      setMsg({ text: (e as Error).message, tone: 'warn', at: 'file' });
    }
  };

  const note = (at: Msg['at']) => msg?.at === at && <Note tone={msg.tone}>{msg.text}</Note>;

  return (
    <div class="screen">
      <Panel title={S.projects.current}>
        <div class="field">
          <label for="pname">{S.projects.name}</label>
          <div class="field__box">
            <input id="pname" value={project.name} onInput={(e) => onRename((e.target as HTMLInputElement).value)} />
          </div>
        </div>
        <p class="muted small">{S.projects.changed(fmtDate(project.updatedAt))}</p>
        <div class="btn-row">
          <button type="button" class="btn btn--primary" onClick={save} disabled={!canStore || !ready}>{S.projects.save}</button>
          <button type="button" class="btn btn--tonal" onClick={() => replace({ kind: 'new' })}>{S.projects.newProject}</button>
        </div>
        {!ready && (
          <>
            <Note>{partial ? S.projects.needRoomPartial : S.projects.needRoom}</Note>
            <div class="btn-row">
              <button type="button" class="btn btn--ghost" onClick={toRoom}>{partial ? S.projects.continueRoom : S.projects.createRoom} →</button>
            </div>
          </>
        )}
        {note('project')}
        {!canStore && <Note tone="warn">{S.projects.storageOff}</Note>}
      </Panel>

      <Panel title={S.projects.file}>
        <div class="btn-row">
          <button type="button" class="btn" onClick={() => fileInput.current?.click()}><ImportIcon /> {S.projects.importFile}</button>
          <button type="button" class="btn" disabled={!ready} onClick={() => void exportFile()}><ExportIcon /> {S.projects.exportFile}</button>
        </div>
        {lastExport && <p class="muted small">{S.projects.lastExport(fmtDate(lastExport))}</p>}
        {note('file')}
        <p class="small">{S.projects.fileIntro}</p>
        <ol class="small steps-list">{S.projects.fileSteps.map((t, ki) => <li key={ki}>{t}</li>)}</ol>
        <p class="muted small">{S.projects.fileNote}</p>
        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json"
          class="visually-hidden"
          onChange={(e) => {
            const f = (e.target as HTMLInputElement).files?.[0];
            if (f) importFile(f);
            (e.target as HTMLInputElement).value = '';
          }}
        />
      </Panel>

      <Panel title={S.projects.list}>
        {list.length === 0 ? (
          <p class="muted small">{S.projects.none}</p>
        ) : (
          <ul class="project-list">
            {list.map((p) => (
              <li key={p.id}>
                <div>
                  <strong>{p.name}</strong>
                  <span class="muted small">
                    {p.roomReady ? `${fmt(p.room.depth, 2)} × ${fmt(p.room.width, 2)} × ${fmt(p.room.height, 2)} м` : S.projects.noRoom}, {new Date(p.updatedAt).toLocaleDateString('ru-RU')}
                  </span>
                </div>
                <div class="btn-row btn-row--tight">
                  <button type="button" class="btn btn--small" onClick={() => replace({ kind: 'open', p })}>{S.projects.open}</button>
                  <button
                    type="button"
                    class="btn btn--small btn--ghost"
                    onClick={async () => {
                      // копия открытого проекта: его скан и черновик комнаты ещё нужны
                      const open = p.id === project.id;
                      await deleteProject(p.id, open).catch(() => undefined);
                      if (!open) dropRoomDraft(p.id);
                      refresh();
                    }}
                    aria-label={`${S.projects.remove} ${p.name}`}
                  >
                    {S.projects.remove}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      {ask && <ReplaceSheet ask={ask} project={project} partial={partial} unsaved={unsaved} onCancel={() => setAsk(null)} onConfirm={() => replaceNow(ask)} />}
    </div>
  );
}

/** Предупреждение перед заменой текущего проекта (023; 024 — версия того же проекта из файла). */
function ReplaceSheet({ ask, project, partial, unsaved, onCancel, onConfirm }: {
  ask: Replace; project: Project; partial: boolean; unsaved: boolean; onCancel: () => void; onConfirm: () => void;
}) {
  const T = S.projects;
  const loss = partial ? T.leavePartial : unsaved ? T.leaveUnsaved : '';
  if (ask.kind === 'new') return <ConfirmSheet title={T.newTitle} text={loss} confirm={T.newConfirm} cancel={T.cancel} onCancel={onCancel} onConfirm={onConfirm} />;
  const same = ask.p.id === project.id;
  let title: string, text: string, confirm = T.openConfirm;
  if (ask.kind === 'open' && same && !partial) {
    // тот же проект из списка: откроется сохранённая версия, пропадут изменения после сохранения
    title = T.revertTitle; text = T.revertText; confirm = T.revertConfirm;
  } else if (ask.kind === 'import' && same) {
    const f = fmtDate(ask.p.updatedAt), c = fmtDate(project.updatedAt);
    title = T.sameTitle;
    text = [ask.p.updatedAt < project.updatedAt ? T.sameOlder(f, c) : T.sameOther(f, c), loss].filter(Boolean).join(' ');
  } else {
    title = ask.kind === 'open' ? T.openTitle(ask.p.name) : T.importTitle(ask.p.name);
    text = loss;
  }
  return <ConfirmSheet title={title} text={text} confirm={confirm} cancel={T.cancel} onCancel={onCancel} onConfirm={onConfirm} />;
}

// Значки файла проекта (023)
const ImportIcon = () => (
  <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12 M7 10l5 5 5-5 M5 21h14" /></svg>
);
const ExportIcon = () => (
  <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V3 M7 8l5-5 5 5 M5 21h14" /></svg>
);
