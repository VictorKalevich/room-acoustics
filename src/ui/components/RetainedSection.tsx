import { useRef } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { SectionVisibility } from './SectionVisibility';

/** Mount on first use and keep UI drafts/results when navigating away. */
export function RetainedSection({ active, children }: { active: boolean; children: ComponentChildren }) {
  const visited = useRef(false);
  if (active) visited.current = true;
  return visited.current ? <div class="retained-section" hidden={!active}><SectionVisibility visible={active}>{children}</SectionVisibility></div> : null;
}
