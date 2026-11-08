// «Сообщить о проблеме»: журнал ошибок на устройстве и файл отчёта для разработчика.
import { useEffect, useState } from 'preact/hooks';
import type { Project } from '../../state/project';
import { serializeProject } from '../../state/storage';
import { buildReport, clearErrors, deviceInfo, onErrors, readErrors, reportFileName } from '../../state/errlog';
import { shareFile } from '../audio/mic';
import { BUILD } from '../updates';
import { Note, Panel } from './Fields';
import { S } from '../strings';

export function ProblemReport({ project }: { project: Project }) {
  const [errors, setErrors] = useState(readErrors);
  const [note, setNote] = useState('');
  const [withProject, setWithProject] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => onErrors(() => setErrors(readErrors())), []);

  const save = async () => {
    const rep = buildReport({
      build: BUILD,
      device: deviceInfo(),
      errors: readErrors(),
      note,
      screen: location.hash || undefined,
      project: withProject ? JSON.parse(serializeProject(project)) : undefined,
    });
    await shareFile(JSON.stringify(rep, null, 2), reportFileName(), 'application/json');
    setMsg(S.problem.saved);
  };

  const shown = errors.slice(-10).toReversed();
  return (
    <Panel title={S.problem.title}>
      <p class="muted small">{S.problem.intro}</p>
      <p class="small" data-testid="errlog-count">{S.problem.count(errors.length)}</p>
      {shown.length > 0 && (
        <details class="details errlog">
          <summary>{S.problem.log}</summary>
          <ol class="errlog__list small">
            {shown.map((e) => (
              <li key={e.t + e.msg}>
                <span class="muted">{new Date(e.t).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · {S.problem.kinds[e.kind]}{e.ctx ? ` · ${e.ctx}` : ''}</span>
                <br />
                {e.msg}
              </li>
            ))}
          </ol>
        </details>
      )}
      <div class="field">
        <label for="problem-note">{S.problem.note}</label>
        <div class="field__box"><textarea id="problem-note" rows={3} value={note} onInput={(e) => setNote((e.target as HTMLTextAreaElement).value)} /></div>
      </div>
      <label class="check">
        <input type="checkbox" checked={withProject} onChange={(e) => setWithProject((e.target as HTMLInputElement).checked)} />
        <span>{S.problem.withProject}</span>
      </label>
      <div class="btn-row">
        <button type="button" class="btn btn--primary" onClick={() => void save()}>{S.problem.save}</button>
        {errors.length > 0 && (
          <button type="button" class="btn btn--ghost" onClick={() => { clearErrors(); setMsg(S.problem.cleared); }}>{S.problem.clear}</button>
        )}
      </div>
      {msg && <Note tone="good">{msg}</Note>}
    </Panel>
  );
}
