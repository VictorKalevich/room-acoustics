// Полоска помощника сверху экрана: текущий шаг и переход к нему.
import type { Project } from '../../state/project';
import { STEPS, manualDone, setManualDone, stepDone, type WizardTab } from '../wizard';
import { S } from '../strings';

export function WizardStrip({ project, onGo, onChange }: { project: Project; onGo: (t: WizardTab) => void; onChange: () => void }) {
  const manual = manualDone(project.id);
  const idx = STEPS.findIndex((s) => !stepDone(project, s, manual));
  if (idx < 0) {
    return <div class="wizard-strip is-done" role="status">{S.wizard.allDone}</div>;
  }
  const s = STEPS[idx];
  return (
    <div class="wizard-strip" role="region" aria-label={S.wizard.title}>
      <span class="wizard-strip__text">
        <strong>{S.wizard.step(idx + 1, STEPS.length)}: {s.title}.</strong> {s.hint}
      </span>
      <span class="wizard-strip__btns">
        <button type="button" class="btn btn--small" onClick={() => onGo(s.tab)}>{S.wizard.open}</button>
        <button type="button" class="btn btn--small btn--ghost" onClick={() => { setManualDone(project.id, [...manual, s.id]); onChange(); }}>{S.wizard.done}</button>
      </span>
    </div>
  );
}
