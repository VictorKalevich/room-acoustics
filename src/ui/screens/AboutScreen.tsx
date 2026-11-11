// «О приложении» (024): версия и обновления, установка на iPhone, сообщение о проблеме. Раньше версия и установка
// повторялись на экране «Проекты».
import { useEffect, useState } from 'preact/hooks';
import type { Project } from '../../state/project';
import { Note, Panel } from '../design-system';
import { ProblemReport } from '../components/ProblemReport';
import { S } from '../strings';
import { BUILD, checkForUpdate, getStatus, onStatus, type UpdateStatus } from '../updates';

export function AboutScreen({ project }: { project: Project }) {
  return (
    <div class="screen">
      <AboutPanel />
      <Panel title={S.projects.install}>
        <p class="small">{S.projects.installText}</p>
        <p class="muted small">{S.projects.privacy}</p>
      </Panel>
      <ProblemReport project={project} />
    </div>
  );
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

