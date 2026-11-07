import { useEffect, useRef, useState } from 'preact/hooks';
import type { Project } from '../../state/project';
import { newProject } from '../../state/project';
import { deleteProject, downloadProject, listProjects, parseProjectFile, saveProject, storageAvailable } from '../../state/storage';
import { Panel, Note } from '../components/Fields';
import { S } from '../strings';
import { BUILD, checkForUpdate, getStatus, onStatus, type UpdateStatus } from '../updates';
import { fmt } from '../format';

interface Props {
  project: Project;
  onReplace: (p: Project) => void;
  onRename: (name: string) => void;
}

export function ProjectsScreen({ project, onReplace, onRename }: Props) {
  const [list, setList] = useState<Project[]>([]);
  const [canStore, setCanStore] = useState(true);
  const [msg, setMsg] = useState<{ text: string; tone: 'good' | 'warn' } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

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
      const p = parseProjectFile(await f.text());
      onReplace(p);
      setMsg({ text: S.projects.imported, tone: 'good' });
    } catch (e) {
      setMsg({ text: (e as Error).message, tone: 'warn' });
    }
  };

  return (
    <div class="screen">
      <Panel>
        <div class="field">
          <label for="pname">{S.projects.name}</label>
          <div class="field__box">
            <input id="pname" value={project.name} onInput={(e) => onRename((e.target as HTMLInputElement).value)} />
          </div>
        </div>
        <div class="btn-row">
          <button type="button" class="btn btn--primary" onClick={save} disabled={!canStore}>{S.projects.save}</button>
          <button type="button" class="btn" onClick={() => downloadProject(project)}>{S.projects.exportFile}</button>
        </div>
        <div class="btn-row">
          <button type="button" class="btn btn--ghost" onClick={() => fileInput.current?.click()}>{S.projects.importFile}</button>
          <button type="button" class="btn btn--ghost" onClick={() => onReplace(newProject())}>{S.projects.newProject}</button>
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
      </Panel>

      <Panel title={S.projects.list}>
        {list.length === 0 ? (
          <p class="muted small">{S.projects.none}</p>
        ) : (
          <ul class="project-list">
            {list.map((p) => (
              <li>
                <div>
                  <strong>{p.name}</strong>
                  <span class="muted small">
                    {fmt(p.room.depth, 2)} × {fmt(p.room.width, 2)} × {fmt(p.room.height, 2)} м, {new Date(p.updatedAt).toLocaleDateString('ru-RU')}
                  </span>
                </div>
                <div class="btn-row btn-row--tight">
                  <button type="button" class="btn btn--small" onClick={() => onReplace(p)}>{S.projects.open}</button>
                  <button
                    type="button"
                    class="btn btn--small btn--ghost"
                    onClick={async () => { await deleteProject(p.id); refresh(); }}
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

function AboutPanel() {
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
