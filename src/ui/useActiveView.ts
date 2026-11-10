import { useLayoutEffect, useRef } from 'preact/hooks';

/** Async device permission requests may finish after the user leaves a view. */
export function useActiveView(active: boolean) {
  const ref = useRef(active);
  useLayoutEffect(() => {
    ref.current = active;
    return () => { ref.current = false; };
  }, [active]);
  return ref;
}
