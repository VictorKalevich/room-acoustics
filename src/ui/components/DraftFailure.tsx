// Рабочий проект не открылся при запуске (029): сообщение вместо приложения — без шапки, меню, нижней панели и разделов,
// чтобы с пустым проектом не работали как с настоящим. Каркас и FailurePanel — как у «Приложение не открылось» (028).
// Черновик на устройстве не перезаписывается, пока пользователь не подтвердил «Начать новый проект».
import { useState } from 'preact/hooks';
import type { DraftProblem } from '../useProject';
import { ConfirmSheet, FailurePanel, Note } from '../design-system';
import { exportDraftCopy } from '../projectExport';
import { S } from '../strings';

export function DraftFailure({ problem, onRetry, onNew }: { problem: DraftProblem; onRetry: () => void; onNew: () => void }) {
  const [ask, setAsk] = useState(false);
  const [copied, setCopied] = useState(false);
  const T = S.draftFailure;
  const saveCopy = async () => { if (problem.kind === 'invalid' && await exportDraftCopy(problem.raw)) setCopied(true); };
  return (
    <div class="app app--start">
      <main class="content">
        <FailurePanel
          title={problem.kind === 'invalid' ? T.brokenTitle : T.unreadableTitle}
          text={problem.kind === 'invalid' ? T.brokenText(problem.reason) : T.unreadableText}
          actions={<>
            {problem.kind === 'invalid'
              ? <button type="button" class="btn btn--primary" onClick={() => void saveCopy()}>{T.saveCopy}</button>
              : <button type="button" class="btn btn--primary" onClick={onRetry}>{T.retry}</button>}
            <button type="button" class="btn" onClick={() => setAsk(true)}>{S.failure.newProject}</button>
          </>}
        >
          {copied && <Note tone="good">{S.projects.exported}</Note>}
        </FailurePanel>
      </main>
      {ask && (
        <ConfirmSheet title={S.failure.newTitle} text={problem.kind === 'invalid' ? T.newTextBroken : T.newText} confirm={S.failure.newProject}
          onCancel={() => setAsk(false)} onConfirm={() => { setAsk(false); onNew(); }} />
      )}
    </div>
  );
}
