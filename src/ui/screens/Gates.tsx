// Закрытые экраны (021/022): расчёты, для которых ещё нет данных, — с переходом туда, где их задают.
import { Panel } from '../design-system';
import { S } from '../strings';

/** Комната ещё не создана (остаётся для старых ссылок: до создания комнаты разделов с расчётами нет в навигации). */
export function RoomFirst({ onGo }: { onGo: () => void }) {
  return (
    <div class="screen">
      <Panel title={S.roomFirst.title}>
        <p class="small">{S.roomFirst.text}</p>
        <button type="button" class="btn btn--primary" onClick={onGo}>{S.roomFirst.go}</button>
      </Panel>
    </div>
  );
}

/** Места колонок, сабвуфера и слушателя ещё не выбраны: подобрать или указать, как всё стоит. */
export function PlacementFirst({ onGo, inline = false }: { onGo: (m: 'auto' | 'manual') => void; inline?: boolean }) {
  const buttons = (
    <div class="btn-row">
      <button type="button" class="btn btn--primary" onClick={() => onGo('auto')}>{S.placementFirst.auto}</button>
      <button type="button" class="btn" onClick={() => onGo('manual')}>{S.placementFirst.manual}</button>
    </div>
  );
  if (inline) return <Panel title={S.placementFirst.title}><p class="small">{S.placementFirst.short}</p>{buttons}</Panel>;
  return (
    <div class="screen">
      <Panel title={S.placementFirst.title}>
        <p class="small">{S.placementFirst.text}</p>
        {buttons}
      </Panel>
    </div>
  );
}
