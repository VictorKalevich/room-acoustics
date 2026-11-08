// Помощник по шагам и словарь терминов.
import { Fragment } from 'preact';
import { useState } from 'preact/hooks';
import type { Project } from '../../state/project';
import { STEPS, manualDone, setManualDone, setWizardOn, stepDone, wizardOn, type WizardTab } from '../wizard';
import { GLOSSARY } from '../glossary';
import { Panel } from '../components/Fields';
import { S } from '../strings';

export function HelpScreen({ project, onGo, onWizard }: { project: Project; onGo: (t: WizardTab) => void; onWizard: () => void }) {
  const [on, setOn] = useState(wizardOn());
  const [manual, setManual] = useState(manualDone(project.id));
  const [q, setQ] = useState('');
  const toggle = (id: string, v: boolean) => {
    const next = v ? [...manual, id] : manual.filter((x) => x !== id);
    setManual(next);
    setManualDone(project.id, next);
    onWizard();
  };
  const terms = GLOSSARY.filter((t) => !q || (t.title + ' ' + t.text).toLowerCase().includes(q.toLowerCase()));
  return (
    <div class="screen">
      <Panel title={S.wizard.title}>
        <label class="check">
          <input type="checkbox" checked={on} onChange={(e) => { const v = (e.target as HTMLInputElement).checked; setOn(v); setWizardOn(v); onWizard(); }} />
          <span>{S.wizard.toggle}</span>
        </label>
        <ol class="wizard-list">
          {STEPS.map((s) => {
            const done = stepDone(project, s, manual);
            const auto = !!s.auto?.(project);
            return (
              <li key={s.id} class={done ? 'is-done' : ''}>
                <label class="check">
                  <input type="checkbox" checked={done} disabled={auto} onChange={(e) => toggle(s.id, (e.target as HTMLInputElement).checked)} />
                  <span><strong>{s.title}.</strong> {s.hint}</span>
                </label>
                <button type="button" class="btn btn--small btn--ghost" onClick={() => onGo(s.tab)}>{S.wizard.open}</button>
              </li>
            );
          })}
        </ol>
        <p class="muted small">{S.wizard.note}</p>
      </Panel>
      <Panel title={S.glossary.title}>
        <div class="field">
          <label for="gl-q">{S.glossary.search}</label>
          <div class="field__box"><input id="gl-q" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} /></div>
        </div>
        <dl class="glossary">
          {terms.map((t) => (
            <Fragment key={t.id}>
              <dt>{t.title}</dt>
              <dd class="small">{t.text}</dd>
            </Fragment>
          ))}
        </dl>
      </Panel>
    </div>
  );
}
