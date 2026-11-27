// Правка просматриваемой конфигурации (текущей или эксперимента) через открытую комнату: каждая операция
// увеличивает ревизию конфигурации и сохраняется с проверкой конфликта, отменяется и повторяется.
import { updateConfig } from '../../domain/operations';
import type { ConfigRole, Room, RoomConfiguration } from '../../domain/model';
import { useApp } from '../../shared/context';
import type { RoomHandle } from '../rooms/useRoom';

export interface ConfigEdit {
  config: RoomConfiguration;
  role: ConfigRole;
  apply: (op: (c: RoomConfiguration) => RoomConfiguration, label: string) => Promise<boolean>;
  preview: (op: (c: RoomConfiguration) => RoomConfiguration) => void;
  cancelPreview: () => void;
}

/** Операция, вернувшая ту же конфигурацию (закреплённый объект, то же значение), — не изменение: комната та же. */
function step(r: Room, role: ConfigRole, op: (c: RoomConfiguration) => RoomConfiguration, now: string): Room {
  const base = role === 'experimental' ? r.experimental : r.current;
  if (!base) throw new Error('Экспериментальной конфигурации нет.');
  const next = op(base);
  return next === base ? r : updateConfig(r, role, () => next, now);
}

export function useConfig(h: RoomHandle): ConfigEdit {
  const { clock } = useApp();
  const room = h.room!;
  const role = h.role;
  const config = role === 'experimental' && room.experimental ? room.experimental : room.current;
  return {
    config,
    role,
    apply: (op, label) => h.edit((r) => step(r, role, op, clock.now()), label),
    preview: (op) => { try { h.preview((r) => step(r, role, op, clock.now())); } catch { /* предпросмотр недопустимого положения не показывается */ } },
    cancelPreview: h.cancelPreview,
  };
}
