import { useEffect, useRef, useState } from 'preact/hooks';
import type { Project } from '../state/project';
import { defaultConstraints, newProject, syncSetup } from '../state/project';
import { clearPendingDraft, DraftLoadError, loadDraft, releaseDraft, saveDraft, stashPendingDraft } from '../state/storage';
import type { Constraints, Room, Setup, SourceSpec } from '../core/types';
import type { VoiceSettings } from '../core/voice';
import type { Precision } from '../core/precision';
import { clampToRoom } from '../core/system';
import { baselinePositions } from '../core/placement';
import { markPlaced } from '../state/variant';
import { setBeforeReload } from './updates';
import { logError } from '../state/errlog';

/**
 * Приводит расстановку к текущим источникам и размерам комнаты. 022: пока места текущей расстановки не выбраны,
 * они — места по умолчанию для этой комнаты (а не места комнаты нового проекта, сдвинутые внутрь стен).
 */
function fitSetup(s: Setup, p: Project, current = false): Setup {
  const base = current && !s.placed ? { ...s, ...baselinePositions(p.room, p.sources, p.constraints) } : s;
  const synced = syncSetup(base, p.room, p.sources, p.constraints);
  return {
    ...synced,
    listener: clampToRoom(p.room, synced.listener, 0.1),
    positions: Object.fromEntries(Object.entries(synced.positions).map(([k, v]) => [k, clampToRoom(p.room, v)])),
  };
}

/** Держит зону слушателя внутри комнаты после изменения размеров. */
function fitConstraints(c: Constraints, room: Room): Constraints {
  const d = defaultConstraints(room);
  const bad = c.listenerMaxX >= room.depth - 0.05 || c.listenerMinX >= c.listenerMaxX || c.listenerMinX <= 0;
  return bad ? { ...c, listenerMinX: d.listenerMinX, listenerMaxX: d.listenerMaxX } : c;
}

/** 029: рабочий проект есть, но не открылся при запуске — что показать вместо приложения. */
export type DraftProblem = { kind: 'unreadable' } | { kind: 'invalid'; reason: string; raw: unknown };

export function useProject() {
  const [project, setProject] = useState<Project>(() => newProject());
  // проект открыт (или черновика нет) — только тогда работают приложение и все пути записи черновика ниже
  const [ready, setReady] = useState(false);
  // 029: черновик не открылся — вместо приложения сообщение; прежний черновик до выбора пользователя не перезаписывается
  const [problem, setProblem] = useState<DraftProblem | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    loadDraft()
      .then((d) => { if (d) setProject(d); setReady(true); })
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
  const startNew = () => { releaseDraft(); setProject(newProject()); setProblem(null); setReady(true); };

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

  const touch = (patch: Partial<Project> | ((prev: Project) => Partial<Project>), invalidate = true) =>
    setProject((prev) => {
      const p = typeof patch === 'function' ? patch(prev) : patch;
      const next: Project = {
        ...prev,
        ...p,
        updatedAt: new Date().toISOString(),
        // явно переданный результат (в том числе null после очистки комнаты) важнее пометки «устарел»
        result: p.result !== undefined ? p.result : invalidate && prev.result ? { ...prev.result, stale: true } : prev.result,
      };
      if (p.room || p.sources || p.constraints || p.current) {
        next.current = fitSetup(next.current, next, true);
        if (p.room || p.sources) next.setups = next.setups.map((x) => fitSetup(x, next));
      }
      return next;
    });

  const onRoom = (room: Room, extra: Partial<Project> = {}) =>
    touch({ ...extra, room, constraints: fitConstraints(extra.constraints ?? project.constraints, room) });
  const onSources = (sources: SourceSpec[]) => touch({ sources });
  const onConstraints = (constraints: Constraints) => touch({ constraints });
  // изменение мест пользователем — места выбраны (022)
  const onSetup = (current: Setup) => touch((prev) => ({ current: markPlaced(prev.current, current) }), false);
  const onSetups = (setups: Setup[]) => touch({ setups }, false);
  const onVoice = (voice: VoiceSettings) => touch({ voice }, false);
  // 026: другая точность — другие числа; результат подбора помечается устаревшим
  const onPrecision = (precision: Precision) => touch({ precision: precision === 'standard' ? undefined : precision });
  return { project, setProject, ready, problem, retry, startNew, touch, onRoom, onSources, onConstraints, onSetup, onSetups, onVoice, onPrecision };
}
