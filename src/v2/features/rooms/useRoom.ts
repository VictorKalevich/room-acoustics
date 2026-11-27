// Открытая комната (V2-018, V2-025): загрузка, сохранение по очереди с проверкой конфликта, отмена и повтор,
// предпросмотр при перетаскивании без записи, выбор просматриваемой конфигурации (текущая или эксперимент).
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { ConfigRole, Room } from '../../domain/model';
import { StorageError } from '../../storage/db';
import { useApp } from '../../shared/context';

export const UNDO_LIMIT = 50;

export type RoomLoad = { status: 'loading' } | { status: 'missing' } | { status: 'error'; message: string } | { status: 'ready' };

export interface RoomHandle {
  load: RoomLoad;
  room: Room | null;
  role: ConfigRole;
  setRole: (r: ConfigRole) => void;
  /** Изменить и сохранить; `false` — не сохранено (конфликт или ошибка), комната перечитана. */
  edit: (fn: (r: Room) => Room, label?: string) => Promise<boolean>;
  /** Показать изменение без записи (перетаскивание); следующий `edit` или `cancelPreview` его заменяет. */
  preview: (fn: (r: Room) => Room) => void;
  cancelPreview: () => void;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string | null;
  redoLabel: string | null;
  error: string | null;
  reload: () => void;
}

/** Выбранная конфигурация запоминается на время сессии для каждой комнаты. */
const roleMemory = new Map<string, ConfigRole>();

interface Step { room: Room; label: string }

export function useRoom(id: string): RoomHandle {
  const { rooms } = useApp();
  const [load, setLoad] = useState<RoomLoad>({ status: 'loading' });
  const [committed, setCommitted] = useState<Room | null>(null);
  const [shown, setShown] = useState<Room | null>(null);
  const [role, setRoleState] = useState<ConfigRole>(roleMemory.get(id) ?? 'current');
  const [error, setError] = useState<string | null>(null);
  const [stacks, setStacks] = useState<{ past: Step[]; future: Step[] }>({ past: [], future: [] });
  const base = useRef<Room | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoad({ status: 'loading' });
    rooms.open(id).then((r) => {
      if (!alive) return;
      base.current = r ?? null;
      setCommitted(r ?? null);
      setShown(r ?? null);
      setLoad(r ? { status: 'ready' } : { status: 'missing' });
      if (r && !r.experimental && roleMemory.get(id) === 'experimental') { roleMemory.set(id, 'current'); setRoleState('current'); }
    }, (e) => alive && setLoad({ status: 'error', message: e instanceof Error ? e.message : String(e) }));
    return () => { alive = false; };
  }, [id, rooms, reloadTick]);

  const reload = useCallback(() => { setStacks({ past: [], future: [] }); setReloadTick((t) => t + 1); }, []);

  const write = useCallback((next: Room, undoStep: Step | null, mode: 'edit' | 'undo' | 'redo') => {
    const run = queue.current.then(async () => {
      const prev = base.current;
      if (!prev) return false;
      try {
        const stored = await rooms.save(next, prev);
        base.current = stored;
        setCommitted(stored);
        setShown(stored);
        setError(null);
        if (undoStep) {
          setStacks((s) => mode === 'undo'
            ? { past: s.past.slice(0, -1), future: [...s.future, undoStep] }
            : mode === 'redo'
              ? { past: [...s.past, undoStep], future: s.future.slice(0, -1) }
              : { past: [...s.past, undoStep].slice(-UNDO_LIMIT), future: [] });
        }
        return true;
      } catch (e) {
        const conflict = e instanceof StorageError && e.kind === 'conflict';
        setError(conflict ? 'Комната изменена в другой вкладке или окне. Показана сохранённая версия; повторите изменение.' : e instanceof Error ? e.message : String(e));
        setShown(base.current);
        if (conflict) reload();
        return false;
      }
    });
    queue.current = run.catch(() => undefined);
    return run;
  }, [rooms, reload]);

  const edit = useCallback(async (fn: (r: Room) => Room, label = 'Изменение') => {
    const cur = base.current;
    if (!cur) return false;
    let next: Room;
    try { next = fn(cur); } catch (e) { setError(e instanceof Error ? e.message : String(e)); setShown(cur); return false; }
    if (next === cur) { setShown(cur); return true; }
    return write(next, { room: cur, label }, 'edit');
  }, [write]);

  const preview = useCallback((fn: (r: Room) => Room) => { if (base.current) setShown(fn(base.current)); }, []);
  const cancelPreview = useCallback(() => setShown(base.current), []);

  const undo = useCallback(async () => {
    const step = stacks.past.at(-1);
    const cur = base.current;
    if (!step || !cur) return;
    await write({ ...step.room, updatedAt: cur.updatedAt }, { room: cur, label: step.label }, 'undo');
  }, [stacks, write]);

  const redo = useCallback(async () => {
    const step = stacks.future.at(-1);
    const cur = base.current;
    if (!step || !cur) return;
    await write({ ...step.room, updatedAt: cur.updatedAt }, { room: cur, label: step.label }, 'redo');
  }, [stacks, write]);

  const setRole = useCallback((r: ConfigRole) => { roleMemory.set(id, r); setRoleState(r); }, [id]);
  const effectiveRole: ConfigRole = role === 'experimental' && !shown?.experimental ? 'current' : role;

  return {
    load, room: shown ?? committed, role: effectiveRole, setRole, edit, preview, cancelPreview, undo, redo,
    canUndo: stacks.past.length > 0, canRedo: stacks.future.length > 0,
    undoLabel: stacks.past.at(-1)?.label ?? null, redoLabel: stacks.future.at(-1)?.label ?? null,
    error, reload,
  };
}
