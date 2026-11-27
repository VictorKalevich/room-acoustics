// Первый запуск (V2-016, макеты M01/D01): выбор уровня сложности. Выбор запоминается и меняется в настройках.
import { useState } from 'preact/hooks';
import { Button, Icon } from '../../design-system';
import { COMPLEXITIES, COMPLEXITY_LABEL, COMPLEXITY_TEXT } from '../../application/settings';
import type { Complexity } from '../../domain/model';
import { useApp } from '../../shared/context';
import { Screen } from '../../shared/Screen';

export function FirstRun() {
  const { updateSettings } = useApp();
  const [level, setLevel] = useState<Complexity>('simple');
  const [busy, setBusy] = useState(false);
  return (
    <Screen title="Выбор сложности" reading>
      <div class="al-stack al-stack--24">
        <div class="al-stack al-stack--8">
          <p class="al-text-overline">Room Acoustics</p>
          <h1 class="al-text-headline">Как подробно показывать акустику?</h1>
          <p class="al-text-secondary">Уровень меняет только объём деталей. Расчёты и данные одинаковы на всех уровнях, скрытые параметры не теряются. Уровень можно сменить в настройках в любое время.</p>
        </div>
        <fieldset class="al-choices">
          <legend class="al-visually-hidden">Уровень сложности</legend>
          {COMPLEXITIES.map((c) => (
            <label key={c} class="al-choice">
              <input type="radio" name="complexity" value={c} checked={level === c} onChange={() => setLevel(c)} />
              <span class="al-choice__body">
                <span class="al-choice__title">{COMPLEXITY_LABEL[c]}</span>
                <span class="al-choice__text">{COMPLEXITY_TEXT[c]}</span>
              </span>
              <Icon name="check" class="al-choice__mark" />
            </label>
          ))}
        </fieldset>
        <Button variant="primary" block busy={busy} onClick={async () => { setBusy(true); await updateSettings((s) => ({ ...s, complexity: level })); }}>Продолжить</Button>
      </div>
    </Screen>
  );
}
