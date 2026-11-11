// 021: экраны с расчётами, пока комната не создана, — переход к созданию комнаты.
import { Panel } from '../design-system';
import { S } from '../strings';

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
