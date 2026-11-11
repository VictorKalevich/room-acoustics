import { useEffect, useRef, useState } from 'preact/hooks';
import type { Project } from '../../state/project';
import { newProject } from '../../state/project';
import { deleteProject, deleteScan, downloadProject, listProjects, parseProjectFile, saveProject, storageAvailable } from '../../state/storage';
import { ConfirmSheet, Panel, Note } from '../design-system';
import { S } from '../strings';
import { BUILD, checkForUpdate, getStatus, onStatus, type UpdateStatus } from '../updates';
import { fmt } from '../format';
import { dropRoomDraft, loadRoomDraft } from '../roomDraft';
import type { Destination } from '../navigation';

interface Props {
  project: Project;
  onReplace: (p: Project) => void;
  onRename: (name: string) => void;
  /** 023: назад, на экран, с которого открыли «Проекты». */
  onBack: () => void;
  onGo: (t: Destination) => void;
}

/** Что заменит текущий проект (023): новый, сохранённый из списка или открытый из файла. */
type Replace = { kind: 'new' } | { kind: 'open'; p: Project } | { kind: 'import'; p: Project };

/**
 * Проекты. 023: «← Назад» возвращает на прежний экран; «Сохранить» и «Экспорт» — только у созданной
 * комнаты; «Новый проект» рядом с «Сохранить»; файл проекта — отдельной строкой. «Новый проект», «Открыть»
 * из списка и «Импорт» спрашивают, если введённое в текущем проекте пропадёт.
 */
export function ProjectsScreen({ project, onReplace, onRename, onBack, onGo }: Props) {
  const [list, setList] = useState<Project[]>([]);
  const [canStore, setCanStore] = useState(true);
  const [msg, setMsg] = useState<{ text: string; tone: 'good' | 'warn' } | null>(null);
  const [ask, setAsk] = useState<Replace | null>(null);
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
    if (r.kind === 'import') setMsg({ text: S.projects.imported, tone: 'good' });
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
      setMsg({ text: S.projects.saved, tone: 'good' });
      refresh();
    } catch {
      setMsg({ text: S.projects.storageOff, tone: 'warn' });
    }
  };

  const importFile = async (f: File) => {
    try {
      replace({ kind: 'import', p: parseProjectFile(await f.text()) });
    } catch (e) {
      setMsg({ text: (e as Error).message, tone: 'warn' });
    }
  };

  return (
    <div class="screen">
      <div class="btn-row">
        <button type="button" class="btn btn--ghost btn--small" onClick={onBack}>← {S.projects.back}</button>
      </div>
      <Panel title={S.projects.current}>
        <div class="field">
          <label for="pname">{S.projects.name}</label>
          <div class="field__box">
            <input id="pname" value={project.name} onInput={(e) => onRename((e.target as HTMLInputElement).value)} />
          </div>
        </div>
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
        <h3 class="subhead">{S.projects.file}</h3>
        <div class="btn-row">
          <button type="button" class="btn" onClick={() => fileInput.current?.click()}><ImportIcon /> {S.projects.importFile}</button>
          <button type="button" class="btn" disabled={!ready} onClick={() => downloadProject(project)}><ExportIcon /> {S.projects.exportFile}</button>
        </div>
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
        {msg && <Note tone={msg.tone}>{msg.text}</Note>}
        {!canStore && <Note tone="warn">{S.projects.storageOff}</Note>}
        {ask && <ReplaceSheet ask={ask} project={project} partial={partial} onCancel={() => setAsk(null)} onConfirm={() => replaceNow(ask)} />}
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
                    onClick={async () => { await deleteProject(p.id); dropRoomDraft(p.id); refresh(); }}
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

      <AboutPanel />

      <Panel title={S.projects.install}>
        <p class="small">{S.projects.installText}</p>
        <p class="muted small">{S.projects.privacy}</p>
      </Panel>
    </div>
  );
}

/** Предупреждение перед заменой текущего проекта (023). */
function ReplaceSheet({ ask, project, partial, onCancel, onConfirm }: {
  ask: Replace; project: Project; partial: boolean; onCancel: () => void; onConfirm: () => void;
}) {
  const T = S.projects;
  // тот же проект из списка: откроется сохранённая версия, пропадут изменения после сохранения
  const revert = ask.kind === 'open' && ask.p.id === project.id && !partial;
  const title = ask.kind === 'new' ? T.newTitle : revert ? T.revertTitle : ask.kind === 'open' ? T.openTitle(ask.p.name) : T.importTitle(ask.p.name);
  const text = revert ? T.revertText : partial ? T.leavePartial : T.leaveUnsaved;
  const confirm = ask.kind === 'new' ? T.newConfirm : revert ? T.revertConfirm : T.openConfirm;
  return <ConfirmSheet title={title} text={text} confirm={confirm} cancel={T.cancel} onCancel={onCancel} onConfirm={onConfirm} />;
}

export function AboutPanel() {
  const [st, setSt] = useState<UpdateStatus>(getStatus());
  useEffect(() => onStatus(setSt), []);
  const d = new Date(BUILD.time);
  const date = Number.isNaN(d.getTime())
    ? BUILD.time
    : d.toLocaleString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const text = st === 'idle' ? null : S.projects.status[st];
  return (
    <Panel title={S.projects.about}>
      <p class="small app-version">{S.projects.version(date, BUILD.sha)}</p>
      <p class="muted small">{S.projects.autoUpdate}</p>
      <div class="btn-row">
        <button type="button" class="btn" disabled={st === 'unsupported' || st === 'checking' || st === 'updating'} onClick={() => void checkForUpdate(true)}>
          {S.projects.check}
        </button>
      </div>
      {text && <Note tone={st === 'error' ? 'warn' : 'good'}>{text}</Note>}
    </Panel>
  );
}

// Значки файла проекта (023)
const ImportIcon = () => (
  <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12 M7 10l5 5 5-5 M5 21h14" /></svg>
);
const ExportIcon = () => (
  <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V3 M7 8l5-5 5 5 M5 21h14" /></svg>
);
