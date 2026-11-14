// Границы ошибок (028). Исключение при отрисовке одного раздела не выводит из строя остальные разделы, шапку, меню и
// нижнюю панель; сбой самой оболочки даёт сообщение вместо пустой страницы. Preact 11 направляет в ближайшую границу
// исключения отрисовки, эффектов, ref и размонтирования; ошибки обработчиков событий, таймеров и промисов идут мимо —
// их, как раньше, записывает общий журнал (installErrorLog).
import { Component, type ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { Project } from '../../state/project';
import { newProject } from '../../state/project';
import { clearPendingDraft, loadDraft, releaseDraft, saveDraft } from '../../state/storage';
import { logError } from '../../state/errlog';
import { ConfirmSheet, FailurePanel, Note } from '../design-system';
import { exportProject } from '../projectExport';
import { S } from '../strings';

interface BoundaryProps {
  /** Что упало — для журнала ошибок. */
  ctx: string;
  /** Что показать вместо упавшего содержимого. */
  fallback: ComponentChildren;
  children: ComponentChildren;
}

class Boundary extends Component<BoundaryProps, { failed: boolean }> {
  state = { failed: false };
  componentDidCatch(error: unknown) {
    logError('error', error, this.props.ctx);
    // состояние меняется здесь же: так Preact считает ошибку обработанной этой границей
    this.setState({ failed: true });
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/**
 * Граница раздела. Стоит внутри скрытой обёртки раздела: упавший скрытый раздел ничего не показывает, пока на него
 * не перейдут. onReport — переход к «Сообщить о проблеме» («О приложении»); у самого «О приложении» его нет.
 */
export function ScreenBoundary({ name, project, onReport, children }: { name: string; project: Project; onReport?: () => void; children: ComponentChildren }) {
  // «Попробовать снова» — граница с новым ключом: раздел монтируется заново
  const [attempt, setAttempt] = useState(0);
  return (
    <Boundary key={attempt} ctx={`экран «${name}»`} fallback={<ScreenFailure project={project} onRetry={() => setAttempt((n) => n + 1)} onReport={onReport} />}>
      {children}
    </Boundary>
  );
}

function ScreenFailure({ project, onRetry, onReport }: { project: Project; onRetry: () => void; onReport?: () => void }) {
  const [exported, setExported] = useState(false);
  const exportNow = async () => { if (await exportProject(project)) setExported(true); };
  return (
    <FailurePanel
      title={S.failure.screenTitle}
      text={S.failure.text}
      actions={<>
        <button type="button" class="btn btn--primary" onClick={onRetry}>{S.failure.retry}</button>
        {/* как в «Проектах» (D16): экспорт — когда комната создана */}
        {project.roomReady && <button type="button" class="btn" onClick={() => void exportNow()}>{S.failure.export}</button>}
        {onReport && <button type="button" class="btn" onClick={onReport}>{S.failure.report}</button>}
      </>}
    >
      {exported && <Note tone="good">{S.projects.exported}</Note>}
    </FailurePanel>
  );
}

/** Граница всего приложения: шапка, меню, полоски над разделами и сам App. */
export function AppBoundary({ children }: { children: ComponentChildren }) {
  return <Boundary ctx="оболочка приложения" fallback={<AppFailure />}>{children}</Boundary>;
}

function AppFailure() {
  // оболочки нет — рабочий проект берётся с устройства (его последнее сохранённое состояние)
  const [draft, setDraft] = useState<Project | null>(null);
  const [ask, setAsk] = useState(false);
  const [msg, setMsg] = useState<{ text: string; tone: 'good' | 'warn' } | null>(null);
  useEffect(() => { loadDraft().then((p) => setDraft(p ?? null), () => setDraft(null)); }, []);

  const exportNow = async () => { if (draft && await exportProject(draft)) setMsg({ text: S.projects.exported, tone: 'good' }); };
  const startNew = async () => {
    setAsk(false);
    // 029: пользователь подтвердил замену — запрет записи, если рабочий проект не открылся, снимается
    releaseDraft();
    clearPendingDraft();
    try {
      await saveDraft(newProject());
    } catch {
      setMsg({ text: S.projects.storageOff, tone: 'warn' });
      return;
    }
    location.hash = '#room';
    location.reload();
  };

  return (
    <div class="app app--start">
      <main class="content">
        <FailurePanel
          title={S.failure.appTitle}
          text={S.failure.text}
          actions={<>
            <button type="button" class="btn btn--primary" onClick={() => location.reload()}>{S.failure.reload}</button>
            {draft?.roomReady && <button type="button" class="btn" onClick={() => void exportNow()}>{S.failure.export}</button>}
            <button type="button" class="btn" onClick={() => setAsk(true)}>{S.failure.newProject}</button>
          </>}
        >
          {msg && <Note tone={msg.tone}>{msg.text}</Note>}
        </FailurePanel>
      </main>
      {ask && (
        <ConfirmSheet title={S.failure.newTitle} text={S.failure.newText} confirm={S.failure.newProject}
          onCancel={() => setAsk(false)} onConfirm={() => void startNew()} />
      )}
    </div>
  );
}
