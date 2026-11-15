import { useEffect, useRef, useState } from 'preact/hooks';
import type { Project } from '../state/project';
import { newProject } from '../state/project';
import { clearPendingDraft, DraftLoadError, loadDraft, releaseDraft, saveDraft, stashPendingDraft } from '../state/storage';
import {
  changeConstraints, changePrecision, changeRoom, changeSetup, changeSetups, changeSources, changeVoice, renameProject,
  replaceProject, selectVariant, setResult, type Transition,
} from '../state/transitions';
import type { Constraints, PlacementResult, Room, Setup, SourceSpec } from '../core/types';
import type { VoiceSettings } from '../core/voice';
import type { Precision } from '../core/precision';
import { setBeforeReload } from './updates';
import { logError } from '../state/errlog';

/** 029: рабочий проект есть, но не открылся при запуске — что показать вместо приложения. */
export type DraftProblem = { kind: 'unreadable' } | { kind: 'invalid'; reason: string; raw: unknown };

/**
 * Рабочий проект: загрузка черновика, сохранение на устройство и обработчики изменений для экранов.
 * Правила изменения проекта — переходы `src/state/transitions.ts` (031).
 */
export function useProject() {
  const [project, setProject] = useState<Project>(() => newProject());
  // проект открыт (или черновика нет) — только тогда работают приложение и все пути записи черновика ниже
  const [ready, setReady] = useState(false);
  // 029: черновик не открылся — вместо приложения сообщение; прежний черновик до выбора пользователя не перезаписывается
  const [problem, setProblem] = useState<DraftProblem | null>(null);
  const [attempt, setAttempt] = useState(0);
  /** Единственный путь изменения проекта: переход от предыдущего состояния со временем изменения. */
  const apply = (t: Transition) => setProject((prev) => t(prev, new Date().toISOString()));
  useEffect(() => {
    loadDraft()
      .then((d) => { if (d) apply(replaceProject(d)); setReady(true); })
      .catch((e: unknown) => {
        if (e instanceof DraftLoadError && e.kind === 'invalid') {
          logError('error', e.error, 'черновик проекта не открылся; копия сохранена как draft-failed');
          setProblem({ kind: 'invalid', reason: e.message, raw: e.raw });
        } else {
          logError('error', e instanceof DraftLoadError ? e.error : e, 'черновик проекта не прочитан');
          setProblem({ kind: 'unreadable' });
        }
      });
  }, [attempt]);
  /** «Повторить»: прочитать черновик снова (с повторами), пока видно «Открываем проект…». */
  const retry = () => { setProblem(null); setAttempt((n) => n + 1); };
  /** «Начать новый проект» после подтверждения: новый проект, прежний черновик заменит отложенное сохранение. */
  const startNew = () => { releaseDraft(); apply(replaceProject(newProject())); setProblem(null); setReady(true); };

  useEffect(() => {
    if (ready) setBeforeReload(() => saveDraft(project));
  }, [project, ready]);

  // последнее состояние и то, что уже записано на устройство
  const latest = useRef(project);
  const saved = useRef<Project | null>(null);
  useEffect(() => {
    latest.current = project;
    if (!ready) return;
    const t = setTimeout(() => {
      saveDraft(project)
        .then(() => { saved.current = project; if (latest.current === project) clearPendingDraft(); })
        .catch(() => undefined);
    }, 300);
    return () => clearTimeout(t);
  }, [project, ready]);

  // Страницу закрывают, перезагружают или сворачивают раньше, чем сработало отложенное сохранение (оно ждёт 300 мс
  // после последнего изменения): несохранённое состояние пишется сразу. Иначе правка, сделанная за мгновение до
  // закрытия, пропадала, а при быстрой череде правок не сохранялась ни одна.
  useEffect(() => {
    if (!ready) return;
    const flush = () => {
      if (saved.current === latest.current) return;
      stashPendingDraft(latest.current);
      saveDraft(latest.current).catch(() => undefined);
    };
    const onHide = () => { if (document.visibilityState === 'hidden') flush(); };
    addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onHide);
    return () => { removeEventListener('pagehide', flush); document.removeEventListener('visibilitychange', onHide); };
  }, [ready]);

  // ограничения — из этой отрисовки, как и раньше (031, FR-3103): так их видел экран, который прислал комнату
  const onRoom = (room: Room, extra: Partial<Project> = {}) => apply(changeRoom(room, extra, project.constraints));
  const onSources = (sources: SourceSpec[]) => apply(changeSources(sources));
  const onConstraints = (constraints: Constraints) => apply(changeConstraints(constraints));
  const onSetup = (current: Setup) => apply(changeSetup(current));
  const onSetups = (setups: Setup[]) => apply(changeSetups(setups));
  const onVoice = (voice: VoiceSettings) => apply(changeVoice(voice));
  const onPrecision = (precision: Precision) => apply(changePrecision(precision));
  const onResult = (result: PlacementResult & { stale?: boolean }, selectedIndex: number) => apply(setResult(result, selectedIndex));
  const onRename = (name: string) => apply(renameProject(name));
  const onSelect = (selectedIndex: number) => apply(selectVariant(selectedIndex));
  const onReplace = (next: Project) => apply(replaceProject(next));
  return {
    project, ready, problem, retry, startNew,
    onRoom, onSources, onConstraints, onSetup, onSetups, onVoice, onPrecision, onResult, onRename, onSelect, onReplace,
  };
}
