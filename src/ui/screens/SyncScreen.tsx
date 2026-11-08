// Синхронизация через файл: сохранить проект в Файлы / iCloud Drive и открыть его на другом устройстве.
import { useRef, useState } from 'preact/hooks';
import type { Project } from '../../state/project';
import { FILE_EXT, parseProjectFile, saveProject, serializeProject } from '../../state/storage';
import { shareFile } from '../audio/mic';
import { Note, Panel } from '../components/Fields';
import { S } from '../strings';

const LAST_KEY = (id: string) => `ra-sync-${id}`;
const fmtDate = (iso: string) => new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

export function SyncScreen({ project, onReplace }: { project: Project; onReplace: (p: Project) => void }) {
  const [msg, setMsg] = useState<{ t: string; tone: 'good' | 'warn' | 'info' } | null>(null);
  const [pending, setPending] = useState<Project | null>(null);
  const input = useRef<HTMLInputElement>(null);
  let last: string | null = null;
  try { last = localStorage.getItem(LAST_KEY(project.id)); } catch { /* без хранилища */ }

  const save = async () => {
    const name = `${project.name.replace(/[\\/:*?"<>|]+/g, '_') || 'room'}${FILE_EXT}`;
    await shareFile(serializeProject(project), name, 'application/json');
    try { localStorage.setItem(LAST_KEY(project.id), new Date().toISOString()); } catch { /* */ }
    setMsg({ t: S.sync.saved, tone: 'good' });
  };

  const open = async (f: File) => {
    try {
      const p = parseProjectFile(await f.text());
      if (p.id === project.id) {
        const newer = p.updatedAt > project.updatedAt;
        setPending(p);
        setMsg({ t: newer ? S.sync.fileNewer(fmtDate(p.updatedAt), fmtDate(project.updatedAt)) : S.sync.fileOlder(fmtDate(p.updatedAt), fmtDate(project.updatedAt)), tone: newer ? 'info' : 'warn' });
      } else {
        setPending(p);
        setMsg({ t: S.sync.other(p.name, fmtDate(p.updatedAt)), tone: 'info' });
      }
    } catch (e) {
      setMsg({ t: (e as Error).message, tone: 'warn' });
    }
  };

  const accept = async () => {
    if (!pending) return;
    try { await saveProject(project); } catch { /* хранилище недоступно — всё равно открываем */ }
    onReplace(pending);
    setPending(null);
    setMsg({ t: S.sync.opened, tone: 'good' });
  };

  return (
    <div class="screen">
      <Panel title={S.sync.title}>
        <p class="small">{S.sync.intro}</p>
        <ol class="small steps-list">{S.sync.steps.map((s) => <li>{s}</li>)}</ol>
        <div class="btn-row">
          <button type="button" class="btn btn--primary" onClick={save}>{S.sync.save}</button>
          <button type="button" class="btn" onClick={() => input.current?.click()}>{S.sync.open}</button>
        </div>
        <p class="muted small">{S.sync.current(project.name, fmtDate(project.updatedAt))}{last ? ` ${S.sync.last(fmtDate(last))}` : ''}</p>
        {msg && <Note tone={msg.tone === 'info' ? undefined : msg.tone}>{msg.t}</Note>}
        {pending && (
          <div class="btn-row">
            <button type="button" class="btn btn--primary" onClick={accept}>{S.sync.accept}</button>
            <button type="button" class="btn btn--ghost" onClick={() => { setPending(null); setMsg(null); }}>{S.sync.cancel}</button>
          </div>
        )}
        <input
          ref={input}
          type="file"
          accept=".json,application/json"
          class="visually-hidden"
          onChange={(e) => {
            const f = (e.target as HTMLInputElement).files?.[0];
            (e.target as HTMLInputElement).value = '';
            if (f) open(f);
          }}
        />
        <p class="muted small">{S.sync.note}</p>
      </Panel>
    </div>
  );
}
