import { useState } from 'preact/hooks';
import type { StateUpdater } from 'preact/hooks';

// Ephemeral view preferences are scoped to a project, never written into its file.
const values = new Map<string, unknown>();
export function useViewState<T>(projectId: string, name: string, initial: T): [T, (next: StateUpdater<T>) => void] {
  const key = `${projectId}:${name}`;
  const [value, setValue] = useState<T>(() => values.has(key) ? values.get(key) as T : initial);
  const update = (next: StateUpdater<T>) => setValue((previous) => {
    const resolved = typeof next === 'function' ? (next as (p: T) => T)(previous) : next;
    values.set(key, resolved);
    return resolved;
  });
  return [value, update];
}
